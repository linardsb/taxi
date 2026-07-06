import type { RideStatus } from "./ride-state-machine";
import type { LatLng } from "./schemas/geo";

/**
 * Socket.IO event names and payloads shared by api, rider, driver, and
 * dispatch. Naming follows domain:action. Documented in
 * .claude/references/realtime-events.md — keep the two in sync.
 */
export const RT = {
  driverLocation: "driver:location",
  rideStatus: "ride:status",
  rideOffer: "ride:offer",
  dispatchBoard: "dispatch:board",
} as const;

export interface DriverLocationEvent {
  driverId: string;
  location: LatLng;
  heading?: number;
  at: string; // ISO timestamp
}

export interface RideStatusEvent {
  rideId: string;
  status: RideStatus;
  at: string;
}

export interface RideOfferEvent {
  rideId: string;
  expiresAt: string;
  pickupAddress: string;
  etaSeconds: number;
}
