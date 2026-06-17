import 'dotenv/config';

/** Typed, validated bot configuration. */
export interface BotConfig {
  botToken: string;
  groupRadiusKm: number;
  groupSize: number;
  testMode: boolean;
}

/**
 * Loads and validates configuration from environment variables.
 *
 * @param env - Environment source (defaults to process.env; injectable for tests).
 * @returns Validated BotConfig.
 * @throws If BOT_TOKEN is missing or numeric values are invalid.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const botToken = env.BOT_TOKEN;
  if (!botToken) {
    throw new Error('BOT_TOKEN is required');
  }

  const groupRadiusKm = env.GROUP_RADIUS_KM ? Number(env.GROUP_RADIUS_KM) : 5;
  if (!Number.isFinite(groupRadiusKm) || groupRadiusKm <= 0) {
    throw new Error('GROUP_RADIUS_KM must be a positive number');
  }

  const groupSize = env.GROUP_SIZE ? Number(env.GROUP_SIZE) : 3;
  if (!Number.isInteger(groupSize) || groupSize < 2) {
    throw new Error('GROUP_SIZE must be an integer >= 2');
  }

  const testMode = env.TEST_MODE !== 'false';

  return { botToken, groupRadiusKm, groupSize, testMode };
}
