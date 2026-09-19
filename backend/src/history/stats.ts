import { prisma } from '../db.js';

// Chart ranges. "day" reads raw results (at most ~2.9k rows for a 30 s check);
// week and month read the hourly rollup, so their cost does not grow with the
// check interval or with the number of other checks (see DECISIONS.md, stage 10).
export const RANGES = {
  day: { bucketSec: 15 * 60, buckets: 96, source: 'raw' },
  week: { bucketSec: 60 * 60, buckets: 168, source: 'hourly' },
  month: { bucketSec: 6 * 60 * 60, buckets: 120, source: 'hourly' },
} as const;
export type Range = keyof typeof RANGES;

export interface Bucket {
  t: Date;
  total: number;
  failures: number;
  avgMs: number | null; // successful results only
  maxMs: number | null;
}

interface Row {
  t: Date;
  total: number;
  failures: number;
  sumMsOk: number;
  maxMs: number | null;
}

// Buckets are aligned to a fixed UTC origin, so the grid does not shift
// between requests; the last bucket is the current, partial one.
export function bucketGrid(range: Range, now: Date) {
  const { bucketSec, buckets } = RANGES[range];
  const size = bucketSec * 1000;
  const last = Math.floor(now.getTime() / size) * size;
  return { from: new Date(last - (buckets - 1) * size), to: new Date(last + size), bucketSec, buckets };
}

export async function checkStats(checkId: number, range: Range, now = new Date()) {
  const { from, to, bucketSec } = bucketGrid(range, now);
  const step = `${bucketSec} seconds`;

  // Empty buckets (backend down, check paused) come back as total = 0: a gap,
  // not 100 % or 0 %.
  const rows =
    RANGES[range].source === 'raw'
      ? await prisma.$queryRaw<Row[]>`
          WITH grid AS (SELECT generate_series(${from}::timestamptz, ${to}::timestamptz - ${step}::interval, ${step}::interval) AS t),
          agg AS (
            SELECT date_bin(${step}::interval, checked_at, ${from}::timestamptz) AS t,
                   count(*)::int AS total,
                   (count(*) FILTER (WHERE NOT is_success))::int AS failures,
                   coalesce(sum(response_time_ms) FILTER (WHERE is_success), 0)::float8 AS "sumMsOk",
                   max(response_time_ms) FILTER (WHERE is_success) AS "maxMs"
            FROM check_results
            WHERE check_id = ${checkId} AND checked_at >= ${from} AND checked_at < ${to}
            GROUP BY 1)
          SELECT grid.t, coalesce(total, 0) AS total, coalesce(failures, 0) AS failures, coalesce("sumMsOk", 0) AS "sumMsOk", "maxMs"
          FROM grid LEFT JOIN agg USING (t) ORDER BY grid.t`
      : await prisma.$queryRaw<Row[]>`
          WITH grid AS (SELECT generate_series(${from}::timestamptz, ${to}::timestamptz - ${step}::interval, ${step}::interval) AS t),
          agg AS (
            SELECT date_bin(${step}::interval, hour, ${from}::timestamptz) AS t,
                   sum(total)::int AS total,
                   sum(failures)::int AS failures,
                   sum(sum_ms_ok)::float8 AS "sumMsOk",
                   max(max_ms_ok) AS "maxMs"
            FROM check_results_hourly
            WHERE check_id = ${checkId} AND hour >= ${from} AND hour < ${to}
            GROUP BY 1)
          SELECT grid.t, coalesce(total, 0) AS total, coalesce(failures, 0) AS failures, coalesce("sumMsOk", 0) AS "sumMsOk", "maxMs"
          FROM grid LEFT JOIN agg USING (t) ORDER BY grid.t`;

  const incidents = await prisma.incident.findMany({
    where: { checkId, startedAt: { lt: to }, OR: [{ endedAt: null }, { endedAt: { gt: from } }] },
    select: { startedAt: true, endedAt: true },
  });

  let total = 0;
  let failures = 0;
  let sumMsOk = 0;
  const out: Bucket[] = rows.map((r) => {
    total += r.total;
    failures += r.failures;
    sumMsOk += r.sumMsOk;
    const ok = r.total - r.failures;
    return { t: r.t, total: r.total, failures: r.failures, avgMs: ok > 0 ? Math.round(r.sumMsOk / ok) : null, maxMs: r.maxMs };
  });
  const ok = total - failures;
  // Downtime = confirmed outages (incidents) clipped to the range, not failed
  // probes: a single failure below the threshold is not an outage.
  const end = Math.min(to.getTime(), now.getTime());
  const downtimeMs = incidents.reduce(
    (sum, i) => sum + Math.max(0, Math.min(i.endedAt?.getTime() ?? end, end) - Math.max(i.startedAt.getTime(), from.getTime())),
    0,
  );

  return {
    range,
    bucketSec,
    from,
    to,
    buckets: out,
    totals: {
      checks: total,
      failures,
      uptime: total > 0 ? Math.round((ok / total) * 10000) / 100 : null,
      avgMs: ok > 0 ? Math.round(sumMsOk / ok) : null,
      incidents: incidents.length,
      downtimeSec: Math.round(downtimeMs / 1000),
    },
  };
}
