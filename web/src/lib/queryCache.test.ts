import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheInvalidate, cacheRead, cacheReadAsync, cacheWrite } from './queryCache';

describe('queryCache', () => {
  beforeEach(() => {
    cacheInvalidate('');
  });

  it('reads back written values from memory', () => {
    expect(cacheRead('missing')).toBeUndefined();
    cacheWrite('/timeline?baby=1', { items: [1] });
    expect(cacheRead('/timeline?baby=1')).toEqual({ items: [1] });
  });

  it('invalidates by prefix and blocks stale hydration of those keys', () => {
    cacheWrite('/stats/a', 1);
    cacheWrite('/stats/b', 2);
    cacheWrite('/other', 3);
    cacheInvalidate('/stats');
    expect(cacheRead('/stats/a')).toBeUndefined();
    expect(cacheRead('/other')).toBe(3);
  });

  it('hydrates from IndexedDB after a write', async () => {
    cacheWrite('/persisted', { ok: true });
    await new Promise((r) => setTimeout(r, 30));
    const value = await cacheReadAsync<{ ok: boolean }>('/persisted');
    expect(value).toEqual({ ok: true });
  });

  it('drops entries older than 24 hours', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    cacheWrite('/old', 1);
    vi.setSystemTime(now + 25 * 60 * 60 * 1000);
    expect(cacheRead('/old')).toBeUndefined();
    vi.useRealTimers();
  });
});
