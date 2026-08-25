import { afterEach, describe, expect, it, vi } from 'vitest';
import { isHeicFile, isLargeFile, toUploadableFile, uploadLargeFile } from './chunked-upload';

function file(name: string, type: string, size = 10) {
  const f = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('chunked upload helpers', () => {
  it('treats files over 32MB as large', () => {
    expect(isLargeFile(file('a.mp4', 'video/mp4', 32 * 1024 * 1024))).toBe(false);
    expect(isLargeFile(file('a.mp4', 'video/mp4', 32 * 1024 * 1024 + 1))).toBe(true);
  });

  it('detects HEIC/HEIF by mime and extension', () => {
    expect(isHeicFile(file('photo.heic', 'image/heic'))).toBe(true);
    expect(isHeicFile(file('photo.HEIF', 'image/heif'))).toBe(true);
    expect(isHeicFile(file('photo.heic', ''))).toBe(true);
    expect(isHeicFile(file('photo.jpg', 'image/jpeg'))).toBe(false);
  });

  it('returns the original file when HEIC conversion is unavailable', async () => {
    const original = file('photo.heic', 'image/heic');
    const converted = await toUploadableFile(original);
    expect(converted).toBe(original);
  });

  it('leaves non-HEIC files unchanged', async () => {
    const jpg = file('photo.jpg', 'image/jpeg');
    await expect(toUploadableFile(jpg)).resolves.toBe(jpg);
  });
});

class MockXHR {
  status = 200;
  responseText = '{}';
  upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  withCredentials = false;
  open() {}
  setRequestHeader() {}
  send() {
    this.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 10 } as ProgressEvent);
    this.onload?.();
  }
}

describe('uploadLargeFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('initializes, uploads parts, and completes', async () => {
    localStorage.setItem('token', 'tok');
    vi.stubGlobal('XMLHttpRequest', MockXHR);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('/chunked/init/')) {
          return {
            ok: true,
            json: async () => ({
              data: { uploadId: 'up1', key: 'moments/a.mp4', totalParts: 1, chunkSize: 1024 },
            }),
          };
        }
        if (u.includes('/chunked/complete/')) {
          expect(init?.method).toBe('POST');
          return {
            ok: true,
            json: async () => ({ data: [{ url: '/u', key: 'moments/a.mp4' }] }),
          };
        }
        return { ok: false, json: async () => ({ error: 'nope' }) };
      }),
    );

    const clip = new File([new Uint8Array(100)], 'clip.mp4', { type: 'video/mp4' });
    const progress: number[] = [];
    const result = await uploadLargeFile(clip, 'moments', (p) => progress.push(p));
    expect(result.key).toBe('moments/a.mp4');
    expect(result.mediaType).toBe('video');
    expect(progress.at(-1)).toBe(100);
  });

  it('throws when init fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({ error: 'too large' }) })),
    );
    const clip = new File([new Uint8Array(10)], 'a.mp4', { type: 'video/mp4' });
    await expect(uploadLargeFile(clip, 'moments')).rejects.toThrow('too large');
  });
});
