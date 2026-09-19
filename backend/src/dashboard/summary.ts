import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../db.js';
import { bus, type LiveEvent } from '../live/bus.js';
import { openStreamCount } from '../live/stream.js';

export interface DashboardSummary {
  total: number;
  up: number;
  down: number;
  paused: number;
  // Active checks without a verdict yet (new, or below the failure threshold).
  unknown: number;
  // Mean of per-check uptime over the last 24 h (whole hours), in percent; null without results.
  uptime24h: number | null;
  computedAt: Date;
}

const DAY_MS = 24 * 60 * 60_000;

// Counts use the same rule as group status: paused checks are neither up nor down.
export async function computeSummary(): Promise<DashboardSummary> {
  const since = new Date(Date.now() - DAY_MS);
  const [checks, [{ uptime }]] = await Promise.all([
    prisma.check.findMany({ select: { isPaused: true, currentStatus: true } }),
    // Per-check uptime first, then the mean, so a 30 s check does not outweigh
    // an hourly one. Reads the hourly rollup: 24–25 rows per check whatever the
    // interval; the window is the last 24 whole hours plus the current one.
    prisma.$queryRaw<{ uptime: number | null }[]>`
      SELECT avg(u)::float8 AS uptime FROM (
        SELECT 1 - sum(failures)::float8 / sum(total) AS u
        FROM check_results_hourly
        WHERE hour >= date_trunc('hour', ${since}::timestamptz, 'UTC')
        GROUP BY check_id
      ) per_check`,
  ]);
  const active = checks.filter((c) => !c.isPaused);
  return {
    total: checks.length,
    up: active.filter((c) => c.currentStatus === 'up').length,
    down: active.filter((c) => c.currentStatus === 'down').length,
    paused: checks.length - active.length,
    unknown: active.filter((c) => c.currentStatus === 'unknown').length,
    uptime24h: uptime === null ? null : Math.round(uptime * 10000) / 100,
    computedAt: new Date(),
  };
}

const TRIGGERS = new Set<LiveEvent['type']>(['check.upsert', 'check.deleted', 'check.result']);
// Results arrive every few ms under load: recompute at most this often.
const MIN_INTERVAL_MS = 3000;

// Listens to the bus and republishes a fresh summary as a `summary` event.
// The first change is published right away, later ones are coalesced.
export function startSummaryPublisher(log: FastifyBaseLogger): () => void {
  let timer: NodeJS.Timeout | null = null;
  let lastRun = 0;

  const run = async () => {
    timer = null;
    lastRun = Date.now();
    try {
      bus.publish({ type: 'summary', data: await computeSummary() });
    } catch (err) {
      log.error({ err }, 'dashboard summary failed');
    }
  };

  const unsubscribe = bus.subscribe((event) => {
    if (!TRIGGERS.has(event.type) || timer) return;
    // No open dashboards: nothing to compute. A dashboard that connects later
    // fetches the summary itself.
    if (openStreamCount() === 0) return;
    timer = setTimeout(() => void run(), Math.max(0, lastRun + MIN_INTERVAL_MS - Date.now()));
  });

  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}
