import type { CheckStatus } from '../api/types';

const LABELS: Record<CheckStatus | 'paused', string> = {
  up: 'работает',
  down: 'упал',
  unknown: 'нет данных',
  paused: 'пауза',
};

export function StatusBadge({ status, paused }: { status: CheckStatus; paused?: boolean }) {
  const key = paused ? 'paused' : status;
  return <span className={`badge badge-${key}`}>{LABELS[key]}</span>;
}
