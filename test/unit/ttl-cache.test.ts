import { TtlCache } from '../../app/src/ttl-cache';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('TTL', () => {
  test('reuses a value until the TTL has passed, then loads again', async () => {
    const c = clock();
    const cache = new TtlCache<string>({ ttlMs: 300_000, now: c.now });
    const load = jest.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');

    await expect(cache.get('k', load)).resolves.toBe('v1');
    c.advance(299_999);
    await expect(cache.get('k', load)).resolves.toBe('v1');
    expect(load).toHaveBeenCalledTimes(1);

    c.advance(1); // exactly 300 s after the load
    await expect(cache.get('k', load)).resolves.toBe('v2');
    expect(load).toHaveBeenCalledTimes(2);
  });

  test('the TTL starts when the load finishes, not when it started', async () => {
    const c = clock();
    const cache = new TtlCache<string>({ ttlMs: 1000, now: c.now });
    const slow = deferred<string>();
    const first = cache.get('k', () => slow.promise);
    c.advance(5000); // a slow API call
    slow.resolve('v1');
    await first;
    c.advance(999);
    const load = jest.fn().mockResolvedValue('v2');
    await expect(cache.get('k', load)).resolves.toBe('v1');
    expect(load).not.toHaveBeenCalled();
  });

  test('a TTL of 0 never reuses a value', async () => {
    const cache = new TtlCache<string>({ ttlMs: 0, now: clock().now });
    const load = jest.fn().mockResolvedValue('v');
    await cache.get('k', load);
    await cache.get('k', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test('keys are cached separately', async () => {
    const cache = new TtlCache<string>({ ttlMs: 1000, now: clock().now });
    await expect(cache.get('a', () => Promise.resolve('A'))).resolves.toBe('A');
    await expect(cache.get('b', () => Promise.resolve('B'))).resolves.toBe('B');
    await expect(cache.get('a', () => Promise.resolve('wrong'))).resolves.toBe('A');
  });

  test('invalidate forces the next call to load', async () => {
    const cache = new TtlCache<string>({ ttlMs: 60_000, now: clock().now });
    const load = jest.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new');
    await cache.get('k', load);
    cache.invalidate('k');
    await expect(cache.get('k', load)).resolves.toBe('new');
  });

  test('rejects a negative or non-numeric TTL', () => {
    expect(() => new TtlCache({ ttlMs: -1 })).toThrow(/ttlMs/);
    expect(() => new TtlCache({ ttlMs: Number.NaN })).toThrow(/ttlMs/);
  });
});

describe('failures are never cached', () => {
  test('a rejected load is retried on the next call', async () => {
    const cache = new TtlCache<string>({ ttlMs: 300_000, now: clock().now });
    const load = jest.fn().mockRejectedValueOnce(new Error('ThrottlingException')).mockResolvedValueOnce('v');
    await expect(cache.get('k', load)).rejects.toThrow('ThrottlingException');
    await expect(cache.get('k', load)).resolves.toBe('v');
    expect(load).toHaveBeenCalledTimes(2);
    expect(cache.stats()).toEqual({ hits: 0, loads: 2, failures: 1 });
  });

  test('a loader that throws before returning a promise is retried too', async () => {
    const cache = new TtlCache<string>({ ttlMs: 300_000, now: clock().now });
    const load = jest
      .fn<Promise<string>, []>()
      .mockImplementationOnce(() => {
        throw new Error('bad input');
      })
      .mockResolvedValueOnce('v');
    await expect(cache.get('k', load)).rejects.toThrow('bad input');
    await expect(cache.get('k', load)).resolves.toBe('v');
  });

  test('a failed refresh drops the expired value instead of serving it', async () => {
    const c = clock();
    const cache = new TtlCache<string>({ ttlMs: 1000, now: c.now });
    await cache.get('k', () => Promise.resolve('old'));
    c.advance(1000);
    await expect(cache.get('k', () => Promise.reject(new Error('AccessDenied')))).rejects.toThrow('AccessDenied');
    await expect(cache.get('k', () => Promise.resolve('new'))).resolves.toBe('new');
  });
});

describe('single-flight', () => {
  test('20 concurrent callers share one load', async () => {
    const cache = new TtlCache<string>({ ttlMs: 300_000, now: clock().now });
    const d = deferred<string>();
    const load = jest.fn(() => d.promise);

    const calls = Array.from({ length: 20 }, () => cache.get('k', load));
    d.resolve('v');
    await expect(Promise.all(calls)).resolves.toEqual(Array(20).fill('v'));
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toEqual({ hits: 19, loads: 1, failures: 0 });
  });

  test('every waiter sees the failure, and the next call starts a fresh load', async () => {
    const cache = new TtlCache<string>({ ttlMs: 300_000, now: clock().now });
    const d = deferred<string>();
    const load = jest.fn(() => d.promise);

    const calls = Array.from({ length: 5 }, () => cache.get('k', load));
    d.reject(new Error('timeout'));
    const results = await Promise.allSettled(calls);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);

    await expect(cache.get('k', () => Promise.resolve('v'))).resolves.toBe('v');
  });
});
