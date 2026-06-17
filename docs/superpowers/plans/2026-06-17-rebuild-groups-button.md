# Rebuild-Groups Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Пересобрать группы" button to the live map that globally re-optimizes groups (nearest neighbors) while guaranteeing no already-grouped participant is orphaned, running inside the bot process with no Telegram notifications.

**Architecture:** A pure `optimizeGroups` function (iterative greedy rebuild with original-group locking) in `matcher.ts`; a `store.rebuild()` that applies it and persists; `serve.ts` refactored into a reusable `createViewerServer` factory that adds a `POST /rebuild` endpoint; `bot.ts` runs that server (sharing its in-memory `Store`) so the button is same-origin; a button in `live.html`/`live.js`.

**Tech Stack:** TypeScript (ESM, NodeNext), Node 24, grammY, `node:http`, `node:test` via `tsx`, vanilla browser JS + Leaflet.

---

## File Structure

- `src/matcher.ts` (modify) — add pure `optimizeGroups(participants, existingGroups, radiusKm, groupSize)`.
- `src/store.ts` (modify) — add `rebuild(radiusKm, groupSize): { changed: number }`.
- `src/viewer-server.ts` (new) — `createViewerServer(options)` factory holding the request handler (moved from `serve.ts`) plus `POST /rebuild`.
- `src/serve.ts` (rewrite) — thin entry that calls `createViewerServer()` and listens (batch viewer, no rebuild).
- `src/bot.ts` (modify) — start `createViewerServer({ rebuild })` on the viewer port, sharing the live `Store`.
- `viewer/live.html` (modify) — add the button + minimal style.
- `viewer/live.js` (modify) — wire the button to `POST /rebuild`.
- Tests: `src/matcher.test.ts` (extend), `src/store.test.ts` (extend), `src/viewer-server.test.ts` (new).

---

## Task 1: `optimizeGroups` pure function

**Files:**
- Modify: `src/matcher.ts`
- Test: `src/matcher.test.ts`

- [ ] **Step 1: Write the failing tests (append to `src/matcher.test.ts`)**

Add these imports at the TOP of the file if not already present (the file already imports `test`, `assert`, `findGroups`, and `Participant`):
```typescript
import { optimizeGroups } from './matcher.js';
import type { Group } from './types.js';
```

