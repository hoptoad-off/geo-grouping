import { Bot, Keyboard, InlineKeyboard } from 'grammy';
import type { Api, RawApi, Context } from 'grammy';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import type { GroupWithMembers, LeaveResult } from './store.js';
import type { Language } from './types.js';
import { t } from './i18n.js';
import { CAMPUSES } from './campuses.js';
import { startOnboarding, advance, type OnboardingState } from './onboarding.js';
import { menuScreen, type Screen, type RequestState, type MenuButton } from './settings-menu.js';
import { formatGroupFormed, safeSend } from './notify.js';
import { createViewerServer } from './viewer-server.js';

const config = loadConfig();
const store = await Store.load();
const bot = new Bot(config.botToken);

/** In-flight onboarding wizards, keyed by Telegram user id (transient). */
const onboarding = new Map<number, OnboardingState>();
/** Users we're awaiting a free-text support message from (transient). */
const awaitingSupport = new Set<number>();

const LANG_BY_LABEL: Record<string, Language> = { English: 'en', 'Русский': 'ru', "O'zbek": 'uz' };
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
/** Main reply menu: location button only when the prod-hide rule allows, plus Settings. */
function mainMenuKeyboard(lang: Language, showLocation: boolean): Keyboard {
  const kb = new Keyboard();
  if (showLocation) kb.requestLocation(t(lang, 'btn.sendLocation')).row();
  kb.text(t(lang, 'btn.settings'));
  return kb.resized();
}
/** Builds an inline keyboard from a pure menu layout, localizing each label. */
function inlineFrom(lang: Language, rows: MenuButton[][]): InlineKeyboard {
  const kb = new InlineKeyboard();
  rows.forEach((row, i) => {
    for (const b of row) kb.text(t(lang, b.labelKey), b.data);
    if (i < rows.length - 1) kb.row();
  });
  return kb;
}
function campusByLabel(lang: Language, label: string): string | undefined {
  return CAMPUSES.find((c) => t(lang, c.nameKey) === label)?.id;
}
function langOf(uid: number): Language {
  return store.getProfile(uid)?.language ?? 'en';
}
function showLocationButton(uid: number): boolean {
  return config.testMode || !store.hasActiveParticipant(uid);
}
function requestStateOf(uid: number): RequestState {
  const mine = store.participantsByUser(uid);
  if (mine.some((p) => p.status === 'grouped')) return 'grouped';
  if (mine.some((p) => p.status === 'waiting')) return 'waiting';
  return 'none';
}
function statusText(uid: number, lang: Language): string {
  const mine = store.participantsByUser(uid);
  if (mine.length === 0) return t(lang, 'status.none');
  const lines = mine.map(
    (p) => `${p.id}: ${p.status === 'grouped' ? t(lang, 'status.grouped', { group: p.groupId! }) : t(lang, 'status.waiting')}`
  );
  return t(lang, 'status.header') + '\n' + lines.join('\n');
}
function screenTitle(screen: Screen, uid: number, lang: Language): string {
  if (screen === 'status') return statusText(uid, lang);
  if (screen === 'general') return t(lang, 'menu.general');
  if (screen === 'lang') return t(lang, 'menu.lang');
  return t(lang, 'menu.root');
}
/** Edits the menu message in place; ignores Telegram "message is not modified". */
async function safeEdit(ctx: Context, text: string, markup: InlineKeyboard): Promise<void> {
  try {
    await ctx.editMessageText(text, { reply_markup: markup });
  } catch {
    /* e.g. content unchanged — safe to ignore */
  }
}

async function notifyFormed(api: Api<RawApi>, formed: GroupWithMembers[]): Promise<void> {
  for (const { members } of formed) {
    for (const member of members) {
      await safeSend(api, member.chatId, formatGroupFormed(members, member));
    }
  }
}
/** Sends dissolve notices (each in the member's own language) then any re-formed groups. */
async function notifyLeaveResult(api: Api<RawApi>, result: LeaveResult): Promise<void> {
  if (result.dissolvedGroup) {
    for (const m of result.dissolvedGroup.notifiedMembers) {
      await safeSend(api, m.chatId, t(m.language, 'group.dissolved'));
    }
  }
  await notifyFormed(api, result.formedGroups);
}

bot.command('start', async (ctx) => {
  const uid = ctx.from!.id;
  onboarding.set(uid, startOnboarding());
  awaitingSupport.delete(uid);
  await ctx.reply(t('en', 'onboarding.chooseLanguage'), { reply_markup: languageKeyboard() });
});

