import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPermissionState, isSubscribed, subscribePush, unsubscribePush } from './push';

describe('push helpers', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('unsubscribe clears the local flag even if the service worker is missing', async () => {
    localStorage.setItem('push_enabled', 'true');
    await unsubscribePush();
    expect(localStorage.getItem('push_enabled')).toBeNull();
  });

  it('isSubscribed is false when the flag is unset', () => {
    expect(isSubscribed()).toBe(false);
  });

  it('subscribePush returns false when permission is denied', async () => {
    Object.defineProperty(window.navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve({ active: { postMessage: vi.fn() }, pushManager: {} }) },
    });
    vi.stubGlobal('Notification', {
      requestPermission: async () => 'denied',
      permission: 'default',
    });
    await expect(subscribePush()).resolves.toBe(false);
  });

  it('subscribePush starts polling when permission is granted', async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window.navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({
          active: { postMessage },
          pushManager: {
            subscribe: async () => ({
              toJSON: () => ({ endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } }),
            }),
          },
        }),
      },
    });
    vi.stubGlobal('Notification', {
      requestPermission: async () => 'granted',
      permission: 'granted',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/push/vapid-key')) {
          return { ok: true, json: async () => ({ data: { publicKey: '' } }) };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );
    await expect(subscribePush()).resolves.toBe(true);
    expect(localStorage.getItem('push_enabled')).toBe('true');
    expect(postMessage).toHaveBeenCalledWith({ type: 'START_POLLING' });
  });

  it('getPermissionState is denied without Notification', () => {
    const original = window.Notification;
    Reflect.deleteProperty(window, 'Notification');
    expect(getPermissionState()).toBe('denied');
    window.Notification = original;
  });
});
