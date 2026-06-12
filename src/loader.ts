import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GeoPoint } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT_PATH = path.resolve(__dirname, '../data/input.json');

/**
 * Loads geolocation points from the configured data source.
 * Switching to a database later requires changes only in this module.
 *
 * @param source - 'json' to read data/input.json, 'db' for a database query (not yet implemented).
 * @returns Promise resolving to the array of loaded GeoPoints.
 * @throws If the source is 'db' (stubbed) or the JSON file is missing/invalid.
 */
export async function loadPoints(source: 'json' | 'db'): Promise<GeoPoint[]> {
  if (source === 'json') {
    const raw = await readFile(INPUT_PATH, 'utf-8');
    const points: GeoPoint[] = JSON.parse(raw);
    if (!Array.isArray(points)) {
      throw new Error('input.json must contain a JSON array of points');
    }
    return points;
  }

  // TODO: replace with actual DB query
  // Expected query: SELECT id, name, lat, lng FROM locations WHERE active = true
  throw new Error('DB source not yet implemented');
}
