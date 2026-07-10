import { useRef, useEffect, useState, useCallback, createContext, useContext } from 'react';

const PullRefreshContext = createContext<{
  register: (cb: () => Promise<void>) => void;
  unregister: () => void;
} | null>(null);

export const PullRefreshProvider = PullRefreshContext.Provider;

/**
 * Pages call this to register their refresh handler.
 * When the user pulls down, the registered callback is invoked.
 */
export function useRefreshHandler(onRefresh: () => Promise<void>) {
  const ctx = useContext(PullRefreshContext);
  const cbRef = useRef(onRefresh);
  cbRef.current = onRefresh;

  useEffect(() => {
    if (!ctx) return;
    const handler = () => cbRef.current();
    ctx.register(handler);
    return () => ctx.unregister();
  }, [ctx]);
}

interface PullRefreshState {
  pullDistance: number;
  refreshing: boolean;
}

export function usePullRefresh(containerRef: React.RefObject<HTMLElement | null>) {
  const [state, setState] = useState<PullRefreshState>({ pullDistance: 0, refreshing: false });
  const refreshCbRef = useRef<(() => Promise<void>) | null>(null);

  const threshold = 60;
  const maxPull = 120;

  const ctxValue = useRef({
    register: (cb: () => Promise<void>) => { refreshCbRef.current = cb; },
    unregister: () => { refreshCbRef.current = null; },
  }).current;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const isTouchDevice = 'ontouchstart' in window;
    if (!isTouchDevice) return;

    let startY = 0;
    let pulling = false;
    let currentPull = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (el.scrollTop > 0) return;
      startY = e.touches[0].clientY;
      pulling = false;
      currentPull = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (el.scrollTop > 0) {
        if (pulling) {
          pulling = false;
          currentPull = 0;
          setState((s) => s.pullDistance === 0 ? s : { ...s, pullDistance: 0 });
        }
        return;
      }

      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) {
        if (pulling) {
          pulling = false;
          currentPull = 0;
          setState((s) => s.pullDistance === 0 ? s : { ...s, pullDistance: 0 });
        }
        return;
      }

      pulling = true;
      e.preventDefault();
      const dampened = Math.min(dy * 0.4, maxPull);
      currentPull = dampened;
      setState((s) => ({ ...s, pullDistance: dampened }));
    };

    const onTouchEnd = async () => {
      if (!pulling) return;
      pulling = false;

      if (currentPull >= threshold && refreshCbRef.current) {
        setState({ pullDistance: threshold, refreshing: true });
        try {
          await refreshCbRef.current();
        } finally {
          setState({ pullDistance: 0, refreshing: false });
        }
      } else {
        setState({ pullDistance: 0, refreshing: false });
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  return { ...state, ctxValue };
}
