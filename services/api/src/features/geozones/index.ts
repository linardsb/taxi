/**
 * The geozones slice's public API — nothing outside imports past this file.
 * The repository is deliberately absent: the service is the boundary.
 *
 * Answers one question for #10: "which zone is this pickup in?" — which decides
 * whether dispatch runs in queue mode, and stamps `rides.geozone_id` for Dina's
 * district stats (S7-2).
 *
 * KNOWN GAPS — seen and accepted for the pilot, not overlooked:
 *
 * - No controller and no writes. Zones come from the `@taxi/db` seed; #20 adds
 *   the admin CRUD that lets Dina draw them without a deploy.
 * - Polygons are never read into JS. Every lookup is `ST_Contains` in SQL, so
 *   there is no in-memory point-in-polygon and no polygon cache. The driver
 *   location ping path — which is forbidden from touching Drizzle — therefore
 *   cannot ask "which zone am I in", which is why #10 enrolls drivers into
 *   geozone queues lazily at dispatch time instead of on zone entry.
 * - No zone lookup for the DESTINATION. Only the pickup resolves a zone; #20's
 *   district reporting is what would need both.
 */
export { GeozonesModule } from './geozones.module';
export { GeozonesService } from './geozones.service';
export type { ResolvedGeozone } from './geozones.repository';
