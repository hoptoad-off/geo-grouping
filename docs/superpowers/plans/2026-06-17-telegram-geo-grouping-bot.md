# Telegram Geo-Grouping Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the batch geo-grouping pipeline into a live Telegram bot that collects user locations, forms trios where all members are within 5 km of each other, notifies them, and re-matches when a member leaves.

**Architecture:** grammY bot (long polling) over a JSON-file state store. Pure `matcher` performs radius-constrained grouping reusing existing `haversineKm`/`computeCentroid`. `store` owns persistence + orchestration (`joinAndMatch`, `leave`); `bot.ts` is a thin handler layer; `notify` formats/sends messages tolerating failures. The existing batch pipeline and Leaflet viewer are left untouched.

**Tech Stack:** TypeScript (ESM, NodeNext), Node 24, grammY, dotenv, `node:test` via `tsx`.

---

## File Structure

- `src/config.ts` (new) — load + validate `.env` into a typed config.
- `src/types.ts` (modify) — add `Participant`, `Group`, `BotState`.
- `src/grouping.ts` (modify) — widen `computeCentroid` parameter type so it accepts `Participant`.
- `src/matcher.ts` (new) — pure radius-constrained grouping (`findGroups`).
- `src/store.ts` (new) — JSON state load/save (atomic, queued) + `joinAndMatch` / `leave`.
- `src/notify.ts` (new) — `safeSend`, `formatGroupFormed`.
- `src/bot.ts` (new) — grammY bot, command/location handlers (entry point).
- Tests: `src/config.test.ts`, `src/matcher.test.ts`, `src/store.test.ts`, `src/notify.test.ts`.
- `.env.example` (new), `package.json` / `tsconfig.json` / `.gitignore` (modify).

---

## Task 1: Project setup

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Install runtime dependencies**

Run:
```bash
npm install grammy dotenv
```
Expected: `grammy` and `dotenv` added to `dependencies` in `package.json`.

- [ ] **Step 2: Add scripts to `package.json`**

In the `"scripts"` block, add `bot` and `test` so it becomes:
```json
  "scripts": {
    "start": "tsx src/index.ts",
    "viz": "tsx src/serve.ts",
    "build": "tsc",
    "bot": "tsx src/bot.ts",
    "test": "node --import tsx --test \"src/**/*.test.ts\""
  },
```

- [ ] **Step 3: Exclude test files from `tsc` build**

In `tsconfig.json`, add a top-level `"exclude"` key (sibling of `"include"`):
```json
  "include": ["src/**/*"],
  "exclude": ["**/*.test.ts"]
```

- [ ] **Step 4: Update `.gitignore`**

Append two lines so the file reads:
```
node_modules/
dist/
.env
data/state.json
```

- [ ] **Step 5: Create `.env.example`**

Create `.env.example`:
```
# Telegram bot token from @BotFather
BOT_TOKEN=

# Max pairwise distance (km) for a group to form
GROUP_RADIUS_KM=5

# Members per group
GROUP_SIZE=3

# true = one account may submit multiple locations (each = a separate participant)
TEST_MODE=true
```

- [ ] **Step 6: Verify install + build**

Run:
```bash
npm run build
```
Expected: build succeeds (no errors). `grammy`/`dotenv` present under `node_modules`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore .env.example
git commit -m "chore: add grammy/dotenv deps and bot scripts"
```

---

## Task 2: Domain types + computeCentroid widening

**Files:**
- Modify: `src/types.ts`
- Modify: `src/grouping.ts:47`

- [ ] **Step 1: Add bot types to `src/types.ts`**

Append to the end of `src/types.ts`:
```typescript
/** Status of a participant in the matching lifecycle. */
export type ParticipantStatus = 'waiting' | 'grouped';

/** One location submission from a Telegram user awaiting or in a group. */
export interface Participant {
  id: string; // e.g. "u_007"
  telegramUserId: number;
  chatId: number;
  displayName: string;
  lat: number;
  lng: number;
  status: ParticipantStatus;
  groupId: string | null; // set only when status === 'grouped'
  createdAt: string; // ISO timestamp
}

/** A formed group of participants. */
export interface Group {
  groupId: string; // e.g. "group_001"
  memberIds: string[];
  centroid: { lat: number; lng: number };
  createdAt: string; // ISO timestamp
}

