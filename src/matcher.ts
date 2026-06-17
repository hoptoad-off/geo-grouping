import type { Participant } from './types.js';
import { haversineKm, computeCentroid } from './grouping.js';

/** A group proposed by the matcher, before persistence. */
export interface FormedGroup {
  memberIds: string[];
  centroid: { lat: number; lng: number };
}

/**
 * Greedily builds one group around a seed: adds the nearest candidates that are
 * within `radiusKm` of EVERY current member, until the group reaches groupSize.
 *
 * @returns The members (length === groupSize) or null if no valid group exists.
 */
function buildGroup(
  seed: Participant,
  candidates: Participant[],
  radiusKm: number,
  groupSize: number
): Participant[] | null {
  const near = candidates
    .filter((c) => haversineKm(seed.lat, seed.lng, c.lat, c.lng) <= radiusKm)
    .sort(
      (a, b) =>
        haversineKm(seed.lat, seed.lng, a.lat, a.lng) -
        haversineKm(seed.lat, seed.lng, b.lat, b.lng)
    );

  const members: Participant[] = [seed];
  for (const c of near) {
    if (members.length >= groupSize) break;
    const okWithAll = members.every(
      (m) => haversineKm(m.lat, m.lng, c.lat, c.lng) <= radiusKm
    );
    if (okWithAll) members.push(c);
  }

  return members.length === groupSize ? members : null;
}

/**
 * Finds groups among waiting participants where all pairwise distances within a
 * group are <= radiusKm. Seeds are tried in createdAt order (oldest first);
 * a seed with no valid partners is left waiting.
 *
 * @param waiting - Participants with status 'waiting'.
 * @param radiusKm - Maximum allowed pairwise distance.
 * @param groupSize - Required members per group.
 * @returns Newly formed groups (each with memberIds and centroid).
 */
export function findGroups(
  waiting: Participant[],
  radiusKm: number,
  groupSize: number
): FormedGroup[] {
  const pool = [...waiting].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const used = new Set<string>();
  const result: FormedGroup[] = [];

  for (const seed of pool) {
    if (used.has(seed.id)) continue;
    const candidates = pool.filter((c) => c.id !== seed.id && !used.has(c.id));
    const members = buildGroup(seed, candidates, radiusKm, groupSize);
    if (members) {
      for (const m of members) used.add(m.id);
      result.push({
        memberIds: members.map((m) => m.id),
        centroid: computeCentroid(members),
      });
    }
  }

  return result;
}
