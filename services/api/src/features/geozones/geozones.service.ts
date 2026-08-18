import { Injectable } from '@nestjs/common';
import type { LatLng } from '@taxi/shared';
import {
  GeozonesRepository,
  type ResolvedGeozone,
} from './geozones.repository';

/**
 * The slice's public API. Thin on purpose, like `PlatformConfigService`: it
 * exists so dispatch depends on a service rather than a repository.
 *
 * A point in no zone is `undefined` — legal, and means "use the city default
 * dispatch mode". It is not an error and must never throw.
 */
@Injectable()
export class GeozonesService {
  constructor(private readonly repository: GeozonesRepository) {}

  resolveForPoint(
    cityId: string,
    point: LatLng,
  ): Promise<ResolvedGeozone | undefined> {
    return this.repository.findContaining(cityId, point);
  }

  /** The city's zone catalog — one query, for the board's zone grid (#19). */
  listForCity(cityId: string): Promise<ResolvedGeozone[]> {
    return this.repository.listForCity(cityId);
  }
}
