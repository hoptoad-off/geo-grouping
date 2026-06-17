import { Bot, Keyboard } from 'grammy';
import type { Api, RawApi, Context } from 'grammy';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import type { GroupWithMembers, LeaveResult } from './store.js';
import type { Language } from './types.js';
import { t } from './i18n.js';
import { CAMPUSES } from './campuses.js';
import { startOnboarding, advance, type OnboardingState } from './onboarding.js';
import { mainMenuLayout, type MenuButton, type RequestState } from './main-menu.js';
import { formatGroupFormed, safeSend } from './notify.js';
import { createViewerServer } from './viewer-server.js';

const config = loadConfig();
const store = await Store.load();
const bot = new Bot(config.botToken);

/** In-flight onboarding wizards, keyed by Telegram user id (transient). */
const onboarding = new Map<number, OnboardingState>();
/** Users we're awaiting a free-text support message from (transient). */
const awaitingSupport = new Set<number>();
/** Users currently picking a new language from the sub-keyboard (transient). */
const awaitingLanguageChange = new Set<number>();

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
/** Sub-keyboard for changing language: the three fixed labels + a Back row. */
function languageChooseKeyboard(lang: Language): Keyboard {
  return new Keyboard()
    .text(LANG_LABELS[0]).text(LANG_LABELS[1]).text(LANG_LABELS[2]).row()
    .text(t(lang, 'btn.back'))
    .resized();
}
/** Builds the bottom reply keyboard from a pure layout (text vs requestLocation). */
function buildMainKeyboard(lang: Language, rows: MenuButton[][]): Keyboard {
  const kb = new Keyboard();
  rows.forEach((row, i) => {
    for (const b of row) {
      if (b.kind === 'location') kb.requestLocation(t(lang, b.labelKey));
      else kb.text(t(lang, b.labelKey));
    }
    if (i < rows.length - 1) kb.row();
  });
  return kb.resized();
}
function mainMenuKeyboard(uid: number, lang: Language): Keyboard {
  return buildMainKeyboard(lang, mainMenuLayout(requestStateOf(uid), config.testMode));
}
function campusByLabel(lang: Language, label: string): string | undefined {
  return CAMPUSES.find((c) => t(lang, c.nameKey) === label)?.id;
}
function langOf(uid: number): Language {
  return store.getProfile(uid)?.language ?? 'en';
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

type MenuAction = 'status' | 'support' | 'language' | 'unsubscribe' | 'relocate';
/** Maps a tapped reply-button label (in the user's language) to a menu action. */
function matchMenuAction(lang: Language, text: string): MenuAction | null {
  if (text === t(lang, 'btn.statusItem')) return 'status';
  if (text === t(lang, 'btn.support')) return 'support';
  if (text === t(lang, 'btn.changeLang')) return 'language';
  if (text === t(lang, 'btn.unsubscribe')) return 'unsubscribe';
  if (text === t(lang, 'btn.relocate')) return 'relocate';
  return null;
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

/** Runs a top-level menu action chosen from the bottom keyboard. */
async function handleMenuAction(ctx: Context, uid: number, lang: Language, action: MenuAction): Promise<void> {
  if (action === 'status') {
    await ctx.reply(statusText(uid, lang), { reply_markup: mainMenuKeyboard(uid, lang) });
    return;
  }
  if (action === 'support') {
    awaitingSupport.add(uid);
    await ctx.reply(t(lang, 'support.prompt'));
    return;
  }
  if (action === 'language') {
    awaitingLanguageChange.add(uid);
    await ctx.reply(t(lang, 'menu.lang'), { reply_markup: languageChooseKeyboard(lang) });
    return;
  }
  if (action === 'unsubscribe') {
    const mine = store.participantsByUser(uid);
    if (mine.length === 0) {
      await ctx.reply(t(lang, 'status.none'), { reply_markup: mainMenuKeyboard(uid, lang) });
      return;
    }
    const latest = mine.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
    const result = store.leave(latest.id, config.groupRadiusKm, config.groupSize);
    await store.save();
    await ctx.reply(t(lang, 'unsubscribe.done'), { reply_markup: mainMenuKeyboard(uid, lang) });
    await notifyLeaveResult(ctx.api, result);
    return;
  }
  // relocate (queued only)
  const waiting = store.participantsByUser(uid).filter((p) => p.status === 'waiting');
  if (waiting.length === 0) {
    await ctx.reply(t(lang, 'relocate.notQueued'), { reply_markup: mainMenuKeyboard(uid, lang) });
    return;
  }
  const latest = waiting.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
  store.leave(latest.id, config.groupRadiusKm, config.groupSize);
  await store.save();
  await ctx.reply(t(lang, 'relocate.prompt'), { reply_markup: locationKeyboard(lang) });
}

bot.command('start', async (ctx) => {
  const uid = ctx.from!.id;
  onboarding.set(uid, startOnboarding());
  awaitingSupport.delete(uid);
  awaitingLanguageChange.delete(uid);
  await ctx.reply(t('en', 'onboarding.chooseLanguage'), { reply_markup: languageKeyboard() });
});

bot.on('message:text', async (ctx, next) => {
  const uid = ctx.from.id;
  const text = ctx.message.text;
  if (text.startsWith('/')) return next();
  const lang = langOf(uid);

  // 1) language-change mode
  if (awaitingLanguageChange.has(uid)) {
    const picked = LANG_BY_LABEL[text];
    if (picked) {
      store.setLanguage(uid, picked);
      await store.save();
      awaitingLanguageChange.delete(uid);
      await ctx.reply(t(picked, 'lang.changed'), { reply_markup: mainMenuKeyboard(uid, picked) });
      return;
    }
    if (text === t(lang, 'btn.back')) {
      awaitingLanguageChange.delete(uid);
      await ctx.reply(t(lang, 'menu.root'), { reply_markup: mainMenuKeyboard(uid, lang) });
      return;
    }
    return; // ignore unrecognized input while choosing a language
  }

  // 2) support-capture mode
  if (awaitingSupport.has(uid)) {
    const action = matchMenuAction(lang, text);
    if (!action) {
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
      await ctx.reply(t(lang, 'support.thanks'), { reply_markup: mainMenuKeyboard(uid, lang) });
      return;
    }
    // a menu button was tapped instead → cancel capture and run that action
    awaitingSupport.delete(uid);
    await handleMenuAction(ctx, uid, lang, action);
    return;
  }

  // 3) onboarding steps
  const state = onboarding.get(uid);
  if (state) {
    if (state.step === 'language') {
      const picked = LANG_BY_LABEL[text];
      if (!picked) return;
      const { state: nextState } = advance(state, { type: 'language', value: picked });
      onboarding.set(uid, nextState);
      await ctx.reply(t(picked, 'onboarding.chooseCampus'), { reply_markup: campusKeyboard(picked) });
      return;
    }
    if (state.step === 'campus') {
      const olang = state.language!;
      const campusId = campusByLabel(olang, text);
      if (!campusId) return;
      const { state: nextState } = advance(state, { type: 'campus', value: campusId });
      onboarding.set(uid, nextState);
      await ctx.reply(t(olang, 'onboarding.sharePhone'), { reply_markup: phoneKeyboard(olang) });
      return;
    }
    return;
  }

  // 4) top-level menu action
  const action = matchMenuAction(lang, text);
  if (action) {
    await handleMenuAction(ctx, uid, lang, action);
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
    await ctx.reply(t(lang, 'onboarding.sendLocation'), { reply_markup: mainMenuKeyboard(uid, lang) });
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

  const kb = mainMenuKeyboard(uid, lang);
  if (formedGroups.length === 0) {
    await ctx.reply(t(lang, 'location.accepted'), { reply_markup: kb });
  }
  await notifyFormed(ctx.api, formedGroups);
  if (formedGroups.length > 0) {
    await ctx.reply(t(lang, 'menu.root'), { reply_markup: kb });
  }
});

bot.command('leave', async (ctx) => {
  const uid = ctx.from!.id;
  const lang = langOf(uid);
  const mine = store.participantsByUser(uid);
  if (mine.length === 0) {
    await ctx.reply(t(lang, 'common.noActive'), { reply_markup: mainMenuKeyboard(uid, lang) });
    return;
  }
  const latest = mine.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
  const result = store.leave(latest.id, config.groupRadiusKm, config.groupSize);
  await store.save();
  await ctx.reply(
    t(lang, 'leave.confirm') + (result.dissolvedGroup ? t(lang, 'leave.groupDissolved') : ''),
    { reply_markup: mainMenuKeyboard(uid, lang) }
  );
  await notifyLeaveResult(ctx.api, result);
});

bot.command('status', async (ctx) => {
  const uid = ctx.from!.id;
  const lang = langOf(uid);
  await ctx.reply(statusText(uid, lang), { reply_markup: mainMenuKeyboard(uid, lang) });
});

bot.command('reset', async (ctx) => {
  const uid = ctx.from!.id;
  const lang = langOf(uid);
  const mine = store.participantsByUser(uid);
  if (mine.length === 0) {
    await ctx.reply(t(lang, 'common.noActive'), { reply_markup: mainMenuKeyboard(uid, lang) });
    return;
  }
  for (const p of mine) {
    const result = store.leave(p.id, config.groupRadiusKm, config.groupSize);
    await notifyLeaveResult(ctx.api, result);
  }
  await store.save();
  await ctx.reply(t(lang, 'reset.done'), { reply_markup: mainMenuKeyboard(uid, lang) });
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
