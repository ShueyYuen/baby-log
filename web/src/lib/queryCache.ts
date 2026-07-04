/**
 * Simple in-memory query cache for stale-while-revalidate behavior.
 * Data is never expired — entries are replaced on revalidation or invalidated after mutations.
 */

type Entry = { data: unknown };

const store = new Map<string, Entry>();

export function cacheRead<T>(key: string): T | undefined {
  const entry = store.get(key);
  return entry ? (entry.data as T) : undefined;
}

export function cacheWrite<T>(key: string, data: T): void {
  store.set(key, { data });
}

/** Remove all cache entries whose key starts with `prefix` */
export function cacheInvalidate(prefix: string): void {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}
