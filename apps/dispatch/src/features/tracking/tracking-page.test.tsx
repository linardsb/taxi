import { formatMessage, type TrackingView } from '@taxi/shared';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TrackingPage, { generateMetadata } from '@/app/t/[token]/page';

// `vi.mock` is per-file, so the island's leaflet stub is duplicated here
// rather than shared — two copies beat a fixture that still needs mocking
// in every file that loads it.
const mapStub = { setView: vi.fn(), remove: vi.fn() };
mapStub.setView.mockReturnValue(mapStub);
const markerStub = { setLatLng: vi.fn(), addTo: vi.fn() };
markerStub.addTo.mockReturnValue(markerStub);
vi.mock('leaflet', () => ({
  default: {
    map: () => mapStub,
    tileLayer: () => ({ addTo: vi.fn() }),
    marker: () => markerStub,
  },
}));

const TOKEN = 'Ab3_-6qhTGplK0vwXz9y-Q';
const baseView: TrackingView = {
  state: 'arriving',
  driverName: 'Jānis',
  driverPhotoUrl: null,
  vehiclePlate: 'AB-1234',
  position: { lat: 56.95, lng: 24.1, at: '2026-08-11T09:00:00.000Z' },
  etaMinutes: 4,
  dispatchPhone: '+37160000000',
  updatedAt: '2026-08-11T09:00:00.000Z',
};

const okJson = (view: TrackingView) => ({
  ok: true,
  status: 200,
  json: async () => view,
});
const statusOnly = (status: number) => ({
  ok: false,
  status,
  json: async () => ({}),
});

/**
 * The page is an async server component: call it, then render the (all-sync)
 * tree it returns. `params`/`searchParams` are Promises in Next 16.
 */
const renderPage = async (
  searchParams: Record<string, string | string[]> = {},
) => {
  const tree = await TrackingPage({
    params: Promise.resolve({ token: TOKEN }),
    searchParams: Promise.resolve(searchParams),
  });
  render(tree);
  // Real timers here (the page does not poll) — flush the island's dynamic
  // import('leaflet') so it does not resolve outside act().
  await act(async () => {});
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('TrackingPage', () => {
  it('exposes the retry control as a named link when the API is down (failure — M2)', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));
    await renderPage();

    // One query, three contracts: the control exists, it is a real `link` for
    // assistive tech, and its accessible name comes from the catalog. A
    // hardcoded `↻` or an icon-only control fails it.
    expect(
      screen.getByRole('link', { name: formatMessage('lv', 'page.retry') }),
    ).toBeInTheDocument();
  });

  it('renders the ride, the language switcher and a tel: dispatch link (expected)', async () => {
    vi.mocked(fetch).mockResolvedValue(okJson(baseView) as never);
    await renderPage();

    expect(
      screen.getByRole('heading', { name: formatMessage('lv', 'page.title') }),
    ).toBeInTheDocument();

    // Only the two NON-active languages are offered.
    expect(screen.getByRole('link', { name: 'ru' })).toHaveAttribute(
      'href',
      `/t/${TOKEN}?lang=ru`,
    );
    expect(screen.getByRole('link', { name: 'en' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'lv' })).not.toBeInTheDocument();

    expect(
      screen.getByRole('link', {
        name: formatMessage('lv', 'page.call_dispatch'),
      }),
    ).toHaveAttribute('href', 'tel:+37160000000');
  });

  it('normalizes an unknown or array-valued ?lang (edge)', async () => {
    vi.mocked(fetch).mockResolvedValue(okJson(baseView) as never);

    await renderPage({ lang: 'xx' }); // unknown → default lv
    expect(
      screen.getByRole('heading', { name: formatMessage('lv', 'page.title') }),
    ).toBeInTheDocument();
  });

  it('takes the first value of a repeated ?lang (edge)', async () => {
    vi.mocked(fetch).mockResolvedValue(okJson(baseView) as never);

    await renderPage({ lang: ['ru', 'en'] }); // array → first valid value
    expect(
      screen.getByRole('heading', { name: formatMessage('ru', 'page.title') }),
    ).toBeInTheDocument();
  });

  it('shows the catalog notice for 404 and 410 (failure)', async () => {
    vi.mocked(fetch).mockResolvedValue(statusOnly(404) as never);
    await renderPage();
    expect(
      screen.getByRole('heading', {
        name: formatMessage('lv', 'page.not_found'),
      }),
    ).toBeInTheDocument();

    cleanup(); // second render in one test — drop the first tree explicitly

    vi.mocked(fetch).mockResolvedValue(statusOnly(410) as never);
    await renderPage();
    expect(
      screen.getByRole('heading', { name: formatMessage('lv', 'page.expired') }),
    ).toBeInTheDocument();
  });
});

describe('generateMetadata', () => {
  it('titles the document from the requested language catalog (expected)', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ token: TOKEN }),
      searchParams: Promise.resolve({ lang: 'ru' }),
    });
    expect(metadata.title).toBe(formatMessage('ru', 'page.title'));
  });
});
