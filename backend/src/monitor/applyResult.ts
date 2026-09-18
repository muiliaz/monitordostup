import { prisma } from '../db.js';
import type { ProbeResult } from '../scheduler/httpProbe.js';

// Stage 4: persist the last-run data and streak counters, release the lock.
// Thresholds, statuses, incidents and history come in stage 5.
export async function applyResult(checkId: number, result: ProbeResult, finishedAt: Date, nextRunAt: Date) {
  // updateMany: the check may have been deleted while it was running.
  await prisma.check.updateMany({
    where: { id: checkId },
    data: {
      isRunning: false,
      lockedAt: null,
      nextRunAt,
      lastCheckedAt: finishedAt,
      lastResponseTimeMs: result.responseTimeMs,
      consecutiveFailures: result.isSuccess ? 0 : { increment: 1 },
      consecutiveSuccesses: result.isSuccess ? { increment: 1 } : 0,
    },
  });
}
