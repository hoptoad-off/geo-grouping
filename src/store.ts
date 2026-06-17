import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BotState, Participant, Group } from './types.js';
import { findGroups, optimizeGroups } from './matcher.js';

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

  /** Returns the live internal state object — read only, do not mutate. */
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
    const group = this.state.groups.find((g) => g.groupId === groupId);
    if (!group) {
      throw new Error(`Invariant violation: group ${groupId} for participant ${participantId} is missing`);
    }
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

  /** Atomically persists state to disk; concurrent calls are serialized. */
  save(): Promise<void> {
    const attempt = this.writeChain.then(async () => {
      const tmp = `${this.filePath}.tmp`;
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf-8');
      await rename(tmp, this.filePath);
    });
    // Keep the chain resolvable so one failed write doesn't reject all future saves,
    // while still surfacing the error to this caller.
    this.writeChain = attempt.catch(() => {});
    return attempt;
  }
}
