import type { MaintenanceWindow } from './api/types';

// Window active at `now` for a check (directly or via its group). Computed on
// the client from the window list, so badges appear and disappear exactly on
// time without any server event at the window boundaries.
export function activeWindow(
  target: { checkId?: number; groupId: number | null },
  windows: MaintenanceWindow[] | undefined,
  now: number,
): MaintenanceWindow | null {
  let best: MaintenanceWindow | null = null;
  for (const w of windows ?? []) {
    const matches = (target.checkId !== undefined && w.checkId === target.checkId) || (target.groupId !== null && w.groupId === target.groupId);
    if (!matches) continue;
    if (new Date(w.startsAt).getTime() > now || new Date(w.endsAt).getTime() <= now) continue;
    if (!best || w.endsAt > best.endsAt) best = w;
  }
  return best;
}

export function formatUntil(iso: string, now: number): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date(now).toDateString();
  return d.toLocaleString('ru-RU', sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
