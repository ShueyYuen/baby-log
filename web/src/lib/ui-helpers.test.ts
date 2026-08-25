import { describe, expect, it } from 'vitest';
import { toViewerImages } from '../components/ui/media-thumbs';
import { formatTimeAgo, minutesSince } from '../components/FeedingPredictionCard';

describe('toViewerImages', () => {
  it('maps upload payloads to viewer images', () => {
    expect(
      toViewerImages([
        { url: '/a.jpg', rawUrl: '/a-raw.jpg', mediaType: 'image' },
        { url: '/b.mp4', mediaType: 'video', posterUrl: '/b.poster.jpg' },
      ]),
    ).toEqual([
      { url: '/a.jpg', rawUrl: '/a-raw.jpg', mediaType: 'image', posterUrl: undefined },
      { url: '/b.mp4', rawUrl: undefined, mediaType: 'video', posterUrl: '/b.poster.jpg' },
    ]);
  });
});

describe('feeding prediction helpers', () => {
  it('formats time ago in minutes, hours, and days', () => {
    expect(formatTimeAgo(0)).toBe('刚刚');
    expect(formatTimeAgo(12)).toBe('12分钟前');
    expect(formatTimeAgo(90)).toBe('1小时30分钟前');
    expect(formatTimeAgo(120)).toBe('2小时前');
    expect(formatTimeAgo(60 * 26)).toBe('1天前');
  });

  it('computes minutes since a timestamp', () => {
    const now = Date.parse('2026-08-25T12:00:00.000Z');
    expect(minutesSince('2026-08-25T11:30:00.000Z', now)).toBe(30);
    expect(minutesSince('2026-08-25T13:00:00.000Z', now)).toBe(0);
  });
});
