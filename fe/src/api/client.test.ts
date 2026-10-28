import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './client';

const respond = (body: unknown, status = 200) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('returns data of an ok envelope', async () => {
    respond({ ok: true, data: { id: 1 } });
    await expect(api('/jobs/1')).resolves.toEqual({ id: 1 });
    expect(fetch).toHaveBeenCalledWith('/api/jobs/1', undefined);
  });

  it('throws ApiError with code and status on an error envelope', async () => {
    respond({ ok: false, error: { code: 'JOB_NOT_FOUND', message: 'job not found', details: null } }, 404);
    const err = await api('/jobs/9').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'JOB_NOT_FOUND', status: 404, message: 'job not found' });
  });

  it('maps a rejected fetch to NETWORK', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));
    await expect(api('/overview')).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('maps a non-JSON body to NETWORK', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 502 })));
    await expect(api('/overview')).rejects.toMatchObject({ code: 'NETWORK', status: 502 });
  });
});
