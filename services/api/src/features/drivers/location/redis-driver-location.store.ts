import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { LatLng } from '@taxi/shared';
import Redis from 'ioredis';
import type {
  DriverLocationStore,
  NearbyDriver,
} from './driver-location.store';

/** Who may have a position recorded at all — the gate the Lua script reads. */
const onlineKey = (cityId: string) => `drivers:online:${cityId}`;
/** The GEO set itself: a sorted set under the hood, hence ZREM to remove a member. */
const geoKey = (cityId: string) => `drivers:geo:${cityId}`;
/** Its own key because a GEO member cannot carry a last-seen score of its own. */
const seenKey = (cityId: string) => `drivers:seen:${cityId}`;

/** GEOSEARCH … WITHDIST WITHCOORD → [member, distance, [lng, lat]]; every leaf is a STRING. */
type GeoSearchRow = [string, string, [string, string]];

@Injectable()
export class RedisDriverLocationStore
  implements DriverLocationStore, OnModuleDestroy
{
  private readonly redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url);
  }

  async markOnline(cityId: string, driverId: string): Promise<void> {
    await this.redis.sadd(onlineKey(cityId), driverId);
  }

  /**
   * All three keys in one round trip. There is no `GEODEL` — a GEO set is a
   * sorted set, so `ZREM` is how a position is removed.
   */
  async markOffline(cityId: string, driverId: string): Promise<void> {
    await this.redis
      .multi()
      .srem(onlineKey(cityId), driverId)
      .zrem(geoKey(cityId), driverId)
      .zrem(seenKey(cityId), driverId)
      .exec();
  }

  /**
   * Presence check and position write in one atomic step. Two commands would
   * leave the window this codebase already reasons about elsewhere (see
   * auth.service.ts on claiming the OTP cooldown rather than reading it): a
   * driver who went offline between the SISMEMBER and the GEOADD is silently
   * re-added by their own straggler ping, and dispatch offers them a ride.
   */
  private static readonly RECORD = `
    if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 0 then return 0 end
    redis.call('GEOADD', KEYS[2], ARGV[2], ARGV[3], ARGV[1])
    redis.call('ZADD', KEYS[3], ARGV[4], ARGV[1])
    return 1
  `;

  async record(
    cityId: string,
    driverId: string,
    location: LatLng,
    atMs: number,
  ): Promise<boolean> {
    const result = await this.redis.eval(
      RedisDriverLocationStore.RECORD,
      3,
      onlineKey(cityId),
      geoKey(cityId),
      seenKey(cityId),
      driverId,
      String(location.lng), // GEOADD key LONGITUDE LATITUDE member — lng FIRST
      String(location.lat),
      String(atMs),
    );
    return Number(result) === 1;
  }

  async findNearby(
    cityId: string,
    centre: LatLng,
    opts: { radiusMeters: number; limit: number; freshSinceMs: number },
  ): Promise<NearbyDriver[]> {
    const replies = await this.redis
      .pipeline()
      .geosearch(
        geoKey(cityId),
        'FROMLONLAT',
        String(centre.lng), // lng FIRST — the reverse of how LatLng reads
        String(centre.lat),
        'BYRADIUS',
        String(opts.radiusMeters),
        'm',
        'ASC', // nearest first; the freshness filter below preserves the order
        'WITHDIST',
        'WITHCOORD',
        // No COUNT on purpose: Redis applies it BEFORE our freshness filter, so
        // COUNT 10 over 8 stale positions can return nothing usable while a
        // live driver sits 200 m away. See the plan's NOTES for the scaling fix.
      )
      .zrangebyscore(seenKey(cityId), opts.freshSinceMs, '+inf')
      .exec();

    if (!replies)
      throw new Error('driver-location: redis pipeline returned no replies');
    const [geoReply, freshReply] = replies;
    // Surface a command error instead of degrading to "nobody is nearby" — a
    // silent empty list here reads to dispatch as "no drivers in Rīga".
    if (geoReply?.[0]) throw geoReply[0];
    if (freshReply?.[0]) throw freshReply[0];

    const fresh = new Set((freshReply?.[1] ?? []) as string[]);
    const rows = (geoReply?.[1] ?? []) as GeoSearchRow[];

    const nearby: NearbyDriver[] = [];
    for (const [driverId, distance, coord] of rows) {
      if (!fresh.has(driverId)) continue; // socket went away without going offline
      nearby.push({
        driverId,
        location: { lat: Number(coord[1]), lng: Number(coord[0]) }, // coord is [lng, lat]
        distanceMeters: Number(distance),
      });
      if (nearby.length === opts.limit) break;
    }
    return nearby;
  }

  /**
   * `quit()` is the graceful close, but it rejects when Redis is unreachable
   * (restart, network blip). Letting that escape would abort the rest of the
   * shutdown hooks — including the pg pool's — so force the socket down instead.
   */
  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
