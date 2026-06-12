import { loadPoints } from './loader.js';
import { groupPoints } from './grouping.js';
import { classifyGroups, TIER_THRESHOLDS } from './classifier.js';
import { writeResult } from './writer.js';
import type { GroupingResult } from './types.js';

/** Fixed destination point: Amir Timur Square, central Tashkent. */
const DESTINATION = { lat: 41.3111, lng: 69.2797 };

/**
 * Entry point: load points, cluster them into groups of 3,
 * classify each group by distance tier, and write the output JSON.
 *
 * @returns Promise that resolves when the pipeline completes.
 */
async function main(): Promise<void> {
  const points = await loadPoints('json');
  console.log(`Loaded ${points.length} points`);

  const { groups, unassigned } = groupPoints(points);
  const classified = classifyGroups(groups, DESTINATION);

  const result: GroupingResult = {
    destination: DESTINATION,
    tierThresholds: TIER_THRESHOLDS,
    totalGroups: classified.length,
    groups: classified,
    unassigned,
    generatedAt: new Date().toISOString(),
  };

  await writeResult(result);
}

main().catch((err) => {
  console.error('Geo-grouping pipeline failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
