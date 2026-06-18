# Live admin panel — design

**Date:** 2026-06-18
**Status:** Approved (design), pending implementation plan

## Summary

Turn the `/live` page from a fullscreen sidebar+map view into a proper admin
dashboard: the map becomes one card among others, a filterable table lists
**every** point (including ungrouped/waiting ones), filters narrow what is shown,
and a button exports point information to a real Word `.docx`. Access can be
optionally protected by a token.

The batch viewer at `/` and the bot's behavior are untouched.

## Goals

- `/live` is a scrollable dashboard of cards, not a fullscreen split.
- The Leaflet map is a fixed-height card (~420px), not `height: 100vh`.
- A table lists **all** participants — including `waiting` (ungrouped) ones,
  which today appear only as map markers, never in a list.
- Filters: status (grouped/waiting/all), campus, language, free-text search over
  display name + phone.
- Export to Word as a real `.docx`:
  - per row → one participant's document,
  - global button → one table document of all currently-filtered participants.
- Optional `ADMIN_TOKEN` protects the data and export/rebuild endpoints.

## Non-goals

- No changes to the batch viewer (`viewer/index.html`, `viewer/app.js`) at `/`.
- No changes to bot behavior or the existing unit tests (they stay green).
- No SSE/WebSocket; polling stays as-is.
- No new "point status" beyond the existing `waiting` / `grouped`.
- No server-side filter logic — filters live on the client; the export endpoint
  selects by explicit ids passed from the client.

## Architecture / files

| File | Change |
|------|--------|
| `viewer/live.html` | Rewrite shell into a card dashboard (header, metrics, filters, map card, table card, support card). |
| `viewer/live.js` | Add filter state + `filtered` computation; render map and table from `filtered`; add Word export download via fetch→Blob; token handling on 401. |
| `src/word-export.ts` (new) | `buildPointDoc(participant, campuses)` and `buildPointsDoc(participants, campuses)` → `Promise<Buffer>` via the `docx` package's `Packer.toBuffer`. |
| `src/viewer-server.ts` | Add `adminToken` option + auth guard on protected routes; add a state-loading helper; add `/export/point` and `/export/points` routes. |
| `src/serve.ts` | Pass `adminToken: process.env.ADMIN_TOKEN` into `createViewerServer`. |
| `src/bot.ts` | Where it builds the viewer server, also pass `adminToken: process.env.ADMIN_TOKEN`. |
| `package.json` | Add `docx` dependency. |
| `.env.example` | Document `ADMIN_TOKEN` (optional). |
| `src/word-export.test.ts` (new) | Buffer/`PK` signature tests. |
| `src/viewer-server.test.ts` | Add export + auth tests. |

## Data source

Unchanged: `data/state.json` (see `src/types.ts` `BotState`). Each participant has
`id, telegramUserId, chatId, displayName, lat, lng, campusId, phone, language,
status: 'waiting' | 'grouped', groupId, createdAt`. Campus names resolve via the
`campuses` array (id → display name); `live.js` already has a `campusName()`
helper mapping campus ids.

## Layout (`viewer/live.html`)

Replace the flex `body` (sidebar + 100vh map) with a vertical, scrollable
dashboard. Sections, top to bottom:

1. **Header bar** — title "Бот — админ-панель", token status, buttons
   "🔄 Пересобрать группы" and "📄 Экспорт всех (отфильтрованных) в Word".
2. **Metrics row** — small cards: всего точек · в группах · ожидают · групп ·
   обращений. Values reflect the **filtered** set where it makes sense
   (totals reflect filtered count; "групп"/"обращений" reflect full state).
3. **Filters card** — `status` select (все / в группе / ожидают), `campus`
   select (все + one per campus), `language` select (все + each language present),
   text input "поиск по имени/телефону".
4. **Map card** — `#map` at a fixed height (~420px). Draws the filtered points,
   campuses (always), and group spokes for filtered grouped members.
5. **Table card** — columns: имя, телефон, кампус, язык, статус, группа,
   координаты, создан, действия (📄 экспорт строки, 🎯 показать на карте).
6. **Support card** — tickets, as today.

Styling continues the existing dark theme (`#1e1e2e` / `#2a2a3c`). All
user-controlled strings still pass through the existing `esc()` before entering
`innerHTML`/popups.

## Filtering (`viewer/live.js`)

- A `filters` object: `{ status: 'all'|'waiting'|'grouped', campus: 'all'|<id>,
  language: 'all'|<lang>, query: string }`.
- `applyFilters(participants)` returns the subset matching all active filters;
  `query` matches case-insensitively against `displayName` and `phone`.
- On any filter change: recompute `filtered`, re-render map layers and table from
  it, update metrics. No bot/network call — purely client-side.
- Map: same rendering primitives as today (group-colored circle markers + dashed
  spokes to centroid for grouped; grey markers for waiting; campus markers).
  Only `filtered` participants are drawn. `fitBounds` still runs only on the
  first successful load with points; filter changes never re-fit (no jitter).
