import { createContext, useContext, useEffect, useRef } from 'react';

export const KeepAliveActiveContext = createContext(true);

/**
 * Runs `callback` each time the KeepAlive page transitions from hidden to visible.
 * Skips the initial mount — only fires on re-activation.
 */
export function useActivated(callback: () => void) {
  const active = useContext(KeepAliveActiveContext);
  const mountedRef = useRef(false);
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (active) {
      cbRef.current();
    }
  }, [active]);
}
