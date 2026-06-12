/**
 * A single geolocation point loaded from the data source.
 * Extra fields are allowed so DB rows with additional columns
 * can flow through the pipeline unchanged.
 */
export interface GeoPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  [key: string]: any; // extensible for DB fields later
}

/** A cluster of exactly 3 points with its computed centroid and tier. */
export interface GeoGroup {
  groupId: string; // e.g. "group_001"
  points: GeoPoint[]; // always exactly 3 points
  centroid: { lat: number; lng: number };
  distanceToDestination: number; // in kilometers
  tier: 1 | 2 | 3; // 1 = closest (< 5km), 2 = mid (5–10km), 3 = far (10km+)
}

/** The full output document written to data/output.json. */
export interface GroupingResult {
  destination: { lat: number; lng: number };
  tierThresholds: {
    tier1MaxKm: 5; // < 5km → Tier 1
    tier2MaxKm: 10; // 5–10km → Tier 2
    //                 10km+ → Tier 3
  };
  totalGroups: number;
  groups: GeoGroup[];
  unassigned: GeoPoint[]; // remainder points if count not divisible by 3
  generatedAt: string; // ISO timestamp
}
