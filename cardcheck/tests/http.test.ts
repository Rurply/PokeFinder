import { describe, expect, it, vi } from 'vitest';
import { fetchWithRetry, HttpError } from '../src/lib/http';

describe('fetchWithRetry', () => {
  it('retries 5xx then succeeds', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const r = await fetchWithRetry('https://x', {}, f, { delays: [0] });
    expect(r.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(3);
  });
  it('does not retry 4xx', async () => {
    const f = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    await expect(fetchWithRetry('https://x', {}, f, { delays: [0] })).rejects.toBeInstanceOf(HttpError);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
