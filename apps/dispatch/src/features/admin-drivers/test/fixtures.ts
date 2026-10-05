import type { AuthSession } from '@taxi/shared';
import { vi } from 'vitest';

/** Shared fakes for the admin-drivers tests. Under `test/`: not shipped source. */

export const SESSION_KEY = 'taxi.console.session';

export const adminSession: AuthSession = {
  accessToken: 'token-admin',
  expiresAt: '2099-01-01T00:00:00.000Z',
  user: {
    id: '99999999-8888-4777-8666-555555555555',
    phone: '+37129999009',
    role: 'admin',
    language: 'lv',
    createdAt: '2026-08-01T00:00:00.000Z',
  },
};

export const DRIVER_A = 'd0000000-0000-4000-8000-00000000000a';
export const DRIVER_B = 'd0000000-0000-4000-8000-00000000000b';
export const VEHICLE_A = 'e0000000-0000-4000-8000-00000000000a';

export const summary = (userId: string, name: string, plate: string) => ({
  userId,
  displayName: name,
  phone: '+37120000001',
  approvalStatus: 'pending',
  status: 'offline',
  createdAt: '2026-09-29T10:00:00.000Z',
  vehicles: [{ plate, category: 'standard' }],
});

export const vehicle = {
  id: VEHICLE_A,
  driverId: DRIVER_A,
  plate: 'AB-1234',
  make: 'Škoda',
  model: 'Octavia',
  year: 2019,
  category: 'standard',
  passengerSeats: 4,
  hasChildSeat: false,
};

export const detail = (overrides: Record<string, unknown> = {}) => ({
  ...summary(DRIVER_A, 'Jānis Ozols', 'AB-1234'),
  profile: {
    userId: DRIVER_A,
    status: 'offline',
    approvalStatus: 'pending',
    spokenLanguages: ['lv'],
    fleetId: null,
    balanceCents: 0,
    commissionPctOverride: 12,
  },
  vehicles: [vehicle],
  ...overrides,
});

type Route = {
  method?: string;
  path: string;
  status?: number;
  body?: unknown;
};

/**
 * `fetch` answered by route: the first unused route whose method and path
 * prefix match. Each route answers once, so a refetch needs its own route.
 */
export function routeFetch(routes: Route[]) {
  const pending = [...routes];
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const index = pending.findIndex(
      (r) => (r.method ?? 'GET') === method && url.includes(r.path),
    );
    if (index === -1) throw new Error(`unrouted ${method} ${url}`);
    const [route] = pending.splice(index, 1);
    const status = route!.status ?? 200;
    const text = route!.body === undefined ? '' : JSON.stringify(route!.body);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
      json: async () => JSON.parse(text) as unknown,
    } as Response;
  });
}

/** The `[method, url, parsed body]` of every fetch made so far. */
export const calls = () =>
  vi.mocked(fetch).mock.calls.map(([input, init]) => [
    init?.method ?? 'GET',
    String(input),
    typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  ]);
