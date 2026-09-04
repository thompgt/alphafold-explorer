import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, bandColour } from '../src/api.ts';

describe('bandColour', () => {
  it('picks the band whose floor the pLDDT value clears', () => {
    expect(bandColour(95)).toBe('#0053d6'); // very_high
    expect(bandColour(90)).toBe('#0053d6'); // boundary is inclusive
    expect(bandColour(89.9)).toBe('#65cbf3'); // confident
    expect(bandColour(70)).toBe('#65cbf3');
    expect(bandColour(69.9)).toBe('#ffdb13'); // low
    expect(bandColour(50)).toBe('#ffdb13');
    expect(bandColour(49.9)).toBe('#ff7d45'); // very_low
    expect(bandColour(0)).toBe('#ff7d45');
  });
});

describe('api request wrapper', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('resolves with the parsed JSON body on success', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as unknown as typeof fetch;

    const health = await api.health();
    expect(health).toEqual({ ok: true });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ headers: expect.objectContaining({ 'content-type': 'application/json' }) }),
    );
  });

  it('throws an ApiError carrying the response body on failure', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'nope', reason: 'blocked' }), { status: 400 }),
    ) as unknown as typeof fetch;

    await expect(api.ask('why?')).rejects.toMatchObject({
      name: 'ApiError',
      message: 'nope',
      status: 400,
      body: { message: 'nope', reason: 'blocked' },
    });
  });

  it('falls back to a generic message when the error body has none', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await api.recall('anything');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).message).toBe('request failed (503)');
  });
});
