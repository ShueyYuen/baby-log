import type { UploadMomentResult } from './api';

const API_BASE = '/api/v1';

const DEFAULT_CHUNK_SIZE = 2 * 1024 * 1024; // 2MB — stays under common nginx body limits
const MIN_CHUNK_SIZE = 1 * 1024 * 1024; // 1MB
const MAX_CHUNK_SIZE = 8 * 1024 * 1024; // 8MB
const LARGE_FILE_THRESHOLD = 32 * 1024 * 1024; // only very large files use chunked
const MAX_CONCURRENT = 3;
const MAX_RETRIES = 3;
const HEIC_EXT = /\.hei[cf]$/i;

function getToken(): string | null {
  return localStorage.getItem('token');
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface ChunkedInitResponse {
  data: {
    uploadId: string;
    key: string;
    mode: string;
    totalParts: number;
    chunkSize: number;
  };
}

export function isLargeFile(file: File): boolean {
  return file.size > LARGE_FILE_THRESHOLD;
}

export function isHeicFile(file: File): boolean {
  const type = (file.type || '').toLowerCase();
  if (type === 'image/heic' || type === 'image/heif') return true;
  return HEIC_EXT.test(file.name);
}

/** Convert HEIC/HEIF to JPEG so iPhone photos can be stored and displayed everywhere. */
export async function toUploadableFile(file: File): Promise<File> {
  if (!isHeicFile(file)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('HEIC conversion failed'))),
        'image/jpeg',
        0.9,
      );
    });
    const name = file.name.replace(HEIC_EXT, '.jpg') || 'photo.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch (e) {
    console.warn('[Upload] HEIC conversion failed, uploading original', e);
    return file;
  }
}

function guessContentType(file: File): string {
  if (file.type && file.type !== 'application/octet-stream') return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'mp4':
    case 'm4v':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'webm':
      return 'video/webm';
    case 'avi':
      return 'video/x-msvideo';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'heic':
    case 'heif':
      return 'image/heic';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return file.type || 'video/mp4';
  }
}

interface UploadSession {
  uploadId: string;
  key: string;
  fileSize: number;
  chunkSize: number;
  totalParts: number;
  completedParts: Set<number>;
}

const SESSION_KEY_PREFIX = 'chunked_upload_';

function saveSession(fileId: string, session: UploadSession) {
  try {
    const data = {
      ...session,
      completedParts: Array.from(session.completedParts),
    };
    sessionStorage.setItem(SESSION_KEY_PREFIX + fileId, JSON.stringify(data));
  } catch { /* ignore quota errors */ }
}

function loadSession(fileId: string): UploadSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY_PREFIX + fileId);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return {
      ...data,
      completedParts: new Set(data.completedParts),
    };
  } catch {
    return null;
  }
}

function clearSession(fileId: string) {
  sessionStorage.removeItem(SESSION_KEY_PREFIX + fileId);
}

function getFileId(file: File): string {
  return `${file.name}_${file.size}_${file.lastModified}`;
}

function adaptChunkSize(bytesTransferred: number, elapsedMs: number, currentChunkSize: number): number {
  if (elapsedMs <= 0) return currentChunkSize;

  const speedBps = (bytesTransferred / elapsedMs) * 1000;
  const targetSeconds = 10;
  let ideal = speedBps * targetSeconds;
  ideal = Math.max(MIN_CHUNK_SIZE, Math.min(MAX_CHUNK_SIZE, ideal));
  const adjusted = currentChunkSize + (ideal - currentChunkSize) * 0.5;
  return Math.max(MIN_CHUNK_SIZE, Math.min(MAX_CHUNK_SIZE, Math.round(adjusted)));
}

function uploadPart(
  url: string,
  blob: Blob,
  onProgress: (loaded: number) => void,
): Promise<void> {
  const token = getToken();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      let msg = `Part failed: ${xhr.status}`;
      try {
        const err = JSON.parse(xhr.responseText);
        if (err.error) msg = err.error;
      } catch { /* ignore */ }
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(blob);
  });
}

