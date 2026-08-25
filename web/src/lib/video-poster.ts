const MAX_POSTER_WIDTH = 480;
const POSTER_QUALITY = 0.82;
const CAPTURE_TIMEOUT_MS = 8000;

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogg|avi|mkv|3gp)$/i;

export function isVideoMedia(mediaType?: string, src?: string): boolean {
  if (mediaType === 'video') return true;
  if (mediaType === 'image') return false;
  if (!src) return false;
  return VIDEO_EXT.test(src.split('?')[0]);
}

export function posterKeyFromVideoKey(videoKey: string): string {
  const cleaned = videoKey.trim().split('?')[0];
  if (!cleaned) return '';
  const lastSlash = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'));
  const lastDot = cleaned.lastIndexOf('.');
  if (lastDot <= lastSlash) return `${cleaned}.poster.jpg`;
  return `${cleaned.slice(0, lastDot)}.poster.jpg`;
}

export function posterDimensions(width: number, height: number, maxWidth = MAX_POSTER_WIDTH) {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };
  const scale = Math.min(1, maxWidth / width);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function captureVideoPoster(source: File | string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';

    const createdUrl = typeof source === 'string' ? null : URL.createObjectURL(source);
    const url = createdUrl ?? (source as string);

    const cleanup = () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('poster capture timed out'));
    }, CAPTURE_TIMEOUT_MS);

    const fail = (err: Error) => {
      window.clearTimeout(timer);
      cleanup();
      reject(err);
    };

    const snap = () => {
      try {
        const { width, height } = posterDimensions(video.videoWidth, video.videoHeight);
        if ((video.videoWidth || 0) < 2 || (video.videoHeight || 0) < 2) {
          fail(new Error('empty video frame'));
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          fail(new Error('canvas unsupported'));
          return;
        }
        ctx.drawImage(video, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            window.clearTimeout(timer);
            cleanup();
            if (!blob) fail(new Error('poster encode failed'));
            else resolve(blob);
          },
          'image/jpeg',
          POSTER_QUALITY,
        );
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)));
      }
    };

    video.addEventListener('error', () => fail(new Error('video load failed')));
    video.addEventListener('seeked', snap, { once: true });
    video.addEventListener(
      'loadeddata',
      () => {
        const t =
          Number.isFinite(video.duration) && video.duration > 0
            ? Math.min(0.5, video.duration * 0.05)
            : 0.1;
        try {
          if (video.currentTime === t) snap();
          else video.currentTime = t;
        } catch {
          snap();
        }
      },
      { once: true },
    );

    video.src = url;
    video.load();
  });
}

export async function uploadVideoPoster(
  videoKey: string,
  blob: Blob,
): Promise<{ key: string; url: string }> {
  const form = new FormData();
  form.append('videoKey', videoKey);
  form.append('file', blob, 'poster.jpg');
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch('/api/v1/upload/poster', {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || '封面上传失败');
  const result = (data as { data?: { key: string; url: string } }).data;
  if (!result?.key || !result?.url) throw new Error('封面上传失败');
  return result;
}

export async function attachVideoPoster<T extends { key: string; mediaType?: string; posterKey?: string; posterUrl?: string }>(
  file: File,
  result: T,
): Promise<T> {
  const isVideo = result.mediaType === 'video' || file.type.startsWith('video/');
  if (!isVideo || !result.key) return result;
  try {
    const blob = await captureVideoPoster(file);
    const poster = await uploadVideoPoster(result.key, blob);
    return { ...result, mediaType: 'video', posterKey: poster.key, posterUrl: poster.url };
  } catch (e) {
    console.warn('[Upload] video poster failed', e);
    return { ...result, mediaType: result.mediaType || 'video' };
  }
}
