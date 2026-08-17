import { HttpException } from '@nestjs/common';
import type { JwtClaims, MapsProvider } from '@taxi/shared';
import type { Env } from '../../common/config/env.schema';
import { InMemoryKeyValueStore } from '../../../test/harness';
import { AddressSearchController } from './address-search.controller';
import { ADDRESS_SEARCH_MAX_PER_WINDOW } from './address-search.policy';

const DISPATCHER = { sub: 'dispatcher-1', role: 'dispatcher' } as JwtClaims;

const SUGGESTION = {
  placeId: 'place-1',
  primaryText: 'Brīvības iela 45',
  secondaryText: 'Rīga, Latvija',
};

const POINT = {
  location: { lat: 56.9496, lng: 24.1052 },
  address: 'Brīvības iela 45, Rīga',
};

const SESSION = '00000000-0000-4000-8000-000000000abc';

function build() {
  const maps = {
    searchAddress: jest.fn().mockResolvedValue([SUGGESTION]),
    resolvePlace: jest.fn().mockResolvedValue(POINT),
    route: jest.fn(),
    geocode: jest.fn(),
    reverseGeocode: jest.fn(),
  } as unknown as MapsProvider & {
    searchAddress: jest.Mock;
    resolvePlace: jest.Mock;
  };
  const kv = new InMemoryKeyValueStore();
  const env = {
    PLACES_SEARCH_MIN_CHARS: 3,
    PLACES_BIAS_RADIUS_METERS: 30_000,
  } as Env;
  return { maps, kv, controller: new AddressSearchController(maps, kv, env) };
}

describe('AddressSearchController', () => {
  describe('search', () => {
    it('biases to Rīga and forwards the session token (expected)', async () => {
      const { maps, controller } = build();

      const results = await controller.search(DISPATCHER, {
        q: 'brivibas 45',
        session: SESSION,
      });

      expect(results).toEqual([SUGGESTION]);
      expect(maps.searchAddress).toHaveBeenCalledWith('brivibas 45', 'lv', {
        bias: {
          center: { lat: 56.9496, lng: 24.1052 },
          radiusMeters: 30_000,
        },
        sessionToken: SESSION,
      });
    });

    it('answers [] below the minimum length without spending (edge)', async () => {
      const { maps, kv, controller } = build();

      await expect(
        controller.search(DISPATCHER, { q: 'br', session: SESSION }),
      ).resolves.toEqual([]);

      expect(maps.searchAddress).not.toHaveBeenCalled();
      // And it did not consume the quota that exists to bound spend — a request
      // that cannot spend must not count against one that can.
      expect(await kv.get('geo:search:rate:dispatcher-1')).toBeNull();
    });

    it('counts a padded short query as short (edge)', async () => {
      const { maps, controller } = build();

      await expect(
        controller.search(DISPATCHER, { q: '  br  ', session: SESSION }),
      ).resolves.toEqual([]);

      expect(maps.searchAddress).not.toHaveBeenCalled();
    });

    it('throttles a runaway client with a positive retry hint (failure)', async () => {
      const { maps, controller } = build();

      for (let i = 0; i < ADDRESS_SEARCH_MAX_PER_WINDOW; i += 1) {
        await controller.search(DISPATCHER, { q: 'briv', session: SESSION });
      }

      const throttled = controller.search(DISPATCHER, {
        q: 'briv',
        session: SESSION,
      });
      await expect(throttled).rejects.toBeInstanceOf(HttpException);
      await throttled.catch((error: HttpException) => {
        expect(error.getStatus()).toBe(429);
        const body = error.getResponse() as { retryAfterSeconds: number };
        expect(body.retryAfterSeconds).toBeGreaterThan(0);
      });

      // The cap is what bounds the bill: the 121st call never reaches Google.
      expect(maps.searchAddress).toHaveBeenCalledTimes(
        ADDRESS_SEARCH_MAX_PER_WINDOW,
      );
    });
  });

  describe('resolve', () => {
    it('returns the bookable point (expected)', async () => {
      const { maps, controller } = build();

      await expect(
        controller.resolve(DISPATCHER, 'place-1', { session: SESSION }),
      ).resolves.toEqual(POINT);

      expect(maps.resolvePlace).toHaveBeenCalledWith('place-1', 'lv', SESSION);
    });

    it('404s a place the provider has forgotten (failure)', async () => {
      const { maps, controller } = build();
      maps.resolvePlace.mockResolvedValue(null);

      const rejected = controller.resolve(DISPATCHER, 'gone', {
        session: SESSION,
      });

      await expect(rejected).rejects.toThrow('place_not_found');
      await rejected.catch((error: HttpException) => {
        expect(error.getStatus()).toBe(404);
      });
    });
  });
});
