import type { CheckStatus } from '@prisma/client';

export type GroupStatus = 'up' | 'down' | 'unknown';

// Group is "down" if any active check is down, "up" only if every active check
// is up. Paused checks are ignored; a group of only paused checks is "unknown".
export function groupStatus(checks: { isPaused: boolean; currentStatus: CheckStatus }[]): GroupStatus {
  const active = checks.filter((c) => !c.isPaused);
  if (active.length === 0) return 'unknown';
  if (active.some((c) => c.currentStatus === 'down')) return 'down';
  if (active.every((c) => c.currentStatus === 'up')) return 'up';
  return 'unknown';
}
