# Live Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/live` into an admin dashboard with a card-sized map, a table of all points (including ungrouped), filters, optional token auth, and Word `.docx` export (single point + filtered list).

**Architecture:** A new pure `src/word-export.ts` builds `.docx` Buffers with the `docx` package. `src/viewer-server.ts` gains an optional token guard, an injectable state path, and two GET export endpoints. The browser layer (`viewer/live.html` + `viewer/live.js`) is rewritten into a scrollable dashboard that filters the state client-side and downloads docx via fetch→Blob.

**Tech Stack:** TypeScript (ESM, `node:test`), Node http, Leaflet (vendored), `docx` package.

## Global Constraints

- ESM imports use the `.js` extension on local files (e.g. `import { x } from './types.js'`), even from `.ts` sources — verbatim project convention.
- Tests use `node:test` + `node:assert/strict`; run with `npm test`.
- Do not modify the batch viewer (`viewer/index.html`, `viewer/app.js`) or `/`.
- Do not change bot behavior or break existing tests.
- Bind/serve stays loopback by default; CSP and security headers in `viewer-server.ts` are preserved.
- All user-controlled strings rendered into the DOM/popups must pass through the existing `esc()` helper.
- Languages are exactly `en | ru | uz`. Participant statuses are exactly `waiting | grouped`.
- UI copy is Russian, matching the existing page.

---

### Task 1: Word export module (`src/word-export.ts`)

**Files:**
- Modify: `package.json` (add `docx` dependency)
- Create: `src/word-export.ts`
- Test: `src/word-export.test.ts`

**Interfaces:**
- Consumes: `Participant` from `./types.js`.
- Produces:
  - `campusLabel(id: string): string`
  - `buildPointDoc(p: Participant): Promise<Buffer>`
  - `buildPointsDoc(ps: Participant[]): Promise<Buffer>`

- [ ] **Step 1: Install the docx dependency**

Run:
```bash
npm install docx@^9
```
Expected: `package.json` `dependencies` now contains `"docx": "^9...."`, install succeeds.

- [ ] **Step 2: Write the failing test**

Create `src/word-export.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Participant } from './types.js';
import { buildPointDoc, buildPointsDoc, campusLabel } from './word-export.js';

function p(id: string, over: Partial<Participant> = {}): Participant {
  return {
    id,
    telegramUserId: 1,
    chatId: 1,
    displayName: `User ${id}`,
    lat: 41.31,
    lng: 69.28,
    campusId: 'yashnobod',
    phone: '998900000000',
    language: 'ru',
    status: 'waiting',
    groupId: null,
    createdAt: '2026-06-18T07:00:00.000Z',
    ...over,
  };
}

function isDocx(buf: Buffer): boolean {
  // .docx is a zip; zip files start with the bytes "PK".
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

test('campusLabel maps known ids and falls back to the raw id', () => {
  assert.equal(campusLabel('yashnobod'), 'Yashnobod');
  assert.equal(campusLabel('unknown_x'), 'unknown_x');
});

test('buildPointDoc returns a non-empty docx buffer', async () => {
  const buf = await buildPointDoc(p('u_001', { displayName: 'Иван', status: 'grouped', groupId: 'group_001' }));
  assert.ok(isDocx(buf), 'buffer should start with PK');
});

test('buildPointsDoc builds a docx for many participants', async () => {
  const buf = await buildPointsDoc([p('u_001'), p('u_002'), p('u_003')]);
  assert.ok(isDocx(buf), 'buffer should start with PK');
});

test('buildPointsDoc handles an empty list without throwing', async () => {
  const buf = await buildPointsDoc([]);
  assert.ok(isDocx(buf), 'buffer should start with PK');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="docx|campusLabel"`
Expected: FAIL — cannot find module `./word-export.js`.

- [ ] **Step 4: Write the implementation**

Create `src/word-export.ts`:
```ts
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType,
} from 'docx';
import type { Participant } from './types.js';

// Display labels mirror viewer/live.js so the doc and the page agree.
const CAMPUS_LABELS: Record<string, string> = {
  mirzo_ulugbek: 'Mirzo Ulugbek',
  yashnobod: 'Yashnobod',
};

/** Human-readable campus name; falls back to the raw id. */
export function campusLabel(id: string): string {
  return CAMPUS_LABELS[id] ?? id;
}

const STATUS_LABELS: Record<string, string> = {
  waiting: 'Ожидает',
  grouped: 'В группе',
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function coords(p: Participant): string {
  return `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
}

