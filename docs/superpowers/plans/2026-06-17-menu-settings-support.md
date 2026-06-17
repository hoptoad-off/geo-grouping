# Main Menu, Settings, Relocate/Language & Support Tickets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a post-onboarding main menu (location button hidden in prod once a request exists, always shown in test), an inline settings menu (status / relocate / unsubscribe / change language), and a support-ticket flow shown on the live map.

**Architecture:** A pure `settings-menu.ts` decides the inline-keyboard layout per request state; `bot.ts` renders it and routes `callback_query` actions and a free-text support capture. The store gains `hasActiveParticipant`, `setLanguage`, and `addSupportTicket`; tickets persist in `state.json` and render in a new sidebar section on `/live`.

**Tech Stack:** TypeScript (ESM, `.js` imports), grammY (`Keyboard`, `InlineKeyboard`, `callback_query:data`), Node `node:test` + `tsx`, Leaflet viewer.

## Global Constraints

- Intra-`src/` imports use the `.js` extension (ESM, `"type": "module"`).
- Tests: `node:test` + `node:assert/strict`, files `src/*.test.ts`. Targeted: `npm test -- --test-name-pattern='...'`; single file: `npm test -- src/FILE.test.ts`; full: `npm test`. Build: `npm run build`.
- Languages exactly `'en' | 'ru' | 'uz'` (Uzbek Latin). Every language must hold every i18n key (enforced by the existing i18n test).
- Location button visibility: `showLocationButton(uid) = config.testMode || !store.hasActiveParticipant(uid)`.
- Change location is allowed ONLY when the user has a `waiting` participant; unsubscribe KEEPS the profile.
- Support tickets are read-only on the site; ALL ticket fields rendered in the viewer pass through the existing `esc()` helper (ticket text is untrusted).
- Viewer stays bound to `127.0.0.1`; the matcher (`src/matcher.ts`) is NOT modified.
- Existing commands `/start`, `/status`, `/leave`, `/reset` remain working.

---

### Task 1: Data model + store (tickets, language change, active-request check)

**Files:**
- Modify: `src/types.ts`
- Modify: `src/store.ts`
- Modify: `src/store.test.ts`

**Interfaces:**
- Consumes: `Language` (from `types.ts`/`i18n.ts`); existing `Store`.
- Produces:
  - `interface SupportTicket { id: string; telegramUserId: number; displayName: string; phone: string; language: Language; text: string; createdAt: string }`
  - `BotState.supportTickets: SupportTicket[]`
  - `interface NewSupportTicket { telegramUserId: number; displayName: string; phone: string; language: Language; text: string }` (in `store.ts`)
  - `Store.hasActiveParticipant(telegramUserId: number): boolean`
  - `Store.setLanguage(telegramUserId: number, language: Language): void`
  - `Store.addSupportTicket(input: NewSupportTicket): SupportTicket`

- [ ] **Step 1: Update `src/types.ts`**

Add the `SupportTicket` interface (after `UserProfile`) and the new `BotState` field:

```ts
/** A free-text support request captured from a user, shown on the live map. */
export interface SupportTicket {
  id: string;            // 'ticket_001'
  telegramUserId: number;
  displayName: string;
  phone: string;         // from profile, '' if unknown
  language: Language;
  text: string;
  createdAt: string;     // ISO timestamp
}
```

```ts
export interface BotState {
  seq: number;
  participants: Participant[];
  groups: Group[];
  profiles: Record<string, UserProfile>;
  campuses: Campus[];
  supportTickets: SupportTicket[];
}
```

- [ ] **Step 2: Update the empty-state test + add new store tests (`src/store.test.ts`)**

Update the empty-state expectation to include `supportTickets: []`:

```ts
test('load returns empty state for a missing file', async () => {
  const store = await Store.load(tmpPath());
  assert.deepEqual(store.getState(), {
    seq: 0, participants: [], groups: [], profiles: {}, campuses: CAMPUSES, supportTickets: [],
  });
});
```

Add these tests:

