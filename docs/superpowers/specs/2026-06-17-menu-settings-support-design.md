# Main menu, settings, relocate/language change & support tickets — Design

**Date:** 2026-06-17
**Status:** Approved

## Summary

After onboarding, the bot presents a persistent main menu. In production the
"Send location" button disappears once the user has an active request; in
`TEST_MODE` it always stays. A "⚙️ Settings" button opens an inline-keyboard
menu where the user can: view their request status and (when queued) change
location or unsubscribe; and, under general settings, contact support or change
language. Support is a ticket flow: the user types a message, it is stored and
shown on the live map in a separate "Support" section, and the bot replies that
the team will get in touch.

## Goals

1. Main-menu reply keyboard; location button visibility rule (prod hides after a
   request exists, test always shows).
2. Inline settings navigation (callback queries), edited in place.
3. Status view; **unsubscribe** (keeps profile); **change location** (queued
   users only).
4. **Change language** (updates profile and the user's active participants).
5. **Support tickets**: capture user message → persist → show on `/live` →
   confirm to user.

## Non-goals (YAGNI)

- Marking support tickets resolved / replying from the site (read-only list).
- Changing campus from the menu (only language is changeable here).
- Removing the existing `/start`, `/status`, `/leave`, `/reset` commands — they
  stay as shortcuts.

## Location-button visibility rule

`showLocationButton(uid) = config.testMode || !hasActiveParticipant(uid)`

where `hasActiveParticipant(uid)` is true if the user has any participant with
status `waiting` or `grouped`. This single rule satisfies every requirement:

- Prod, after sending a location → has an active participant → button hidden.
- Test mode → always shown.
- After **unsubscribe** or **change location** → no active participant → button
  reappears.

## Keyboards

`mainMenuKeyboard(lang, showLocation)` — a reply keyboard:

- row 1 (only if `showLocation`): `requestLocation(t(lang,'btn.sendLocation'))`
- row 2: `t(lang,'btn.settings')` (plain text button "⚙️ Настройки")

The onboarding flow's final step now shows `mainMenuKeyboard(lang, true)` instead
of a location-only keyboard. After a location is accepted, the bot replies with
`mainMenuKeyboard(lang, showLocationButton(uid))`.

## Inline settings navigation

Tapping the "⚙️ Settings" reply button sends a fresh message carrying an inline
keyboard. All subsequent navigation **edits that message** (`editMessageText` +
`editMessageReplyMarkup`) via `callback_query`. Callback data uses an `s:` prefix:

```
s:root      → Settings root:  [📋 Status] [🔧 General]
s:status    → Status screen:  status text +
                 (waiting) [📍 Relocate (s:relocate)] [❌ Unsubscribe (s:leave)]
                 (grouped)  [❌ Unsubscribe (s:leave)]
                 (none)     just text
                 + [⬅️ Back (s:root)]
s:general   → General screen: [🆘 Support (s:support)] [🌐 Language (s:lang)] [⬅️ Back (s:root)]
s:lang      → Language screen: [English (s:lang:en)] [Русский (s:lang:ru)] [O'zbek (s:lang:uz)] [⬅️ Back (s:general)]
s:lang:<l>  → set language, confirm, re-render general screen in the new language
s:relocate  → (waiting only) remove waiting participant, answer callback, send a NEW
              message with the location keyboard prompting a fresh location
s:leave     → unsubscribe (see below), answer callback, edit message to confirmation;
              the next main-menu keyboard reflects the now-visible location button
s:support   → set awaitingSupport[uid]=true, answer callback, send a message asking
              the user to type their support message
```

Each `callback_query` is acknowledged with `answerCallbackQuery` to clear the
client spinner. A `relocate` attempt while grouped is guarded (the button isn't
shown, but the handler re-checks and shows a message if state changed).

The screen-selection logic (which screen + which buttons for the current request
state) is extracted into a **pure** module `src/settings-menu.ts` so it is unit
testable without Telegram.

## Actions

- **Status** — reuses the `/status` data (queued / grouped + neighbors).
- **Unsubscribe (`s:leave`)** — calls `store.leave(latestParticipantId)`,
  dissolving the group and notifying neighbors if grouped; **profile is kept** in
  `state.profiles`, so the user can submit again without re-onboarding.
- **Change location (`s:relocate`)** — only when the user has a `waiting`
  participant: removes it (`store.leave`), then prompts for a new location with
  the location keyboard.
- **Change language (`s:lang:<l>`)** — `store.setLanguage(uid, lang)` updates
  `profile.language` **and** the `language` field of the user's active
  participants (so group/dissolve notifications use the new language).

## Support tickets

Flow:
1. `s:support` → `awaitingSupport.add(uid)`, bot asks the user to type a message.
2. The next plain-text message (not a command, not the "Settings" button) from a
   user in `awaitingSupport` is captured: `store.addSupportTicket({...})` stores a
   `SupportTicket`, the flag is cleared, the bot replies "Спасибо, мы с вами
   свяжемся" and re-shows the main menu.

`SupportTicket`:
```ts
interface SupportTicket {
  id: string;            // 'ticket_001' via store.nextId('ticket')
  telegramUserId: number;
  displayName: string;
  phone: string;         // from profile, '' if unknown
  language: Language;
  text: string;
  createdAt: string;     // ISO
}
```
`BotState.supportTickets: SupportTicket[]` is persisted and therefore already
served inside `state.json`.

## Live map: Support section

`viewer/live.html` + `viewer/live.js` gain a "🆘 Поддержка" toggle/section in the
sidebar listing tickets newest-first: display name, phone, language, timestamp,
and the message text. Every interpolated value passes through the existing `esc()`
helper (ticket text is untrusted user input — escaping is mandatory). The map
markers are unaffected.

## Data model changes (`src/types.ts`)

- Add `interface SupportTicket` (above).
- Add `supportTickets: SupportTicket[]` to `BotState`.
- `Store.load` normalizes `supportTickets ??= []` (migration for old files).

## Store changes (`src/store.ts`)

- `hasActiveParticipant(telegramUserId): boolean` — any waiting/grouped
  participant for that user.
- `setLanguage(telegramUserId, language): void` — update profile + the user's
  participants' `language`.
- `addSupportTicket(input): SupportTicket` — assign `ticket_NNN` id + timestamp,
  push, return it.
- `save()` already serializes the whole state; `supportTickets` included.

## Bot wiring (`src/bot.ts`)

- New `callback_query` handler routing on `s:` prefixes (delegates screen choice
  to the pure `settings-menu.ts`).
- `message:text` handler order becomes: (1) `/`-commands fall through; (2) if
  `awaitingSupport.has(uid)` → capture ticket; (3) onboarding step logic; (4) if
  text equals the user's localized "Settings" label → open settings message;
  (5) otherwise ignore.
- Onboarding completion and the location handler use `mainMenuKeyboard`.
- New transient in-memory set `awaitingSupport: Set<number>` (sibling to the
  onboarding map).

## i18n additions (`src/i18n.ts`)

New keys (en/ru/uz): `btn.settings`, `menu.root`, `btn.statusItem`, `btn.general`,
`btn.relocate`, `btn.unsubscribe`, `btn.support`, `btn.changeLang`, `btn.back`,
`menu.general`, `status.none`, `relocate.prompt`, `relocate.notQueued`,
`unsubscribe.done`, `support.prompt`, `support.thanks`, `lang.changed`. The
existing language-button labels are reused for the language screen.

## Error handling

- `callback_query` always answered (even on no-op) to clear the spinner.
- Relocate while not queued → informational message, no state change.
- Support capture: empty/whitespace text → re-prompt, no ticket stored.
- Send failures continue to be swallowed by `safeSend`.
- All existing coordinate/profile guards unchanged.

## Testing

- `settings-menu` (pure) — correct screen + button set for waiting / grouped /
  no-request states; back navigation targets; language sub-screen.
- `store` — `hasActiveParticipant` true/false; `setLanguage` updates profile and
  participants; `addSupportTicket` assigns id/timestamp and persists through
  save/load; `supportTickets` defaults to `[]` on load of an old file.
- `i18n` — every language has every new key.
- Existing matcher/notify/onboarding/viewer-server tests unchanged.
- Live-map support section verified manually (browser), as with the rest of the
  viewer.

## Affected files

| File | Change |
|------|--------|
| `src/types.ts` | `SupportTicket`, `BotState.supportTickets` |
| `src/i18n.ts` | new menu/support keys (en/ru/uz) |
| `src/settings-menu.ts` | **new** — pure screen/keyboard selection |
| `src/store.ts` | `hasActiveParticipant`, `setLanguage`, `addSupportTicket`, load normalize |
| `src/bot.ts` | main-menu keyboard, callback_query routing, message:text branches, awaitingSupport |
| `viewer/live.js` | support tickets section render |
| `viewer/live.html` | support section markup/styles/toggle |
| `README.md` | document menu, settings, relocate/unsubscribe, language change, support |
