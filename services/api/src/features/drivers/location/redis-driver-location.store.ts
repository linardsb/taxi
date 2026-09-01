import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { LatLng } from '@taxi/shared';
import Redis from 'ioredis';
import type {
  DriverLocationStore,
  NearbyDriver,
  OnlineDriver,
} from './driver-location.store';

/** Who may have a position recorded at all — the gate the Lua script reads. */
const onlineKey = (cityId: string) => `drivers:online:${cityId}`;
/** The GEO set itself: a sorted set under the hood, hence ZREM to remove a member. */
const geoKey = (cityId: string) => `drivers:geo:${cityId}`;
/** Its own key because a GEO member cannot carry a last-seen score of its own. */
const seenKey = (cityId: string) => `drivers:seen:${cityId}`;

/**
 * GEOSEARCH … WITHDIST WITHCOORD → [member, distance, [lng, lat]]; every leaf
 * is a STRING.
 *
 * Validated rather than cast (L6). ioredis types every reply as `unknown`, and
 * a cast over a shape change yields `{lat: NaN, lng: NaN}` typed as a `LatLng`
 * that was never parsed — a driver at the origin, silently, in the data
 * dispatch picks from. A malformed row is dropped, never guessed at.
 */
type GeoSearchRow = [string, string, [string, string]];

const isNumeric = (v: unknown): v is string =>
  typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v));

/** Exported for its spec — a malformed reply must be provable, not assumed. */
export function asGeoSearchRow(value: unknown): GeoSearchRow | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined;
  const [member, distance, coord] = value as unknown[];
  if (typeof member !== 'string' || !isNumeric(distance)) return undefined;
  if (!Array.isArray(coord) || coord.length < 2) return undefined;
  const [lng, lat] = coord as unknown[];
  if (!isNumeric(lng) || !isNumeric(lat)) return undefined;
  return [member, distance, [lng, lat]];
}

/** ZRANGEBYSCORE returns a flat array of members; anything else is not usable. */
export function asMemberSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((v): v is string => typeof v === 'string'));
}

@Injectable()
export class RedisDriverLocationStore
  implements DriverLocationStore, OnModuleDestroy
{
  private readonly redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url);
    // EVALSHA with an automatic NOSCRIPT fallback, instead of shipping the Lua
    // source on every ping (L4). ioredis caches the SHA and re-sends the body
    // only if the server has forgotten it — a restart or SCRIPT FLUSH — so the
    // atomicity argument below is unchanged; only the bytes on the wire shrink.
    this.redis.defineCommand('recordDriverPosition', {
      numberOfKeys: 3,
      lua: RedisDriverLocationStore.RECORD,
    });
  }

  /**
   * SADD + the seeded `seen` score in one round trip (#14). `zadd(key, score,
   * member)` — score BEFORE member in ioredis.
   */
  async markOnline(
    cityId: string,
    driverId: string,
    atMs: number,
  ): Promise<void> {
    await this.redis
      .multi()
      .sadd(onlineKey(cityId), driverId)
      .zadd(seenKey(cityId), String(atMs), driverId)
      .exec();
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

  /**
   * `defineCommand` attaches the command to the client at runtime, so it needs
   * its own type — and it must stay BOUND to the client, or ioredis's generated
   * function loses the `this` it sends on.
   */
  private get recordCommand(): (...args: string[]) => Promise<unknown> {
    const client = this.redis as unknown as Record<
      string,
      (...a: string[]) => Promise<unknown>
    >;
    return client.recordDriverPosition!.bind(this.redis);
  }

  async record(
    cityId: string,
    driverId: string,
    location: LatLng,
    atMs: number,
  ): Promise<boolean> {
    const result = await this.recordCommand(
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

    const fresh = asMemberSet(freshReply?.[1]);
    const rawRows = Array.isArray(geoReply?.[1]) ? geoReply[1] : [];

    const nearby: NearbyDriver[] = [];
    for (const raw of rawRows) {
      const row = asGeoSearchRow(raw);
      if (!row) continue; // unreadable beats a driver at {NaN, NaN}
      const [driverId, distance, coord] = row;
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

  async positionOf(
    cityId: string,
    driverId: string,
  ): Promise<{ location: LatLng; atMs: number } | null> {
    const replies = await this.redis
      .pipeline()
      .geopos(geoKey(cityId), driverId)
      .zscore(seenKey(cityId), driverId)
      .exec();

    if (!replies)
      throw new Error('driver-location: redis pipeline returned no replies');
    const [posReply, seenReply] = replies;
    // Surface a command error, same rule as findNearby: a silent null here
    // reads to the tracking page as "driver has no position".
    if (posReply?.[0]) throw posReply[0];
    if (seenReply?.[0]) throw seenReply[0];

    // GEOPOS → [[lng, lat] | null] per queried member; ZSCORE → string | null.
    // Validated rather than cast (the asGeoSearchRow rule): a malformed reply
    // is null, never a position at {NaN, NaN}.
    const entries = Array.isArray(posReply?.[1])
      ? (posReply[1] as unknown[])
      : [];
    const coord = entries[0];
    if (!Array.isArray(coord) || coord.length < 2) return null;
    const [lng, lat] = coord as unknown[];
    if (!isNumeric(lng) || !isNumeric(lat) || !isNumeric(seenReply?.[1]))
      return null;
    return {
      location: { lat: Number(lat), lng: Number(lng) },
      atMs: Number(seenReply[1]),
    };
  }

  /**
   * SMEMBERS, then one pipelined GEOPOS + ZMSCORE over the members. A plain
   * pipeline, not Lua: this is read-only, so the write race the `record` gate
   * closes atomically cannot arise here — the worst interleaving is a driver
   * going offline mid-read, which the next 2 s board frame corrects.
   */
  async listOnline(cityId: string): Promise<OnlineDriver[]> {
    const members = await this.redis.smembers(onlineKey(cityId));
    if (members.length === 0) return [];

    const replies = await this.redis
      .pipeline()
      .geopos(geoKey(cityId), ...members)
      .zmscore(seenKey(cityId), ...members)
      .exec();

    if (!replies)
      throw new Error('driver-location: redis pipeline returned no replies');
    const [posReply, seenReply] = replies;
    // Surface a command error, same rule as findNearby: a silent empty list
    // here reads to the console as "no drivers online in Rīga".
    if (posReply?.[0]) throw posReply[0];
    if (seenReply?.[0]) throw seenReply[0];

    // GEOPOS → [[lng, lat] | null] and ZMSCORE → [string | null], one entry
    // per queried member, in query order. Validated rather than cast (the
    // asGeoSearchRow rule): a malformed coordinate is a null position on the
    // board, never a driver at {NaN, NaN}.
    const positions = Array.isArray(posReply?.[1])
      ? (posReply[1] as unknown[])
      : [];
    const scores = Array.isArray(seenReply?.[1])
      ? (seenReply[1] as unknown[])
      : [];

    return members.map((driverId, i) => {
      const coord = positions[i];
      let location: OnlineDriver['location'] = null;
      if (Array.isArray(coord) && coord.length >= 2) {
        const [lng, lat] = coord as unknown[];
        if (isNumeric(lng) && isNumeric(lat)) {
          location = { lat: Number(lat), lng: Number(lng) }; // coord is [lng, lat]
        }
      }
      const score = scores[i];
      return {
        driverId,
        location,
        lastSeenMs: isNumeric(score) ? Number(score) : null,
      };
    });
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
