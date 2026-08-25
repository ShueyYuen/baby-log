import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachVideoPoster,
  isVideoMedia,
  posterDimensions,
  posterKeyFromVideoKey,
  posterUrlFromVideoSrc,
} from './video-poster';

describe('posterUrlFromVideoSrc', () => {
  it('derives a sibling poster URL', () => {
    expect(posterUrlFromVideoSrc('/api/v1/uploads/moments/abc.mp4')).toBe(
      '/api/v1/uploads/moments/abc.poster.jpg',
    );
    expect(posterUrlFromVideoSrc('https://cdn.example/x.MOV?sig=1')).toBe(
      'https://cdn.example/x.poster.jpg?sig=1',
    );
  });

  it('skips blob and data URLs', () => {
    expect(posterUrlFromVideoSrc('blob:https://app/1')).toBe('');
    expect(posterUrlFromVideoSrc('data:video/mp4;base64,aa')).toBe('');
  });
});

describe('posterKeyFromVideoKey', () => {
  it('replaces the video extension with .poster.jpg', () => {
    expect(posterKeyFromVideoKey('moments/abc.mp4')).toBe('moments/abc.poster.jpg');
    expect(posterKeyFromVideoKey('clip.MOV')).toBe('clip.poster.jpg');
    expect(posterKeyFromVideoKey('health/x.webm')).toBe('health/x.poster.jpg');
  });

  it('appends when there is no extension', () => {
    expect(posterKeyFromVideoKey('moments/abc')).toBe('moments/abc.poster.jpg');
  });
});

describe('posterDimensions', () => {
  it('caps width at 480 and keeps aspect ratio', () => {
    expect(posterDimensions(1920, 1080)).toEqual({ width: 480, height: 270 });
    expect(posterDimensions(320, 240)).toEqual({ width: 320, height: 240 });
  });

  it('guards empty frames', () => {
    expect(posterDimensions(0, 0)).toEqual({ width: 1, height: 1 });
  });
});

describe('isVideoMedia', () => {
  it('prefers the explicit mediaType', () => {
    expect(isVideoMedia('video', '/a.jpg')).toBe(true);
    expect(isVideoMedia('image', '/a.mp4')).toBe(false);
  });

  it('falls back to the URL extension', () => {
    expect(isVideoMedia(undefined, '/clip.mp4')).toBe(true);
    expect(isVideoMedia(undefined, '/pic.jpg')).toBe(false);
  });
});

describe('attachVideoPoster', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('uploads a client-captured JPEG to /upload/poster', async () => {
    localStorage.setItem('token', 'tok-1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          success: true,
          data: { key: 'moments/a.poster.jpg', url: '/api/v1/uploads/moments/a.poster.jpg' },
        }),
      })),
    );
    const file = new File([new Uint8Array([0, 1, 2])], 'a.mp4', { type: 'video/mp4' });
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
    const out = await attachVideoPoster(file, { key: 'moments/a.mp4', mediaType: 'video' }, blob);
    expect(out.posterKey).toBe('moments/a.poster.jpg');
    expect(out.posterUrl).toBe('/api/v1/uploads/moments/a.poster.jpg');
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/upload/poster',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );
    const body = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as FormData;
    expect(body.get('videoKey')).toBe('moments/a.mp4');
  });

  it('skips the poster request when capture produced nothing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const file = new File([new Uint8Array([0, 1, 2])], 'a.mp4', { type: 'video/mp4' });
    const out = await attachVideoPoster(file, { key: 'moments/a.mp4', mediaType: 'video' }, null);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.posterKey).toBeUndefined();
    expect(out.posterUrl).toBeUndefined();
  });
});
