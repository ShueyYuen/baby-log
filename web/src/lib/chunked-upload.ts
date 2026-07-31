import type { UploadMomentResult } from './api';

const API_BASE = '/api/v1';

const DEFAULT_CHUNK_SIZE = 50 * 1024 * 1024; // 50MB
const MIN_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_CHUNK_SIZE = 200 * 1024 * 1024; // 200MB
const LARGE_FILE_THRESHOLD = 200 * 1024 * 1024; // 200MB
const MAX_CONCURRENT = 3;
const MAX_RETRIES = 3;

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

interface UploadSession {
  uploadId: string;
  key: string;
  fileSize: number;
  chunkSize: number;
  totalParts: number;
  completedParts: Set<number>;
}

// Stored sessions for resume capability
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

// Adaptive chunk size based on measured speed
function adaptChunkSize(bytesTransferred: number, elapsedMs: number, currentChunkSize: number): number {
  if (elapsedMs <= 0) return currentChunkSize;

  const speedBps = (bytesTransferred / elapsedMs) * 1000;

  // Target: each chunk takes 5-15 seconds
  const targetSeconds = 10;
  let ideal = speedBps * targetSeconds;

  ideal = Math.max(MIN_CHUNK_SIZE, Math.min(MAX_CHUNK_SIZE, ideal));

  // Smooth: only adjust by 50% toward ideal to avoid oscillation
  const adjusted = currentChunkSize + (ideal - currentChunkSize) * 0.5;
  return Math.max(MIN_CHUNK_SIZE, Math.min(MAX_CHUNK_SIZE, Math.round(adjusted)));
}

export async function uploadLargeFile(
  file: File,
  prefix: string,
  onProgress?: (percent: number) => void,
): Promise<UploadMomentResult> {
  const fileId = getFileId(file);
  let session = loadSession(fileId);

  // Try to resume existing session
  if (session) {
    const valid = await validateSession(session);
    if (!valid) {
      clearSession(fileId);
      session = null;
    }
  }

  // Initialize new session if needed
  if (!session) {
    session = await initSession(file, prefix);
    saveSession(fileId, session);
  }

  const { uploadId, key, totalParts, chunkSize } = session;
  let currentChunkSize = chunkSize;
  let uploadedBytes = 0;

  // Count already-completed bytes for progress
  for (const partNum of session.completedParts) {
    const start = partNum * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    uploadedBytes += (end - start);
  }
  onProgress?.(Math.round((uploadedBytes / file.size) * 100));

  // Build queue of remaining parts
  const remaining: number[] = [];
  for (let i = 0; i < totalParts; i++) {
    if (!session.completedParts.has(i)) {
      remaining.push(i);
    }
  }

  // Upload with parallel workers
  const errors: Error[] = [];
  const queue = [...remaining];

  const uploadWorker = async () => {
    while (queue.length > 0 && errors.length === 0) {
      const partIndex = queue.shift();
      if (partIndex === undefined) break;

      const start = partIndex * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);

      const t0 = performance.now();
      let success = false;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const res = await fetch(
            `${API_BASE}/upload/chunked/part/${uploadId}?partNumber=${partIndex + 1}&offset=${start}`,
            {
              method: 'POST',
              headers: { ...authHeaders() },
              credentials: 'same-origin',
              body: chunk,
            },
          );
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error((errData as any).error || `Part ${partIndex + 1} failed: ${res.status}`);
          }
          success = true;
          break;
        } catch (e) {
          if (attempt === MAX_RETRIES - 1) {
            errors.push(e instanceof Error ? e : new Error(String(e)));
          }
          // Exponential backoff
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }

      if (success) {
        const elapsed = performance.now() - t0;
        const partBytes = end - start;

        session!.completedParts.add(partIndex);
        saveSession(fileId, session!);

        uploadedBytes += partBytes;
        onProgress?.(Math.round((uploadedBytes / file.size) * 100));

        // Adapt chunk size (informational only - used for next upload since parts are fixed)
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
    throw new Error(`Upload failed: ${errors[0].message}`);
  }

  // Complete
  const completeRes = await fetch(`${API_BASE}/upload/chunked/complete/${uploadId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'same-origin',
  });
  if (!completeRes.ok) {
    const err = await completeRes.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to complete upload');
  }

  clearSession(fileId);

  const completeData = await completeRes.json();
  const result = completeData.data?.[0] || completeData.data;
  const mediaType: 'image' | 'video' = file.type.startsWith('image/') ? 'image' : 'video';
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
      contentType: file.type || 'video/mp4',
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
  // For files under 500MB, use 20MB chunks (faster feedback)
  if (fileSize < 500 * 1024 * 1024) return 20 * 1024 * 1024;
  // For files under 2GB, use 50MB chunks
  if (fileSize < 2 * 1024 * 1024 * 1024) return DEFAULT_CHUNK_SIZE;
  // For files over 2GB, use 100MB chunks (reduce overhead)
  return 100 * 1024 * 1024;
}
