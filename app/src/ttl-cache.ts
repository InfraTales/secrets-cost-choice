/**
 * A small in-process cache for secrets and parameters.
 *
 * Three rules, each with a test:
 * 1. A value is reused until `ttlMs` has passed since it was loaded.
 * 2. A failed load is never cached. The next call tries again.
 * 3. Concurrent callers for the same key share one load (single-flight), so a cold
 *    start with 20 parallel requests makes one API call, not 20.
 */
export interface TtlCacheOptions {
  ttlMs: number;
  /** Injected in tests. */
  now?: () => number;
}

export interface CacheStats {
  hits: number;
  loads: number;
  failures: number;
}

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly counters: CacheStats = { hits: 0, loads: 0, failures: 0 };

  constructor(options: TtlCacheOptions) {
    if (!Number.isFinite(options.ttlMs) || options.ttlMs < 0) {
      throw new Error(`ttlMs must be 0 or more, got ${options.ttlMs}`);
    }
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
  }

  get(key: string, load: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(key);
    if (entry && this.now() < entry.expiresAt) {
      this.counters.hits += 1;
      return Promise.resolve(entry.value);
    }

    const pending = this.inFlight.get(key);
    if (pending) {
      this.counters.hits += 1;
      return pending;
    }

    this.counters.loads += 1;
    const promise = this.load(key, load);
    this.inFlight.set(key, promise);
    return promise;
  }

  /** Drop a key, for example after the caller sees an authentication error with the cached value. */
  invalidate(key: string): void {
    this.entries.delete(key);
  }

  stats(): CacheStats {
    return { ...this.counters };
  }

  private load(key: string, load: () => Promise<T>): Promise<T> {
    // The loader runs on the next microtask, after get() has stored this promise in
    // inFlight. Our first version called it directly inside an async function: a loader
    // that threw before returning a promise ran the cleanup first, then get() stored the
    // rejected promise, and every later call got that same old error.
    return Promise.resolve()
      .then(load)
      .then(
        (value) => {
          this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
          return value;
        },
        (err: unknown) => {
          this.counters.failures += 1;
          this.entries.delete(key);
          throw err;
        },
      )
      .finally(() => this.inFlight.delete(key));
  }
}
