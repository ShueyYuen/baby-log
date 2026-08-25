import { describe, expect, it } from 'vitest';
import { isVideoMedia, posterDimensions, posterKeyFromVideoKey } from './video-poster';

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
