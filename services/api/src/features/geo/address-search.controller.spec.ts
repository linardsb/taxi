import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtClaims, MapsProvider, UserRole } from '@taxi/shared';
import type { Env } from '../../common/config/env.schema';
import { InMemoryKeyValueStore } from '../../../test/harness';
import { ROLES_KEY } from '../auth';
import { AddressSearchController } from './address-search.controller';
import {
  ADDRESS_SEARCH_MAX_PER_WINDOW,
  RIDER_ADDRESS_RESOLVE_MAX_PER_WINDOW,
  RIDER_ADDRESS_SEARCH_MAX_PER_WINDOW,
} from './address-search.policy';

const DISPATCHER = { sub: 'dispatcher-1', role: 'dispatcher' } as JwtClaims;
const RIDER = { sub: 'rider-1', role: 'rider' } as JwtClaims;

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

  // #16 widened both routes to riders. The cases below are about the WIDENING
  // itself: that a rider is served, that their quota is their own, and that the
  // widening did not quietly admit a fourth role.
  describe('rider access', () => {
    it("serves a rider and spends against the rider's own key (expected)", async () => {
      const { maps, kv, controller } = build();

      await expect(
        controller.search(RIDER, { q: 'brivibas 45', session: SESSION }),
      ).resolves.toEqual([SUGGESTION]);

      expect(maps.searchAddress).toHaveBeenCalledTimes(1);
      expect(await kv.get('geo:search:rate:rider:rider-1')).toBe('1');
      // NOT the dispatcher namespace, which is what makes the two caps
      // independent rather than merely differently sized.
      expect(await kv.get('geo:search:rate:rider-1')).toBeNull();
    });

    it('throttles a rider at their own cap while a dispatcher is unaffected (edge)', async () => {
      const { kv, controller } = build();

      for (let i = 0; i < RIDER_ADDRESS_SEARCH_MAX_PER_WINDOW; i += 1) {
        await controller.search(RIDER, { q: 'briv', session: SESSION });
      }

      const throttled = controller.search(RIDER, {
        q: 'briv',
        session: SESSION,
      });
      await expect(throttled).rejects.toBeInstanceOf(HttpException);
      await throttled.catch((error: HttpException) => {
        expect(error.getStatus()).toBe(429);
        const body = error.getResponse() as { retryAfterSeconds: number };
        expect(body.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      });

      // One person can hold both roles in a small operator: a rider who
      // exhausted their own quota must not have spent Dina's shift.
      await expect(
        controller.search(DISPATCHER, { q: 'briv', session: SESSION }),
      ).resolves.toEqual([SUGGESTION]);
      expect(await kv.get('geo:search:rate:dispatcher-1')).toBe('1');
    });

    it("resolves against the rider's own, much smaller resolve cap (edge)", async () => {
      const { maps, controller } = build();

      for (let i = 0; i < RIDER_ADDRESS_RESOLVE_MAX_PER_WINDOW; i += 1) {
        await controller.resolve(RIDER, 'place-1', { session: SESSION });
      }

      await expect(
        controller.resolve(RIDER, 'place-1', { session: SESSION }),
      ).rejects.toBeInstanceOf(HttpException);
      // The cap is what bounds the bill: the 11th resolve never reaches Google.
      expect(maps.resolvePlace).toHaveBeenCalledTimes(
        RIDER_ADDRESS_RESOLVE_MAX_PER_WINDOW,
      );
    });

    it('admits dispatcher, admin and rider and nobody else — a driver is refused by the guard (failure)', () => {
      // The guard, not the method, is what returns the 403, so the assertion is
      // on the metadata the guard reads. A fourth role appearing here is a
      // widening nobody asked for.
      const reflector = new Reflector();
      const expected = ['admin', 'dispatcher', 'rider'];
      // Read off the property DESCRIPTOR rather than as
      // `Controller.prototype.search`: the latter is an unbound method
      // reference, which `@typescript-eslint/unbound-method` rejects.
      type Handler = (...args: never[]) => unknown;
      const handlerOf = (name: 'search' | 'resolve'): Handler =>
        Object.getOwnPropertyDescriptor(AddressSearchController.prototype, name)
          ?.value as Handler;
      for (const name of ['search', 'resolve'] as const) {
        const roles = reflector.get<UserRole[], string>(
          ROLES_KEY,
          handlerOf(name),
        );
        expect([...roles].sort()).toEqual(expected);
      }
    });
  });
});
