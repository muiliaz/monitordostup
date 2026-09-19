import { useQuery, type QueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { CheckStatus, PublicCheck } from '../api/types';
import { useLiveStream, type Handlers } from '../api/useLiveStream';
import { LiveIndicator } from '../components/LiveIndicator';
import { formatAgo, formatDuration } from '../format';
import { groupStatus } from '../groupStatus';
import { formatUntil } from '../maintenance';
import { useNow } from '../useNow';

const statusKey = ['public', 'status'] as const;

type Patch = Pick<PublicCheck, 'id' | 'name' | 'status' | 'since' | 'lastCheckedAt'>;
type Status = { checks: PublicCheck[] };

// Module-level: useLiveStream needs a stable object.
const publicHandlers: Handlers = {
  check: (qc: QueryClient, patch: Patch) => {
    let known = false;
    qc.setQueryData<Status>(statusKey, (s) =>
      s && {
        checks: s.checks.map((c) => {
          if (c.id !== patch.id) return c;
          known = true;
          return { ...c, ...patch };
        }),
      },
    );
    // Just made public: the list must be refetched to include it.
    if (!known) void qc.invalidateQueries({ queryKey: statusKey });
  },
  'check.removed': (qc: QueryClient, { id }: { id: number }) => {
    qc.setQueryData<Status>(statusKey, (s) => s && { checks: s.checks.filter((c) => c.id !== id) });
  },
  changed: (qc: QueryClient) => void qc.invalidateQueries({ queryKey: statusKey }),
};

function activeMaintenance(c: PublicCheck, now: number) {
  return c.maintenance.find((w) => new Date(w.startsAt).getTime() <= now && new Date(w.endsAt).getTime() > now) ?? null;
}

const asCheck = (c: PublicCheck) => ({ isPaused: c.status === 'paused', currentStatus: c.status === 'paused' ? ('unknown' as const) : c.status });

export function PublicStatusPage() {
  const live = useLiveStream('/api/public/stream', publicHandlers);
  // Uptime moves with every result, which the stream does not carry: refresh it once a minute.
  const status = useQuery({ queryKey: statusKey, queryFn: () => api<Status>('/public/status'), refetchInterval: 60_000 });
  const now = useNow();

  const checks = status.data?.checks ?? [];
  const groups = new Map<string | null, PublicCheck[]>();
  for (const c of checks) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);

  return (
    <div className="public">
      <header className="public-header">
        <div>
          <h1>Статус сервисов</h1>
          <div className="muted small">Обновляется автоматически</div>
        </div>
        <LiveIndicator state={live} />
      </header>

      {status.isLoading ? (
        <p>Загрузка…</p>
      ) : status.error ? (
        <p className="error">Не удалось загрузить статус. Страница повторит попытку сама.</p>
      ) : (
        <>
          <Overall checks={checks} now={now} />
          {[...groups].map(([name, items]) => (
            <div key={name ?? ''} className={`card group-card group-${groupStatus(items.map(asCheck))}`}>
              {(name !== null || groups.size > 1) && <h3>{name ?? 'Другие сервисы'}</h3>}
              <ul className="public-list">
                {items.map((c) => (
                  <PublicRow key={c.id} check={c} now={now} />
                ))}
              </ul>
            </div>
          ))}
        </>
      )}

      <footer className="public-footer muted small">
        <Link to="/">Вход для администратора</Link>
      </footer>
    </div>
  );
}

function Overall({ checks, now }: { checks: PublicCheck[]; now: number }) {
  let tone: CheckStatus | 'maint' = 'unknown';
  let text = 'Публичных сервисов пока нет';
  if (checks.length > 0) {
    const down = checks.filter((c) => c.status === 'down' && !activeMaintenance(c, now)).length;
    const active = checks.filter((c) => c.status !== 'paused');
    if (down > 0) [tone, text] = ['down', down === 1 ? 'Один сервис недоступен' : `Недоступно сервисов: ${down}`];
    else if (checks.some((c) => activeMaintenance(c, now))) [tone, text] = ['maint', 'Идут плановые работы'];
    else if (active.length > 0 && active.every((c) => c.status === 'up')) [tone, text] = ['up', 'Все сервисы работают'];
    else text = 'Собираем данные о доступности';
  }
  return <div className={`overall overall-${tone}`}>{text}</div>;
}

const LABELS: Record<PublicCheck['status'], string> = {
  up: 'работает',
  down: 'недоступен',
  unknown: 'нет данных',
  paused: 'мониторинг приостановлен',
};

function PublicRow({ check: c, now }: { check: PublicCheck; now: number }) {
  const maint = activeMaintenance(c, now);
  const downFor = c.status === 'down' && c.since ? formatDuration(now - new Date(c.since).getTime()) : null;
  return (
    <li className={c.status === 'down' ? 'row-down' : undefined}>
      <div>
        <div className="check-name">{c.name}</div>
        <div className="check-url">{c.lastCheckedAt ? `проверено ${formatAgo(c.lastCheckedAt, now)}` : 'ещё не проверялся'}</div>
      </div>
      <div className="public-status">
        <span className={`badge badge-${c.status}`}>
          {LABELS[c.status]}
          {downFor && ` · ${downFor}`}
        </span>
        {maint && <span className="badge badge-maint">плановые работы до {formatUntil(maint.endsAt, now)}</span>}
        <div className="muted small">
          {c.uptime24h === null ? 'аптайм за 24 ч: —' : `аптайм за 24 ч: ${c.uptime24h.toFixed(2)}%`}
        </div>
      </div>
    </li>
  );
}
