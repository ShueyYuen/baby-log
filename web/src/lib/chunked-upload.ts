import type { UploadMomentResult } from './api';

const API_BASE = '/api/v1';
const CHUNK_SIZE = 50 * 1024 * 1024; // 50MB per chunk
const MAX_CONCURRENT = 3;
const LARGE_FILE_THRESHOLD = 200 * 1024 * 1024; // 200MB

function getToken(): string | null {
  return localStorage.getItem('token');
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface MultipartInitResponse {
  data: {
    uploadId: string;
    key: string;
    mediaType: 'image' | 'video';
    parts: { partNumber: number; uploadUrl: string }[];
  };
}

interface ChunkedInitResponse {
  data: {
    uploadId: string;
    key: string;
    mode: string;
  };
}

interface StorageModeResponse {
  data: { directUpload: boolean } | MultipartInitResponse['data'];
}

export function isLargeFile(file: File): boolean {
  return file.size > LARGE_FILE_THRESHOLD;
}

export async function uploadLargeFile(
  file: File,
  prefix: string,
  onProgress?: (percent: number) => void,
): Promise<UploadMomentResult> {
  const storageMode = await detectStorageMode(prefix);

  if (storageMode === 's3') {
    return uploadViaS3Multipart(file, prefix, onProgress);
  }
  return uploadViaChunked(file, prefix, onProgress);
}

async function detectStorageMode(prefix: string): Promise<'s3' | 'local'> {
  const res = await fetch(`${API_BASE}/upload/presign/${prefix}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'same-origin',
    body: JSON.stringify({ filename: 'probe.mp4', contentType: 'video/mp4' }),
  });
  const data = await res.json();
  return data.data?.directUpload ? 's3' : 'local';
}

// ─── S3 Multipart Upload ─────────────────────────────────────────────────────

async function uploadViaS3Multipart(
  file: File,
  prefix: string,
  onProgress?: (percent: number) => void,
): Promise<UploadMomentResult> {
  const numChunks = Math.ceil(file.size / CHUNK_SIZE);

  const initRes = await fetch(`${API_BASE}/upload/multipart/init/${prefix}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'same-origin',
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || 'video/mp4',
      fileSize: file.size,
      chunkSize: CHUNK_SIZE,
    }),
  });
  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to initiate multipart upload');
  }
  const initData: MultipartInitResponse = await initRes.json();
  const { uploadId, key, mediaType, parts } = initData.data;

  const completedParts: { partNumber: number; etag: string }[] = [];
  let uploadedBytes = 0;

  const uploadPart = async (partInfo: { partNumber: number; uploadUrl: string }) => {
    const start = (partInfo.partNumber - 1) * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);

    const res = await fetch(partInfo.uploadUrl, {
      method: 'PUT',
      body: chunk,
    });

    if (!res.ok) {
      throw new Error(`Failed to upload part ${partInfo.partNumber}: ${res.status}`);
    }

    const etag = res.headers.get('ETag') || '';
    completedParts.push({ partNumber: partInfo.partNumber, etag });
    uploadedBytes += (end - start);
    onProgress?.(Math.round((uploadedBytes / file.size) * 100));
  };

  // Upload parts with concurrency limit
  const queue = [...parts];
  const workers: Promise<void>[] = [];

  for (let i = 0; i < Math.min(MAX_CONCURRENT, queue.length); i++) {
    workers.push(runWorker(queue, uploadPart));
  }
  await Promise.all(workers);

  // Complete multipart upload
  completedParts.sort((a, b) => a.partNumber - b.partNumber);

  const completeRes = await fetch(`${API_BASE}/upload/multipart/complete/${prefix}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'same-origin',
    body: JSON.stringify({ uploadId, key, parts: completedParts }),
  });
  if (!completeRes.ok) {
    // Attempt abort on failure
    fetch(`${API_BASE}/upload/multipart/abort/${prefix}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      credentials: 'same-origin',
      body: JSON.stringify({ uploadId, key }),
    }).catch(() => {});
    const err = await completeRes.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to complete multipart upload');
  }

  const completeData = await completeRes.json();
  const result = completeData.data?.[0] || completeData.data;
  return { url: result.url, key: result.key, rawUrl: result.rawUrl, rawKey: result.rawKey, mediaType };
}

// ─── Local Chunked Upload ────────────────────────────────────────────────────

async function uploadViaChunked(
  file: File,
  prefix: string,
  onProgress?: (percent: number) => void,
): Promise<UploadMomentResult> {
  const initRes = await fetch(`${API_BASE}/upload/chunked/init/${prefix}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'same-origin',
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || 'video/mp4',
      fileSize: file.size,
    }),
  });
  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to initiate chunked upload');
  }
  const initData: ChunkedInitResponse = await initRes.json();
  const { uploadId, key } = initData.data;

  const numChunks = Math.ceil(file.size / CHUNK_SIZE);
  let uploadedBytes = 0;

  // Upload chunks sequentially (local storage requires ordered append)
  for (let i = 0; i < numChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);

    const partRes = await fetch(`${API_BASE}/upload/chunked/part/${uploadId}`, {
      method: 'POST',
      headers: { ...authHeaders() },
      credentials: 'same-origin',
      body: chunk,
    });
    if (!partRes.ok) {
      throw new Error(`Failed to upload chunk ${i + 1}`);
    }

    uploadedBytes += (end - start);
    onProgress?.(Math.round((uploadedBytes / file.size) * 100));
  }

  // Complete
  const completeRes = await fetch(`${API_BASE}/upload/chunked/complete/${uploadId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'same-origin',
  });
  if (!completeRes.ok) {
    const err = await completeRes.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to complete chunked upload');
  }

  const completeData = await completeRes.json();
  const result = completeData.data?.[0] || completeData.data;
  const mediaType: 'image' | 'video' = file.type.startsWith('image/') ? 'image' : 'video';
  return { url: result.url, key: result.key, rawUrl: result.rawUrl, rawKey: result.rawKey, mediaType };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function runWorker<T>(
  queue: T[],
  process: (item: T) => Promise<void>,
): Promise<void> {
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    await process(item);
  }
}
