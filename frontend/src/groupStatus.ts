import type { Check, CheckStatus } from './api/types';

// Same rule as backend/src/monitor/groupStatus.ts: paused checks are ignored,
// "down" if any active check is down, "up" only if all active checks are up.
export function groupStatus(checks: Pick<Check, 'isPaused' | 'currentStatus'>[]): CheckStatus {
  const active = checks.filter((c) => !c.isPaused);
  if (active.length === 0) return 'unknown';
  if (active.some((c) => c.currentStatus === 'down')) return 'down';
  if (active.every((c) => c.currentStatus === 'up')) return 'up';
  return 'unknown';
}