/** Label/value pairs shown for a single participant. */
function fields(p: Participant): [string, string][] {
  return [
    ['ID', p.id],
    ['Имя', p.displayName],
    ['Телефон', p.phone],
    ['Кампус', campusLabel(p.campusId)],
    ['Язык', p.language],
    ['Статус', statusLabel(p.status)],
    ['Группа', p.groupId ?? '—'],
    ['Координаты', coords(p)],
    ['Создан', p.createdAt],
  ];
}

/** Builds a .docx Buffer describing one participant. */
export async function buildPointDoc(p: Participant): Promise<Buffer> {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: p.displayName || p.id, heading: HeadingLevel.HEADING_1 }),
        ...fields(p).map(([k, v]) => new Paragraph({
          children: [new TextRun({ text: `${k}: `, bold: true }), new TextRun(String(v))],
        })),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

const COLUMNS = ['Имя', 'Телефон', 'Кампус', 'Язык', 'Статус', 'Группа', 'Координаты', 'Создан'];

function tableRow(cells: string[]): TableRow {
  return new TableRow({
    children: cells.map((c) => new TableCell({ children: [new Paragraph(String(c))] })),
  });
}

/** Builds a .docx Buffer with a table over many participants. */
export async function buildPointsDoc(ps: Participant[]): Promise<Buffer> {
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      tableRow(COLUMNS),
      ...ps.map((p) => tableRow([
        p.displayName, p.phone, campusLabel(p.campusId), p.language,
        statusLabel(p.status), p.groupId ?? '—', coords(p), p.createdAt,
      ])),
    ],
  });
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: `Точки (${ps.length})`, heading: HeadingLevel.HEADING_1 }),
        table,
      ],
    }],
  });
  return Packer.toBuffer(doc);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="docx|campusLabel"`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/word-export.ts src/word-export.test.ts
git commit -m "feat: word-export module for participant docx (single + table)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PpgAdSEAEu3NrLA4fzWTHQ"
```

---

### Task 2: Token auth guard (`src/viewer-server.ts`)

**Files:**
- Modify: `src/viewer-server.ts`
- Test: `src/viewer-server.test.ts`

**Interfaces:**
- Consumes: existing `createViewerServer(options)`.
- Produces: `ViewerServerOptions.adminToken?: string`. When set, `GET /data/state.json` and `POST /rebuild` require header `Authorization: Bearer <token>`; missing/wrong → `401`. Static assets stay open.

- [ ] **Step 1: Write the failing test**

Append to `src/viewer-server.test.ts`:
```ts
test('adminToken protects state.json + rebuild; static stays open', async () => {
  const server = createViewerServer({
    adminToken: 'secret123',
    rebuild: async () => ({ changed: 0 }),
  });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  try {
    // No token → 401 on protected routes.
    assert.equal((await fetch(`${base}/data/state.json`)).status, 401);
    assert.equal((await fetch(`${base}/rebuild`, { method: 'POST' })).status, 401);

    // Wrong token → 401.
    assert.equal(
      (await fetch(`${base}/data/state.json`, { headers: { Authorization: 'Bearer nope' } })).status,
      401,
    );

    // Correct token → not 401 (rebuild succeeds).
    const ok = await fetch(`${base}/rebuild`, {
      method: 'POST',
      headers: { Authorization: 'Bearer secret123' },
    });
    assert.equal(ok.status, 200);

    // Static asset is reachable without a token.
    const live = await fetch(`${base}/live`);
    assert.equal(live.status, 200);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="adminToken protects"`
Expected: FAIL — `/data/state.json` returns 200/404, not 401.

- [ ] **Step 3: Extend the options interface**

In `src/viewer-server.ts`, replace the `ViewerServerOptions` interface body so it reads:
```ts
export interface ViewerServerOptions {
  /**
   * When provided, enables `POST /rebuild`, which calls this handler and returns
   * its result as JSON. When omitted, `/rebuild` responds 404 (batch viewer).
   */
  rebuild?: () => Promise<{ changed: number }>;
  /**
   * When set, protects data + action routes (state.json, exports, rebuild) with
   * `Authorization: Bearer <token>`. When omitted, those routes are open.
   */
  adminToken?: string;
  /** Path to the bot state JSON. Defaults to `<root>/data/state.json`. */
  statePath?: string;
}
```

- [ ] **Step 4: Add the guard at the top of the request handler**

