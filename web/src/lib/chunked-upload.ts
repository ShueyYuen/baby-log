import type { UploadMomentResult } from './api';

const API_BASE = '/api/v1';
const CHUNK_SIZE = 50 * 1024 * 1024; // 50MB per chunk
const LARGE_FILE_THRESHOLD = 200 * 1024 * 1024; // 200MB

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
  };
}

export function isLargeFile(file: File): boolean {
  return file.size > LARGE_FILE_THRESHOLD;
}

export async function uploadLargeFile(
  file: File,
  prefix: string,
  onProgress?: (percent: number) => void,
): Promise<UploadMomentResult> {
  // Always use chunked upload through the backend.
  // The backend stores locally first (immediate access) then syncs to S3 in background.
  return uploadViaChunked(file, prefix, onProgress);
}

// ─── Chunked Upload ──────────────────────────────────────────────────────────

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

