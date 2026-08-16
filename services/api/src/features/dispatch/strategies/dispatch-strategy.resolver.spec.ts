import type { PlatformConfig } from '@taxi/shared';
import type { ResolvedGeozone } from '../../geozones';
import type { AutoMatchStrategy } from './auto-match.strategy';
import { DispatchStrategyResolver } from './dispatch-strategy.resolver';
import type { GeozoneQueueStrategy } from './geozone-queue.strategy';

const autoMatch = { mode: 'auto_match' } as AutoMatchStrategy;
const geozoneQueue = { mode: 'geozone_queue' } as GeozoneQueueStrategy;

const resolver = new DispatchStrategyResolver(autoMatch, geozoneQueue);

const config = (
  defaultDispatchMode: PlatformConfig['defaultDispatchMode'],
): PlatformConfig => ({ defaultDispatchMode }) as PlatformConfig;

const zone = (queueModeEnabled: boolean): ResolvedGeozone => ({
  id: '00000000-0000-4000-8000-000000000102',
  slug: 'rix',
  name: 'Lidosta RIX',
  queueModeEnabled,
});

describe('DispatchStrategyResolver', () => {
  it('picks the queue strategy in a queue-mode zone (expected)', () => {
    expect(resolver.forZone(zone(true), config('auto_match')).mode).toBe(
      'geozone_queue',
    );
  });

  it('falls back to the city default in a zone that opted out (edge)', () => {
    // `queueModeEnabled: false` means "this zone opted out", NOT "force
    // auto-match" — a city defaulting to queue mode must keep it here.
    expect(resolver.forZone(zone(false), config('auto_match')).mode).toBe(
      'auto_match',
    );
    expect(resolver.forZone(zone(false), config('geozone_queue')).mode).toBe(
      'geozone_queue',
    );
  });

  it('uses the city default for a pickup in no zone at all (failure)', () => {
    expect(resolver.forZone(undefined, config('auto_match')).mode).toBe(
      'auto_match',
    );
    expect(resolver.forZone(undefined, config('geozone_queue')).mode).toBe(
      'geozone_queue',
    );
  });
});
