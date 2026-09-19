import type { Check, CheckResult, Incident } from '@prisma/client';
import { prisma } from '../db.js';
import type { ProbeResult } from '../scheduler/httpProbe.js';
import { evaluate, type Transition } from './transitions.js';

export interface AppliedResult {
  check: Check;
  result: CheckResult;
  transition: Transition;
  incident: Incident | null; // opened or closed by this result
}

// Records one probe result and everything that follows from it in a single
// transaction: history row, streak counters, status, incident open/close,
// scheduling fields and lock release. Returns null if the check was deleted
// while it was running.
export async function applyResult(checkId: number, probe: ProbeResult, checkedAt: Date, nextRunAt: Date): Promise<AppliedResult | null> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.check.findUnique({ where: { id: checkId } });
    if (!current) return null;

    const result = await tx.checkResult.create({
      data: {
        checkId,
        checkedAt,
        isSuccess: probe.isSuccess,
        responseTimeMs: probe.responseTimeMs,
        httpCode: probe.httpCode,
        errorMessage: probe.errorMessage,
      },
    });

    // Same transaction as the raw row, so the rollup can never drift from it.
    // Only this check's own (never overlapping) runs touch its hour row.
    const okMs = probe.isSuccess ? probe.responseTimeMs : null;
    await tx.$executeRaw`
      INSERT INTO check_results_hourly AS h (check_id, hour, total, failures, sum_ms_ok, max_ms_ok)
      VALUES (${checkId}, date_trunc('hour', ${checkedAt}::timestamptz, 'UTC'), 1, ${probe.isSuccess ? 0 : 1}, ${okMs ?? 0}, ${okMs})
      ON CONFLICT (check_id, hour) DO UPDATE SET
        total = h.total + 1,
        failures = h.failures + EXCLUDED.failures,
        sum_ms_ok = h.sum_ms_ok + EXCLUDED.sum_ms_ok,
        max_ms_ok = GREATEST(h.max_ms_ok, EXCLUDED.max_ms_ok)`;

    const { state, transition } = evaluate(current, probe.isSuccess, checkedAt);

    // Only monitoring fields are written: the config (url, interval, …) may
    // have been edited while the probe was running and must not be reverted.
    const check = await tx.check.update({
      where: { id: checkId },
      data: {
        currentStatus: state.currentStatus,
        consecutiveFailures: state.consecutiveFailures,
        consecutiveSuccesses: state.consecutiveSuccesses,
        failingSince: state.failingSince,
        statusChangedAt: state.statusChangedAt,
        isRunning: false,
        lockedAt: null,
        nextRunAt,
        lastCheckedAt: checkedAt,
        lastResponseTimeMs: probe.responseTimeMs,
      },
    });

    let incident: Incident | null = null;
    if (transition?.kind === 'went_down') {
      // ON CONFLICT DO NOTHING against the "one open incident per check" index:
      // if an open incident somehow exists already, keep it instead of failing.
      const rows = await tx.$queryRaw<Incident[]>`
        INSERT INTO incidents (check_id, started_at, cause)
        VALUES (${checkId}, ${transition.startedAt}, ${probe.errorMessage})
        ON CONFLICT DO NOTHING
        RETURNING id, check_id AS "checkId", started_at AS "startedAt", ended_at AS "endedAt",
                  duration_sec AS "durationSec", cause`;
      incident = rows[0] ?? null;
    } else if (transition?.kind === 'recovered') {
      const rows = await tx.$queryRaw<Incident[]>`
        UPDATE incidents
        SET ended_at = ${checkedAt},
            duration_sec = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (${checkedAt}::timestamptz - started_at))))::int
        WHERE check_id = ${checkId} AND ended_at IS NULL
        RETURNING id, check_id AS "checkId", started_at AS "startedAt", ended_at AS "endedAt",
                  duration_sec AS "durationSec", cause`;
      incident = rows[0] ?? null;
    }

    return { check, result, transition, incident };
  });
}
