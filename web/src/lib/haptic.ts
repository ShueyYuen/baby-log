/**
 * Trigger a short vibration for haptic feedback on supported devices.
 * Falls back to a no-op on unsupported browsers/devices.
 */
export function hapticTap() {
  if ('vibrate' in navigator) {
    navigator.vibrate(10);
  }
}

export function hapticSuccess() {
  if ('vibrate' in navigator) {
    navigator.vibrate([10, 30, 10]);
  }
}

export function hapticError() {
  if ('vibrate' in navigator) {
    navigator.vibrate([30, 20, 30]);
  }
}
