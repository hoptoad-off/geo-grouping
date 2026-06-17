# Telegram geo-grouping bot — design

**Date:** 2026-06-17
**Status:** Approved (design), pending implementation plan

## Summary

Turn the existing batch geo-grouping pipeline into a live Telegram bot. Users
send their geolocation; the bot groups them into trios where all three are within
a configurable radius (default 5 km) of each other. When a group forms, all three
members are notified. A member can leave (`/leave`); when a grouped member leaves,
the group dissolves, the remaining two are notified and returned to the waiting
pool, and matching runs again immediately.

The existing geometry helpers (`haversineKm`, `computeCentroid` in
`src/grouping.ts`) are reused. The batch pipeline (`index.ts`, `loader.ts`,
`writer.ts`, `classifier.ts`) and the Leaflet viewer are left untouched.

## Goals

- Collect geolocation from Telegram users.
- Form groups of exactly 3 where **all pairwise distances ≤ radius** (default 5 km).
- Notify all three members when a group forms.
- On `/leave` by a grouped member: dissolve the group, notify the other two,
  return them to the waiting pool, and re-run matching.
- Persist state across bot restarts.

## Non-goals (for now)

- No group-dissolution triggers other than manual `/leave` (no confirmations,
  no timeouts, no location staleness).
- No distance-tier classification / fixed destination (removed from bot flow).
- No webhook deployment — long polling is sufficient for local testing.
- No database — JSON file storage (clean DB migration can come later).

## Tech stack

- **grammY** — Telegram bot framework (TypeScript-first, modern, native typing).
- **dotenv** — configuration via `.env`.
- Long polling (no webhook).
- **node:test** (built-in) run via `tsx` for unit tests — no new test deps.

## Configuration (`.env`, read by `src/config.ts`)

| Var | Default | Meaning |
|-----|---------|---------|
| `BOT_TOKEN` | (required) | Telegram bot token |
| `GROUP_RADIUS_KM` | `5` | Max pairwise distance for a group |
| `GROUP_SIZE` | `3` | Members per group |
| `TEST_MODE` | `true` | Allow multiple locations per account |

## Architecture / modules

- `src/types.ts` — add `Participant`, `Group`, `BotState`. Keep existing pipeline
  types; remove only what is clearly dead if needed.
- `src/config.ts` — load and validate `.env` values into a typed config object.
- `src/store.ts` — load `data/state.json` on start; atomic writes (temp file +
  rename) serialized through a write queue to avoid races. CRUD on participants
  and groups.
- `src/matcher.ts` — radius-constrained grouping over waiting participants;
  reuses `haversineKm` from `grouping.ts`.
- `src/notify.ts` — helper to send messages to participants; tolerates send
  failures (e.g. user blocked the bot).
- `src/bot.ts` — grammY bot + command/handlers; new entry point (`npm run bot`).
- Reused unchanged: `src/grouping.ts` (`haversineKm`, `computeCentroid`).

## Data model (`data/state.json`)

```json
{
  "seq": 12,
  "participants": [
    {
      "id": "u_007",
      "telegramUserId": 123,
      "chatId": 123,
      "displayName": "Иван",
      "lat": 41.31,
      "lng": 69.28,
      "status": "waiting",
      "groupId": null,
      "createdAt": "2026-06-17T10:00:00.000Z"
    }
  ],
  "groups": [
    {
      "groupId": "group_001",
      "memberIds": ["u_007", "u_008", "u_009"],
      "centroid": { "lat": 41.31, "lng": 69.28 },
      "createdAt": "2026-06-17T10:01:00.000Z"
    }
  ]
}
```

- `status`: `"waiting"` | `"grouped"`. `groupId` is set only when `grouped`.
- `seq` is a monotonic counter for generating participant/group ids.
- **TEST_MODE=true**: one Telegram account may have multiple `Participant`
  records (each sent location = a separate participant). One account can fill a
  whole group; notifications are sent per virtual participant.
- **TEST_MODE=false**: one active location per `telegramUserId` — a new location
  replaces the account's existing `waiting` participant.

## Matching logic (`matcher.ts`)

- Candidates = all participants with `status === "waiting"`.
- Take the earliest waiting participant by `createdAt` as the **seed**.
- Among the other waiting participants, find a set of `GROUP_SIZE - 1` such that
  **all pairwise distances within the trio ≤ `GROUP_RADIUS_KM`** (every member
  close to every other member, not only to the seed).
- If such a set exists, form the group (compute centroid via `computeCentroid`),
  mark members `grouped`, assign `groupId`.
- If the seed has no valid partners, leave it waiting and move to the next seed.
- Matching runs after every new location and after every group dissolution.
- Pure function over state input → returns newly formed groups + updated
  participants, so it is unit-testable without the bot.

## Event flow & commands

- `/start` — greeting + instructions; show a "📍 Отправить геолокацию" keyboard
  button (request_location).
- **Location message** → create a `waiting` `Participant` → run matcher → if a
  group forms, set members `grouped` and notify all three with the member list
  and pairwise distances.
- `/leave`:
  - If the participant was `grouped` → **dissolve the group**: notify the other
    two members ("Группа распалась, ищем новую"), set them back to `waiting`,
    remove the leaver, then re-run the matcher (the freed two may immediately
    join a new group).
  - If the participant was only `waiting` → remove them from the queue.
  - In TEST_MODE with multiple participants per account, `/leave` removes the
    account's most recent participant (if it was grouped, that group dissolves
    as above). Use `/reset` to clear all of the account's participants at once.
- `/status` — show the caller's current participant(s) and group state.
- `/reset` (test helper) — remove all of the caller's participants.

## Error handling & reliability

- Validate incoming coordinates (lat ∈ [-90, 90], lng ∈ [-180, 180]) before
  storing — mirrors existing `loader.ts` validation.
- Atomic `state.json` writes (temp file + `rename`); a serialized write queue so
  concurrent handlers cannot corrupt the file.
- Wrap message sends in try/catch; a blocked user must not crash the bot.
- State is read from JSON at startup, so restarts preserve participants/groups.

## Testing (TDD)

- `matcher.ts` — pure; cover: group forms when all within radius; no group when
  any pair exceeds radius; seed skipped when no valid partners; re-grouping after
  dissolution; TEST_MODE multiple participants from one account fill a group.
- `store.ts` — load/save round-trip, atomic write, id generation via `seq`,
  add/remove/update participants and groups.
- Tests via built-in `node:test`, executed with `tsx`.

## Open decisions

None outstanding. `/leave` removes the most recent participant; `/reset` clears
all of an account's participants.
</content>
</invoke>
