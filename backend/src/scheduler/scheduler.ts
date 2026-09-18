import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../db.js';
import { applyResult } from '../monitor/applyResult.js';
import { httpProbe } from './httpProbe.js';
import { computeNextRunAt } from './nextRun.js';

interface ClaimedCheck {
  id: number;
  url: string;
  intervalSec: number;
  timeoutMs: number;
  expectedStatus: number;
  expectedBodySubstring: string | null;
  scheduledAt: Date;
}

interface RunSample {
  at: number;
  checkId: number;
  lagMs: number;
  durationMs: number;
}

const TICK_MS = 1000;
// Upper bound for simultaneously running probes (sockets), far above 50 checks.
const MAX_IN_FLIGHT = 500;
// A lock older than timeout + this grace is considered abandoned.
const STALE_LOCK_GRACE_MS = 60_000;
const STATS_WINDOW_MS = 5 * 60_000;

const CLAIM_COLUMNS = `
  c.id, c.url,
  c.interval_sec AS "intervalSec",
  c.timeout_ms AS "timeoutMs",
  c.expected_status AS "expectedStatus",
  c.expected_body_substring AS "expectedBodySubstring",
  c.next_run_at AS "scheduledAt"`;

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private readonly inFlight = new Map<number, AbortController>();
  private samples: RunSample[] = [];
  private runsTotal = 0;

  constructor(private readonly log: FastifyBaseLogger) {}

  async start() {
    // Single backend instance: any lock left in the DB belongs to a previous
    // process that died mid-check, so it is safe to release all of them.
    const released = await prisma.check.updateMany({
      where: { isRunning: true },
      data: { isRunning: false, lockedAt: null },
    });
    if (released.count > 0) this.log.warn({ released: released.count }, 'released locks left by previous process');

    this.stopped = false;
    this.loop();
    this.log.info('scheduler started');
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    const ids = [...this.inFlight.keys()];
    // Aborted probes are not recorded: an interrupted check is a gap, not a failure.
    for (const controller of this.inFlight.values()) controller.abort();
    if (ids.length > 0) {
      await prisma.check.updateMany({ where: { id: { in: ids } }, data: { isRunning: false, lockedAt: null } });
    }
    this.log.info({ aborted: ids.length }, 'scheduler stopped');
  }

  // Next tick is scheduled only after the current one finished, so ticks of
  // this process never overlap even if the DB is slow.
  private loop() {
    if (this.stopped) return;
    this.tick()
      .catch((err) => this.log.error({ err }, 'scheduler tick failed'))
      .finally(() => {
        if (!this.stopped) this.timer = setTimeout(() => this.loop(), TICK_MS);
      });
  }

  private async tick() {
    const free = MAX_IN_FLIGHT - this.inFlight.size;
    if (free <= 0) return;
    for (const check of await this.claimDue(free)) {
      // Fire and forget: the tick never waits for a probe.
      void this.execute(check, false);
    }
  }

  // Claim and lock due checks in ONE statement. FOR UPDATE SKIP LOCKED plus the
  // is_running condition guarantee a check is handed out once, even if two
  // ticks (or two backend processes) run this concurrently.
  private claimDue(limit: number): Promise<ClaimedCheck[]> {
    const now = new Date();
    return prisma.$queryRawUnsafe<ClaimedCheck[]>(
      `UPDATE checks c SET is_running = true, locked_at = $1
       FROM (
         SELECT id FROM checks
         WHERE is_paused = false
           AND next_run_at <= $1
           AND (is_running = false
                OR locked_at < $1 - make_interval(secs => (timeout_ms + ${STALE_LOCK_GRACE_MS}) / 1000.0))
         ORDER BY next_run_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       ) due
       WHERE c.id = due.id
       RETURNING ${CLAIM_COLUMNS}`,
      now,
      limit,
    );
  }

  // Manual "run now". Same lock as the scheduler, so it can't overlap a scheduled run.
  async runNow(checkId: number): Promise<'started' | 'already_running' | 'not_found'> {
    const now = new Date();
    const rows = await prisma.$queryRawUnsafe<ClaimedCheck[]>(
      `UPDATE checks c SET is_running = true, locked_at = $1
       WHERE c.id = $2 AND c.is_running = false
       RETURNING ${CLAIM_COLUMNS}`,
      now,
      checkId,
    );
    if (rows.length === 0) {
      const exists = await prisma.check.count({ where: { id: checkId } });
      return exists ? 'already_running' : 'not_found';
    }
    void this.execute({ ...rows[0], scheduledAt: now }, true);
    return 'started';
  }

  private async execute(check: ClaimedCheck, manual: boolean) {
    const controller = new AbortController();
    this.inFlight.set(check.id, controller);
    const startedAt = new Date();
    const lagMs = manual ? 0 : startedAt.getTime() - check.scheduledAt.getTime();

    try {
      const result = await httpProbe(check, controller.signal);
      if (controller.signal.aborted) return;

      const finishedAt = new Date();
      // Manual runs restart the grid from now; scheduled runs keep their grid.
      const anchor = manual ? startedAt : check.scheduledAt;
      const nextRunAt = computeNextRunAt(anchor, finishedAt, check.intervalSec);
      await applyResult(check.id, result, finishedAt, nextRunAt);

      this.record({ at: finishedAt.getTime(), checkId: check.id, lagMs, durationMs: result.responseTimeMs });
      this.log.info(
        { checkId: check.id, manual, lagMs, durationMs: result.responseTimeMs, ok: result.isSuccess, httpCode: result.httpCode, error: result.errorMessage ?? undefined },
        'check finished',
      );
    } catch (err) {
      // Lock stays set; it is reclaimed as stale after timeout + grace.
      this.log.error({ err, checkId: check.id }, 'check execution failed');
    } finally {
      this.inFlight.delete(check.id);
    }
  }

  private record(sample: RunSample) {
    this.runsTotal++;
    this.samples.push(sample);
    const cutoff = Date.now() - STATS_WINDOW_MS;
    if (this.samples[0].at < cutoff) this.samples = this.samples.filter((s) => s.at >= cutoff);
  }

  stats() {
    const cutoff = Date.now() - STATS_WINDOW_MS;
    const recent = this.samples.filter((s) => s.at >= cutoff);
    const pct = (values: number[], p: number) => {
      if (values.length === 0) return null;
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
    };
    const lags = recent.map((s) => s.lagMs);
    const durations = recent.map((s) => s.durationMs);
    return {
      inFlight: [...this.inFlight.keys()],
      runsTotal: this.runsTotal,
      window: '5m',
      runs: recent.length,
      startLagMs: { p50: pct(lags, 50), p95: pct(lags, 95), max: pct(lags, 100) },
      durationMs: { p50: pct(durations, 50), max: pct(durations, 100) },
    };
  }
}
