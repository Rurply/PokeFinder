// TTL cache on top of a chrome.storage.local-like key/value store.

export interface KVStore {
  get(keys: string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

interface Entry<T> {
  v: T;
  /** Stored-at timestamp (ms). */
  t: number;
}

export const HOUR = 60 * 60 * 1000;
export const TTL = {
  card: 24 * HOUR,
  search: 24 * HOUR,
  rates: 12 * HOUR,
  psa: 24 * HOUR,
};

export const CACHE_PREFIX = 'cache:';

export function createCache(kv: KVStore, now: () => number = Date.now) {
  return {
    /** Returns the cached value, or undefined if missing or older than ttlMs. */
    async get<T>(key: string, ttlMs: number): Promise<T | undefined> {
      const e = await this.peek<T>(key);
      if (!e) return undefined;
      if (now() - e.t > ttlMs) return undefined;
      return e.v;
    },
    /** Returns the entry regardless of age (used for stale fallbacks). */
    async peek<T>(key: string): Promise<{ v: T; t: number } | undefined> {
      const k = CACHE_PREFIX + key;
      const r = await kv.get([k]);
      return r[k] as Entry<T> | undefined;
    },
    /** Never throws: on a storage error (e.g. quota) the cache is cleared and the write retried once. */
    async set<T>(key: string, value: T): Promise<void> {
      const item = { [CACHE_PREFIX + key]: { v: value, t: now() } satisfies Entry<T> };
      try {
        await kv.set(item);
      } catch {
        try {
          await this.prune(-1);
          await kv.set(item);
        } catch {
          /* caching is best-effort */
        }
      }
    },
    /** Removes entries older than maxAgeMs (-1 removes all cache entries). */
    async prune(maxAgeMs: number): Promise<number> {
      const all = await kv.get(null);
      const stale = Object.entries(all)
        .filter(([k, e]) => k.startsWith(CACHE_PREFIX) && (maxAgeMs < 0 || now() - ((e as Entry<unknown>)?.t ?? 0) > maxAgeMs))
        .map(([k]) => k);
      if (stale.length) await kv.remove(stale);
      return stale.length;
    },
  };
}

export type Cache = ReturnType<typeof createCache>;

/** In-memory KV store (tests, and fallback when chrome.storage is unavailable). */
export function memoryKV(): KVStore {
  const m = new Map<string, unknown>();
  return {
    async get(keys) {
      const out: Record<string, unknown> = {};
      for (const k of keys ?? [...m.keys()]) if (m.has(k)) out[k] = structuredClone(m.get(k));
      return out;
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) m.set(k, structuredClone(v));
    },
    async remove(keys) {
      for (const k of keys) m.delete(k);
    },
  };
}