- Table: one row per participant in `filtered`, regardless of group. "Показать на
  карте" pans/zooms to that point; row export hits `/export/point`.

## Word export

### Module `src/word-export.ts`

Uses the `docx` package. Two exported functions, both returning
`Promise<Buffer>`:

- `buildPointDoc(participant, campuses)` — a single-participant document: a
  heading with the display name, then a labeled list / small table of fields
  (id, телефон, кампус (resolved name), язык, статус, группа, координаты,
  создан).
- `buildPointsDoc(participants, campuses)` — a heading plus a table with one row
  per participant and the same columns as the on-screen table.

Campus name resolution mirrors the client (`campuses` id → name; fall back to the
raw id). The functions are pure (no fs, no network) so they unit-test cleanly.

### Endpoints (`src/viewer-server.ts`)

- `GET /export/point?id=<id>` → 400 if no `id`; 404 if not found; otherwise reads
  `data/state.json`, builds the single-point doc, responds `200` with
  `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
  `Content-Disposition: attachment; filename="point-<id>.docx"`, `Cache-Control:
  no-store`.
- `GET /export/points?ids=<id>,<id>,...` → reads `data/state.json`, selects the
  participants whose ids are in the list (order preserving the list), builds the
  table doc, responds `200` with the docx headers and
  `filename="points-<count>.docx"`. Empty/absent `ids` → 400.

Both go through the auth guard (below). A small helper loads + parses
`data/state.json` and returns `BotState`, reused by both routes.

### Client download (`viewer/live.js`)

Because requests may carry an `Authorization` header, downloads use
`fetch(url, { headers })` → `res.blob()` → `URL.createObjectURL` → a temporary
`<a download>` click → `revokeObjectURL`. Same-origin fetch + blob is allowed by
the existing CSP (`connect-src 'self'`); no CSP change is needed.

## Access / auth

- Optional `ADMIN_TOKEN` env var, read by `serve.ts` and `bot.ts` and passed as
  `createViewerServer({ adminToken })`.
- When `adminToken` is set, an auth guard protects the **data and action**
  routes: `GET /data/state.json`, `GET /export/point`, `GET /export/points`,
  `POST /rebuild`. The guard accepts `Authorization: Bearer <token>` and returns
  `401` otherwise.
- When `adminToken` is unset (default), no auth is enforced — behavior is
  identical to today (loopback-only).
- Static assets (`live.html`, `live.js`, Leaflet, `data/output.json`) are **not**
  protected — they contain no participant data.
- `live.js`: keeps the token in `localStorage`. On any `401`, it prompts for the
  token, stores it, and retries; all protected requests send the
  `Authorization` header when a token is present. The header shows token status.

## Error handling / edge cases

- Missing/unreadable `state.json` on an export route → `503` with a short JSON
  error; the page already shows a friendly polling message for the map.
- `id` not found (single export) → `404`; empty filtered set (table export) → the
  global export button is disabled when `filtered.length === 0`.
- Empty/whitespace `ids` → `400`.
- Wrong/missing token when `adminToken` set → `401`, client re-prompts.
- Existing security headers (CSP, `X-Content-Type-Options`, loopback bind) stay;
  export responses set their own `Content-Type`/`Content-Disposition` and
  `Cache-Control: no-store`.

## Testing

- `src/word-export.test.ts` (new, Node `node:test`): `buildPointDoc` and
  `buildPointsDoc` return a non-empty `Buffer` whose first two bytes are `PK`
  (the zip/docx signature); the table doc for N participants is produced without
  throwing.
- `src/viewer-server.test.ts` (extend):
  - `/export/point?id=<existing>` → `200` + docx `Content-Type`.
  - `/export/point` without id → `400`; unknown id → `404`.
  - `/export/points?ids=...` → `200` + docx `Content-Type`.
  - With `adminToken` set: protected route without/with wrong token → `401`;
    with correct `Authorization: Bearer` → `200`. Static assets remain `200`
    without a token.
- `viewer/live.js` stays browser-verified manually (project convention: viewer
  scripts have no unit tests, the `node:test` runner targets Node modules).

Manual smoke test:
1. `npm run bot` + `npm run viz`, open `http://127.0.0.1:8080/live`.
2. The page is a scrollable dashboard; the map is a card, not fullscreen.
3. The table lists every participant, including waiting/ungrouped ones.
4. Each filter (status/campus/language/search) narrows table + map live.
5. A row's 📄 downloads `point-<id>.docx`; it opens in Word with that point's
   fields.
6. The header's 📄 downloads `points-N.docx` of the current filtered set.
7. With `ADMIN_TOKEN` set in `.env`, the page prompts for the token; wrong token
   is rejected, correct token unlocks data + export.
8. `/` batch viewer still works unchanged; existing tests stay green.

## Open decisions

None.