Append at the end:
```typescript
function gp(id: string, lat: number, lng: number, status: 'waiting' | 'grouped', groupId: string | null, createdAt: string): Participant {
  return { id, telegramUserId: 1, chatId: 1, displayName: id, lat, lng, status, groupId, createdAt };
}

test('optimizeGroups regroups tighter when a closer neighbor exists', () => {
  // existing (suboptimal): [a,b,c] and [d,e,f]; d is actually nearest to a,b
  const ps = [
    gp('a', 41.300, 69.280, 'grouped', 'group_001', '2026-01-01T00:00:01.000Z'),
    gp('b', 41.301, 69.280, 'grouped', 'group_001', '2026-01-01T00:00:02.000Z'),
    gp('c', 41.340, 69.280, 'grouped', 'group_001', '2026-01-01T00:00:03.000Z'),
    gp('d', 41.300, 69.2805, 'grouped', 'group_002', '2026-01-01T00:00:04.000Z'),
    gp('e', 41.341, 69.280, 'grouped', 'group_002', '2026-01-01T00:00:05.000Z'),
    gp('f', 41.340, 69.2805, 'grouped', 'group_002', '2026-01-01T00:00:06.000Z'),
  ];
  const existing: Group[] = [
    { groupId: 'group_001', memberIds: ['a', 'b', 'c'], centroid: { lat: 41.3, lng: 69.28 }, createdAt: 'x' },
    { groupId: 'group_002', memberIds: ['d', 'e', 'f'], centroid: { lat: 41.34, lng: 69.28 }, createdAt: 'x' },
  ];
  const result = optimizeGroups(ps, existing, 5, 3);
  assert.equal(result.groups.length, 2);
  assert.equal(result.waitingIds.length, 0);
  const aGroup = result.groups.find((g) => g.memberIds.includes('a'));
  assert.ok(aGroup.memberIds.includes('d')); // a now grouped with its nearest, d
  assert.ok(!aGroup.memberIds.includes('c')); // not the farther c
});

test('optimizeGroups keeps a grouped point in its original group rather than orphan it', () => {
  // [a,b,c] grouped; d waiting near a/b. Greedy would form [a,d,b] and orphan c.
  const ps = [
    gp('a', 41.300, 69.280, 'grouped', 'group_001', '2026-01-01T00:00:01.000Z'),
    gp('b', 41.301, 69.280, 'grouped', 'group_001', '2026-01-01T00:00:02.000Z'),
    gp('c', 41.340, 69.280, 'grouped', 'group_001', '2026-01-01T00:00:03.000Z'),
    gp('d', 41.300, 69.2805, 'waiting', null, '2026-01-01T00:00:04.000Z'),
  ];
  const existing: Group[] = [
    { groupId: 'group_001', memberIds: ['a', 'b', 'c'], centroid: { lat: 41.3, lng: 69.28 }, createdAt: 'x' },
  ];
  const result = optimizeGroups(ps, existing, 5, 3);
  assert.equal(result.groups.length, 1);
  assert.deepEqual([...result.groups[0].memberIds].sort(), ['a', 'b', 'c']);
  assert.deepEqual(result.waitingIds, ['d']); // only the previously-waiting point is left over
});

test('optimizeGroups leaves a far waiting point in the queue', () => {
  const ps = [
    gp('a', 41.300, 69.280, 'grouped', 'group_001', '2026-01-01T00:00:01.000Z'),
    gp('b', 41.301, 69.280, 'grouped', 'group_001', '2026-01-01T00:00:02.000Z'),
    gp('c', 41.302, 69.280, 'grouped', 'group_001', '2026-01-01T00:00:03.000Z'),
    gp('d', 41.800, 69.280, 'waiting', null, '2026-01-01T00:00:04.000Z'), // ~55 km away
  ];
  const existing: Group[] = [
    { groupId: 'group_001', memberIds: ['a', 'b', 'c'], centroid: { lat: 41.3, lng: 69.28 }, createdAt: 'x' },
  ];
  const result = optimizeGroups(ps, existing, 5, 3);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.waitingIds, ['d']);
});

test('optimizeGroups returns nothing for empty input', () => {
  assert.deepEqual(optimizeGroups([], [], 5, 3), { groups: [], waitingIds: [] });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test src/matcher.test.ts`
Expected: FAIL — `optimizeGroups` is not exported.

- [ ] **Step 3: Implement `optimizeGroups` (append to `src/matcher.ts`)**

Add the import for `Group` at the top of `src/matcher.ts` (it currently imports only `Participant` from types):
```typescript
import type { Participant, Group } from './types.js';
```
(Change the existing `import type { Participant } from './types.js';` line to the above.)

Append at the end of `src/matcher.ts`:
```typescript
/** Result of a global group re-optimization. */
export interface OptimizeResult {
  groups: FormedGroup[];
  waitingIds: string[];
}

/**
 * Re-optimizes groups over ALL participants so members end up with their nearest
 * neighbors, while guaranteeing no previously-grouped participant is orphaned.
 *
 * Iterative greedy rebuild with original-group locking: run findGroups over the
 * pool; if any previously-grouped participant would be left over, lock its whole
 * original group (remove those members from the pool) and re-run; repeat until no
 * previously-grouped participant is orphaned. Worst case locks every original
 * group (no change); best case rebuilds all groups tighter.
 *
 * @param participants - All participants (grouped + waiting).
 * @param existingGroups - Current groups (to look up original membership).
 * @param radiusKm - Max pairwise distance for a group.
 * @param groupSize - Members per group.
 * @returns Final groups and the ids left waiting (only ever previously-waiting ones).
 */
export function optimizeGroups(
  participants: Participant[],
  existingGroups: Group[],
  radiusKm: number,
  groupSize: number
): OptimizeResult {
  const originalGroupByMember = new Map<string, Group>();
  for (const g of existingGroups) {
    for (const id of g.memberIds) originalGroupByMember.set(id, g);
  }
  const previouslyGrouped = new Set(
    participants.filter((p) => p.status === 'grouped').map((p) => p.id)
  );

  const lockedGroups: Group[] = [];
  const lockedIds = new Set<string>();

  // Loop terminates: each iteration with orphans locks at least one new original
  // group, and there are finitely many groups.
  for (;;) {
    const pool = participants.filter((p) => !lockedIds.has(p.id));
    const tentative = findGroups(pool, radiusKm, groupSize);

    const placed = new Set<string>();
    for (const fg of tentative) for (const id of fg.memberIds) placed.add(id);

    const orphaned = [...previouslyGrouped].filter(
      (id) => !lockedIds.has(id) && !placed.has(id)
    );

    if (orphaned.length === 0) {
      const groups: FormedGroup[] = [
        ...lockedGroups.map((g) => ({ memberIds: g.memberIds, centroid: g.centroid })),
        ...tentative,
      ];
      const grouped = new Set<string>();
      for (const g of groups) for (const id of g.memberIds) grouped.add(id);
      const waitingIds = participants
        .filter((p) => !grouped.has(p.id))
        .map((p) => p.id);
      return { groups, waitingIds };
    }

    for (const id of orphaned) {
      const g = originalGroupByMember.get(id);
      if (!g || lockedGroups.some((lg) => lg.groupId === g.groupId)) continue;
      lockedGroups.push(g);
      for (const m of g.memberIds) lockedIds.add(m);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test src/matcher.test.ts`