In `src/viewer-server.ts`, immediately after the line `const url = new URL(req.url ?? '/', 'http://localhost');` inside `createServer(...)`, insert:
```ts
    // Token guard: when adminToken is configured, data + action routes require
    // a bearer token. Static assets (the page shell, scripts, output.json) stay
    // open — they carry no participant data.
    const PROTECTED = new Set([
      '/data/state.json', '/export/point', '/export/points', '/rebuild',
    ]);
    if (options.adminToken && PROTECTED.has(url.pathname)) {
      if (req.headers['authorization'] !== `Bearer ${options.adminToken}`) {
        res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end('Unauthorized');
        return;
      }
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="adminToken protects"`
Expected: PASS.

- [ ] **Step 6: Run the full suite (no regressions)**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/viewer-server.ts src/viewer-server.test.ts
git commit -m "feat: optional bearer-token guard on viewer data/action routes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PpgAdSEAEu3NrLA4fzWTHQ"
```

---

### Task 3: Export endpoints (`src/viewer-server.ts`)

**Files:**
- Modify: `src/viewer-server.ts`
- Test: `src/viewer-server.test.ts`

**Interfaces:**
- Consumes: `buildPointDoc`, `buildPointsDoc` from `./word-export.js`; `ViewerServerOptions.statePath`.
- Produces:
  - `GET /export/point?id=<id>` → docx of one participant, or `400` (no id) / `404` (unknown) / `503` (no state).
  - `GET /export/points?ids=<csv>` → docx table of the named participants, or `400` (no ids) / `503` (no state). Non-GET on either → `405`.
  - Both respond with `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document` and a `Content-Disposition` attachment filename (`point-<id>.docx` / `points-<count>.docx`).

- [ ] **Step 1: Write the failing test**

Append to `src/viewer-server.test.ts`. (Add this import near the top of the file, after the existing imports: `import { writeFile } from 'node:fs/promises';`)
```ts
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function writeState(participants: unknown[]): Promise<string> {
  const file = path.join(tmpdir(), `state-${randomUUID()}.json`);
  await writeFile(file, JSON.stringify({
    seq: participants.length, participants, groups: [],
    profiles: {}, campuses: [], supportTickets: [],
  }), 'utf8');
  return file;
}

function participant(id: string) {
  return {
    id, telegramUserId: 1, chatId: 1, displayName: `User ${id}`,
    lat: 41.31, lng: 69.28, campusId: 'yashnobod', phone: '998900000000',
    language: 'ru', status: 'waiting', groupId: null,
    createdAt: '2026-06-18T07:00:00.000Z',
  };
}

test('GET /export/point returns a docx for a known id', async () => {
  const statePath = await writeState([participant('u_001')]);
  const server = createViewerServer({ statePath });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  try {
    const ok = await fetch(`${base}/export/point?id=u_001`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), DOCX_MIME);
    const buf = Buffer.from(await ok.arrayBuffer());
    assert.ok(buf[0] === 0x50 && buf[1] === 0x4b, 'docx starts with PK');

    assert.equal((await fetch(`${base}/export/point`)).status, 400);
    assert.equal((await fetch(`${base}/export/point?id=missing`)).status, 404);
    assert.equal((await fetch(`${base}/export/point?id=u_001`, { method: 'POST' })).status, 405);
  } finally {
    server.close();
  }
});

test('GET /export/points returns a docx for the named ids', async () => {
  const statePath = await writeState([participant('u_001'), participant('u_002')]);
  const server = createViewerServer({ statePath });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  try {
    const ok = await fetch(`${base}/export/points?ids=u_001,u_002`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), DOCX_MIME);

    assert.equal((await fetch(`${base}/export/points`)).status, 400);
  } finally {
    server.close();
  }
});

