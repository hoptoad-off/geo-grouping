# Move settings from inline buttons to the bottom reply keyboard — Design

**Date:** 2026-06-17
**Status:** Approved

## Summary

Replace the inline (under-message) settings menu with a persistent **bottom reply
keyboard**. The settings actions — status, support, language, unsubscribe, and
(when queued) change-location — become reply-keyboard buttons at the top level.
Language selection, which needs its own choices, uses a temporary reply
sub-keyboard. The `callback_query` inline navigation is removed entirely.

## Motivation

The user prefers the actions live in the bottom keyboard ("меню") rather than as
inline buttons attached to a message. Reply keyboards are flat (no nesting / no
"Back" within one keyboard), so the previous Settings → {Status, General} → {…}
tree is flattened to a single top-level keyboard, with language choices on a
short sub-keyboard.

## Main reply keyboard (depends on request state)

Built by a pure `mainMenuLayout(requestState, testMode)`:

**Production:**
```
none (no request):  [📍 Отправить локацию]
                    [📋 Статус] [🆘 Поддержка]
                    [🌐 Язык]

waiting (queued):   [📍 Сменить локацию]
                    [📋 Статус] [🆘 Поддержка]
                    [🌐 Язык] [❌ Отписаться]

grouped:            [📋 Статус] [🆘 Поддержка]
                    [🌐 Язык] [❌ Отписаться]
```

**Test mode:** the first row is always `[📍 Отправить локацию]` (the
`requestLocation` button), plus the same action rows for the current state.

Rules preserved from the previous design:
- The `📍 Отправить локацию` button (a `requestLocation` button) shows when
  `testMode || requestState === 'none'`. In prod, after a location is sent the
  user becomes `waiting`, so it is replaced by `📍 Сменить локацию`; when
  `grouped`, neither location button appears.
- `📍 Сменить локацию` appears only when `waiting` (a plain text action button).
- `❌ Отписаться` appears only when there is an active request (waiting/grouped).

## Button → action (all matched by button text; no callbacks)

- **📋 Статус** → reply with the status text (same as `/status`).
- **🆘 Поддержка** → enter support-capture mode, prompt for a message → store a
  ticket (unchanged flow).
- **🌐 Язык** → enter language-select mode and show a sub-keyboard
  `[English] [Русский] [O'zbek]` / `[⬅️ Назад]`; picking a language calls
  `store.setLanguage` and returns to the main keyboard in the new language; Back
  returns without change.
- **❌ Отписаться** → `store.leave` (keeps the profile), refresh the keyboard.
- **📍 Сменить локацию** → remove the waiting participant, then prompt for a new
  location with a `requestLocation` keyboard.

## Transient per-user modes (in-memory, like onboarding)

- `awaitingSupport: Set<number>` (existing) — next plain-text message becomes a
  ticket. If the user instead taps a known menu-action button, support capture is
  cancelled and that action runs (so a button label is never filed as a ticket).
- `awaitingLanguageChange: Set<number>` (new) — while set, a fixed language label
  sets the language; the Back label returns to the menu; other text is ignored.

## `message:text` handler order

1. `/`-commands → `next()` (fall through to command handlers).
2. Language-select mode (if `awaitingLanguageChange`).
3. Support-capture mode (if `awaitingSupport`); a tapped menu-action cancels it
   and falls through to the action.
4. Onboarding steps (if onboarding).
5. Main-menu action (match button text → run the action).
6. Otherwise ignore.

## Code changes

- **Rename** `src/settings-menu.ts` → `src/main-menu.ts`: replace the inline
  `menuScreen` with the pure `mainMenuLayout(requestState, testMode): MenuButton[][]`
  where `interface MenuButton { labelKey: string; kind: 'text' | 'location' }`.
  Rename `src/settings-menu.test.ts` → `src/main-menu.test.ts`.
- **`src/bot.ts`:**
  - Remove the `callback_query:data` handler, `inlineFrom`, `safeEdit`,
    `screenTitle`, and the `InlineKeyboard` / `menuScreen` imports.
  - Add `buildMainKeyboard(lang, layout)` (text vs `requestLocation` buttons) and
    `mainMenuKeyboard(uid, lang)` (uses `mainMenuLayout(requestStateOf(uid), config.testMode)`).
  - Add `matchMenuAction(lang, text)` reverse-lookup and a `handleMenuAction`
    dispatcher.
  - Add `awaitingLanguageChange` set and `languageChooseKeyboard(lang)`.
  - Onboarding completion, the location handler, `/leave`, `/reset` send
    `mainMenuKeyboard(uid, lang)` instead of the old keyboards.
- **`src/store.ts`** — no change (methods are reused).
- **i18n (`src/i18n.ts`)** — remove now-unused keys `btn.settings`, `btn.general`,
  `menu.general`, `lang.en`, `lang.ru`, `lang.uz` from all three dicts (the
  language sub-keyboard uses the fixed `English/Русский/O'zbek` labels, not i18n).
  Keep `btn.statusItem`, `btn.relocate`, `btn.unsubscribe`, `btn.support`,
  `btn.changeLang`, `btn.back`, `menu.root`, `menu.lang`, `status.none`,
  `relocate.prompt`, `relocate.notQueued`, `unsubscribe.done`, `support.prompt`,
  `support.thanks`, `lang.changed`.
- **Viewer (`/live`)** — unchanged (support section stays).

## Error handling

- Unsubscribe / relocate with no matching participant → informational reply, no
  state change, keyboard refreshed.
- Empty support text → re-prompt.
- Language-select mode ignores unrecognized text (stays on the sub-keyboard).
- Existing coordinate/profile/contact guards unchanged.

## Testing

- `main-menu` (pure) — `mainMenuLayout` returns the correct rows for
  none / waiting / grouped in prod, and the test-mode variants (send-location
  always present). Assert button `labelKey` + `kind` per row.
- `i18n` — the existing parity test still passes after key removals (all three
  dicts removed the same keys).
- `store` tests unchanged. Bot wiring verified by `npm run build` + `npm test`
  and manual Telegram check.

## Affected files

| File | Change |
|------|--------|
| `src/main-menu.ts` | **new** (renamed from settings-menu.ts) — `mainMenuLayout` |
| `src/main-menu.test.ts` | **new** (renamed) — layout tests |
| `src/settings-menu.ts` / `.test.ts` | **deleted** |
| `src/bot.ts` | reply-keyboard menu; remove callback/inline; action dispatch; language mode |
| `src/i18n.ts` | remove unused inline keys (all three languages) |
| `README.md` | update menu description (bottom keyboard, not inline) |