Expected: PASS (9 tests total — the original 5 plus 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/matcher.ts src/matcher.test.ts
git commit -m "feat: add optimizeGroups rebuild with orphan protection"
```

---

## Task 2: `store.rebuild`

**Files:**
- Modify: `src/store.ts`
- Test: `src/store.test.ts`

- [ ] **Step 1: Write the failing tests (append to `src/store.test.ts`)**

Append at the end:
```typescript
test('rebuild keeps a grouped member in its group instead of orphaning it', async () => {
  const store = await Store.load(tmpPath());
  store.joinAndMatch(np(41.300, 69.280, 1), 5, 3);
  store.joinAndMatch(np(41.301, 69.280, 2), 5, 3);
  store.joinAndMatch(np(41.340, 69.280, 3), 5, 3); // forms [u_001,u_002,u_003]
  store.joinAndMatch(np(41.300, 69.2805, 4), 5, 3); // u_004 waiting, near u_001

  const before = store.getState().groups.length;
  const result = store.rebuild(5, 3);

  assert.equal(store.getState().groups.length, 1); // still one group, u_004 not pulled in to orphan u_003
  const grouped = store.getState().participants.filter((p) => p.status === 'grouped');
  const waiting = store.getState().participants.filter((p) => p.status === 'waiting');
  assert.equal(grouped.length, 3);
  assert.equal(waiting.length, 1);
  assert.equal(result.changed, 0); // membership unchanged
  assert.equal(before, 1);
});

test('rebuild reshuffles into tighter groups and reports changed count', async () => {
  const store = await Store.load(tmpPath());
  // a,b near; c far-ish -> [a,b,c]; then d (near a,b), e,f near c -> [d,e,f]
  store.joinAndMatch(np(41.300, 69.280, 1), 5, 3);   // a
  store.joinAndMatch(np(41.301, 69.280, 2), 5, 3);   // b
  store.joinAndMatch(np(41.340, 69.280, 3), 5, 3);   // c -> group [a,b,c]
  store.joinAndMatch(np(41.300, 69.2805, 4), 5, 3);  // d (near a,b)
  store.joinAndMatch(np(41.341, 69.280, 5), 5, 3);   // e (near c)
  store.joinAndMatch(np(41.340, 69.2805, 6), 5, 3);  // f (near c) -> group [d,e,f]

  assert.equal(store.getState().groups.length, 2);
  const result = store.rebuild(5, 3);

  assert.equal(store.getState().groups.length, 2);
  assert.equal(store.getState().participants.filter((p) => p.status === 'grouped').length, 6);
  // u_001 ('a') should now be grouped with u_004 ('d'), its nearest
  const aMember = store.getState().participants.find((p) => p.id === 'u_001');
  const aGroup = store.getState().groups.find((g) => g.groupId === aMember.groupId);
  assert.ok(aGroup.memberIds.includes('u_004'));
  assert.equal(result.changed, 2);
});

test('rebuild on empty state is a no-op', async () => {
  const store = await Store.load(tmpPath());
  const result = store.rebuild(5, 3);
  assert.equal(result.changed, 0);
  assert.deepEqual(store.getState().groups, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test src/store.test.ts`
Expected: FAIL — `store.rebuild` is not a function.

- [ ] **Step 3: Implement `rebuild` in `src/store.ts`**

Update the matcher import at the top of `src/store.ts` (it currently imports only `findGroups`):
```typescript
import { findGroups, optimizeGroups } from './matcher.js';
```
(Change the existing `import { findGroups } from './matcher.js';` line to the above.)

Add this method to the `Store` class, immediately AFTER the `leave(...)` method and BEFORE `save()`:
```typescript
  /**
   * Globally re-optimizes groups (nearest neighbors) without orphaning any
   * previously-grouped participant. Computes the new layout with the pure
   * optimizeGroups (so a throw leaves state untouched), then applies it.
   *
   * @returns How many resulting groups differ from the previous grouping.
   */
  rebuild(radiusKm: number, groupSize: number): { changed: number } {
    const layout = optimizeGroups(this.state.participants, this.state.groups, radiusKm, groupSize);

    const key = (ids: string[]): string => [...ids].sort().join(',');
    const oldSets = new Set(this.state.groups.map((g) => key(g.memberIds)));

    const newGroups: Group[] = layout.groups.map((fg) => ({
      groupId: this.nextId('group'),
      memberIds: fg.memberIds,
      centroid: fg.centroid,
      createdAt: new Date().toISOString(),
    }));

    const groupIdByMember = new Map<string, string>();
    for (const g of newGroups) for (const id of g.memberIds) groupIdByMember.set(id, g.groupId);

    for (const p of this.state.participants) {
      const gid = groupIdByMember.get(p.id);
      if (gid) {
        p.status = 'grouped';
        p.groupId = gid;
      } else {
        p.status = 'waiting';
        p.groupId = null;
      }
    }
    this.state.groups = newGroups;

    const changed = newGroups.filter((g) => !oldSets.has(key(g.memberIds))).length;
    return { changed };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test src/store.test.ts`
Expected: PASS (11 tests total — the original 8 plus 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/store.ts src/store.test.ts
git commit -m "feat: add store.rebuild applying optimizeGroups"
```

---

## Task 3: Viewer-server factory + `/rebuild` endpoint

**Files:**
- Create: `src/viewer-server.ts`
- Rewrite: `src/serve.ts`
- Test: `src/viewer-server.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/viewer-server.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Store } from './store.js';
import type { NewParticipant } from './store.js';
import { createViewerServer } from './viewer-server.js';

function np(lat: number, lng: number, uid: number): NewParticipant {
  return { telegramUserId: uid, chatId: uid, displayName: `u${uid}`, lat, lng };
}

async function listen(server: import('node:http').Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

test('POST /rebuild rebuilds, GET /rebuild is 405, input.json stays 403', async () => {
  const file = path.join(tmpdir(), `state-${randomUUID()}.json`);
  const store = await Store.load(file);
  store.joinAndMatch(np(41.300, 69.280, 1), 5, 3);
  store.joinAndMatch(np(41.301, 69.280, 2), 5, 3);
  store.joinAndMatch(np(41.340, 69.280, 3), 5, 3);
  store.joinAndMatch(np(41.300, 69.2805, 4), 5, 3);

  const server = createViewerServer({
    rebuild: async () => {
      const r = store.rebuild(5, 3);
      await store.save();
      return r;
    },
  });
  const port = await listen(server);
  try {
    const post = await fetch(`http://127.0.0.1:${port}/rebuild`, { method: 'POST' });
    assert.equal(post.status, 200);
    const body = await post.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.changed, 'number');

    const get = await fetch(`http://127.0.0.1:${port}/rebuild`);
    assert.equal(get.status, 405);

    const forbidden = await fetch(`http://127.0.0.1:${port}/data/input.json`);
    assert.equal(forbidden.status, 403);
  } finally {
    server.close();
  }
});

test('without a rebuild handler, /rebuild is 404', async () => {
  const server = createViewerServer();
  const port = await listen(server);
  try {
    const post = await fetch(`http://127.0.0.1:${port}/rebuild`, { method: 'POST' });
    assert.equal(post.status, 404);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/viewer-server.test.ts`
Expected: FAIL — cannot find module `./viewer-server.js`.

- [ ] **Step 3: Create `src/viewer-server.ts`**

```typescript
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** Options for the viewer HTTP server. */
export interface ViewerServerOptions {
  /**
   * When provided, enables `POST /rebuild`, which calls this handler and returns
   * its result as JSON. When omitted, `/rebuild` responds 404 (batch viewer).
   */
  rebuild?: () => Promise<{ changed: number }>;
}

/**
 * Builds the viewer HTTP server. Serves viewer/index.html at "/", viewer/live.html
 * at "/live", files under viewer/, and only output.json + state.json from data/.
 * Optionally exposes POST /rebuild.
 *
 * @param options - Optional rebuild handler.
 * @returns An http.Server (not yet listening — caller calls .listen).
 */
export function createViewerServer(options: ViewerServerOptions = {}): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/rebuild') {
      if (!options.rebuild) {
        res.writeHead(404).end('Not found');
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end('Method Not Allowed');
        return;
      }
      try {
        const result = await options.rebuild();
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify({ ok: true, changed: result.changed }));
      } catch (err) {
        console.error('Rebuild failed:', err instanceof Error ? err.message : err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false }));
      }
      return;
    }

    let filePath =
      url.pathname === '/'
        ? '/viewer/index.html'
        : url.pathname === '/live'
          ? '/viewer/live.html'
          : url.pathname;

    // Expose all of viewer/ but only output.json and state.json from data/ — the
    // raw input.json and any other data files stay private. The URL parser
    // already normalizes "../" and "%2e%2e/", and the path.sep suffix on each
    // prefix prevents sibling-directory bypass (e.g. ROOT/viewer-secret).
    const resolved = path.resolve(ROOT, '.' + filePath);
    const allowed =
      resolved.startsWith(path.join(ROOT, 'viewer') + path.sep) ||
      resolved === path.join(ROOT, 'data', 'output.json') ||
      resolved === path.join(ROOT, 'data', 'state.json');
    if (!allowed) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    try {
      const content = await readFile(resolved);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(resolved)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy':
          "default-src 'self'; " +
          "img-src 'self' https://tile.openstreetmap.org https://*.basemaps.cartocdn.com data:; " +
          "style-src 'self' 'unsafe-inline'; " +
          "script-src 'self'; " +
          "connect-src 'self'; " +
          "object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      });
      res.end(content);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
}
```

- [ ] **Step 4: Rewrite `src/serve.ts` to use the factory**

Replace the ENTIRE contents of `src/serve.ts` with:
```typescript
import { createViewerServer } from './viewer-server.js';

