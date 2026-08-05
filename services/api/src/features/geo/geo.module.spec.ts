import { APP_ENV, type Env } from '../../common/config/env.schema';
import { GeoModule, mapsProviderSourceFactory } from './geo.module';
import { MAPS_PROVIDER_SOURCE } from './maps.tokens';
import { StubMapsProvider } from './stub-maps.provider';

const env = (NODE_ENV: Env['NODE_ENV']) => ({ NODE_ENV }) as Env;

describe('mapsProviderSourceFactory', () => {
  it('provides the stub outside production (expected)', () => {
    expect(mapsProviderSourceFactory(env('development'))).toBeInstanceOf(
      StubMapsProvider,
    );
    expect(mapsProviderSourceFactory(env('test'))).toBeInstanceOf(
      StubMapsProvider,
    );
  });

  it('refuses to boot in production (failure)', () => {
    // The stub prices rides off straight-line distance and returns no polyline,
    // so an internet-facing deploy before #13/#16 quotes real money off
    // geometry. Failing at boot is the point: a silent stub is worse than no
    // boot.
    expect(() => mapsProviderSourceFactory(env('production'))).toThrow(
      /No production MapsProvider is bound/,
    );
  });

  it('is what the module actually binds MAPS_PROVIDER_SOURCE to (edge)', () => {
    // Without this, the two cases above pass just as happily against a
    // `useClass: StubMapsProvider` registration — the factory would be dead
    // code and production would still boot the stub.
    const providers = Reflect.getMetadata('providers', GeoModule) as {
      provide?: unknown;
      useClass?: unknown;
      useFactory?: unknown;
      inject?: unknown[];
    }[];
    const source = providers.find((p) => p.provide === MAPS_PROVIDER_SOURCE);

    expect(source?.useFactory).toBe(mapsProviderSourceFactory);
    expect(source?.inject).toEqual([APP_ENV]);
    expect(source?.useClass).toBeUndefined();
  });
});