export async function uploadLargeFile(
  file: File,
  prefix: string,
  onProgress?: (percent: number) => void,
): Promise<UploadMomentResult> {
  const fileId = getFileId(file);
  let session = loadSession(fileId);

  console.log(`[ChunkedUpload] Starting: file=${file.name} size=${(file.size / 1024 / 1024).toFixed(1)}MB prefix=${prefix}`);

  if (session) {
    const valid = await validateSession(session);
    if (!valid) {
      console.log('[ChunkedUpload] Previous session expired, starting fresh');
      clearSession(fileId);
      session = null;
    } else {
      console.log(`[ChunkedUpload] Resuming: ${session.completedParts.size}/${session.totalParts} parts done`);
    }
  }

  if (!session) {
    session = await initSession(file, prefix);
    saveSession(fileId, session);
    console.log(`[ChunkedUpload] Initialized: uploadId=${session.uploadId} totalParts=${session.totalParts} chunkSize=${(session.chunkSize / 1024 / 1024).toFixed(0)}MB`);
  }

  const { uploadId, totalParts, chunkSize } = session;
  let currentChunkSize = chunkSize;
  let uploadedBytes = 0;
  const inFlight = new Map<number, number>();

  const emitProgress = () => {
    let extra = 0;
    for (const n of inFlight.values()) extra += n;
    const pct = Math.min(99, Math.round(((uploadedBytes + extra) / file.size) * 100));
    onProgress?.(pct);
  };

  for (const partNum of session.completedParts) {
    const start = partNum * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    uploadedBytes += (end - start);
  }
  emitProgress();

  const remaining: number[] = [];
  for (let i = 0; i < totalParts; i++) {
    if (!session.completedParts.has(i)) {
      remaining.push(i);
    }
  }

  const errors: Error[] = [];
  const queue = [...remaining];

  const uploadWorker = async () => {
    while (queue.length > 0 && errors.length === 0) {
      const partIndex = queue.shift();
      if (partIndex === undefined) break;

      const start = partIndex * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);
      const partBytes = end - start;

      const t0 = performance.now();
      let success = false;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          inFlight.set(partIndex, 0);
          await uploadPart(
            `${API_BASE}/upload/chunked/part/${uploadId}?partNumber=${partIndex + 1}&offset=${start}`,
            chunk,
            (loaded) => {
              inFlight.set(partIndex, loaded);
              emitProgress();
            },
          );
          success = true;
          break;
        } catch (e) {
          inFlight.set(partIndex, 0);
          emitProgress();
          if (attempt === MAX_RETRIES - 1) {
            errors.push(e instanceof Error ? e : new Error(String(e)));
          }
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }

      if (success) {
        const elapsed = performance.now() - t0;
        const speed = ((partBytes / 1024 / 1024) / (elapsed / 1000)).toFixed(1);

        inFlight.delete(partIndex);
        session!.completedParts.add(partIndex);
        saveSession(fileId, session!);

        uploadedBytes += partBytes;
        emitProgress();

        console.log(`[ChunkedUpload] Part ${partIndex + 1}/${totalParts} done (${speed} MB/s)`);

        currentChunkSize = adaptChunkSize(partBytes, elapsed, currentChunkSize);
      }
    }
  };

  const workers: Promise<void>[] = [];
  const concurrency = Math.min(MAX_CONCURRENT, remaining.length);
  for (let i = 0; i < concurrency; i++) {
    workers.push(uploadWorker());
  }
  await Promise.all(workers);

  if (errors.length > 0) {
    console.error(`[ChunkedUpload] Failed after retries:`, errors[0].message);
    throw new Error(`Upload failed: ${errors[0].message}`);
  }

  console.log(`[ChunkedUpload] All parts uploaded, calling complete...`);
  const completeRes = await fetch(`${API_BASE}/upload/chunked/complete/${uploadId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'same-origin',
  });
  if (!completeRes.ok) {
    const err = await completeRes.json().catch(() => ({}));
    console.error(`[ChunkedUpload] Complete failed: status=${completeRes.status}`, err);
    throw new Error((err as any).error || 'Failed to complete upload');
  }

  clearSession(fileId);
  onProgress?.(100);

  const completeData = await completeRes.json();
  const result = completeData.data?.[0] || completeData.data;
  const mediaType: 'image' | 'video' = file.type.startsWith('image/') ? 'image' : 'video';
  console.log(`[ChunkedUpload] Complete! key=${result.key} url=${result.url}`);
  return { url: result.url, key: result.key, rawUrl: result.rawUrl, rawKey: result.rawKey, mediaType };
}

async function initSession(file: File, prefix: string): Promise<UploadSession> {
  const chunkSize = selectInitialChunkSize(file.size);

  const initRes = await fetch(`${API_BASE}/upload/chunked/init/${prefix}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'same-origin',
    body: JSON.stringify({
      filename: file.name,
      contentType: guessContentType(file),
      fileSize: file.size,
      chunkSize,
    }),
  });
  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to initiate upload');
  }
  const initData: ChunkedInitResponse = await initRes.json();
  const { uploadId, key, totalParts, chunkSize: serverChunkSize } = initData.data;

  return {
    uploadId,
    key,
    fileSize: file.size,
    chunkSize: serverChunkSize,
    totalParts,
    completedParts: new Set(),
  };
}

async function validateSession(session: UploadSession): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/upload/chunked/status/${session.uploadId}`, {
      headers: { ...authHeaders() },
      credentials: 'same-origin',
    });
    return res.ok;
  } catch {
    return false;
  }
}

function selectInitialChunkSize(fileSize: number): number {
  if (fileSize < 64 * 1024 * 1024) return MIN_CHUNK_SIZE;
  if (fileSize < 200 * 1024 * 1024) return DEFAULT_CHUNK_SIZE;
  if (fileSize < 500 * 1024 * 1024) return 4 * 1024 * 1024;
  return MAX_CHUNK_SIZE;
}
