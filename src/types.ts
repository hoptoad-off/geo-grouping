import type { Campus } from './campuses.js';
import type { Language } from './i18n.js';
export type { Language };

/**
 * A single geolocation point loaded from the data source.
 * Extra fields are allowed so DB rows with additional columns
 * can flow through the pipeline unchanged.
 */
export interface GeoPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  [key: string]: any; // extensible for DB fields later
}

/** A cluster of exactly 3 points with its computed centroid and tier. */
export interface GeoGroup {
  groupId: string; // e.g. "group_001"
  points: GeoPoint[]; // always exactly 3 points
  centroid: { lat: number; lng: number };
  distanceToDestination: number; // in kilometers
  tier: 1 | 2 | 3; // 1 = closest (< 5km), 2 = mid (5–10km), 3 = far (10km+)
}

/** The full output document written to data/output.json. */
export interface GroupingResult {
  destination: { lat: number; lng: number };
  tierThresholds: {
    tier1MaxKm: 5; // < 5km → Tier 1
    tier2MaxKm: 10; // 5–10km → Tier 2
    //                 10km+ → Tier 3
  };
  totalGroups: number;
  groups: GeoGroup[];
  unassigned: GeoPoint[]; // remainder points if count not divisible by 3
  generatedAt: string; // ISO timestamp
}

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
  campusId: string;   // which branch this submission targets
  phone: string;      // phone shared via Telegram contact
  language: Language; // recipient's language for notifications
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

/** Persisted onboarding result for one Telegram account. */
export interface UserProfile {
  language: Language;
  campusId: string;
  phone: string;
}

/** Full persisted bot state. */
export interface BotState {
  seq: number; // monotonic counter for id generation
  participants: Participant[];
  groups: Group[];
  profiles: Record<string, UserProfile>; // keyed by telegramUserId (as string)
  campuses: Campus[];                     // written on save for the live map
}