```ts
test('hasActiveParticipant reflects waiting/grouped membership', async () => {
  const store = await Store.load(tmpPath());
  assert.equal(store.hasActiveParticipant(1), false);
  store.joinAndMatch(np(41.30, 69.28, 1), 5, 3);
  assert.equal(store.hasActiveParticipant(1), true);
  assert.equal(store.hasActiveParticipant(2), false);
});

test('setLanguage updates profile and the user participants', async () => {
  const store = await Store.load(tmpPath());
  store.setProfile(1, { language: 'ru', campusId: 'mirzo_ulugbek', phone: '+998900000000' });
  store.joinAndMatch(np(41.30, 69.28, 1), 5, 3);
  store.setLanguage(1, 'uz');
  assert.equal(store.getProfile(1)!.language, 'uz');
  assert.ok(store.participantsByUser(1).every((p) => p.language === 'uz'));
});

test('addSupportTicket assigns id + timestamp and persists', async () => {
  const file = tmpPath();
  const store = await Store.load(file);
  const tk = store.addSupportTicket({
    telegramUserId: 1, displayName: 'A', phone: '+998900000000', language: 'ru', text: 'help me',
  });
  assert.match(tk.id, /^ticket_\d+$/);
  assert.ok(tk.createdAt);
  await store.save();
  const reloaded = await Store.load(file);
  assert.equal(reloaded.getState().supportTickets.length, 1);
  assert.equal(reloaded.getState().supportTickets[0].text, 'help me');
});

test('load defaults supportTickets to [] for older files', async () => {
  const file = tmpPath();
  await writeFile(
    file,
    JSON.stringify({ seq: 0, participants: [], groups: [], profiles: {} }),
    'utf-8'
  );
  const store = await Store.load(file);
  assert.deepEqual(store.getState().supportTickets, []);
});
```

Add the `writeFile` import at the top of the test file if not present:

```ts
import { writeFile } from 'node:fs/promises';
```

- [ ] **Step 3: Run the new tests — they must fail**

Run: `npm test -- --test-name-pattern='hasActiveParticipant|setLanguage updates profile|addSupportTicket assigns|defaults supportTickets|empty state for a missing'`
Expected: FAIL (methods/field absent; empty state lacks `supportTickets`).

- [ ] **Step 4: Implement store changes (`src/store.ts`)**

Update imports to bring in the new types:

```ts
import type { BotState, Participant, Group, UserProfile, SupportTicket, Language } from './types.js';
```

> Note: `Language` is re-exported from `types.ts`. If `Language` is already imported elsewhere in `store.ts`, merge into the existing import rather than duplicating.

Add the `NewSupportTicket` input interface near `NewParticipant`:

```ts
/** Fields needed to add a support ticket (id/timestamp assigned by the store). */
export interface NewSupportTicket {
  telegramUserId: number;
  displayName: string;
  phone: string;
  language: Language;
  text: string;
}
```

In `load()`, extend the empty default and normalize old files:

```ts
if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
  state = { seq: 0, participants: [], groups: [], profiles: {}, campuses: CAMPUSES, supportTickets: [] };
} else {
  throw err;
}
```

and after the existing `state.profiles ??= {};` / `state.campuses = CAMPUSES;` lines add:

```ts
state.supportTickets ??= [];
```

Add three methods (after `setProfile`):

```ts
/** True if the user has any waiting or grouped participant. */
hasActiveParticipant(telegramUserId: number): boolean {
  return this.state.participants.some(
    (p) => p.telegramUserId === telegramUserId && (p.status === 'waiting' || p.status === 'grouped')
  );
}

/** Updates the user's profile language and the language of all their participants. */
setLanguage(telegramUserId: number, language: Language): void {
  const profile = this.state.profiles[String(telegramUserId)];
  if (profile) profile.language = language;
  for (const p of this.state.participants) {
    if (p.telegramUserId === telegramUserId) p.language = language;
  }
}

/** Appends a support ticket (assigning id + timestamp) and returns it. */
addSupportTicket(input: NewSupportTicket): SupportTicket {
  const ticket: SupportTicket = {
    id: this.nextId('ticket'),
    telegramUserId: input.telegramUserId,
    displayName: input.displayName,
    phone: input.phone,
    language: input.language,
    text: input.text,
    createdAt: new Date().toISOString(),
  };
  this.state.supportTickets.push(ticket);
  return ticket;
}
```

- [ ] **Step 5: Run targeted tests — must pass**

