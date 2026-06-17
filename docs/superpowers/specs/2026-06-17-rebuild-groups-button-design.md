# Rebuild-groups button — design

**Date:** 2026-06-17
**Status:** Approved (design), pending implementation plan

## Summary

Add a "Пересобрать группы" button to the live map that re-optimizes all groups
so members end up with their nearest available neighbors, while guaranteeing that
no already-grouped participant is left alone. The rebuild runs in the bot process
(the single owner of state), changes state silently (no Telegram notifications),
and the map reflects the result.

## Goals

- A manual button on the live page that triggers a global re-optimization of groups.
- Tighter groups: if a formed group has a closer available neighbor, regroup using
  the nearest points.
- **Guarantee:** a participant who currently has a group never becomes ungrouped
  ("orphaned") as a result of a rebuild.
- No Telegram notifications on rebuild — changes are visible only on the map.

## Non-goals

- No automatic/periodic rebuild — manual button only. The incremental matcher on
  join/`/leave` is unchanged.
- No notifications, no per-user messaging on rebuild.
- No change to the batch viewer or the bot's command handlers.

## Architecture

Today the bot and the viewer are **separate processes** that both touch
`data/state.json`. If the viewer wrote rebuilt state directly, the bot's
in-memory `Store` would overwrite it on its next save, and two writers could race.
Therefore the rebuild must run **inside the bot process** (the single state owner).

**Decision:** fold live-map serving into the bot process.

- Refactor `src/serve.ts`'s request-handling into a reusable factory
  `createViewerServer(options)` where `options` may include a `Store` and a
  rebuild handler. The standalone batch viewer (`npm run viz`) keeps using it
  without a store (so `/rebuild` is unavailable there).
- `bot.ts` starts this HTTP server on port 8080 alongside long polling, passing
  its live `Store` instance and a rebuild handler.
- The button issues a same-origin `POST /rebuild`; no CSP change needed.
- The live map is now served by `npm run bot`. The standalone `npm run viz`
  remains for the batch viewer (use a different `PORT` if run simultaneously).

This removes the two-writer fragility: one process owns the `Store`, the file,
and the HTTP endpoint.

## Rebuild algorithm

`store.rebuild(radiusKm, groupSize)` delegates the computation to a **pure
function** in `matcher.ts`:

```
optimizeGroups(participants, existingGroups, radiusKm, groupSize)
  → { groups: [{ memberIds, centroid }], waitingIds: string[] }
```

Iterative greedy rebuild with original-group fallback:

1. `pool` = all participants (grouped + waiting). Record `previouslyGrouped`
   (ids currently grouped) and a map id → original group.
2. Run `findGroups(pool, radiusKm, groupSize)` (the existing greedy matcher:
   nearest, all pairwise ≤ radius, seeds ordered by `createdAt`).
3. Find `orphaned` = members of `previouslyGrouped` not placed in any tentative
   group (they would fall into the leftover).
4. If `orphaned` is empty → commit: the tentative groups become the result;
   leftover (only previously-waiting ids) → `waitingIds`. Best case.
5. If non-empty → **lock** the original groups of every orphaned point (those
   whole groups stay intact; their members are removed from `pool`). Re-run from
   step 2 on the remaining pool. Repeat until no new orphans appear.
6. Result = locked original groups + greedily rebuilt groups from the rest;
   `waitingIds` contains only previously-waiting participants.

Properties:
- Worst case: every original group locked → no change (safe).
- Best case: all groups rebuilt tighter.
- Deterministic and conflict-free (locking removes members before re-matching).
- A locked original group stays radius-valid (its members are unchanged and were
  within radius when formed).

`store.rebuild` first computes the full new layout via `optimizeGroups`, and only
then mutates state (group records, each participant's `status`/`groupId`) and
calls `save()`. If the pure function throws, state is left untouched.

## UI and data flow

- A button "🔄 Пересобрать группы" in the `live.html` sidebar, below the
  "Групп/Ожидают" counter.
- On click: `confirm('Пересобрать все группы заново?')`; if confirmed, the button
  is disabled with text "Пересборка…", then `POST /rebuild` is sent. On success
  the page calls `refresh()` immediately (does not wait for the 5 s poll) and
  re-enables the button.
- `POST /rebuild` handler: `store.rebuild(radiusKm, groupSize)` → `store.save()`
  → respond `200 { ok: true, changed: N }` where N is how many groups changed.
  Any non-POST method on `/rebuild` → `405`.
- The map continues polling `GET /data/state.json` every 5 s.

## Error handling / edge cases

- `POST /rebuild` failure (network or server error) → show message in `#error`,
  re-enable the button; state unchanged.
- Empty state (no participants) → rebuild is a no-op, responds
  `200 { ok: true, changed: 0 }`.
- Compute-then-apply ordering ensures a thrown exception during computation never
  leaves state half-modified.
- The `data/` allow-list is unchanged (still only `output.json` and
  `state.json`); `input.json` stays `403`.

## Testing

- **`optimizeGroups`** (pure) — `node:test`: (a) regroups tighter when a closer
  neighbor exists; (b) a point that cannot be safely moved stays in its original
  group; (c) previously-waiting points may end in the leftover, previously-grouped
  points never do; (d) empty / insufficient input returns no groups.
- **`store.rebuild`** — applies the layout, updates `status`/`groupId`, persists;
  re-running with no possible improvement leaves state consistent (idempotent).
- **HTTP `/rebuild`** — the `createViewerServer` factory makes the server
  testable: start it on an ephemeral port with a test `Store`, `POST /rebuild`,
  assert `200` and the mutated state; `GET /rebuild` → `405`; confirm
  `GET /data/input.json` still `403`.
- **`live.js`** button — manual browser verification; the bot's existing unit
  tests stay green.

## Open decisions

None.
</content>
