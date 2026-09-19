import type { Check } from '@prisma/client';
import type { LiveEvent } from '../live/bus.js';

// What an anonymous visitor may see about a check. Deliberately no URL (it can
// point at internal hosts), no error texts, no timings, no alert settings.
export type PublicStatus = 'up' | 'down' | 'unknown' | 'paused';

export interface PublicCheckPatch {
  id: number;
  name: string;
  status: PublicStatus;
  since: Date | null;
  lastCheckedAt: Date | null;
}

export interface PublicCheck extends PublicCheckPatch {
  group: string | null;
  uptime24h: number | null;
  // Current and upcoming windows (own or via group); the client decides which
  // one is active by the server clock. Notes are internal and not exposed.
  maintenance: { startsAt: Date; endsAt: Date }[];
}

type CheckFields = Pick<Check, 'id' | 'name' | 'isPaused' | 'currentStatus' | 'statusChangedAt' | 'lastCheckedAt'>;

export function toPublicPatch(c: CheckFields): PublicCheckPatch {
  return {
    id: c.id,
    name: c.name,
    status: c.isPaused ? 'paused' : c.currentStatus,
    since: c.statusChangedAt,
    lastCheckedAt: c.lastCheckedAt,
  };
}

export type PublicEvent =
  | { type: 'check'; data: PublicCheckPatch }
  | { type: 'check.removed'; data: { id: number } }
  | { type: 'changed'; data: Record<string, never> };

// Admin bus event -> what the public stream may carry (or null to drop it).
// Only full check rows carry isPublic; partial patches (isRunning flips from
// the scheduler) are dropped, they are of no interest to visitors anyway.
export function toPublicEvent(event: LiveEvent): PublicEvent | null {
  switch (event.type) {
    case 'check.upsert': {
      const c = event.data;
      if (c.isPublic === false) return { type: 'check.removed', data: { id: c.id } };
      if (c.isPublic !== true) return null;
      return { type: 'check', data: toPublicPatch(c as Check) };
    }
    case 'check.deleted':
      return { type: 'check.removed', data: { id: event.data.id } };
    // Renames, group moves, new windows: the page refetches the public list.
    case 'groups.changed':
    case 'maintenance.changed':
      return { type: 'changed', data: {} };
    default:
      // check.result, incident.*, group.status (counts private checks too), summary.
      return null;
  }
}
