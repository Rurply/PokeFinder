// fetch wrapper with timeout and retry/backoff for flaky upstreams (the Pokémon TCG API
// returns intermittent 500/502s).

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface RetryOptions {
  retries?: number;
  timeoutMs?: number;
  /** Backoff delays in ms for each retry. */
  delays?: number[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  fetchFn: FetchLike = (u, i) => fetch(u, i),
  opts: RetryOptions = {},
): Promise<Response> {
  const retries = opts.retries ?? 4;
  const delays = opts.delays ?? [400, 1000, 2000, 4000];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
    try {
      const res = await fetchFn(url, { ...init, signal: ctrl.signal });
      if (res.ok) return res;
      lastErr = new HttpError(res.status, `HTTP ${res.status}`);
      if (!isRetryable(res.status)) throw lastErr;
    } catch (e) {
      lastErr = e;
      if (e instanceof HttpError && !isRetryable(e.status)) throw e;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await sleep(delays[Math.min(attempt, delays.length - 1)]);
  }
  throw lastErr instanceof Error ? lastErr : new Error('Request failed');
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  fetchFn?: FetchLike,
  opts?: RetryOptions,
): Promise<T> {
  const res = await fetchWithRetry(url, init, fetchFn, opts);
  return (await res.json()) as T;
}