Run: `npm test -- --test-name-pattern='hasActiveParticipant|setLanguage updates profile|addSupportTicket assigns|defaults supportTickets|empty state for a missing'`
Expected: PASS.

- [ ] **Step 6: Run the full store file — no regressions**

Run: `npm test -- src/store.test.ts`
Expected: PASS (all store tests).

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/store.ts src/store.test.ts
git commit -m "feat: support tickets, setLanguage, hasActiveParticipant in store"
```

---

### Task 2: i18n keys for menu & support

**Files:**
- Modify: `src/i18n.ts`

**Interfaces:**
- Consumes: existing `t`, `strings`.
- Produces: new keys present in all three languages (the existing `src/i18n.test.ts` "every language has every key" test guards parity — no new test needed).

- [ ] **Step 1: Run the existing i18n parity test to confirm baseline green**

Run: `npm test -- src/i18n.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 2: Add the new keys to each language dict (`src/i18n.ts`)**

Insert these entries into the `en` dict (before its closing `},`):

```ts
    'btn.settings': '⚙️ Settings',
    'btn.statusItem': '📋 Request status',
    'btn.general': '🔧 General settings',
    'btn.relocate': '📍 Change location',
    'btn.unsubscribe': '❌ Unsubscribe',
    'btn.support': '🆘 Contact support',
    'btn.changeLang': '🌐 Change language',
    'btn.back': '⬅️ Back',
    'lang.en': 'English',
    'lang.ru': 'Русский',
    'lang.uz': "O'zbek",
    'menu.root': 'Menu',
    'menu.general': 'General settings',
    'menu.lang': 'Choose language:',
    'status.none': 'You have no active request.',
    'relocate.prompt': 'Send your new location using the button below:',
    'relocate.notQueued': 'You can change location only while you are in the queue.',
    'unsubscribe.done': 'You have unsubscribed. Your profile is kept.',
    'support.prompt': 'Write your message for support in a single message:',
    'support.thanks': 'Thank you! We received your message and will contact you.',
    'lang.changed': 'Language changed.',
```

Insert into the `ru` dict:

```ts
    'btn.settings': '⚙️ Настройки',
    'btn.statusItem': '📋 Статус заявки',
    'btn.general': '🔧 Общие настройки',
    'btn.relocate': '📍 Сменить локацию',
    'btn.unsubscribe': '❌ Отписаться',
    'btn.support': '🆘 Связаться с поддержкой',
    'btn.changeLang': '🌐 Сменить язык',
    'btn.back': '⬅️ Назад',
    'lang.en': 'English',
    'lang.ru': 'Русский',
    'lang.uz': "O'zbek",
    'menu.root': 'Меню',
    'menu.general': 'Общие настройки',
    'menu.lang': 'Выберите язык:',
    'status.none': 'У вас нет активной заявки.',
    'relocate.prompt': 'Отправьте новую локацию кнопкой ниже:',
    'relocate.notQueued': 'Сменить локацию можно только пока вы в очереди.',
    'unsubscribe.done': 'Вы отписались. Профиль сохранён.',
    'support.prompt': 'Напишите ваше сообщение для поддержки одним сообщением:',
    'support.thanks': 'Спасибо! Мы получили ваше сообщение и свяжемся с вами.',
    'lang.changed': 'Язык изменён.',
```

Insert into the `uz` dict:

```ts
    'btn.settings': '⚙️ Sozlamalar',
    'btn.statusItem': '📋 Ariza holati',
    'btn.general': '🔧 Umumiy sozlamalar',
    'btn.relocate': '📍 Joylashuvni oʻzgartirish',
    'btn.unsubscribe': '❌ Obunani bekor qilish',
    'btn.support': '🆘 Qoʻllab-quvvatlash bilan bogʻlanish',
    'btn.changeLang': '🌐 Tilni oʻzgartirish',
    'btn.back': '⬅️ Orqaga',
    'lang.en': 'English',
    'lang.ru': 'Русский',
    'lang.uz': "O'zbek",
    'menu.root': 'Menyu',
    'menu.general': 'Umumiy sozlamalar',
    'menu.lang': 'Tilni tanlang:',
    'status.none': 'Sizda faol ariza yoʻq.',
    'relocate.prompt': 'Quyidagi tugma orqali yangi joylashuvingizni yuboring:',
    'relocate.notQueued': 'Joylashuvni faqat navbatda turganingizda oʻzgartira olasiz.',
    'unsubscribe.done': 'Obuna bekor qilindi. Profilingiz saqlanadi.',
    'support.prompt': 'Qoʻllab-quvvatlash uchun xabaringizni bitta xabarda yozing:',
    'support.thanks': 'Rahmat! Xabaringizni qabul qildik va siz bilan bogʻlanamiz.',
    'lang.changed': 'Til oʻzgartirildi.',
```

