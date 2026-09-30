/**
 * Every banner the presence reducer can raise. Split out of `presence-state.ts`
 * when #20's `driver_not_approved` pushed that file past the 500-line cap.
 */
export type BannerKind =
  | 'marked_offline'
  | 'foreground_denied'
  | 'background_denied'
  | 'vehicle_required'
  | 'driver_on_ride'
  | 'driver_not_approved'
  | 'battery'
  | 'generic';
