import { prisma } from '../db.js';
import { groupStatus } from '../monitor/groupStatus.js';
import type { AppliedResult } from '../monitor/applyResult.js';
import { bus } from './bus.js';

// Publishes everything that follows from one recorded probe result.
export async function publishApplied(applied: AppliedResult) {
  const { check, result, transition, incident } = applied;
  bus.publish({ type: 'check.upsert', data: check });
  bus.publish({ type: 'check.result', data: { ...result, id: result.id.toString() } });

  if (incident && transition?.kind === 'went_down') bus.publish({ type: 'incident.opened', data: incident });
  if (incident && transition?.kind === 'recovered') bus.publish({ type: 'incident.closed', data: incident });

  // Group status only changes when a member's status changes.
  if (transition && check.groupId !== null) await publishGroupStatus(check.groupId);
}

export async function publishGroupStatus(groupId: number) {
  const checks = await prisma.check.findMany({ where: { groupId }, select: { isPaused: true, currentStatus: true } });
  bus.publish({ type: 'group.status', data: { id: groupId, status: groupStatus(checks) } });
}
