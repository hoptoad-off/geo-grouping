import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GeoPoint } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT_PATH = path.resolve(__dirname, '../data/input.json');

/**
 * Validates one raw entry and returns a clean GeoPoint containing only the
 * known fields. Unknown fields are dropped so untrusted input can't smuggle
 * arbitrary data through the pipeline into the output and the viewer.
 *
 * @param raw - Untyped entry parsed from JSON.
 * @param index - Position in the array, for error messages.
 * @returns A validated GeoPoint.
 * @throws If a required field is missing or out of range.
 */
function validatePoint(raw: unknown, index: number): GeoPoint {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`input.json[${index}] must be an object`);
  }
  const { id, name, lat, lng } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`input.json[${index}].id must be a non-empty string`);
  }
  if (typeof name !== 'string') {
    throw new Error(`input.json[${index}].name must be a string`);
  }
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error(`input.json[${index}].lat must be a number in [-90, 90]`);
  }
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error(`input.json[${index}].lng must be a number in [-180, 180]`);
  }
  return { id, name, lat, lng };
}

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
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('input.json must contain a JSON array of points');
    }
    return parsed.map(validatePoint);
  }

  // TODO: replace with actual DB query
  // Expected query: SELECT id, name, lat, lng FROM locations WHERE active = true
  throw new Error('DB source not yet implemented');
}
