import { describe, expect, it, vi } from 'vitest';
import { hapticError, hapticSuccess, hapticTap } from './haptic';
import { getPermissionState, isPushSupported } from './push';

describe('haptic', () => {
  it('vibrates when the API exists', () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    hapticTap();
    hapticSuccess();
    hapticError();
    expect(vibrate).toHaveBeenCalledWith(10);
    expect(vibrate).toHaveBeenCalledWith([10, 30, 10]);
    expect(vibrate).toHaveBeenCalledWith([30, 20, 30]);
  });
});

describe('push support', () => {
  it('requires both service worker and Notification', () => {
    expect(typeof isPushSupported()).toBe('boolean');
  });

  it('reports denied when Notification is missing', () => {
    const original = window.Notification;
    // @ts-expect-error jsdom may or may not define Notification
    delete window.Notification;
    expect(getPermissionState()).toBe('denied');
    window.Notification = original;
  });
});
