# Campus onboarding, phone collection, i18n & campus markers — Design

**Date:** 2026-06-17
**Status:** Approved

## Summary

Extend the geo-grouping Telegram bot so that, before a user sends their location,
the bot collects **language**, **campus** (branch), and **phone number** through a
short onboarding wizard. Grouping becomes **scoped per campus** — participants are
only grouped with others heading to the same branch. The live map gains **campus
destination markers** and shows each participant's **phone** and **campus**. The bot
is fully localized in **English, Russian, and Uzbek**. Existing points are wiped.

## Goals

1. Onboarding wizard on `/start`: language → campus → phone → location.
2. Two campuses (branches) as destinations:
   - **Mirzo Ulugbek** — `41.356250, 69.373209`
   - **Yashnobod** — `41.256928, 69.328708`
3. Grouping only within the same campus.
4. Collect phone via Telegram's verified "share contact" button.
5. Show phone and campus on the live map; show the two campus markers.
6. Full bot localization in en / ru / uz.
7. Reset existing `data/state.json` points.

## Non-goals (YAGNI)

- Distance-to-campus tiers / classification (the legacy batch pipeline did this; not
  requested here).
- A profile-edit menu beyond re-running `/start`.
- Persisting onboarding wizard progress across bot restarts (the resulting profile is
  persisted; the in-flight wizard step is not).
- Authenticating the live map (it stays bound to `127.0.0.1`).

## Campuses as shared constants

New module `src/campuses.ts` is the single source of truth:

```ts
export interface Campus {
  id: string;       // 'mirzo_ulugbek' | 'yashnobod'
  nameKey: string;  // i18n key for the display label
  lat: number;
  lng: number;
}
export const CAMPUSES: Campus[] = [
  { id: 'mirzo_ulugbek', nameKey: 'campus.mirzoUlugbek', lat: 41.356250, lng: 69.373209 },
  { id: 'yashnobod',     nameKey: 'campus.yashnobod',     lat: 41.256928, lng: 69.328708 },
];
```

Imported by the bot (onboarding keyboard), the store (grouping partition key + written
into `state.json`). The live map reads campuses from `state.campuses` — coordinates are
defined once.

## Data model changes (`src/types.ts`)

```ts
export type Language = 'en' | 'ru' | 'uz';

export interface Participant {
  // ...existing fields...
  campusId: string;   // which branch this submission targets
  phone: string;      // E.164-ish string from Telegram contact
  language: Language; // recipient's language for notifications
}

export interface UserProfile {
  language: Language;
  campusId: string;
  phone: string;
}

export interface BotState {
  seq: number;
  participants: Participant[];
  groups: Group[];
  profiles: Record<string, UserProfile>; // keyed by telegramUserId (as string)
  campuses: Campus[];                     // written on save for the map
}
```

**Reset:** `data/state.json` is replaced with a fresh empty state
(`seq: 0, participants: [], groups: [], profiles: {}, campuses: CAMPUSES`). Old points
have no campus/phone and would break per-campus grouping.

## Bot onboarding flow (`src/bot.ts` + new `src/onboarding.ts`)

Wizard state is held in an in-memory `Map<telegramUserId, OnboardingState>`. The derived
**profile** is persisted in `state.profiles`; the in-flight wizard step is transient.

```
/start → ① Language  (English / Русский / O'zbek)         trilingual prompt
       → ② Campus    (Mirzo Ulugbek / Yashnobod)          localized labels
       → ③ Phone     ["📱 Share contact" requestContact]   reply keyboard
       → ④ Location  ["📍 Send location" requestLocation]  reply keyboard → joinAndMatch
```

Rules:

- All steps use **reply keyboards** (consistent with the existing location button; phone
  and location *require* reply-keyboard buttons). Incoming text/contact is matched against
  known button payloads.
- Phone via `requestContact`; verify `ctx.message.contact.user_id === ctx.from.id` so a
  user cannot share someone else's number. On mismatch, re-prompt.
- After onboarding the profile sticks. Subsequent locations reuse the stored profile
  (important in `TEST_MODE`, where one account submits many locations).
- `/start` re-runs the wizard (the way to change language/campus/phone).
- A location received with no profile → reply "send /start first".

**Pure core:** the step-transition logic lives in `src/onboarding.ts` as a testable pure
module (input: current step + event, output: next step + any profile fragment). `bot.ts`
only wires Telegram I/O to it.

## Per-campus grouping (`src/store.ts`; matcher untouched)

The pure `findGroups` / `optimizeGroups` in `src/matcher.ts` stay campus-agnostic. The
**store** partitions by `campusId` before calling them:

- `runMatch`: split waiting participants by `campusId`, run `findGroups` on each subset,
  combine the formed groups.
- `rebuild`: split participants **and** existing groups by `campusId`, run `optimizeGroups`
  per campus, combine results.

Guarantee: **a group never mixes campuses.** Centroid/id assignment is unchanged.

## i18n (`src/i18n.ts`)

A dictionary `strings[lang][key]` for `en` / `ru` / `uz` covering: onboarding prompts,
button labels, campus names, `/status`, `/leave`, `/reset`, invalid-coordinate and
no-profile messages, and the group-formed notification. A helper `t(lang, key, params?)`
does interpolation.

Each recipient is messaged in **their own** language: `formatGroupFormed` and the
dissolve/notification paths take a `lang` argument, resolved from each member's profile.

## Live map (`viewer/live.js`, `viewer/live.html`)

- Render two **campus markers** from `state.campuses` using a distinct divIcon (★ /
  building), always visible, with a name popup.
- Participant popups and group-card entries show **phone** and **campus name**.
- Legend updated to include campus markers.
- HTML escaping (`esc`) continues to wrap all untrusted strings, now including `phone`.
- Per-campus grouping is visible naturally (groups cluster near their branch).
- *(Optional, include only if requested: a faint dashed line from each group centroid to
  its campus marker.)*

## Error handling

- Contact ownership mismatch → re-prompt, do not advance.
- Coordinate validation unchanged (range check before save).
- Send failures continue to be swallowed/logged by `safeSend`.
- Location without a profile → guidance message, no participant created.
- `rebuild` still computes the full new layout before applying (a throw leaves state
  untouched), now per campus.

## Testing

- `store` — two campuses never mix in `joinAndMatch` and `rebuild`; profile reuse across
  multiple locations; reset produces empty state with campuses present.
- `onboarding` — wizard transitions (language → campus → phone → ready); contact-ownership
  rejection; re-`/start` resets to language step.
- `i18n` — every language has every key (no missing translations).
- `notify` — localized group-formed formatting per recipient language.
- Existing `matcher` tests unchanged (pure core untouched).
- `viewer-server` tests unchanged (still serves `state.json`, blocks `input.json`).

## Affected files

| File | Change |
|------|--------|
| `src/campuses.ts` | **new** — campus constants |
| `src/i18n.ts` | **new** — en/ru/uz strings + `t()` |
| `src/onboarding.ts` | **new** — pure wizard state machine |
| `src/types.ts` | add `Language`, profile/campus/phone fields, `BotState.profiles`/`campuses` |
| `src/store.ts` | profiles, per-campus partition in `runMatch`/`rebuild`, write campuses on save, reset |
| `src/bot.ts` | onboarding handlers, contact handler, profile-aware location handler, localized replies |
| `src/notify.ts` | per-language formatting |
| `viewer/live.js` | campus markers, phone/campus in popups & cards |
| `viewer/live.html` | legend update |
| `data/state.json` | reset to empty (with campuses) |
| `README.md` | document onboarding, campuses, per-campus grouping, phone |
