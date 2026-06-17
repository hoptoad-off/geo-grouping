# Move Settings to the Bottom Reply Keyboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline (under-message) settings menu with a persistent bottom reply keyboard whose buttons run the actions directly; language selection uses a short reply sub-keyboard.

**Architecture:** A pure `main-menu.ts` returns the reply-keyboard layout per request state; `bot.ts` builds the keyboard, matches a tapped button label to an action, and dispatches it. The `callback_query` inline navigation is removed. Two transient in-memory modes (support capture, language change) gate free text.

**Tech Stack:** TypeScript (ESM, `.js` imports), grammY (`Keyboard`, `requestLocation`, `message:text`), Node `node:test` + `tsx`.

## Global Constraints

- Intra-`src/` imports use `.js` extension (ESM). Tests: `node:test` + `node:assert/strict`, files `src/*.test.ts`. Targeted: `npm test -- src/FILE.test.ts`; full: `npm test`. Build: `npm run build`.
- No inline keyboards / no `callback_query`: all menu actions are reply-keyboard buttons matched by text.
- Location button (`requestLocation`, label `btn.sendLocation`) shows when `config.testMode || requestState === 'none'`. In prod `waiting` shows `btn.relocate` (text) instead; `grouped` shows no location button.
- `btn.unsubscribe` shows only when there is an active request (waiting or grouped).
- Change location only when `waiting`; unsubscribe keeps the profile (`store.leave`).
- Change language uses the fixed labels `English` / `Русский` / `O'zbek` (not i18n); `store.setLanguage` updates profile + participants.
- A tapped menu button during support capture cancels capture and runs that action (never files a button label as a ticket).
- `/start`, `/status`, `/leave`, `/reset` still work; `/`-commands fall through `message:text`.
- Viewer (`/live`) is unchanged. Store is unchanged.

---

### Task 1: Pure reply-keyboard layout (`main-menu.ts`)

**Files:**
- Create: `src/main-menu.ts`
- Test: `src/main-menu.test.ts`

> Note: `src/settings-menu.ts` and its test are deleted in Task 3 (together with the `bot.ts` rewrite, so the build never breaks). Do NOT delete them in this task.

**Interfaces:**
- Produces:
  - `type RequestState = 'waiting' | 'grouped' | 'none'`
  - `interface MenuButton { labelKey: string; kind: 'text' | 'location' }`
  - `function mainMenuLayout(requestState: RequestState, testMode: boolean): MenuButton[][]`

- [ ] **Step 1: Write the failing test (`src/main-menu.test.ts`)**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mainMenuLayout } from './main-menu.js';

test('prod none: send-location, then status/support, then language', () => {
  assert.deepEqual(mainMenuLayout('none', false), [
    [{ labelKey: 'btn.sendLocation', kind: 'location' }],
    [{ labelKey: 'btn.statusItem', kind: 'text' }, { labelKey: 'btn.support', kind: 'text' }],
    [{ labelKey: 'btn.changeLang', kind: 'text' }],
  ]);
});

test('prod waiting: relocate, then actions incl unsubscribe', () => {
  assert.deepEqual(mainMenuLayout('waiting', false), [
    [{ labelKey: 'btn.relocate', kind: 'text' }],
    [{ labelKey: 'btn.statusItem', kind: 'text' }, { labelKey: 'btn.support', kind: 'text' }],
    [{ labelKey: 'btn.changeLang', kind: 'text' }, { labelKey: 'btn.unsubscribe', kind: 'text' }],
  ]);
});

test('prod grouped: no location row, unsubscribe present', () => {
  assert.deepEqual(mainMenuLayout('grouped', false), [
    [{ labelKey: 'btn.statusItem', kind: 'text' }, { labelKey: 'btn.support', kind: 'text' }],
    [{ labelKey: 'btn.changeLang', kind: 'text' }, { labelKey: 'btn.unsubscribe', kind: 'text' }],
  ]);
});

test('test mode always shows send-location even when waiting', () => {
  const rows = mainMenuLayout('waiting', true);
  assert.deepEqual(rows[0], [{ labelKey: 'btn.sendLocation', kind: 'location' }]);
  assert.deepEqual(rows[rows.length - 1], [
    { labelKey: 'btn.changeLang', kind: 'text' }, { labelKey: 'btn.unsubscribe', kind: 'text' },
  ]);
});

