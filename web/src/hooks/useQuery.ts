import { useState, useEffect, useCallback, useRef } from 'react';
import { cacheRead, cacheWrite } from '../lib/queryCache';

interface QueryResult<T> {
  data: T | undefined;
  loading: boolean;
  refresh: () => void;
}

/**
 * SWR-style data fetching hook:
 *  1. If cache has data → show it immediately (no loading spinner)
 *  2. Always fetch fresh data in background
 *  3. Update state when fresh data arrives
 */
export function useQuery<T>(
  key: string | null | undefined,
  fetcher: () => Promise<T>,
): QueryResult<T> {
  const stale = key ? cacheRead<T>(key) : undefined;
  const [data, setData] = useState<T | undefined>(stale);
  const [loading, setLoading] = useState(stale === undefined);
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!key) return;
    let active = true;

    const cached = cacheRead<T>(key);
    if (cached !== undefined) {
      setData(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    fetcherRef.current()
      .then((fresh) => {
        if (!active) return;
        cacheWrite(key, fresh);
        setData(fresh);
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return { data, loading, refresh };
}