- [ ] **Step 3: Run the i18n parity test — must stay green**

Run: `npm test -- src/i18n.test.ts`
Expected: PASS (the "every language has every key" test confirms all three dicts gained the same keys).

- [ ] **Step 4: Commit**

```bash
git add src/i18n.ts
git commit -m "feat: i18n keys for menu, settings and support"
```

---

### Task 3: Pure settings-menu module

**Files:**
- Create: `src/settings-menu.ts`
- Test: `src/settings-menu.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type RequestState = 'waiting' | 'grouped' | 'none'`
  - `type Screen = 'root' | 'status' | 'general' | 'lang'`
  - `interface MenuButton { labelKey: string; data: string }`
  - `function menuScreen(screen: Screen, requestState: RequestState): MenuButton[][]`

- [ ] **Step 1: Write the failing test (`src/settings-menu.test.ts`)**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { menuScreen } from './settings-menu.js';

test('root offers status and general', () => {
  assert.deepEqual(menuScreen('root', 'none'), [
    [{ labelKey: 'btn.statusItem', data: 's:status' }],
    [{ labelKey: 'btn.general', data: 's:general' }],
  ]);
});

test('status (waiting) shows relocate + unsubscribe then back', () => {
  const rows = menuScreen('status', 'waiting');
  assert.deepEqual(rows[0], [
    { labelKey: 'btn.relocate', data: 's:relocate' },
    { labelKey: 'btn.unsubscribe', data: 's:leave' },
  ]);
  assert.deepEqual(rows[rows.length - 1], [{ labelKey: 'btn.back', data: 's:root' }]);
});

test('status (grouped) hides relocate, keeps unsubscribe', () => {
  const datas = menuScreen('status', 'grouped').flat().map((b) => b.data);
  assert.ok(!datas.includes('s:relocate'));
  assert.ok(datas.includes('s:leave'));
});

test('status (none) has only back', () => {
  assert.deepEqual(menuScreen('status', 'none'), [[{ labelKey: 'btn.back', data: 's:root' }]]);
});

test('general offers support, language, back', () => {
  assert.deepEqual(menuScreen('general', 'none'), [
    [{ labelKey: 'btn.support', data: 's:support' }],
    [{ labelKey: 'btn.changeLang', data: 's:lang' }],
    [{ labelKey: 'btn.back', data: 's:root' }],
  ]);
});

test('lang offers three languages then back to general', () => {
  const rows = menuScreen('lang', 'none');
  assert.deepEqual(rows[0].map((b) => b.data), ['s:lang:en', 's:lang:ru', 's:lang:uz']);
  assert.deepEqual(rows[1], [{ labelKey: 'btn.back', data: 's:general' }]);
});
```

- [ ] **Step 2: Run it — must fail**

Run: `npm test -- src/settings-menu.test.ts`
Expected: FAIL (`Cannot find module './settings-menu.js'`).

- [ ] **Step 3: Implement the module (`src/settings-menu.ts`)**

```ts
/** Which request the user currently has, drives the status screen's buttons. */
export type RequestState = 'waiting' | 'grouped' | 'none';

/** Settings screens the inline menu can show. */
export type Screen = 'root' | 'status' | 'general' | 'lang';

/** One inline button: a localization key for the label and its callback data. */
export interface MenuButton {
  labelKey: string;
  data: string;
}

/**
 * Pure layout for the inline settings keyboard. Returns rows of buttons (label keys +
 * callback data) for a given screen and the user's current request state. No i18n or
 * Telegram here — the bot renders labels via `t()` and builds the InlineKeyboard.
 */
