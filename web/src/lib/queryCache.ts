/**
 * Query cache with IndexedDB persistence for stale-while-revalidate behavior.
 *
 * Hot data lives in a Map for sync access; all writes are flushed to IndexedDB
 * asynchronously so the cache survives page reloads.
 */

const DB_NAME = 'baby-log-cache';
const STORE_NAME = 'queries';
const DB_VERSION = 1;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // evict entries older than 24h

type Entry = { data: unknown; ts: number };

const mem = new Map<string, Entry>();

let dbPromise: Promise<IDBDatabase> | null = null;
let hydrated = false;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function hydrateFromIDB() {
  if (hydrated) return;
  hydrated = true;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    const keysReq = store.getAllKeys();
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => {
        const keys = keysReq.result as string[];
        const values = req.result as Entry[];
        const now = Date.now();
        for (let i = 0; i < keys.length; i++) {
          const entry = values[i];
          if (entry && now - entry.ts < MAX_AGE_MS && !mem.has(keys[i])) {
            mem.set(keys[i], entry);
          }
        }
        resolve();
      };
      tx.onerror = () => resolve();
    });
  } catch {
    // IndexedDB unavailable — graceful fallback to memory-only
  }
}

function persistToIDB(key: string, entry: Entry) {
  openDB()
    .then((db) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(entry, key);
    })
    .catch(() => {});
}

function deleteFromIDB(keys: string[]) {
  if (keys.length === 0) return;
  openDB()
    .then((db) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const k of keys) store.delete(k);
    })
    .catch(() => {});
}

// Kick off hydration eagerly
hydrateFromIDB();

export function cacheRead<T>(key: string): T | undefined {
  const entry = mem.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > MAX_AGE_MS) {
    mem.delete(key);
    return undefined;
  }
  return entry.data as T;
}

export function cacheWrite<T>(key: string, data: T): void {
  const entry: Entry = { data, ts: Date.now() };
  mem.set(key, entry);
  persistToIDB(key, entry);
}

/** Remove all cache entries whose key starts with `prefix` */
export function cacheInvalidate(prefix: string): void {
  const removed: string[] = [];
  for (const k of mem.keys()) {
    if (k.startsWith(prefix)) {
      mem.delete(k);
      removed.push(k);
    }
  }
  deleteFromIDB(removed);
}
