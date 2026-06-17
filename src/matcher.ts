import type { Participant, Group } from './types.js';
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
    .map((c) => ({ c, d: haversineKm(seed.lat, seed.lng, c.lat, c.lng) }))
    .filter(({ d }) => d <= radiusKm)
    .sort((a, b) => a.d - b.d)
    .map(({ c }) => c);

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

/** Result of a global group re-optimization. */
export interface OptimizeResult {
  groups: FormedGroup[];
  waitingIds: string[];
}

/**
 * Re-optimizes groups over ALL participants so members end up with their nearest
 * neighbors, while guaranteeing no previously-grouped participant is orphaned.
 *
 * Iterative greedy rebuild with original-group locking: run findGroups over the
 * pool; if any previously-grouped participant would be left over, lock its whole
 * original group (remove those members from the pool) and re-run; repeat until no
 * previously-grouped participant is orphaned. Worst case locks every original
 * group (no change); best case rebuilds all groups tighter.
 *
 * @param participants - All participants (grouped + waiting).
 * @param existingGroups - Current groups (to look up original membership).
 * @param radiusKm - Max pairwise distance for a group.
 * @param groupSize - Members per group.
 * @returns Final groups and the ids left waiting (only ever previously-waiting ones).
 */
export function optimizeGroups(
  participants: Participant[],
  existingGroups: Group[],
  radiusKm: number,
  groupSize: number
): OptimizeResult {
  const originalGroupByMember = new Map<string, Group>();
  for (const g of existingGroups) {
    for (const id of g.memberIds) originalGroupByMember.set(id, g);
  }
  const previouslyGrouped = new Set(
    participants.filter((p) => p.status === 'grouped').map((p) => p.id)
  );

  const lockedGroups: Group[] = [];
  const lockedIds = new Set<string>();

  for (;;) {
    const pool = participants.filter((p) => !lockedIds.has(p.id));
    const tentative = findGroups(pool, radiusKm, groupSize);

    const placed = new Set<string>();
    for (const fg of tentative) for (const id of fg.memberIds) placed.add(id);

    const orphaned = [...previouslyGrouped].filter(
      (id) => !lockedIds.has(id) && !placed.has(id)
    );

    if (orphaned.length === 0) {
      const groups: FormedGroup[] = [
        ...lockedGroups.map((g) => ({ memberIds: g.memberIds, centroid: g.centroid })),
        ...tentative,
      ];
      const grouped = new Set<string>();
      for (const g of groups) for (const id of g.memberIds) grouped.add(id);
      const waitingIds = participants
        .filter((p) => !grouped.has(p.id))
        .map((p) => p.id);
      return { groups, waitingIds };
    }

    for (const id of orphaned) {
      const g = originalGroupByMember.get(id);
      if (!g || lockedGroups.some((lg) => lg.groupId === g.groupId)) continue;
      lockedGroups.push(g);
      for (const m of g.memberIds) lockedIds.add(m);
    }
  }
}
