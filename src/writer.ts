import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GroupingResult } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, '../data/output.json');

/**
 * Writes the grouping result to data/output.json (2-space indent)
 * and logs a human-readable summary to the console.
 *
 * @param result - The complete grouping result to persist.
 * @returns Promise that resolves once the file is written.
 */
export async function writeResult(result: GroupingResult): Promise<void> {
  await writeFile(OUTPUT_PATH, JSON.stringify(result, null, 2), 'utf-8');

  const tierCounts = { 1: 0, 2: 0, 3: 0 };
  for (const group of result.groups) {
    tierCounts[group.tier]++;
  }

  console.log(
    `✓ ${result.totalGroups} groups formed (Tier 1: ${tierCounts[1]}, Tier 2: ${tierCounts[2]}, Tier 3: ${tierCounts[3]})`
  );
  console.log(`✓ Unassigned points: ${result.unassigned.length}`);
  console.log('✓ Output written to data/output.json');
}