test('test mode none: send-location, no unsubscribe', () => {
  const rows = mainMenuLayout('none', true);
  assert.deepEqual(rows[0], [{ labelKey: 'btn.sendLocation', kind: 'location' }]);
  assert.deepEqual(rows[rows.length - 1], [{ labelKey: 'btn.changeLang', kind: 'text' }]);
});
```

- [ ] **Step 2: Run it — must fail**

Run: `npm test -- src/main-menu.test.ts`
Expected: FAIL (`Cannot find module './main-menu.js'`).

- [ ] **Step 3: Implement (`src/main-menu.ts`)**

```ts
/** Which request the user currently has — drives the menu's button set. */
export type RequestState = 'waiting' | 'grouped' | 'none';

/** One reply-keyboard button: a localization key and whether it requests location. */
export interface MenuButton {
  labelKey: string;
  kind: 'text' | 'location';
}

/**
 * Pure layout for the bottom reply keyboard. The location button (a requestLocation
 * button) shows in test mode or when there is no request; in prod a queued user gets
 * a "change location" text button instead, and a grouped user gets neither. Unsubscribe
 * appears only when there is an active request.
 */
export function mainMenuLayout(requestState: RequestState, testMode: boolean): MenuButton[][] {
  const rows: MenuButton[][] = [];

  if (testMode || requestState === 'none') {
    rows.push([{ labelKey: 'btn.sendLocation', kind: 'location' }]);
  } else if (requestState === 'waiting') {
    rows.push([{ labelKey: 'btn.relocate', kind: 'text' }]);
  }

  rows.push([
    { labelKey: 'btn.statusItem', kind: 'text' },
    { labelKey: 'btn.support', kind: 'text' },
  ]);

  const langRow: MenuButton[] = [{ labelKey: 'btn.changeLang', kind: 'text' }];
  if (requestState === 'waiting' || requestState === 'grouped') {
    langRow.push({ labelKey: 'btn.unsubscribe', kind: 'text' });
  }
  rows.push(langRow);

  return rows;
}
```

- [ ] **Step 4: Run it — must pass**

Run: `npm test -- src/main-menu.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main-menu.ts src/main-menu.test.ts
git commit -m "feat: pure bottom reply-keyboard layout"
```

---

### Task 2: Remove now-unused inline i18n keys

**Files:**
- Modify: `src/i18n.ts`

**Interfaces:** none (display strings). The existing `src/i18n.test.ts` parity test guards that all three dicts stay in sync.

- [ ] **Step 1: Run the i18n parity test (baseline green)**

Run: `npm test -- src/i18n.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 2: Delete the six inline-only keys from EACH of the `en`, `ru`, `uz` dicts (`src/i18n.ts`)**

Remove exactly these key lines from all three dictionaries (six lines per dict):

```
'btn.settings': ...
'btn.general': ...
'menu.general': ...
'lang.en': ...
'lang.ru': ...
'lang.uz': ...
```

Keep all other keys, including `menu.root`, `menu.lang`, `btn.back`, `btn.statusItem`, `btn.relocate`, `btn.unsubscribe`, `btn.support`, `btn.changeLang`, `status.none`, `relocate.prompt`, `relocate.notQueued`, `unsubscribe.done`, `support.prompt`, `support.thanks`, `lang.changed`.

> These keys backed the old inline menu (`btn.settings`, `btn.general`, `menu.general`) and the inline language buttons (`lang.en/ru/uz`). The new reply menu uses the fixed `English/Русский/O'zbek` labels and no settings/general screens.

- [ ] **Step 3: Run the parity test — must stay green**

Run: `npm test -- src/i18n.test.ts`
Expected: PASS (all three dicts removed the same six keys, so parity holds).

- [ ] **Step 4: Commit**

```bash
git add src/i18n.ts
git commit -m "chore: drop i18n keys for the removed inline menu"
```

---

### Task 3: Bot wiring — reply-keyboard menu (full `bot.ts` replacement)

**Files:**
- Modify: `src/bot.ts` (full replacement)
- Delete: `src/settings-menu.ts`, `src/settings-menu.test.ts`