/** Full persisted bot state. */
export interface BotState {
  seq: number; // monotonic counter for id generation
  participants: Participant[];
  groups: Group[];
}
```

- [ ] **Step 2: Widen `computeCentroid` in `src/grouping.ts`**

Replace the signature line (currently `src/grouping.ts:47`):
```typescript
export function computeCentroid(points: GeoPoint[]): { lat: number; lng: number } {
```
with:
```typescript
export function computeCentroid(
  points: ReadonlyArray<{ lat: number; lng: number }>
): { lat: number; lng: number } {
```
(The body is unchanged — it only reads `lat`/`lng`. `GeoPoint` still satisfies the wider type, so existing callers keep working.)

- [ ] **Step 3: Verify it still type-checks**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/grouping.ts
git commit -m "feat: add bot domain types; widen computeCentroid input"
```

---

## Task 3: Config module

**Files:**
- Create: `src/config.ts`
- Test: `src/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/config.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.js';

test('loadConfig throws without BOT_TOKEN', () => {
  assert.throws(() => loadConfig({}), /BOT_TOKEN/);
});

test('loadConfig applies defaults', () => {
  const c = loadConfig({ BOT_TOKEN: 'x' });
  assert.equal(c.botToken, 'x');
  assert.equal(c.groupRadiusKm, 5);
  assert.equal(c.groupSize, 3);
  assert.equal(c.testMode, true);
});

test('loadConfig reads overrides', () => {
  const c = loadConfig({
    BOT_TOKEN: 'x',
    GROUP_RADIUS_KM: '2',
    GROUP_SIZE: '4',
    TEST_MODE: 'false',
  });
  assert.equal(c.groupRadiusKm, 2);
  assert.equal(c.groupSize, 4);
  assert.equal(c.testMode, false);
});

test('loadConfig rejects invalid radius', () => {
  assert.throws(() => loadConfig({ BOT_TOKEN: 'x', GROUP_RADIUS_KM: '0' }), /GROUP_RADIUS_KM/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
node --import tsx --test src/config.test.ts
```
Expected: FAIL — cannot find module `./config.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/config.ts`:
```typescript
import 'dotenv/config';

/** Typed, validated bot configuration. */
export interface BotConfig {
  botToken: string;
  groupRadiusKm: number;
  groupSize: number;
  testMode: boolean;
}

/**
 * Loads and validates configuration from environment variables.
 *
 * @param env - Environment source (defaults to process.env; injectable for tests).
 * @returns Validated BotConfig.
 * @throws If BOT_TOKEN is missing or numeric values are invalid.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const botToken = env.BOT_TOKEN;
  if (!botToken) {
    throw new Error('BOT_TOKEN is required');
  }

  const groupRadiusKm = env.GROUP_RADIUS_KM ? Number(env.GROUP_RADIUS_KM) : 5;
  if (!Number.isFinite(groupRadiusKm) || groupRadiusKm <= 0) {
    throw new Error('GROUP_RADIUS_KM must be a positive number');
  }

  const groupSize = env.GROUP_SIZE ? Number(env.GROUP_SIZE) : 3;
  if (!Number.isInteger(groupSize) || groupSize < 2) {
    throw new Error('GROUP_SIZE must be an integer >= 2');
  }

  const testMode = env.TEST_MODE !== 'false';

  return { botToken, groupRadiusKm, groupSize, testMode };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
node --import tsx --test src/config.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat: add config module with env validation"
```

---

## Task 4: Matcher (radius-constrained grouping)

**Files:**
- Create: `src/matcher.ts`
- Test: `src/matcher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/matcher.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findGroups } from './matcher.js';
import type { Participant } from './types.js';

function p(id: string, lat: number, lng: number, createdAt: string): Participant {
  return {
    id,
    telegramUserId: 1,
    chatId: 1,
    displayName: id,
    lat,
    lng,
    status: 'waiting',
    groupId: null,
    createdAt,
  };
}

const T = (n: number) => `2026-01-01T00:00:0${n}.000Z`;

test('forms a group when three are within radius', () => {
  const waiting = [
    p('a', 41.30, 69.28, T(1)),
    p('b', 41.31, 69.28, T(2)),
    p('c', 41.30, 69.29, T(3)),
  ];
  const groups = findGroups(waiting, 5, 3);
  assert.equal(groups.length, 1);
  assert.deepEqual([...groups[0].memberIds].sort(), ['a', 'b', 'c']);
});

test('forms no group when one member is out of radius', () => {
  const waiting = [
    p('a', 41.30, 69.28, T(1)),
    p('b', 41.31, 69.28, T(2)),
    p('f', 41.50, 69.28, T(3)), // ~22 km away
  ];
  assert.equal(findGroups(waiting, 5, 3).length, 0);
});

test('skips a seed without partners but groups the rest', () => {
  const waiting = [
    p('f', 41.50, 69.28, T(0)), // earliest, far from everyone
    p('a', 41.30, 69.28, T(1)),
    p('b', 41.31, 69.28, T(2)),
    p('c', 41.30, 69.29, T(3)),
  ];
  const groups = findGroups(waiting, 5, 3);
  assert.equal(groups.length, 1);
  assert.ok(!groups[0].memberIds.includes('f'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
node --import tsx --test src/matcher.test.ts
```
Expected: FAIL — cannot find module `./matcher.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/matcher.ts`:
```typescript
import type { Participant } from './types.js';
import { haversineKm, computeCentroid } from './grouping.js';

/** A group proposed by the matcher, before persistence. */
export interface FormedGroup {
  memberIds: string[];
  centroid: { lat: number; lng: number };
}

/**
 * Greedily builds one group around a seed: adds the nearest candidates that are
 * within `radiusKm` of EVERY current member, until the group reaches groupSize.
 *
 * @returns The members (length === groupSize) or null if no valid group exists.
 */
function buildGroup(
  seed: Participant,
  candidates: Participant[],
  radiusKm: number,
  groupSize: number
): Participant[] | null {
  const near = candidates
    .filter((c) => haversineKm(seed.lat, seed.lng, c.lat, c.lng) <= radiusKm)
    .sort(
      (a, b) =>
        haversineKm(seed.lat, seed.lng, a.lat, a.lng) -
        haversineKm(seed.lat, seed.lng, b.lat, b.lng)
    );

  const members: Participant[] = [seed];
  for (const c of near) {
    if (members.length >= groupSize) break;
    const okWithAll = members.every(
      (m) => haversineKm(m.lat, m.lng, c.lat, c.lng) <= radiusKm
    );
    if (okWithAll) members.push(c);
  }

  return members.length === groupSize ? members : null;
}

/**
 * Finds groups among waiting participants where all pairwise distances within a
 * group are <= radiusKm. Seeds are tried in createdAt order (oldest first);
 * a seed with no valid partners is left waiting.
 *
 * @param waiting - Participants with status 'waiting'.
 * @param radiusKm - Maximum allowed pairwise distance.
 * @param groupSize - Required members per group.
 * @returns Newly formed groups (each with memberIds and centroid).
 */
export function findGroups(
  waiting: Participant[],
  radiusKm: number,
  groupSize: number
): FormedGroup[] {
  const pool = [...waiting].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const used = new Set<string>();
  const result: FormedGroup[] = [];

  for (const seed of pool) {
    if (used.has(seed.id)) continue;
    const candidates = pool.filter((c) => c.id !== seed.id && !used.has(c.id));
    const members = buildGroup(seed, candidates, radiusKm, groupSize);
    if (members) {
      for (const m of members) used.add(m.id);
      result.push({
        memberIds: members.map((m) => m.id),
        centroid: computeCentroid(members),
      });
    }
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
node --import tsx --test src/matcher.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/matcher.ts src/matcher.test.ts
git commit -m "feat: add radius-constrained group matcher"
```

---

## Task 5: Store (state persistence + orchestration)

**Files:**
- Create: `src/store.ts`
- Test: `src/store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/store.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import type { NewParticipant } from './store.js';

function np(lat: number, lng: number, uid = 1): NewParticipant {
  return { telegramUserId: uid, chatId: uid, displayName: `u${uid}`, lat, lng };
}

function tmpPath(): string {
  return path.join(tmpdir(), `state-${randomUUID()}.json`);
}

test('load returns empty state for a missing file', async () => {
  const store = await Store.load(tmpPath());
  assert.deepEqual(store.getState(), { seq: 0, participants: [], groups: [] });
});

test('joinAndMatch forms a group once three are close', async () => {
  const store = await Store.load(tmpPath());
  store.joinAndMatch(np(41.30, 69.28), 5, 3);
  store.joinAndMatch(np(41.31, 69.28), 5, 3);
  const third = store.joinAndMatch(np(41.30, 69.29), 5, 3);
  assert.equal(third.formedGroups.length, 1);
  assert.equal(third.formedGroups[0].members.length, 3);
  assert.ok(store.getState().participants.every((p) => p.status === 'grouped'));
});

test('save then load round-trips state', async () => {
  const file = tmpPath();
  const store = await Store.load(file);
  store.joinAndMatch(np(41.30, 69.28), 5, 3);
  await store.save();
  const reloaded = await Store.load(file);
  assert.equal(reloaded.getState().participants.length, 1);
});

test('leave by a grouped member dissolves the group and re-queues others', async () => {
  const store = await Store.load(tmpPath());
  const a = store.joinAndMatch(np(41.30, 69.28), 5, 3).participant;
  store.joinAndMatch(np(41.31, 69.28), 5, 3);
  store.joinAndMatch(np(41.30, 69.29), 5, 3);

  const result = store.leave(a.id, 5, 3);
  assert.equal(result.removed?.id, a.id);
  assert.ok(result.dissolvedGroup);
  assert.equal(result.dissolvedGroup!.notifiedMembers.length, 2);
  assert.equal(store.getState().groups.length, 0);
  assert.ok(
    store.getState().participants.every((p) => p.status === 'waiting' && p.groupId === null)
  );
});

test('leave triggers re-grouping when enough remain', async () => {
  const store = await Store.load(tmpPath());
  const a = store.joinAndMatch(np(41.30, 69.28), 5, 3).participant;
  store.joinAndMatch(np(41.31, 69.28), 5, 3);
  store.joinAndMatch(np(41.30, 69.29), 5, 3);
  store.joinAndMatch(np(41.31, 69.29), 5, 3); // 4th, waiting

  const result = store.leave(a.id, 5, 3);
  assert.equal(result.formedGroups.length, 1); // remaining 3 regroup
});

test('leave by a waiting member just removes them', async () => {
  const store = await Store.load(tmpPath());
  const a = store.joinAndMatch(np(41.30, 69.28), 5, 3).participant;
  const result = store.leave(a.id, 5, 3);
  assert.equal(result.dissolvedGroup, null);
  assert.equal(store.getState().participants.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
node --import tsx --test src/store.test.ts
```
Expected: FAIL — cannot find module `./store.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/store.ts`:
```typescript
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BotState, Participant, Group } from './types.js';
import { findGroups } from './matcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, '../data/state.json');

/** Fields needed to create a participant (ids/timestamps assigned by the store). */
export interface NewParticipant {
  telegramUserId: number;
  chatId: number;
  displayName: string;
  lat: number;
  lng: number;
}

/** A persisted group together with its resolved member participants. */
export interface GroupWithMembers {
  group: Group;
  members: Participant[];
}

/** Result of adding a participant and running the matcher. */
export interface JoinResult {
  participant: Participant;
  formedGroups: GroupWithMembers[];
}

/** Result of a participant leaving. */
export interface LeaveResult {
  removed: Participant | null;
  dissolvedGroup: { group: Group; notifiedMembers: Participant[] } | null;
  formedGroups: GroupWithMembers[];
}

/**
 * In-memory bot state with atomic, serialized JSON persistence.
 * Mutating methods change state synchronously; call `save()` to persist.
 */
export class Store {
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(
    private state: BotState,
    private readonly filePath: string
  ) {}

  /**
   * Loads state from disk, or starts empty if the file does not exist.
   */
  static async load(filePath: string = DEFAULT_PATH): Promise<Store> {
    let state: BotState;
    try {
      const raw = await readFile(filePath, 'utf-8');
      state = JSON.parse(raw) as BotState;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        state = { seq: 0, participants: [], groups: [] };
      } else {
        throw err;
      }
    }
    return new Store(state, filePath);
  }

  getState(): BotState {
    return this.state;
  }

  private nextId(prefix: string): string {
    this.state.seq += 1;
    return `${prefix}_${String(this.state.seq).padStart(3, '0')}`;
  }

  private byId(id: string): Participant | null {
    return this.state.participants.find((p) => p.id === id) ?? null;
  }

  private waiting(): Participant[] {
    return this.state.participants.filter((p) => p.status === 'waiting');
  }

  /** All participants belonging to a given Telegram account. */
  participantsByUser(telegramUserId: number): Participant[] {
    return this.state.participants.filter((p) => p.telegramUserId === telegramUserId);
  }

  /** Drops a user's waiting participants (used in non-test mode to enforce one location). */
  removeWaitingByUser(telegramUserId: number): void {
    this.state.participants = this.state.participants.filter(
      (p) => !(p.telegramUserId === telegramUserId && p.status === 'waiting')
    );
  }

  /** Runs the matcher over the waiting pool, persisting any new groups in memory. */
  private runMatch(radiusKm: number, groupSize: number): GroupWithMembers[] {
    const formed = findGroups(this.waiting(), radiusKm, groupSize);
    const result: GroupWithMembers[] = [];
    for (const fg of formed) {
      const groupId = this.nextId('group');
      const members = fg.memberIds
        .map((id) => this.byId(id))
        .filter((p): p is Participant => p !== null);
      const group: Group = {
        groupId,
        memberIds: fg.memberIds,
        centroid: fg.centroid,
        createdAt: new Date().toISOString(),
      };
      this.state.groups.push(group);
      for (const m of members) {
        m.status = 'grouped';
        m.groupId = groupId;
      }
      result.push({ group, members });
    }
    return result;
  }

  /** Adds a participant (waiting) and runs the matcher. */
  joinAndMatch(input: NewParticipant, radiusKm: number, groupSize: number): JoinResult {
    const participant: Participant = {
      id: this.nextId('u'),
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      displayName: input.displayName,
      lat: input.lat,
      lng: input.lng,
      status: 'waiting',
      groupId: null,
      createdAt: new Date().toISOString(),
    };
    this.state.participants.push(participant);
    const formedGroups = this.runMatch(radiusKm, groupSize);
    return { participant, formedGroups };
  }

  /**
   * Removes a participant. If they were grouped, dissolves the group, re-queues
   * the other members, and re-runs the matcher.
   */
  leave(participantId: string, radiusKm: number, groupSize: number): LeaveResult {
    const participant = this.byId(participantId);
    if (!participant) {
      return { removed: null, dissolvedGroup: null, formedGroups: [] };
    }

    if (participant.status === 'waiting') {
      this.state.participants = this.state.participants.filter((p) => p.id !== participantId);
      return { removed: participant, dissolvedGroup: null, formedGroups: [] };
    }

    const groupId = participant.groupId!;
    const group = this.state.groups.find((g) => g.groupId === groupId)!;
    const others = this.state.participants.filter(
      (p) => p.groupId === groupId && p.id !== participantId
    );
    for (const o of others) {
      o.status = 'waiting';
      o.groupId = null;
    }
    this.state.groups = this.state.groups.filter((g) => g.groupId !== groupId);
    this.state.participants = this.state.participants.filter((p) => p.id !== participantId);

    const formedGroups = this.runMatch(radiusKm, groupSize);
    return {
      removed: participant,
      dissolvedGroup: { group, notifiedMembers: others },
      formedGroups,
    };
  }

  /** Atomically persists state to disk; concurrent calls are serialized. */
  async save(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const tmp = `${this.filePath}.tmp`;
      await writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf-8');
      await rename(tmp, this.filePath);
    });
    return this.writeChain;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
node --import tsx --test src/store.test.ts
```
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store.ts src/store.test.ts
git commit -m "feat: add JSON state store with join/leave orchestration"
```

---

## Task 6: Notify helpers

**Files:**
- Create: `src/notify.ts`
- Test: `src/notify.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/notify.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatGroupFormed, safeSend } from './notify.js';
import type { Participant } from './types.js';

function p(id: string, lat: number, lng: number, name: string): Participant {
  return {
    id,
    telegramUserId: 1,
    chatId: 1,
    displayName: name,
    lat,
    lng,
    status: 'grouped',
    groupId: 'group_001',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

test('formatGroupFormed lists the other members with distances', () => {
  const self = p('a', 41.30, 69.28, 'Alice');
  const other = p('b', 41.31, 69.28, 'Bob');
  const text = formatGroupFormed([self, other], self);
  assert.match(text, /Bob/);
  assert.match(text, /км/);
  assert.ok(!text.includes('Alice')); // self excluded
});

test('safeSend swallows send errors', async () => {
  const api = {
    sendMessage: async () => {
      throw new Error('blocked by user');
    },
  } as never;
  await safeSend(api, 1, 'hi'); // must not throw
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
node --import tsx --test src/notify.test.ts
```
Expected: FAIL — cannot find module `./notify.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/notify.ts`:
```typescript
import type { Api, RawApi } from 'grammy';
import type { Participant } from './types.js';
import { haversineKm } from './grouping.js';

type BotApi = Api<RawApi>;

/**
 * Sends a message, logging and swallowing any failure (e.g. user blocked the bot)
 * so one bad recipient never crashes the handler.
 */
export async function safeSend(api: BotApi, chatId: number, text: string): Promise<void> {
  try {
    await api.sendMessage(chatId, text);
  } catch (err) {
    console.error(
      `Failed to send message to ${chatId}:`,
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Builds the "group formed" message from one member's perspective, listing the
 * other members and their distance from `self`.
 */
export function formatGroupFormed(members: Participant[], self: Participant): string {
  const lines = members
    .filter((m) => m.id !== self.id)
    .map((o) => `• ${o.displayName} — ${haversineKm(self.lat, self.lng, o.lat, o.lng).toFixed(1)} км`);
  return `✅ Группа собрана!\nВаши соседи:\n${lines.join('\n')}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
node --import tsx --test src/notify.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notify.ts src/notify.test.ts
git commit -m "feat: add notification helpers"
```

---

## Task 7: Bot wiring + verification

**Files:**
- Create: `src/bot.ts`
- Modify: `package.json` (README note optional)

- [ ] **Step 1: Implement the bot**

Create `src/bot.ts`:
```typescript
import { Bot, Keyboard } from 'grammy';
import type { Api, RawApi } from 'grammy';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import type { GroupWithMembers } from './store.js';
import { formatGroupFormed, safeSend } from './notify.js';

const config = loadConfig();
const store = await Store.load();
const bot = new Bot(config.botToken);

const locationKeyboard = new Keyboard()
  .requestLocation('📍 Отправить геолокацию')
  .resized();

/** Notifies every member of each freshly formed group, from their own perspective. */
async function notifyFormed(api: Api<RawApi>, formed: GroupWithMembers[]): Promise<void> {
  for (const { members } of formed) {
    for (const member of members) {
      await safeSend(api, member.chatId, formatGroupFormed(members, member));
    }
  }
}

bot.command('start', async (ctx) => {
  await ctx.reply(
    'Привет! Отправьте свою геолокацию кнопкой ниже, и я подберу вам группу из 3 человек поблизости.\n\n' +
      'Команды:\n/leave — выйти\n/status — мой статус\n/reset — удалить все мои локации',
    { reply_markup: locationKeyboard }
  );
});

bot.on('message:location', async (ctx) => {
  const loc = ctx.message.location;
  if (
    !Number.isFinite(loc.latitude) ||
    !Number.isFinite(loc.longitude) ||
    loc.latitude < -90 ||
    loc.latitude > 90 ||
    loc.longitude < -180 ||
    loc.longitude > 180
  ) {
    await ctx.reply('Не удалось распознать координаты, попробуйте ещё раз.');
    return;
  }

  const uid = ctx.from.id;
  if (!config.testMode) {
    store.removeWaitingByUser(uid);
  }

  const { formedGroups } = store.joinAndMatch(
    {
      telegramUserId: uid,
      chatId: ctx.chat.id,
      displayName: ctx.from.first_name ?? 'User',
      lat: loc.latitude,
      lng: loc.longitude,
    },
    config.groupRadiusKm,
    config.groupSize
  );
  await store.save();

  if (formedGroups.length === 0) {
    await ctx.reply('📍 Локация принята! Ищем для вас группу…');
  }
  await notifyFormed(ctx.api, formedGroups);
});

bot.command('leave', async (ctx) => {
  const mine = store.participantsByUser(ctx.from.id);
  if (mine.length === 0) {
    await ctx.reply('У вас нет активных локаций.');
    return;
  }
  const latest = mine.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
  const result = store.leave(latest.id, config.groupRadiusKm, config.groupSize);
  await store.save();

  await ctx.reply('Вы вышли. ' + (result.dissolvedGroup ? 'Ваша группа распущена.' : ''));
  if (result.dissolvedGroup) {
    for (const m of result.dissolvedGroup.notifiedMembers) {
      await safeSend(ctx.api, m.chatId, '⚠️ Группа распалась. Ищем для вас новую…');
    }
  }
  await notifyFormed(ctx.api, result.formedGroups);
});

bot.command('status', async (ctx) => {
  const mine = store.participantsByUser(ctx.from.id);
  if (mine.length === 0) {
    await ctx.reply('У вас нет активных локаций. Отправьте геолокацию, чтобы начать.');
    return;
  }
  const lines = mine.map(
    (p) => `${p.id}: ${p.status === 'grouped' ? `в группе ${p.groupId}` : 'в очереди'}`
  );
  await ctx.reply('Ваш статус:\n' + lines.join('\n'));
});

bot.command('reset', async (ctx) => {
  const mine = store.participantsByUser(ctx.from.id);
  for (const p of mine) {
    const result = store.leave(p.id, config.groupRadiusKm, config.groupSize);
    if (result.dissolvedGroup) {
      for (const m of result.dissolvedGroup.notifiedMembers) {
        await safeSend(ctx.api, m.chatId, '⚠️ Группа распалась. Ищем для вас новую…');
      }
    }
    await notifyFormed(ctx.api, result.formedGroups);
  }
  await store.save();
  await ctx.reply('Все ваши локации удалены.');
});

bot.catch((err) => {
  console.error('Bot error:', err);
});

console.log('Bot starting (long polling)…');
await bot.start();
```

- [ ] **Step 2: Type-check the whole project**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Run the full test suite**

Run:
```bash
npm test
```
Expected: all tests across config/matcher/store/notify PASS.

- [ ] **Step 4: Manual smoke test**

1. Create `.env` from `.env.example` and set `BOT_TOKEN` to a real token from @BotFather.
2. Run `npm run bot`. Expected console: `Bot starting (long polling)…`.
3. In Telegram: send `/start` → bot replies with the location keyboard.
4. Send a location → "📍 Локация принята! Ищем для вас группу…".
5. Send two more locations within 5 km (TEST_MODE=true allows this from one account) → all three virtual participants receive "✅ Группа собрана!" with neighbour distances.
6. Send `/leave` → "Ваша группа распущена."; the other two participants receive "⚠️ Группа распалась…".
7. Check `data/state.json` reflects the changes; restart the bot and confirm `/status` still shows remaining participants (persistence).

- [ ] **Step 5: Commit**

```bash
git add src/bot.ts
git commit -m "feat: add Telegram bot handlers (start/location/leave/status/reset)"
```

---

## Self-Review Notes

- **Spec coverage:** collect locations (Task 7 location handler); radius-constrained trios (Task 4); notify on formation (Task 7 `notifyFormed`); `/leave` dissolves + re-matches + notifies (Task 5 `leave`, Task 7 handler); persistence across restart (Task 5 store + save); TEST_MODE multiple participants (Task 7 conditional `removeWaitingByUser`); config via `.env` (Task 3); coordinate validation (Task 7 handler); `/reset` clears all (Task 7). All covered.
- **Types consistent:** `Participant`, `Group`, `BotState` (Task 2) used identically in matcher/store/notify/bot. `findGroups(waiting, radiusKm, groupSize)`, `joinAndMatch`, `leave`, `GroupWithMembers`, `formatGroupFormed(members, self)`, `safeSend(api, chatId, text)` names match across tasks.
- **No placeholders:** every code/test step contains complete code and exact commands.
```
