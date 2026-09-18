import type { CheckStatus } from '@prisma/client';

// A single failed check is not an outage: it takes this many failures in a row.
export const FAILURE_THRESHOLD = 2;
// One successful check is enough to call the site recovered.
export const RECOVERY_THRESHOLD = 1;

export interface MonitorState {
  currentStatus: CheckStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  failingSince: Date | null;
  statusChangedAt: Date | null;
}

export type Transition =
  | { kind: 'went_down'; startedAt: Date }
  | { kind: 'recovered' }
  | { kind: 'became_up' } // unknown -> up: first data for a new check, not an incident
  | null;

export function evaluate(state: MonitorState, isSuccess: boolean, at: Date): { state: MonitorState; transition: Transition } {
  if (isSuccess) {
    const next: MonitorState = {
      ...state,
      consecutiveFailures: 0,
      consecutiveSuccesses: state.consecutiveSuccesses + 1,
      failingSince: null,
    };
    if (state.currentStatus !== 'up' && next.consecutiveSuccesses >= RECOVERY_THRESHOLD) {
      next.currentStatus = 'up';
      next.statusChangedAt = at;
      return { state: next, transition: { kind: state.currentStatus === 'down' ? 'recovered' : 'became_up' } };
    }
    return { state: next, transition: null };
  }

  const next: MonitorState = {
    ...state,
    consecutiveFailures: state.consecutiveFailures + 1,
    consecutiveSuccesses: 0,
    failingSince: state.failingSince ?? at,
  };
  if (state.currentStatus !== 'down' && next.consecutiveFailures >= FAILURE_THRESHOLD) {
    // The outage started with the first failure of the streak, not when the
    // threshold was crossed: that is when visitors started seeing errors.
    const startedAt = next.failingSince!;
    next.currentStatus = 'down';
    next.statusChangedAt = startedAt;
    return { state: next, transition: { kind: 'went_down', startedAt } };
  }
  return { state: next, transition: null };
}
