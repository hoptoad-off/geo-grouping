import type { GeoPoint } from './types.js';

const EARTH_RADIUS_KM = 6371;

/**
 * Converts degrees to radians.
 *
 * @param deg - Angle in degrees.
 * @returns Angle in radians.
 */
function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Computes the great-circle distance between two coordinates
 * using the Haversine formula.
 *
 * @param lat1 - Latitude of the first point in degrees.
 * @param lng1 - Longitude of the first point in degrees.
 * @param lat2 - Latitude of the second point in degrees.
 * @param lng2 - Longitude of the second point in degrees.
 * @returns Distance between the two points in kilometers.
 */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Computes the centroid of a set of points as the arithmetic mean
 * of their latitudes and longitudes.
 *
 * @param points - Points to average (must be non-empty).
 * @returns Centroid coordinates { lat, lng }.
 */
export function computeCentroid(
  points: ReadonlyArray<{ lat: number; lng: number }>
): { lat: number; lng: number } {
  const lat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const lng = points.reduce((sum, p) => sum + p.lng, 0) / points.length;
  return { lat, lng };
}

/**
 * Raw cluster produced by the grouping step, before tier classification.
 */
export interface RawGroup {
  groupId: string;
  points: GeoPoint[];
  centroid: { lat: number; lng: number };
}

/**
 * Greedy nearest-neighbor clustering into groups of exactly 3 points.
 *
 * Algorithm: take the first unassigned point as a seed, attach its 2
 * nearest unassigned neighbors (Haversine distance), mark all 3 as
 * assigned, and repeat. Points left over when fewer than 3 remain are
 * returned in `unassigned`.
 *
 * @param points - All input points to cluster.
 * @returns Object with `groups` (each exactly 3 points, with centroid
 *          and sequential groupId like "group_001") and `unassigned`
 *          (0–2 leftover points).
 */
export function groupPoints(points: GeoPoint[]): {
  groups: RawGroup[];
  unassigned: GeoPoint[];
} {
  // Copy so we never mutate the caller's array; original input order
  // determines which point becomes the next seed.
  const remaining = [...points];
  const groups: RawGroup[] = [];

  while (remaining.length >= 3) {
    const seed = remaining.shift()!;
    const neighbors = remaining
      .map((p, index) => ({
        index,
        dist: haversineKm(seed.lat, seed.lng, p.lat, p.lng),
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 2)
      .map((n) => n.index)
      .sort((a, b) => b - a); // remove higher index first to keep indices valid

    const members = [seed];
    for (const index of neighbors) {
      members.push(remaining.splice(index, 1)[0]);
    }

    const groupId = `group_${String(groups.length + 1).padStart(3, '0')}`;
    groups.push({ groupId, points: members, centroid: computeCentroid(members) });
  }

  return { groups, unassigned: remaining };
}
