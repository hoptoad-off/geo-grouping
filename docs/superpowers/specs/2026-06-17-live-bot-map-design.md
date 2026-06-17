# Live bot-state map — design

**Date:** 2026-06-17
**Status:** Approved (design), pending implementation plan

## Summary

Add a web map that visualizes the Telegram bot's **live** state (`data/state.json`):
formed groups and waiting participants, auto-refreshing every 5 seconds. The
existing batch viewer (Leaflet map of `data/output.json` with tiers and a fixed
destination) stays untouched at `/`; the live bot view is served at `/live`.

## Goals

- Serve a live map at `http://127.0.0.1:8080/live`.
- Show formed groups (members colored per group, with centroid spokes) and
  waiting participants (grey).
- Auto-refresh every 5 seconds via polling, without disrupting the user's
  current map view.
- Show participant Telegram display names (HTML-escaped).

## Non-goals

- No changes to the batch viewer (`viewer/index.html`, `viewer/app.js`) — it
  stays at `/`.
- No SSE/WebSocket push (polling only).
- No changes to bot behavior or the existing 19 unit tests.
- No tiers / fixed destination / unassigned concept (those are batch-only).

## Architecture / files

- `viewer/live.html` (new) — page shell mirroring `index.html`, loads the
  vendored Leaflet and `live.js`.
- `viewer/live.js` (new) — plain browser script (same style as `app.js`): polls
  `/data/state.json` every `REFRESH_MS`, redraws the map and sidebar.
- `src/serve.ts` (modify) — two minimal changes:
  1. Route `/live` → `viewer/live.html` (alongside the existing `/` →
     `viewer/index.html`).
  2. Add `data/state.json` to the static allow-list (currently only
     `data/output.json` is exposed from `data/`).
- Unchanged: `viewer/index.html`, `viewer/app.js`, all `src/*` bot modules.

## Data source

`data/state.json` shape (written by the bot's store):

```json
{
  "seq": 12,
  "participants": [
    { "id": "u_007", "telegramUserId": 123, "chatId": 123,
      "displayName": "Иван", "lat": 41.31, "lng": 69.28,
      "status": "waiting" | "grouped", "groupId": null | "group_001",
      "createdAt": "..." }
  ],
  "groups": [
    { "groupId": "group_001", "memberIds": ["u_007","u_008","u_009"],
      "centroid": { "lat": 41.31, "lng": 69.28 }, "createdAt": "..." }
  ]
}
```

## Rendering (`live.js`)

- Build a `participantsById` lookup from `participants`.
- **Groups:** assign each group a color from a fixed palette, cycled by index.
  For each `memberId` resolved to a participant: draw a circle marker in the
  group color with a popup (name, id, coords, group); draw a dashed polyline
  from the group centroid to the member; draw a centroid marker showing the
  group number (parsed from `groupId`).
- **Waiting participants** (`status === 'waiting'`): grey circle markers, popup
  shows name, id, coords, "в очереди".
- **Sidebar:** header "Групп: X · Ожидают: Y" plus one card per group listing
  member names.
- **Escaping:** every user-controlled string (notably `displayName`, also `id`,
  `groupId`) passes through an `esc()` helper before entering `innerHTML`/popups,
  identical in behavior to `app.js`'s `esc()`. `displayName` comes from Telegram
  and is untrusted.

## Refresh & map behavior

- `REFRESH_MS = 5000` constant at the top of `live.js`; `setInterval` re-fetches
  and redraws.
- A single `L.featureGroup` holds all drawn layers; each refresh calls
  `clearLayers()` then repopulates, so stale markers never accumulate.
- `fitBounds` runs only on the **first** successful load that contains at least
  one point. Subsequent refreshes preserve the user's current zoom/pan (avoids
  jitter every 5 s).

## Error handling / edge cases

- Missing or unreadable `state.json` → show a friendly message
  ("Бот ещё не создал состояние…"); polling continues.
- Empty state (no participants) → show "Нет активных участников" and keep the
  default Tashkent view (`[41.3111, 69.2797]`, zoom 11).
- Security headers (CSP, `X-Content-Type-Options`, loopback-only bind) are
  already applied by `serve.ts` and are reused unchanged for `/live`,
  `live.js`, and `state.json`. The CSP already permits OpenStreetMap/Carto
  tiles and `'self'` scripts, which covers the live page.

## Testing

The viewer is a browser script. The project's existing viewer (`app.js`) has no
unit tests, and the `node:test` runner targets Node modules, not DOM code.
Following the established convention, `live.js` is verified manually in the
browser; the bot's 19 unit tests remain green and untouched.

Manual smoke test:
1. Start the bot (`npm run bot`) and viewer (`npm run viz`).
2. Open `http://127.0.0.1:8080/` → batch viewer still works (unchanged).
3. Open `http://127.0.0.1:8080/live` → empty-state message when no participants.
4. In Telegram, send 1 location → within 5 s a grey "waiting" marker appears.
5. Send 2 more within 5 km → markers recolor into a group with centroid spokes;
   sidebar shows "Групп: 1 · Ожидают: 0".
6. `/leave` a grouped member → within 5 s the group disperses back to grey
   waiting markers (or regroups if enough remain).
7. Confirm `GET /data/state.json` returns JSON and `GET /data/input.json`
   stays 403 (allow-list unchanged except for state.json).

## Open decisions

None.
</content>
