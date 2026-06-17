import type { Api, RawApi } from 'grammy';
import type { Participant } from './types.js';
import { haversineKm } from './grouping.js';
import { t } from './i18n.js';

type BotApi = Api<RawApi>;

/**
 * Sends a message, logging and swallowing any failure (e.g. user blocked the bot)
 * so one bad recipient never crashes the handler.
 */
export async function safeSend(api: BotApi, chatId: number, text: string): Promise<void> {
  try {
    await api.sendMessage(chatId, text);
  } catch (err) {
    console.error(
      `Failed to send message to ${chatId}:`,
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Builds the "group formed" message from one member's perspective, in that member's
 * language, listing the other members and their distance from `self`.
 */
export function formatGroupFormed(members: Participant[], self: Participant): string {
  const lang = self.language;
  const km = t(lang, 'unit.km');
  const lines = members
    .filter((m) => m.id !== self.id)
    .map((o) => `• ${o.displayName} — ${haversineKm(self.lat, self.lng, o.lat, o.lng).toFixed(1)} ${km}`);
  return `${t(lang, 'group.formedTitle')}\n${t(lang, 'group.neighbors')}\n${lines.join('\n')}`;
}
