import { Bot, Keyboard } from 'grammy';
import type { Api, RawApi } from 'grammy';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import type { GroupWithMembers } from './store.js';
import type { Language } from './types.js';
import { t } from './i18n.js';
import { CAMPUSES } from './campuses.js';
import { startOnboarding, advance, type OnboardingState } from './onboarding.js';
import { formatGroupFormed, safeSend } from './notify.js';
import { createViewerServer } from './viewer-server.js';

const config = loadConfig();
const store = await Store.load();
const bot = new Bot(config.botToken);

/** In-flight onboarding wizards, keyed by Telegram user id (transient). */
const onboarding = new Map<number, OnboardingState>();

/** Fixed language button labels (language-independent). */
const LANG_BY_LABEL: Record<string, Language> = {
  English: 'en',
  'Русский': 'ru',
  "O'zbek": 'uz',
};
const LANG_LABELS = Object.keys(LANG_BY_LABEL);

function languageKeyboard(): Keyboard {
  return new Keyboard().text(LANG_LABELS[0]).text(LANG_LABELS[1]).text(LANG_LABELS[2]).resized().oneTime();
}

function campusKeyboard(lang: Language): Keyboard {
  const kb = new Keyboard();
  for (const c of CAMPUSES) kb.text(t(lang, c.nameKey));
  return kb.resized().oneTime();
}

function phoneKeyboard(lang: Language): Keyboard {
  return new Keyboard().requestContact(t(lang, 'btn.sharePhone')).resized().oneTime();
}

function locationKeyboard(lang: Language): Keyboard {
  return new Keyboard().requestLocation(t(lang, 'btn.sendLocation')).resized();
}

/** Resolves a campus id from a localized label for the given language. */
function campusByLabel(lang: Language, label: string): string | undefined {
  return CAMPUSES.find((c) => t(lang, c.nameKey) === label)?.id;
}

/** Notifies every member of each freshly formed group, in their own language. */
async function notifyFormed(api: Api<RawApi>, formed: GroupWithMembers[]): Promise<void> {
  for (const { members } of formed) {
    for (const member of members) {
      await safeSend(api, member.chatId, formatGroupFormed(members, member));
    }
  }
}

bot.command('start', async (ctx) => {
  onboarding.set(ctx.from!.id, startOnboarding());
  await ctx.reply(t('en', 'onboarding.chooseLanguage'), { reply_markup: languageKeyboard() });
});

// Language + campus arrive as plain text matching known button labels.
bot.on('message:text', async (ctx, next) => {
  const uid = ctx.from.id;
  const state = onboarding.get(uid);
  if (!state) return next(); // not onboarding → fall through to commands

  // Let slash-commands fall through to their registered handlers even during onboarding.
  if (ctx.message.text.startsWith('/')) return next();

  if (state.step === 'language') {
    const lang = LANG_BY_LABEL[ctx.message.text];
    if (!lang) return; // ignore non-button text on this step
    const { state: nextState } = advance(state, { type: 'language', value: lang });
    onboarding.set(uid, nextState);
    await ctx.reply(t(lang, 'onboarding.chooseCampus'), { reply_markup: campusKeyboard(lang) });
    return;
  }

  if (state.step === 'campus') {
    const lang = state.language!;
    const campusId = campusByLabel(lang, ctx.message.text);
    if (!campusId) return;
    const { state: nextState } = advance(state, { type: 'campus', value: campusId });
    onboarding.set(uid, nextState);
    await ctx.reply(t(lang, 'onboarding.sharePhone'), { reply_markup: phoneKeyboard(lang) });
    return;
  }
  // other steps ignore free text
});

// Phone arrives as a shared contact.
bot.on('message:contact', async (ctx) => {
  const uid = ctx.from.id;
  const state = onboarding.get(uid);
  if (!state || state.step !== 'phone') return;
  const lang = state.language!;

  const contact = ctx.message.contact;
  if (contact.user_id !== uid) {
    await ctx.reply(t(lang, 'onboarding.contactMismatch'), { reply_markup: phoneKeyboard(lang) });
    return;
  }

  const { state: nextState, profile } = advance(state, { type: 'phone', value: contact.phone_number });
  onboarding.set(uid, nextState);
  if (profile) {
    store.setProfile(uid, profile);
    await store.save();
    onboarding.delete(uid);
    await ctx.reply(t(lang, 'onboarding.sendLocation'), { reply_markup: locationKeyboard(lang) });
  }
});

