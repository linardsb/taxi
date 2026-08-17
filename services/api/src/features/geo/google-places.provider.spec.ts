import { GooglePlacesProvider } from './google-places.provider';

const BIAS = {
  center: { lat: 56.9496, lng: 24.1052 },
  radiusMeters: 30_000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

function stubFetch(response: Response): jest.Mock {
  const mock = jest.fn().mockResolvedValue(response);
  global.fetch = mock;
  return mock;
}

describe('GooglePlacesProvider', () => {
  const places = new GooglePlacesProvider('test-key', 3_000);
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('searchAddress', () => {
    it('parses the two-level structuredFormat and sends the session token (expected)', async () => {
      const mock = stubFetch(
        jsonResponse({
          suggestions: [
            {
              placePrediction: {
                placeId: 'place-1',
                structuredFormat: {
                  mainText: { text: 'Brīvības iela 45' },
                  secondaryText: { text: 'Rīga, Latvija' },
                },
              },
            },
          ],
        }),
      );

      const results = await places.searchAddress('brivibas 45', 'lv', {
        bias: BIAS,
        sessionToken: 'session-abc',
      });

      expect(results).toEqual([
        {
          placeId: 'place-1',
          primaryText: 'Brīvības iela 45',
          secondaryText: 'Rīga, Latvija',
        },
      ]);

      const [url, init] = mock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://places.googleapis.com/v1/places:autocomplete');
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Goog-Api-Key']).toBe('test-key');
      expect(headers['X-Goog-FieldMask']).toContain(
        'suggestions.placePrediction.placeId',
      );

      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      // The session token is what makes a burst of keystrokes one billed
      // session — its absence is a silent multiplier on the bill.
      expect(body.sessionToken).toBe('session-abc');
      expect(body.includedRegionCodes).toEqual(['lv']);
      expect(body.input).toBe('brivibas 45');
    });

    it('passes "iela + number" input through unaltered (expected)', async () => {
      const mock = stubFetch(jsonResponse({ suggestions: [] }));

      await places.searchAddress('45 briv', 'lv', {
        bias: BIAS,
        sessionToken: 's',
      });

      const [, init] = mock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { input: string };
      // Digits are not stripped and tokens are not reordered — Places handles
      // the Latvian "house number first" habit itself.
      expect(body.input).toBe('45 briv');
    });

    it('drops a suggestion with no placePrediction and defaults a missing secondaryText (edge)', async () => {
      stubFetch(
        jsonResponse({
          suggestions: [
            { queryPrediction: { text: { text: 'taxi' } } },
            {
              placePrediction: {
                placeId: 'place-2',
                structuredFormat: { mainText: { text: 'Elizabetes iela 1' } },
              },
            },
          ],
        }),
      );

      const results = await places.searchAddress('eliz', 'lv', {
        bias: BIAS,
        sessionToken: 's',
      });

      expect(results).toEqual([
        {
          placeId: 'place-2',
          primaryText: 'Elizabetes iela 1',
          secondaryText: '',
        },
      ]);
    });

    it('treats an empty response body as no matches, not an error (edge)', async () => {
      stubFetch(jsonResponse({}));

      await expect(
        places.searchAddress('zzz', 'lv', { bias: BIAS, sessionToken: 's' }),
      ).resolves.toEqual([]);
    });

    it('rejects a malformed response through zod rather than indexing into it (failure)', async () => {
      stubFetch(
        jsonResponse({
          suggestions: [
            { placePrediction: { placeId: 'p', structuredFormat: {} } },
          ],
        }),
      );

      await expect(
        places.searchAddress('brив', 'lv', { bias: BIAS, sessionToken: 's' }),
      ).rejects.toThrow('maps_places_contract_violation');
    });

    it('reduces a provider 5xx to a coordinate-free message (failure)', async () => {
      stubFetch(jsonResponse({ error: 'at 56.9496,24.1052' }, 500));

      await expect(
        places.searchAddress('brivibas', 'lv', {
          bias: BIAS,
          sessionToken: 's',
        }),
      ).rejects.toThrow('maps_places_unavailable');
    });
  });

  describe('resolvePlace', () => {
    it('terminates the session with the Essentials field mask (expected)', async () => {
      const mock = stubFetch(
        jsonResponse({
          location: { latitude: 56.9496, longitude: 24.1052 },
          formattedAddress: 'Brīvības iela 45, Rīga',
        }),
      );

      const point = await places.resolvePlace('place-1', 'lv', 'session-abc');

      expect(point).toEqual({
        location: { lat: 56.9496, lng: 24.1052 },
        address: 'Brīvības iela 45, Rīga',
      });

      const [url, init] = mock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/v1/places/place-1');
      expect(url).toContain('sessionToken=session-abc');
      const headers = init.headers as Record<string, string>;
      // `location` is what puts this call in Place Details Essentials, the SKU
      // that terminates the session. An IDs-Only mask would void it and bill
      // every keystroke separately.
      expect(headers['X-Goog-FieldMask']).toBe('location,formattedAddress');
    });

    it('returns null for a place id the provider has forgotten (edge)', async () => {
      stubFetch(jsonResponse({}, 404));

      await expect(places.resolvePlace('gone', 'lv', 's')).resolves.toBeNull();
    });

    it('rejects details missing a location (failure)', async () => {
      stubFetch(jsonResponse({ formattedAddress: 'Brīvības iela 45' }));

      await expect(places.resolvePlace('p', 'lv', 's')).rejects.toThrow(
        'maps_places_contract_violation',
      );
    });
  });
});
