import { EventEmitter } from 'node:events';
import type { Check, Incident } from '@prisma/client';
import type { GroupStatus } from '../monitor/groupStatus.js';
import type { DashboardSummary } from '../dashboard/summary.js';

// Everything the UI needs to stay current without refetching lists.
// check.upsert carries either a full check or a partial patch (always with id).
export type LiveEvent =
  | { type: 'check.upsert'; data: Partial<Check> & { id: number } }
  | { type: 'check.deleted'; data: { id: number } }
  | { type: 'check.result'; data: { checkId: number; id: string; checkedAt: Date; isSuccess: boolean; responseTimeMs: number; httpCode: number | null; errorMessage: string | null } }
  | { type: 'incident.opened'; data: Incident }
  | { type: 'incident.closed'; data: Incident }
  | { type: 'incident.updated'; data: Incident }
  | { type: 'group.status'; data: { id: number; status: GroupStatus } }
  | { type: 'groups.changed'; data: Record<string, never> }
  | { type: 'maintenance.changed'; data: Record<string, never> }
  | { type: 'summary'; data: DashboardSummary };

type Listener = (event: LiveEvent) => void;

// In-process pub/sub. One backend process (see DECISIONS.md), so no Redis:
// every SSE connection of this process subscribes here.
class LiveBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(event: LiveEvent) {
    this.emitter.emit('event', event);
  }

  subscribe(listener: Listener): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  get subscriberCount(): number {
    return this.emitter.listenerCount('event');
  }
}

export const bus = new LiveBus();
