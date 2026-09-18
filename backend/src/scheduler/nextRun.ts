// Next slot on the check's grid (anchor + k * interval) that is strictly after
// `finishedAt`. Anchoring on the *scheduled* time (not the actual start) keeps
// tick latency from accumulating as drift. If a run took longer than its
// interval, or the backend was down, the missed slots are skipped instead of
// being executed back-to-back to "catch up".
export function computeNextRunAt(anchor: Date, finishedAt: Date, intervalSec: number): Date {
  const intervalMs = intervalSec * 1000;
  const elapsed = Math.max(0, finishedAt.getTime() - anchor.getTime());
  const slots = Math.floor(elapsed / intervalMs) + 1;
  return new Date(anchor.getTime() + slots * intervalMs);
}