const PORT = Number(process.env.PORT) || 8080;
// Bind to loopback only — this is a local viewer and must not be reachable
// from the LAN. Override with HOST=0.0.0.0 only if you knowingly want that.
const HOST = process.env.HOST || '127.0.0.1';

// Standalone batch viewer: no rebuild handler (that lives in the bot process).
createViewerServer().listen(PORT, HOST, () => {
  console.log(`✓ Viewer running at http://${HOST}:${PORT}`);
  console.log('  (Ctrl+C to stop)');
});
```

- [ ] **Step 5: Run the test and type-check**

Run:
```bash
node --import tsx --test src/viewer-server.test.ts
npx tsc --noEmit
```
Expected: 2 tests PASS; tsc no errors.

- [ ] **Step 6: Commit**

```bash
git add src/viewer-server.ts src/serve.ts src/viewer-server.test.ts
git commit -m "refactor: extract createViewerServer factory with POST /rebuild"
```

---

## Task 4: Wire the viewer server into the bot process

**Files:**
- Modify: `src/bot.ts`

- [ ] **Step 1: Add the viewer server to `src/bot.ts`**

At the top of `src/bot.ts`, the imports currently include lines importing from `grammy`, `./config.js`, `./store.js`, `./notify.js`. Add this import after them:
```typescript
import { createViewerServer } from './viewer-server.js';
```

Then, immediately BEFORE the final two lines (`console.log('Bot starting (long polling)…');` and `await bot.start();`), insert:
```typescript
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
```

- [ ] **Step 2: Type-check and confirm all unit tests stay green**

Run:
```bash
npx tsc --noEmit
npm test 2>&1 | tail -4
```
Expected: tsc no errors; `pass` count includes all prior tests plus the new matcher/store/viewer-server tests, `fail 0`.

- [ ] **Step 3: Manual check — bot serves the live map and rebuild**

Stop any standalone viewer to free port 8080, then run the bot:
```bash
pkill -f "tsx src/serve.ts"; pkill -f "tsx src/bot.ts"; sleep 1
(npm run bot &) ; sleep 4
echo -n "/live -> "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/live
echo -n "POST /rebuild -> "; curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8080/rebuild
echo -n "GET /rebuild -> "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/rebuild
```
Expected: `/live -> 200`, `POST /rebuild -> 200`, `GET /rebuild -> 405`.

- [ ] **Step 4: Commit**

```bash
git add src/bot.ts
git commit -m "feat: bot process serves live map and /rebuild endpoint"
```

---

## Task 5: Rebuild button in the live page

**Files:**
- Modify: `viewer/live.html`
- Modify: `viewer/live.js`

- [ ] **Step 1: Add the button and style to `viewer/live.html`**

In `viewer/live.html`, inside the `<style>` block, add this rule just before the closing `</style>`:
```css
    #rebuild-btn {
      width: 100%; margin: 0 0 16px; padding: 8px 12px; cursor: pointer;
      background: #3949ab; color: #fff; border: none; border-radius: 6px;
      font-size: 13px; font-weight: 600;
    }
    #rebuild-btn:hover { background: #43499c; }
    #rebuild-btn:disabled { background: #555; cursor: default; }
