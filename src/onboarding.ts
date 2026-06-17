import type { Language } from './i18n.js';
import type { UserProfile } from './types.js';

export type Step = 'language' | 'campus' | 'phone' | 'ready';

export interface OnboardingState {
  step: Step;
  language?: Language;
  campusId?: string;
  phone?: string;
}

export type OnboardingEvent =
  | { type: 'language'; value: Language }
  | { type: 'campus'; value: string }
  | { type: 'phone'; value: string };

export interface AdvanceResult {
  state: OnboardingState;
  profile?: UserProfile; // set only on transition into 'ready'
}

/** Begins a fresh onboarding at the language step. */
export function startOnboarding(): OnboardingState {
  return { step: 'language' };
}

/**
 * Pure transition: applies an event to the current step. Events that don't match the
 * expected step are ignored (state unchanged). Reaching 'ready' yields the profile.
 */
export function advance(state: OnboardingState, event: OnboardingEvent): AdvanceResult {
  switch (state.step) {
    case 'language':
      if (event.type !== 'language') return { state };
      return { state: { ...state, step: 'campus', language: event.value } };
    case 'campus':
      if (event.type !== 'campus') return { state };
      return { state: { ...state, step: 'phone', campusId: event.value } };
    case 'phone': {
      if (event.type !== 'phone') return { state };
      const next: OnboardingState = { ...state, step: 'ready', phone: event.value };
      return {
        state: next,
        profile: { language: next.language!, campusId: next.campusId!, phone: next.phone! },
      };
    }
    case 'ready':
      return { state };
  }
}
