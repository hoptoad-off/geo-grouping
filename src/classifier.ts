import type { GeoGroup } from './types.js';
import type { RawGroup } from './grouping.js';
import { haversineKm } from './grouping.js';

/** Fixed distance thresholds (km) used for tier classification. */
export const TIER_THRESHOLDS = {
  tier1MaxKm: 5,
  tier2MaxKm: 10,
} as const;

/**
 * Classifies a single distance into a priority tier.
 *
 * @param distanceKm - Centroid-to-destination distance in kilometers.
 * @returns 1 if < 5 km, 2 if >= 5 km and < 10 km, 3 if >= 10 km.
 */
export function classifyDistance(distanceKm: number): 1 | 2 | 3 {
  if (distanceKm < TIER_THRESHOLDS.tier1MaxKm) return 1;
  if (distanceKm < TIER_THRESHOLDS.tier2MaxKm) return 2;
  return 3;
}

/**
 * Computes each group's centroid-to-destination Haversine distance
 * and assigns a tier based on the fixed thresholds.
 *
 * @param groups - Raw clusters from the grouping step.
 * @param destination - Fixed destination point { lat, lng }.
 * @returns Fully classified GeoGroup objects.
 */
export function classifyGroups(
  groups: RawGroup[],
  destination: { lat: number; lng: number }
): GeoGroup[] {
  return groups.map((group) => {
    const distanceToDestination = haversineKm(
      group.centroid.lat,
      group.centroid.lng,
      destination.lat,
      destination.lng
    );
    return {
      ...group,
      distanceToDestination,
      tier: classifyDistance(distanceToDestination),
    };
  });
}