**Interfaces:**
- Consumes: `mainMenuLayout`, `MenuButton`, `RequestState` (Task 1); `t` (Task 2); `Store.{getProfile,setProfile,setLanguage,participantsByUser,leave,joinAndMatch,removeWaitingByUser,addSupportTicket,rebuild,save}`; `startOnboarding`, `advance`, `OnboardingState`; `formatGroupFormed`, `safeSend`; `LeaveResult`.
- Produces: working bot (verified by `npm run build` + `npm test`; Telegram I/O has no unit tests).

- [ ] **Step 1: Delete the obsolete inline-menu module and its test**

```bash
git rm src/settings-menu.ts src/settings-menu.test.ts
```

- [ ] **Step 2: Replace `src/bot.ts` with the full content below**

```ts
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
```

- [ ] **Step 3: Build — must be clean**

Run: `npm run build`
Expected: zero TypeScript errors (settings-menu.ts is gone and no longer imported; main-menu.ts is imported).

- [ ] **Step 4: Full test suite — no regressions**

Run: `npm test`
Expected: PASS (main-menu + i18n + store + matcher + onboarding + notify + viewer-server; the deleted settings-menu test no longer runs).

- [ ] **Step 5: Commit**

```bash
git add src/bot.ts src/settings-menu.ts src/settings-menu.test.ts
git commit -m "feat: settings actions on the bottom reply keyboard; remove inline menu"
```

---

### Task 4: Documentation

**Files:**
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Update `README.md` (Russian, existing style)**

Read `README.md` first, then update the "Меню и настройки" subsection (and any spot that describes inline «⚙️ Настройки» navigation) to describe the bottom reply keyboard instead:
- Главное меню — нижняя reply-клавиатура (не inline под сообщением). Кнопки: «📋 Статус», «🆘 Поддержка», «🌐 Язык», плюс «❌ Отписаться» (когда есть активная заявка) и «📍 Отправить локацию» / «📍 Сменить локацию» по правилу `testMode || состояние = нет заявки`.
- «🌐 Язык» открывает под-клавиатуру `English / Русский / O'zbek` + «⬅️ Назад»; выбор меняет язык (профиль + активные заявки).
- «🆘 Поддержка», «❌ Отписаться» (сохраняет профиль), «📍 Сменить локацию» (только в очереди) — поведение прежнее, но запускается кнопкой нижней клавиатуры.
- Remove any mention of inline-кнопок / `callback`-навигации / экранов «Общие настройки».

Ground wording in `src/bot.ts` and `src/main-menu.ts`.

- [ ] **Step 2: Full test suite — still green (docs-only)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: describe the bottom reply-keyboard menu"
```

---

## Self-Review

**Spec coverage:**
- Bottom reply keyboard per state → `mainMenuLayout` (Task 1) + `buildMainKeyboard`/`mainMenuKeyboard` (Task 3). ✅
- Location/relocate/unsubscribe visibility rules → `mainMenuLayout` (Task 1). ✅
- Status / support / language / unsubscribe / relocate actions → `matchMenuAction` + `handleMenuAction` (Task 3). ✅
- Language sub-keyboard + `setLanguage` → `languageChooseKeyboard` + `awaitingLanguageChange` (Task 3). ✅
- Support-button-cancels-capture → support-mode branch in `message:text` (Task 3). ✅
- Remove inline/callback + unused i18n keys → Task 3 (callback removed, settings-menu deleted) + Task 2 (keys). ✅
- Onboarding / commands keep working with the new keyboard → Task 3 handlers. ✅
- README → Task 4. ✅

**Placeholder scan:** every code step carries full code; only README wording (Task 4 Step 1) is prose-guided, which is acceptable.

**Type consistency:** `RequestState`/`MenuButton`/`mainMenuLayout` defined in Task 1 and imported in Task 3 with matching names; `requestStateOf` is annotated `RequestState`; `MenuAction` union matches `matchMenuAction`/`handleMenuAction`; i18n keys used in `bot.ts` (`btn.statusItem`, `btn.support`, `btn.changeLang`, `btn.unsubscribe`, `btn.relocate`, `btn.back`, `menu.lang`, `menu.root`, `lang.changed`, `status.none`, `relocate.prompt`, `relocate.notQueued`, `unsubscribe.done`, `support.prompt`, `support.thanks`, `location.*`, `onboarding.*`) all remain after Task 2's removals; the removed keys (`btn.settings`, `btn.general`, `menu.general`, `lang.en/ru/uz`) are not referenced in the new `bot.ts`.
