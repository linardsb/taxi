// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/t/[token]/data/route';

const TOKEN = 'Ab3_-6qhTGplK0vwXz9y-Q';
const baseView = {
  state: 'arriving',
  driverName: 'Jānis',
  driverPhotoUrl: null,
  vehiclePlate: 'AB-1234',
  position: { lat: 56.95, lng: 24.1, at: '2026-08-11T09:00:00.000Z' },
  etaMinutes: 4,
  dispatchPhone: '+37160000000',
  updatedAt: '2026-08-11T09:00:00.000Z',
};

// `NextRequest` is a type-only import in the route, so the first argument is
// never touched at runtime — `{} as never` is honest, not a shortcut.
const call = (token: string) =>
  GET({} as never, { params: Promise.resolve({ token }) });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('GET /t/[token]/data', () => {
  it('proxies a valid token through with no-store JSON headers (expected)', async () => {
    vi.mocked(fetch).mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify(baseView),
    } as never);

    const res = await call(TOKEN);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual(baseView);
  });

  it('answers 404 locally for a path-traversal-shaped token (failure)', async () => {
    const res = await call('..');

    // The shape check exists so junk can never cost an API hop.
    expect(res.status).toBe(404);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('answers 502 when the API is unreachable (edge)', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await call(TOKEN);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ message: 'api_unreachable' });
  });
});