bot.on('message:location', async (ctx) => {
  const uid = ctx.from.id;
  const profile = store.getProfile(uid);
  if (!profile) {
    await ctx.reply(t('en', 'location.noProfile'));
    return;
  }
  const lang = profile.language;

  const loc = ctx.message.location;
  if (
    !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude) ||
    loc.latitude < -90 || loc.latitude > 90 || loc.longitude < -180 || loc.longitude > 180
  ) {
    await ctx.reply(t(lang, 'location.invalid'));
    return;
  }

  if (!config.testMode) {
    store.removeWaitingByUser(uid);
  }

  const { formedGroups } = store.joinAndMatch(
    {
      telegramUserId: uid,
      chatId: ctx.chat.id,
      displayName: ctx.from.first_name ?? 'User',
      lat: loc.latitude,
      lng: loc.longitude,
      campusId: profile.campusId,
      phone: profile.phone,
      language: profile.language,
    },
    config.groupRadiusKm,
    config.groupSize
  );
  await store.save();

  if (formedGroups.length === 0) {
    await ctx.reply(t(lang, 'location.accepted'));
  }
  await notifyFormed(ctx.api, formedGroups);
});

/** Picks a language for replying to a user (profile, else English). */
function langOf(uid: number): Language {
  return store.getProfile(uid)?.language ?? 'en';
}

bot.command('leave', async (ctx) => {
  const uid = ctx.from!.id;
  const lang = langOf(uid);
  const mine = store.participantsByUser(uid);
  if (mine.length === 0) {
    await ctx.reply(t(lang, 'common.noActive'));
    return;
  }
  const latest = mine.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
  const result = store.leave(latest.id, config.groupRadiusKm, config.groupSize);
  await store.save();

  await ctx.reply(t(lang, 'leave.confirm') + (result.dissolvedGroup ? t(lang, 'leave.groupDissolved') : ''));
  if (result.dissolvedGroup) {
    for (const m of result.dissolvedGroup.notifiedMembers) {
      await safeSend(ctx.api, m.chatId, t(m.language, 'group.dissolved'));
    }
  }
  await notifyFormed(ctx.api, result.formedGroups);
});

bot.command('status', async (ctx) => {
  const uid = ctx.from!.id;
  const lang = langOf(uid);
  const mine = store.participantsByUser(uid);
  if (mine.length === 0) {
    await ctx.reply(t(lang, 'common.noActive'));
    return;
  }
  const lines = mine.map(
    (p) => `${p.id}: ${p.status === 'grouped' ? t(lang, 'status.grouped', { group: p.groupId! }) : t(lang, 'status.waiting')}`
  );
  await ctx.reply(t(lang, 'status.header') + '\n' + lines.join('\n'));
});

bot.command('reset', async (ctx) => {
  const uid = ctx.from!.id;
  const lang = langOf(uid);
  const mine = store.participantsByUser(uid);
  if (mine.length === 0) {
    await ctx.reply(t(lang, 'common.noActive'));
    return;
  }
  for (const p of mine) {
    const result = store.leave(p.id, config.groupRadiusKm, config.groupSize);
    if (result.dissolvedGroup) {
      for (const m of result.dissolvedGroup.notifiedMembers) {
        await safeSend(ctx.api, m.chatId, t(m.language, 'group.dissolved'));
      }
    }
    await notifyFormed(ctx.api, result.formedGroups);
  }
  await store.save();
  await ctx.reply(t(lang, 'reset.done'));
});

bot.catch((err) => {
  console.error('Bot error:', err);
});

const VIEWER_PORT = Number(process.env.PORT) || 8080;
const VIEWER_HOST = process.env.HOST || '127.0.0.1';
const viewer = createViewerServer({
  rebuild: async () => {
    const result = store.rebuild(config.groupRadiusKm, config.groupSize);
    await store.save();
    return result;
  },
});
viewer.on('error', (err) => {
  console.error('Viewer server error (live map disabled):', err instanceof Error ? err.message : err);
});
viewer.listen(VIEWER_PORT, VIEWER_HOST, () => {
  console.log(`✓ Live map at http://${VIEWER_HOST}:${VIEWER_PORT}/live`);
});

console.log('Bot starting (long polling)…');
await bot.start();
