import { useCallback, useRef } from 'react';

interface LongPressOptions {
  delay?: number;
  onLongPress: () => void;
  onClick?: () => void;
}

/**
 * useLongPress 封装长按与短按：delay 内抬起走 onClick，否则触发 onLongPress。
 * 同时绑定 pointer / touch，兼容移动端。
 */
export function useLongPress({ delay = 500, onLongPress, onClick }: LongPressOptions) {
  const timerRef = useRef<number | null>(null);
  const longPressedRef = useRef(false);
  const activeRef = useRef(false);

  const clear = useCallback(() => {
    activeRef.current = false;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    clear();
    activeRef.current = true;
    longPressedRef.current = false;
    timerRef.current = window.setTimeout(() => {
      if (!activeRef.current) return;
      longPressedRef.current = true;
      navigator.vibrate?.(40);
      onLongPress();
    }, delay);
  }, [clear, delay, onLongPress]);

  const handleClick = useCallback(() => {
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    onClick?.();
  }, [onClick]);

  const bind = useCallback(
    () => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      },
      onPointerUp: (e: React.PointerEvent) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        clear();
      },
      onPointerCancel: clear,
      onPointerLeave: clear,
      onTouchStart: (e: React.TouchEvent) => {
        // touch 兜底：部分 WebView 对 pointer 支持不完整
        start();
      },
      onTouchEnd: clear,
      onTouchCancel: clear,
      onContextMenu: (e: React.SyntheticEvent) => e.preventDefault(),
      onClick: handleClick,
    }),
    [clear, handleClick, start],
  );

  return { bind, clear, isLongPress: () => longPressedRef.current };
}
