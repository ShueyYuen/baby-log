import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, generateIdempotencyKey } from './api';

describe('generateIdempotencyKey', () => {
  it('prefers crypto.randomUUID when available', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-2222-4333-8444-555555555555');
    expect(generateIdempotencyKey()).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('falls back to a timestamp-random string', () => {
    const orig = crypto.randomUUID;
    // @ts-expect-error testing fallback
    crypto.randomUUID = undefined;
    const key = generateIdempotencyKey();
    expect(key).toMatch(/^\d+-[a-z0-9]+$/);
    crypto.randomUUID = orig;
  });
});

describe('api client', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'tok-1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => ({
        ok: true,
        json: async () => ({ success: true, data: { url, method: init?.method ?? 'GET', headers: init?.headers } }),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('sends JSON with bearer token and same-origin credentials', async () => {
    await api.post('/records', { babyId: 'b1' }, 'idem-9');
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/records',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ babyId: 'b1' }),
      }),
    );
    const headers = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-1');
    expect(headers['X-Idempotency-Key']).toBe('idem-9');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('throws the server error message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: 'Permission denied' }),
      })),
    );
    await expect(api.get('/babies')).rejects.toThrow('Permission denied');
  });

  it('builds timeline query strings from filters', async () => {
    await api.timeline.list('baby-1', {
      category: 'feeding',
      type: 'bottle',
      search: '夜奶',
      hasImages: true,
      pageSize: 20,
    });
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/timeline?');
    expect(url).toContain('babyId=baby-1');
    expect(url).toContain('category=feeding');
    expect(url).toContain('type=bottle');
    expect(url).toContain('search=%E5%A4%9C%E5%A5%B6');
    expect(url).toContain('hasImages=true');
  });
});