```

In the sidebar, the current markup has `<div class="meta" id="meta">Загрузка…</div>` followed by `<div class="legend">…</div>`. Insert the button BETWEEN the legend div and `<div id="groups"></div>`, so it reads:
```html
    <button id="rebuild-btn">🔄 Пересобрать группы</button>
    <div id="groups"></div>
```

- [ ] **Step 2: Wire the button in `viewer/live.js`**

At the END of `viewer/live.js` (after `refresh();` and `setInterval(refresh, REFRESH_MS);`), append:
```javascript
const rebuildBtn = document.getElementById('rebuild-btn');
rebuildBtn.addEventListener('click', async () => {
  if (!confirm('Пересобрать все группы заново?')) return;
  rebuildBtn.disabled = true;
  const original = rebuildBtn.textContent;
  rebuildBtn.textContent = 'Пересборка…';
  try {
    const resp = await fetch('/rebuild', { method: 'POST' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    await refresh();
  } catch (e) {
    showError('Не удалось пересобрать группы: ' + e.message);
  } finally {
    rebuildBtn.disabled = false;
    rebuildBtn.textContent = original;
  }
});
```

- [ ] **Step 3: Confirm assets are served and unit tests stay green**

The bot (serving the live map) is running from Task 4. Run:
```bash
echo -n "/viewer/live.js -> "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/viewer/live.js
echo -n "/live -> "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/live
npm test 2>&1 | tail -4
```
Expected: both `200`; tests `fail 0`.

- [ ] **Step 4: Manual browser smoke test**

With the bot running, open `http://127.0.0.1:8080/live`:
1. The sidebar shows a "🔄 Пересобрать группы" button.
2. Create several groups via Telegram (TEST_MODE multiple locations). Note the groupings.
3. Add a location that is closer to an existing group's member than its current partner.
4. Click the button → confirm → button shows "Пересборка…", then the map redraws within a moment with tighter groups; no participant that had a group is left grey/alone.
5. Click again with no improvement possible → groups stay the same (no error).

- [ ] **Step 5: Commit**

```bash
git add viewer/live.html viewer/live.js
git commit -m "feat: add rebuild-groups button to live map"
```

---

## Self-Review Notes

- **Spec coverage:** manual button (Task 5); global nearest re-optimization via `optimizeGroups` (Task 1); orphan guarantee via original-group locking (Task 1, tested); no notifications — `store.rebuild` never calls notify and the bot's rebuild handler only saves (Tasks 2, 4); bot process is single state owner serving same-origin `POST /rebuild` (Tasks 3-4); compute-then-apply so a throw leaves state intact (Task 2); empty-state no-op (Tasks 1-2); `GET /rebuild` → 405, missing handler → 404, `input.json` stays 403 (Task 3, tested); button UX with confirm/disable/immediate refresh and error handling (Task 5). All covered.
- **Placeholder scan:** every step has complete code and exact commands; no TBD/TODO.
- **Type/name consistency:** `optimizeGroups(participants, existingGroups, radiusKm, groupSize) → { groups: FormedGroup[]; waitingIds }` used identically in Task 2; `store.rebuild(radiusKm, groupSize) → { changed }` used in Tasks 3-4; `createViewerServer({ rebuild })` with `rebuild: () => Promise<{ changed: number }>` consistent across Tasks 3-4; `FormedGroup`, `Group`, `Participant`, `nextId` reused from existing code.
```
</content>