test('export routes return 503 when state file is unreadable', async () => {
  const server = createViewerServer({ statePath: path.join(tmpdir(), `missing-${randomUUID()}.json`) });
  const port = await listen(server);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/export/point?id=u_001`);
    assert.equal(r.status, 503);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="/export/"`
Expected: FAIL — export routes return 404 (not yet implemented).

- [ ] **Step 3: Add imports and the docx helper**

In `src/viewer-server.ts`, add after the existing imports:
```ts
import { buildPointDoc, buildPointsDoc } from './word-export.js';
import type { Participant } from './types.js';
```
And add this module-level constant + helper (below the `MIME` map):
```ts
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Writes a generated docx Buffer as a download response. */
function sendDocx(res: import('node:http').ServerResponse, buf: Buffer, filename: string): void {
  res.writeHead(200, {
    'Content-Type': DOCX_MIME,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(buf);
}
```

- [ ] **Step 4: Resolve the state path inside `createViewerServer`**

In `src/viewer-server.ts`, at the very start of `createViewerServer`, before the `return createServer(...)`, add:
```ts
  const statePath = options.statePath ?? path.join(ROOT, 'data', 'state.json');
```

- [ ] **Step 5: Add the export routing**

In `src/viewer-server.ts`, inside the handler, immediately **before** the `let filePath =` static-serving block (and after the `/rebuild` block), insert:
```ts
    if (url.pathname === '/export/point' || url.pathname === '/export/points') {
      if (req.method !== 'GET') {
        res.writeHead(405).end('Method Not Allowed');
        return;
      }
      let participants: Participant[];
      try {
        const state = JSON.parse(await readFile(statePath, 'utf8'));
        participants = (state.participants ?? []) as Participant[];
      } catch {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'state unavailable' }));
        return;
      }

      if (url.pathname === '/export/point') {
        const id = url.searchParams.get('id');
        if (!id) {
          res.writeHead(400).end('Missing id');
          return;
        }
        const p = participants.find((x) => x.id === id);
        if (!p) {
          res.writeHead(404).end('Not found');
          return;
        }
        sendDocx(res, await buildPointDoc(p), `point-${id}.docx`);
        return;
      }

      // /export/points
      const idsParam = url.searchParams.get('ids');
      if (!idsParam || !idsParam.trim()) {
        res.writeHead(400).end('Missing ids');
        return;
      }
      const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
      const byId = new Map(participants.map((p) => [p.id, p]));
      const selected = ids
        .map((id) => byId.get(id))
        .filter((p): p is Participant => Boolean(p));
      sendDocx(res, await buildPointsDoc(selected), `points-${selected.length}.docx`);
      return;
    }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="/export/"`
Expected: PASS (3 tests).

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/viewer-server.ts src/viewer-server.test.ts
git commit -m "feat: /export/point and /export/points docx endpoints

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PpgAdSEAEu3NrLA4fzWTHQ"
```

---

### Task 4: Wire `adminToken` into the runtimes

**Files:**
- Modify: `src/serve.ts`
- Modify: `src/bot.ts:359-365`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `ViewerServerOptions.adminToken`.
- Produces: both the standalone viewer and the bot read `process.env.ADMIN_TOKEN`.

- [ ] **Step 1: Pass the token in `serve.ts`**

In `src/serve.ts`, change the server construction line `createViewerServer().listen(PORT, HOST, () => {` to:
```ts
createViewerServer({ adminToken: process.env.ADMIN_TOKEN }).listen(PORT, HOST, () => {
```

- [ ] **Step 2: Pass the token in `bot.ts`**

In `src/bot.ts`, in the `createViewerServer({ ... })` call at line ~359, add the `adminToken` field so it reads:
```ts
const viewer = createViewerServer({
  adminToken: process.env.ADMIN_TOKEN,
  rebuild: async () => {
    const result = store.rebuild(config.groupRadiusKm, config.groupSize);
    await store.save();
    return result;
  },
});
```

- [ ] **Step 3: Document the env var**

In `.env.example`, append:
```
# Optional. When set, the /live admin panel requires this token (Bearer) for
# state data, exports, and rebuild. Leave empty for open localhost-only access.
ADMIN_TOKEN=
```

- [ ] **Step 4: Verify it still builds and tests pass**

Run: `npm run build && npm test`
Expected: build succeeds, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/serve.ts src/bot.ts .env.example
git commit -m "feat: read ADMIN_TOKEN env into viewer + bot servers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PpgAdSEAEu3NrLA4fzWTHQ"
```

---

### Task 5: Dashboard shell (`viewer/live.html`)

**Files:**
- Modify: `viewer/live.html` (full rewrite of the shell + styles)

**Interfaces:**
- Produces these element ids consumed by `live.js` (Task 6): `#error`, `#token-status`, `#rebuild-btn`, `#export-all-btn`, `#m-total`, `#m-grouped`, `#m-waiting`, `#m-groups`, `#m-tickets`, `#f-status`, `#f-campus`, `#f-language`, `#f-search`, `#map`, `#points-tbody`, `#points-empty`, `#support-count`, `#support`.

- [ ] **Step 1: Replace the file**

Overwrite `viewer/live.html` with:
```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Бот — админ-панель</title>
  <link rel="icon" href="data:," />
  <link rel="stylesheet" href="/viewer/vendor/leaflet/leaflet.css" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #15151f; color: #e0e0e0; padding: 16px;
    }
    .wrap { max-width: 1200px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
    header.bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    header.bar h1 { font-size: 20px; flex: 1; }
    .token-status { font-size: 12px; color: #9090a0; }
    button.action {
      padding: 8px 12px; cursor: pointer; border: none; border-radius: 6px;
      font-size: 13px; font-weight: 600; color: #fff; background: #3949ab;
    }
    button.action:hover { background: #43499c; }
    button.action:disabled { background: #555; cursor: default; }
    .card { background: #1e1e2e; border-radius: 10px; padding: 16px; }
    .metrics { display: flex; gap: 12px; flex-wrap: wrap; }
    .metric { background: #2a2a3c; border-radius: 8px; padding: 10px 16px; min-width: 110px; }
    .metric .num { font-size: 22px; font-weight: 700; }
    .metric .lbl { font-size: 12px; color: #9090a0; }
    .filters { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; }
    .filters label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #9090a0; }
    .filters select, .filters input {
      background: #2a2a3c; color: #e0e0e0; border: 1px solid #3a3a4c;
      border-radius: 6px; padding: 7px 10px; font-size: 13px; min-width: 160px;
    }
    #map { height: 420px; border-radius: 8px; }
    table.points { width: 100%; border-collapse: collapse; font-size: 13px; }
    table.points th, table.points td {
      text-align: left; padding: 8px 10px; border-bottom: 1px solid #2a2a3c;
      white-space: nowrap;
    }
    table.points th { color: #9090a0; font-weight: 600; }
    table.points tr:hover td { background: #24243400; }
    .status-pill { padding: 2px 8px; border-radius: 10px; font-size: 11px; }
    .status-grouped { background: #1e88e5; color: #fff; }
    .status-waiting { background: #757575; color: #fff; }
    .row-btn {
      cursor: pointer; border: none; border-radius: 5px; padding: 4px 8px;
      font-size: 12px; background: #2a2a3c; color: #e0e0e0; margin-right: 4px;
    }
    .row-btn:hover { background: #34344a; }
    .empty { font-size: 13px; color: #9090a0; padding: 12px 0; }
    .ticket-card {
      background: #2a2a3c; border-radius: 8px; padding: 10px 12px;
      margin-bottom: 10px; border-left: 4px solid #c62828;
    }
    .ticket-head { font-size: 12px; color: #e0e0e0; font-weight: 600; }
    .ticket-time { font-size: 11px; color: #9090a0; margin: 2px 0 6px; }
    .ticket-text { font-size: 13px; color: #c8c8d8; white-space: pre-wrap; word-break: break-word; }
    .campus-icon, .centroid-icon {
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-weight: 700; border-radius: 50%; border: 2px solid #fff;
      box-shadow: 0 1px 4px rgba(0,0,0,0.5);
    }
    .centroid-icon { font-size: 11px; }
    .campus-icon { font-size: 14px; border-radius: 6px; }
    #error {
      position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
      background: #c62828; color: #fff; padding: 10px 18px; border-radius: 6px;
      display: none; z-index: 2000;
    }
    h2.section { font-size: 15px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="bar">
      <h1>Бот — админ-панель</h1>
      <span class="token-status" id="token-status"></span>
      <button class="action" id="rebuild-btn">🔄 Пересобрать группы</button>
      <button class="action" id="export-all-btn">📄 Экспорт всех (Word)</button>
    </header>

    <div class="card">
      <div class="metrics">
        <div class="metric"><div class="num" id="m-total">0</div><div class="lbl">точек (фильтр)</div></div>
        <div class="metric"><div class="num" id="m-grouped">0</div><div class="lbl">в группах</div></div>
        <div class="metric"><div class="num" id="m-waiting">0</div><div class="lbl">ожидают</div></div>
        <div class="metric"><div class="num" id="m-groups">0</div><div class="lbl">групп</div></div>
        <div class="metric"><div class="num" id="m-tickets">0</div><div class="lbl">обращений</div></div>
      </div>
    </div>

    <div class="card">
      <h2 class="section">Фильтры</h2>
      <div class="filters">
        <label>Статус
          <select id="f-status">
            <option value="all">Все</option>
            <option value="grouped">В группе</option>
            <option value="waiting">Ожидают</option>
          </select>
        </label>
        <label>Кампус
          <select id="f-campus"><option value="all">Все</option></select>
        </label>
        <label>Язык
          <select id="f-language"><option value="all">Все</option></select>
        </label>
        <label>Поиск
          <input id="f-search" type="text" placeholder="имя или телефон" />
        </label>
      </div>
    </div>

    <div class="card">
      <h2 class="section">Карта</h2>
      <div id="map"></div>
    </div>

    <div class="card">
      <h2 class="section">Точки</h2>
      <table class="points">
        <thead>
          <tr>
            <th>Имя</th><th>Телефон</th><th>Кампус</th><th>Язык</th>
            <th>Статус</th><th>Группа</th><th>Координаты</th><th>Создан</th><th>Действия</th>
          </tr>
        </thead>
        <tbody id="points-tbody"></tbody>
      </table>
      <div class="empty" id="points-empty" style="display:none;">Нет точек по фильтру</div>
    </div>

    <div class="card">
      <h2 class="section">🆘 Поддержка (<span id="support-count">0</span>)</h2>
      <div id="support"></div>
    </div>
  </div>
  <div id="error"></div>

  <script src="/viewer/vendor/leaflet/leaflet.js"></script>
  <script src="/viewer/live.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add viewer/live.html
git commit -m "feat: rebuild /live shell into a card dashboard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PpgAdSEAEu3NrLA4fzWTHQ"
```

---

### Task 6: Dashboard logic (`viewer/live.js`)

**Files:**
- Modify: `viewer/live.js` (full rewrite)

**Interfaces:**
- Consumes: element ids from Task 5; endpoints `/data/state.json`, `/export/point?id=`, `/export/points?ids=`, `/rebuild` from Tasks 2–3.
- Produces: browser behavior only (no exports). Verified manually.

- [ ] **Step 1: Replace the file**

Overwrite `viewer/live.js` with:
```js
const REFRESH_MS = 5000;
const GROUP_PALETTE = [
  '#1e88e5', '#43a047', '#fb8c00', '#8e24aa',
  '#e53935', '#00897b', '#fdd835', '#6d4c41',
];
const WAITING_COLOR = '#757575';
const CAMPUS_COLOR = '#d81b60';
const CAMPUS_NAMES = { mirzo_ulugbek: 'Mirzo Ulugbek', yashnobod: 'Yashnobod' };
const DEFAULT_CENTER = [41.3111, 69.2797];

function campusName(id) {
  return CAMPUS_NAMES[id] || id;
}

/** HTML-escape untrusted strings (displayName comes from Telegram). */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ---- token handling ---------------------------------------------------------
let token = localStorage.getItem('adminToken') || '';

function updateTokenStatus() {
  document.getElementById('token-status').textContent = token ? '🔓 токен задан' : '';
}

function authHeaders() {
  return token ? { Authorization: 'Bearer ' + token } : {};
}

function promptToken() {
  const t = window.prompt('Введите токен администратора (ADMIN_TOKEN):', token || '');
  if (t === null) return false;
  token = t.trim();
  localStorage.setItem('adminToken', token);
  updateTokenStatus();
  return true;
}

// ---- map --------------------------------------------------------------------
const map = L.map('map', { preferCanvas: true }).setView(DEFAULT_CENTER, 11);
const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

let tileErrors = 0, switched = false;
osm.on('tileerror', () => {
  if (switched || ++tileErrors < 4) return;
  switched = true;
  map.removeLayer(osm);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap &copy; CARTO'
  }).addTo(map);
});

const layer = L.featureGroup().addTo(map);
let fitted = false;

function showError(msg) {
  const el = document.getElementById('error');
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

function groupColor(index) {
  return GROUP_PALETTE[index % GROUP_PALETTE.length];
}

// ---- filters ----------------------------------------------------------------
const filters = { status: 'all', campus: 'all', language: 'all', query: '' };
let lastState = null;

function applyFilters(participants) {
  const q = filters.query.trim().toLowerCase();
  return participants.filter((p) => {
    if (filters.status !== 'all' && p.status !== filters.status) return false;
    if (filters.campus !== 'all' && p.campusId !== filters.campus) return false;
    if (filters.language !== 'all' && p.language !== filters.language) return false;
    if (q) {
      const hay = (String(p.displayName || '') + ' ' + String(p.phone || '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Populate campus + language dropdowns from the state (once values appear). */
function syncFilterOptions(state) {
  const campusSel = document.getElementById('f-campus');
  const langSel = document.getElementById('f-language');

  const campusIds = Array.from(new Set(state.participants.map((p) => p.campusId))).filter(Boolean);
  syncSelect(campusSel, campusIds, (id) => campusName(id));

  const langs = Array.from(new Set(state.participants.map((p) => p.language))).filter(Boolean);
  syncSelect(langSel, langs, (l) => l);
}

function syncSelect(select, values, labelFn) {
  const have = new Set(Array.from(select.options).map((o) => o.value));
  for (const v of values) {
    if (have.has(v)) continue;
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = labelFn(v);
    select.appendChild(opt);
  }
}

// ---- rendering --------------------------------------------------------------
function render(state) {
  lastState = state;
  syncFilterOptions(state);

  const filtered = applyFilters(state.participants);
  const byId = {};
  for (const p of state.participants) byId[p.id] = p;
  const groups = state.groups || [];
  const groupIndex = {};
  groups.forEach((g, i) => { groupIndex[g.groupId] = i; });

  // metrics
  document.getElementById('m-total').textContent = String(filtered.length);
  document.getElementById('m-grouped').textContent =
    String(filtered.filter((p) => p.status === 'grouped').length);
  document.getElementById('m-waiting').textContent =
    String(filtered.filter((p) => p.status === 'waiting').length);
  document.getElementById('m-groups').textContent = String(groups.length);
  document.getElementById('m-tickets').textContent = String((state.supportTickets || []).length);

  // map
  layer.clearLayers();
  const allLatLngs = [];

  for (const c of (state.campuses || [])) {
    L.marker([c.lat, c.lng], {
      icon: L.divIcon({
        className: 'campus-icon',
        html: '<div class="campus-icon" style="width:26px;height:26px;background:' + CAMPUS_COLOR + '">★</div>',
        iconSize: [26, 26], iconAnchor: [13, 13],
      }),
    }).addTo(layer).bindPopup('<b>' + esc(campusName(c.id)) + '</b><br>кампус');
  }

  const centroidsDrawn = new Set();
  for (const p of filtered) {
    allLatLngs.push([p.lat, p.lng]);
    const gi = p.groupId != null ? groupIndex[p.groupId] : undefined;
    const color = gi !== undefined ? groupColor(gi) : WAITING_COLOR;
    L.circleMarker([p.lat, p.lng], {
      radius: 7, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 0.95
    }).addTo(layer).bindPopup(
      '<b>' + esc(p.displayName) + '</b><br>id: ' + esc(p.id) +
      '<br>📞 ' + esc(p.phone) +
      '<br>🏫 ' + esc(campusName(p.campusId)) +
      '<br>' + p.lat.toFixed(4) + ', ' + p.lng.toFixed(4) +
      (p.groupId ? '<br>Группа: ' + esc(p.groupId) : '<br><i>в очереди</i>')
    );
    if (gi !== undefined) {
      const g = groups[gi];
      L.polyline([[g.centroid.lat, g.centroid.lng], [p.lat, p.lng]], {
        color, weight: 1.5, opacity: 0.6, dashArray: '4 4'
      }).addTo(layer);
      if (!centroidsDrawn.has(p.groupId)) {
        centroidsDrawn.add(p.groupId);
        const num = String(p.groupId).replace(/^group_0*/, '');
        L.marker([g.centroid.lat, g.centroid.lng], {
          icon: L.divIcon({
            className: 'centroid-icon',
            html: '<div class="centroid-icon" style="width:24px;height:24px;background:' +
              color + '">' + esc(num) + '</div>',
            iconSize: [24, 24], iconAnchor: [12, 12]
          })
        }).addTo(layer).bindPopup('<b>' + esc(p.groupId) + '</b>');
      }
    }
  }

  if (!fitted && allLatLngs.length > 0) {
    map.fitBounds(allLatLngs, { padding: [40, 40] });
    fitted = true;
  }

  renderTable(filtered);
  renderSupport(state);
}

function renderTable(filtered) {
  const tbody = document.getElementById('points-tbody');
  const empty = document.getElementById('points-empty');
  tbody.innerHTML = '';
  empty.style.display = filtered.length ? 'none' : 'block';

  for (const p of filtered) {
    const tr = document.createElement('tr');
    const pillClass = p.status === 'grouped' ? 'status-grouped' : 'status-waiting';
    const pillText = p.status === 'grouped' ? 'В группе' : 'Ожидает';
    const when = new Date(p.createdAt).toLocaleString();
    tr.innerHTML =
      '<td>' + esc(p.displayName) + '</td>' +
      '<td>' + esc(p.phone) + '</td>' +
      '<td>' + esc(campusName(p.campusId)) + '</td>' +
      '<td>' + esc(p.language) + '</td>' +
      '<td><span class="status-pill ' + pillClass + '">' + pillText + '</span></td>' +
      '<td>' + esc(p.groupId || '—') + '</td>' +
      '<td>' + p.lat.toFixed(4) + ', ' + p.lng.toFixed(4) + '</td>' +
      '<td>' + esc(when) + '</td>' +
      '<td></td>';
    const actions = tr.lastElementChild;

    const locate = document.createElement('button');
    locate.className = 'row-btn';
    locate.textContent = '🎯';
    locate.title = 'Показать на карте';
    locate.addEventListener('click', () => {
      map.setView([p.lat, p.lng], 15);
      document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    const exp = document.createElement('button');
    exp.className = 'row-btn';
    exp.textContent = '📄';
    exp.title = 'Экспорт в Word';
    exp.addEventListener('click', () => download('/export/point?id=' + encodeURIComponent(p.id)));

    actions.appendChild(locate);
    actions.appendChild(exp);
    tbody.appendChild(tr);
  }
}

function renderSupport(state) {
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
}

// ---- downloads (fetch -> blob, carries the token) ---------------------------
async function download(url) {
  try {
    let resp = await fetch(url, { headers: authHeaders(), cache: 'no-store' });
    if (resp.status === 401 && promptToken()) {
      resp = await fetch(url, { headers: authHeaders(), cache: 'no-store' });
    }
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const blob = await resp.blob();
    const disp = resp.headers.get('content-disposition') || '';
    const match = disp.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : 'export.docx';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    showError('Не удалось скачать документ: ' + e.message);
  }
}

// ---- polling ----------------------------------------------------------------
async function refresh() {
  let resp;
  try {
    resp = await fetch('/data/state.json', { headers: authHeaders(), cache: 'no-store' });
    if (resp.status === 401) {
      if (promptToken()) return refresh();
      showError('Требуется токен администратора.');
      return;
    }
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
  } catch (e) {
    showError('Бот ещё не создал состояние (data/state.json): ' + e.message);
    return;
  }
  showError('');
  render(await resp.json());
}

// ---- wiring -----------------------------------------------------------------
function reRender() { if (lastState) render(lastState); }

document.getElementById('f-status').addEventListener('change', (e) => {
  filters.status = e.target.value; reRender();
});
document.getElementById('f-campus').addEventListener('change', (e) => {
  filters.campus = e.target.value; reRender();
});
document.getElementById('f-language').addEventListener('change', (e) => {
  filters.language = e.target.value; reRender();
});
document.getElementById('f-search').addEventListener('input', (e) => {
  filters.query = e.target.value; reRender();
});

document.getElementById('export-all-btn').addEventListener('click', () => {
  if (!lastState) return;
  const ids = applyFilters(lastState.participants).map((p) => p.id);
  if (ids.length === 0) { showError('Нет точек по фильтру для экспорта.'); return; }
  download('/export/points?ids=' + encodeURIComponent(ids.join(',')));
});

const rebuildBtn = document.getElementById('rebuild-btn');
rebuildBtn.addEventListener('click', async () => {
  if (!confirm('Пересобрать все группы заново?')) return;
  rebuildBtn.disabled = true;
  const original = rebuildBtn.textContent;
  rebuildBtn.textContent = 'Пересборка…';
  try {
    let resp = await fetch('/rebuild', { method: 'POST', headers: authHeaders() });
    if (resp.status === 401 && promptToken()) {
      resp = await fetch('/rebuild', { method: 'POST', headers: authHeaders() });
    }
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    await refresh();
  } catch (e) {
    showError('Не удалось пересобрать группы: ' + e.message);
  } finally {
    rebuildBtn.disabled = false;
    rebuildBtn.textContent = original;
  }
});

updateTokenStatus();
refresh();
setInterval(refresh, REFRESH_MS);
```

- [ ] **Step 2: Manual smoke test**

Run two terminals:
```bash
npm run bot
npm run viz
```
Then verify at `http://127.0.0.1:8080/live`:
- Page is a scrollable dashboard; the map is a 420px card, not fullscreen.
- The table lists every participant, including `waiting` (ungrouped) ones.
- Changing Статус / Кампус / Язык / Поиск narrows both table and map live; the map does not re-fit/jump on filter change.
- A row's 📄 downloads `point-<id>.docx` that opens in Word with that point's fields.
- The header 📄 downloads `points-<N>.docx` of the current filtered set.
- 🎯 on a row centers the map on that point.
- `/` (batch viewer) still works unchanged.

- [ ] **Step 3: Manual auth test**

Stop the viewer, set `ADMIN_TOKEN=secret123` in `.env`, restart `npm run bot`/`npm run viz`, reload `/live`:
- The page prompts for a token; entering a wrong value keeps it locked, `secret123` unlocks data + exports; reload remembers it (localStorage); the header shows "🔓 токен задан".

- [ ] **Step 4: Commit**

```bash
git add viewer/live.js
git commit -m "feat: /live dashboard logic — filters, points table, word export, token

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PpgAdSEAEu3NrLA4fzWTHQ"
```

---

## Final verification

- [ ] Run `npm run build && npm test` — build clean, all tests pass.
- [ ] Confirm the README's `/live` description still matches, or update it if it describes the old fullscreen layout.
```