export function menuScreen(screen: Screen, requestState: RequestState): MenuButton[][] {
  switch (screen) {
    case 'root':
      return [
        [{ labelKey: 'btn.statusItem', data: 's:status' }],
        [{ labelKey: 'btn.general', data: 's:general' }],
      ];
    case 'status': {
      const rows: MenuButton[][] = [];
      if (requestState === 'waiting') {
        rows.push([
          { labelKey: 'btn.relocate', data: 's:relocate' },
          { labelKey: 'btn.unsubscribe', data: 's:leave' },
        ]);
      } else if (requestState === 'grouped') {
        rows.push([{ labelKey: 'btn.unsubscribe', data: 's:leave' }]);
      }
      rows.push([{ labelKey: 'btn.back', data: 's:root' }]);
      return rows;
    }
    case 'general':
      return [
        [{ labelKey: 'btn.support', data: 's:support' }],
        [{ labelKey: 'btn.changeLang', data: 's:lang' }],
        [{ labelKey: 'btn.back', data: 's:root' }],
      ];
    case 'lang':
      return [
        [
          { labelKey: 'lang.en', data: 's:lang:en' },
          { labelKey: 'lang.ru', data: 's:lang:ru' },
          { labelKey: 'lang.uz', data: 's:lang:uz' },
        ],
        [{ labelKey: 'btn.back', data: 's:general' }],
      ];
  }
}
```

- [ ] **Step 4: Run it — must pass**

Run: `npm test -- src/settings-menu.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/settings-menu.ts src/settings-menu.test.ts
git commit -m "feat: pure settings-menu keyboard layout"
```

---

### Task 4: Bot wiring (main menu, settings callbacks, support capture)

**Files:**
- Modify: `src/bot.ts` (full replacement)

**Interfaces:**
- Consumes: `Store.{getProfile,setProfile,hasActiveParticipant,setLanguage,addSupportTicket,participantsByUser,leave,joinAndMatch,removeWaitingByUser,rebuild,save}`; `menuScreen`, `Screen`, `RequestState`, `MenuButton` (Task 3); `t` (Task 2); `startOnboarding`, `advance`, `OnboardingState`; `formatGroupFormed`, `safeSend`; `LeaveResult` (from `store.ts`).
- Produces: working bot (verified by `npm run build` + `npm test`; no unit tests for Telegram I/O).

- [ ] **Step 1: Replace `src/bot.ts` with the full content below**

```ts
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
```

- [ ] **Step 2: Build — must be clean**

Run: `npm run build`
Expected: zero TypeScript errors.

- [ ] **Step 3: Full test suite — no regressions**

Run: `npm test`
Expected: PASS (all existing + new unit tests).

- [ ] **Step 4: Commit**

```bash
git add src/bot.ts
git commit -m "feat: main menu, inline settings, relocate/language change, support capture"
```

---

### Task 5: Live map — support tickets section

**Files:**
- Modify: `viewer/live.js`
- Modify: `viewer/live.html`

**Interfaces:**
- Consumes: `state.supportTickets` (array of `{ id, telegramUserId, displayName, phone, language, text, createdAt }`).
- Produces: a sidebar "Support" section (verified in the browser).

- [ ] **Step 1: Render tickets in `viewer/live.js`**

Inside `render(state)`, immediately before the final `if (!fitted && allLatLngs.length > 0) {` block, add:

```js
  const tickets = (state.supportTickets || []).slice().reverse();
  document.getElementById('support-count').textContent = String(tickets.length);
  const supportEl = document.getElementById('support');
  supportEl.innerHTML = '';
  if (tickets.length === 0) {
    supportEl.innerHTML = '<div class="empty">Нет обращений</div>';
  }
  for (const tk of tickets) {
    const when = new Date(tk.createdAt).toLocaleString();
    const card = document.createElement('div');
    card.className = 'ticket-card';
    card.innerHTML =
      '<div class="ticket-head">' + esc(tk.displayName) + ' · 📞 ' + esc(tk.phone) +
      ' · ' + esc(tk.language) + '</div>' +
      '<div class="ticket-time">' + esc(when) + '</div>' +
      '<div class="ticket-text">' + esc(tk.text) + '</div>';
    supportEl.appendChild(card);
  }
```

> Every interpolated value passes through `esc()`. `tk.text` is untrusted user input — escaping is mandatory.

- [ ] **Step 2: Add the section markup + styles in `viewer/live.html`**

In the sidebar, after the `<div id="groups"></div>` line, add:

```html
    <h1 style="margin-top:20px;">🆘 Поддержка (<span id="support-count">0</span>)</h1>
    <div id="support"></div>
```

In the `<style>` block, after the `.empty { ... }` rule, add:

```css
    .ticket-card {
      background: #2a2a3c; border-radius: 8px; padding: 10px 12px;
      margin-bottom: 10px; border-left: 4px solid #c62828;
    }
    .ticket-head { font-size: 12px; color: #e0e0e0; font-weight: 600; }
    .ticket-time { font-size: 11px; color: #9090a0; margin: 2px 0 6px; }
    .ticket-text { font-size: 13px; color: #c8c8d8; white-space: pre-wrap; word-break: break-word; }
```

- [ ] **Step 3: Manual browser check**

Run the bot (`npm run bot`), open `http://127.0.0.1:8080/live`. With at least one support ticket in `data/state.json`, confirm the "🆘 Поддержка (N)" section lists it with name, phone, language, time, and the message text. (Visual verification.)

- [ ] **Step 4: Commit**

```bash
git add viewer/live.js viewer/live.html
git commit -m "feat: support tickets section on the live map"
```

---

### Task 6: Documentation

**Files:**
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Update `README.md` (Russian, existing style)**

Read `README.md` first, then update:
- "Команды бота и сценарии" / add a "Меню и настройки" subsection describing: главное меню после онбординга; в проде кнопка «Отправить локацию» исчезает, когда есть активная заявка (`testMode` — всегда видна); inline-меню «⚙️ Настройки» → «📋 Статус заявки» (в очереди: «📍 Сменить локацию», «❌ Отписаться»; в группе — только «❌ Отписаться») и «🔧 Общие настройки» → «🆘 Связаться с поддержкой», «🌐 Сменить язык».
- Note that «Сменить локацию» работает только в очереди; «Отписаться» сохраняет профиль; смена языка обновляет и язык активных заявок.
- Add a "Поддержка" note: пользователь пишет сообщение → оно сохраняется в `state.json` (`supportTickets`) и показывается на `/live` в разделе «🆘 Поддержка».
- "Модель данных": add `supportTickets` to `BotState`, with the `SupportTicket` shape (`id`, `telegramUserId`, `displayName`, `phone`, `language`, `text`, `createdAt`).
- "Живая карта": mention the new "🆘 Поддержка" sidebar section.

Ground wording in `src/bot.ts`, `src/store.ts`, `src/settings-menu.ts` so it matches the implementation.

- [ ] **Step 2: Full test suite — still green (docs-only)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document menu, settings, language change and support tickets"
```

---

## Self-Review

**Spec coverage:**
- Location button hidden in prod after request / shown in test → `showLocationButton` rule, used in `mainMenuKeyboard` (Task 4). ✅
- Inline settings navigation → `settings-menu.ts` (Task 3) + `callback_query` routing (Task 4). ✅
- Status view → `statusText` + status screen (Task 4). ✅
- Unsubscribe keeps profile → `s:leave` uses `store.leave` (no profile removal) (Task 4). ✅
- Change location (queued only) → `s:relocate` waiting-only guard (Task 4). ✅
- Change language updates profile + participants → `store.setLanguage` (Task 1) via `s:lang:<l>` (Task 4). ✅
- Support tickets capture + persist + confirm → `awaitingSupport` + `store.addSupportTicket` (Tasks 1, 4). ✅
- Support section on /live → Task 5. ✅
- Data model `supportTickets` + migration → Task 1. ✅
- i18n for all new strings → Task 2. ✅

**Placeholder scan:** all steps carry full code; the only prose-guided step is README wording (Task 6 Step 1) and manual browser check (Task 5 Step 3), which is acceptable.

**Type consistency:** `RequestState`/`Screen`/`MenuButton`/`menuScreen` identical across Tasks 3 and 4; `SupportTicket`/`NewSupportTicket` consistent across Tasks 1 and 4; callback data strings (`s:root|status|general|lang|relocate|leave|support`, `s:lang:<l>`) match between `settings-menu.ts` layout and the `bot.ts` router; `store.{hasActiveParticipant,setLanguage,addSupportTicket}` signatures match their call sites; `LeaveResult` imported from `store.ts` (already exported).