bot.on('message:text', async (ctx, next) => {
  const uid = ctx.from.id;
  const text = ctx.message.text;
  if (text.startsWith('/')) return next();

  // 1) capture a support message if we're waiting for one
  if (awaitingSupport.has(uid)) {
    const lang = langOf(uid);
    const body = text.trim();
    if (!body) {
      await ctx.reply(t(lang, 'support.prompt'));
      return;
    }
    const profile = store.getProfile(uid);
    store.addSupportTicket({
      telegramUserId: uid,
      displayName: ctx.from.first_name ?? 'User',
      phone: profile?.phone ?? '',
      language: lang,
      text: body,
    });
    await store.save();
    awaitingSupport.delete(uid);
    await ctx.reply(t(lang, 'support.thanks'), { reply_markup: mainMenuKeyboard(lang, showLocationButton(uid)) });
    return;
  }

  // 2) onboarding steps
  const state = onboarding.get(uid);
  if (state) {
    if (state.step === 'language') {
      const lang = LANG_BY_LABEL[text];
      if (!lang) return;
      const { state: nextState } = advance(state, { type: 'language', value: lang });
      onboarding.set(uid, nextState);
      await ctx.reply(t(lang, 'onboarding.chooseCampus'), { reply_markup: campusKeyboard(lang) });
      return;
    }
    if (state.step === 'campus') {
      const lang = state.language!;
      const campusId = campusByLabel(lang, text);
      if (!campusId) return;
      const { state: nextState } = advance(state, { type: 'campus', value: campusId });
      onboarding.set(uid, nextState);
      await ctx.reply(t(lang, 'onboarding.sharePhone'), { reply_markup: phoneKeyboard(lang) });
      return;
    }
    return;
  }

  // 3) main-menu "Settings" button
  const lang = langOf(uid);
  if (text === t(lang, 'btn.settings')) {
    await ctx.reply(t(lang, 'menu.root'), { reply_markup: inlineFrom(lang, menuScreen('root', requestStateOf(uid))) });
    return;
  }
});

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
    await ctx.reply(t(lang, 'onboarding.sendLocation'), { reply_markup: mainMenuKeyboard(lang, true) });
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

  if (!config.testMode) store.removeWaitingByUser(uid);

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

  const kb = mainMenuKeyboard(lang, showLocationButton(uid));
  if (formedGroups.length === 0) {
    await ctx.reply(t(lang, 'location.accepted'), { reply_markup: kb });
  }
  await notifyFormed(ctx.api, formedGroups);
  if (formedGroups.length > 0) {
    await ctx.reply(t(lang, 'menu.root'), { reply_markup: kb });
  }
});

bot.on('callback_query:data', async (ctx) => {
  const uid = ctx.from.id;
  const lang = langOf(uid);
  const data = ctx.callbackQuery.data;

  if (data === 's:root' || data === 's:status' || data === 's:general' || data === 's:lang') {
    const screen = data.slice(2) as Screen;
    await safeEdit(ctx, screenTitle(screen, uid, lang), inlineFrom(lang, menuScreen(screen, requestStateOf(uid))));
    await ctx.answerCallbackQuery();
    return;
  }

  if (data.startsWith('s:lang:')) {
    const newLang = data.slice('s:lang:'.length) as Language;
    store.setLanguage(uid, newLang);
    await store.save();
    await safeEdit(ctx, t(newLang, 'menu.general'), inlineFrom(newLang, menuScreen('general', requestStateOf(uid))));
    await ctx.answerCallbackQuery({ text: t(newLang, 'lang.changed') });
    return;
  }

  if (data === 's:relocate') {
    const mine = store.participantsByUser(uid).filter((p) => p.status === 'waiting');
    if (mine.length === 0) {
      await ctx.answerCallbackQuery({ text: t(lang, 'relocate.notQueued') });
      return;
    }
    const latest = mine.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
    store.leave(latest.id, config.groupRadiusKm, config.groupSize);
    await store.save();
    await ctx.answerCallbackQuery();
    await ctx.reply(t(lang, 'relocate.prompt'), { reply_markup: locationKeyboard(lang) });
    return;
  }

  if (data === 's:leave') {
    const mine = store.participantsByUser(uid);
    if (mine.length === 0) {
      await ctx.answerCallbackQuery({ text: t(lang, 'status.none') });
      return;
    }
    const latest = mine.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
    const result = store.leave(latest.id, config.groupRadiusKm, config.groupSize);
    await store.save();
    await notifyLeaveResult(ctx.api, result);
    try {
      await ctx.editMessageText(t(lang, 'unsubscribe.done'));
    } catch {
      /* ignore unchanged */
    }
    await ctx.answerCallbackQuery();
    await ctx.reply(t(lang, 'menu.root'), { reply_markup: mainMenuKeyboard(lang, showLocationButton(uid)) });
    return;
  }

  if (data === 's:support') {
    awaitingSupport.add(uid);
    await ctx.answerCallbackQuery();
    await ctx.reply(t(lang, 'support.prompt'));
    return;
  }

  await ctx.answerCallbackQuery();
});

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
  await ctx.reply(
    t(lang, 'leave.confirm') + (result.dissolvedGroup ? t(lang, 'leave.groupDissolved') : ''),
    { reply_markup: mainMenuKeyboard(lang, showLocationButton(uid)) }
  );
  await notifyLeaveResult(ctx.api, result);
});

bot.command('status', async (ctx) => {
  const uid = ctx.from!.id;
  await ctx.reply(statusText(uid, langOf(uid)));
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
    await notifyLeaveResult(ctx.api, result);
  }
  await store.save();
  await ctx.reply(t(lang, 'reset.done'), { reply_markup: mainMenuKeyboard(lang, showLocationButton(uid)) });
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
