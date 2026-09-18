import { useSummary } from '../api/hooks';

export function SummaryPanel() {
  const { data } = useSummary();
  const idle = data ? [data.paused && `${data.paused} на паузе`, data.unknown && `${data.unknown} без данных`].filter(Boolean).join(', ') : '';

  return (
    <div className="summary">
      <Metric label="Всего проверок" value={data?.total} note={idle} />
      <Metric label="Работает" value={data?.up} tone="up" />
      <Metric label="Упало" value={data?.down} tone={data?.down ? 'down' : undefined} />
      <Metric
        label="Средний аптайм за 24 ч"
        value={data ? (data.uptime24h === null ? '—' : `${data.uptime24h.toFixed(2)}%`) : undefined}
      />
    </div>
  );
}

function Metric({ label, value, tone, note }: { label: string; value: number | string | undefined; tone?: 'up' | 'down'; note?: string }) {
  return (
    <div className={`metric${tone ? ` metric-${tone}` : ''}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value ?? '…'}</div>
      {note && <div className="muted small">{note}</div>}
    </div>
  );
}
