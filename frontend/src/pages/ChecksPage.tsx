import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useCheckAction, useChecks, useGroups, useMaintenance } from '../api/hooks';
import type { Check, MaintenanceWindow } from '../api/types';
import { MaintenanceBadge } from '../components/MaintenanceBadge';
import { activeWindow } from '../maintenance';
import { CheckForm } from '../components/CheckForm';
import { StatusBadge } from '../components/StatusBadge';
import { formatAgo, formatDuration, formatInterval } from '../format';
import { useNow } from '../useNow';

// Paused checks keep their last status but are not "failing" (same rule as group status).
const isDown = (c: Check) => !c.isPaused && c.currentStatus === 'down';

type Editing = { mode: 'new' } | { mode: 'edit'; check: Check } | null;

export function ChecksPage() {
  const checks = useChecks();
  const groups = useGroups();
  const windows = useMaintenance('current');
  const [editing, setEditing] = useState<Editing>(null);
  const now = useNow();

  if (checks.isLoading || groups.isLoading) return <p>Загрузка…</p>;
  if (checks.error) return <p className="error">Не удалось загрузить проверки</p>;

  const all = checks.data ?? [];
  const allSections = [
    ...(groups.data ?? []).map((g) => ({ key: `g${g.id}`, group: g, items: all.filter((c) => c.groupId === g.id) })),
    { key: 'none', group: null, items: all.filter((c) => c.groupId === null) },
  ];
  // Groups with a failing check go first (stable sort keeps the API's
  // alphabetical order inside each tier); failing checks go first inside a group.
  const sections = allSections
    .filter((s) => s.items.length > 0)
    .map((s) => ({ ...s, items: [...s.items].sort((a, b) => Number(isDown(b)) - Number(isDown(a))) }))
    .sort((a, b) => Number(b.items.some(isDown)) - Number(a.items.some(isDown)));
  const emptyGroups = allSections.flatMap((s) => (s.group && s.items.length === 0 ? [s.group] : []));

  return (
    <section>
      <div className="toolbar">
        <h2>Проверки</h2>
        <button className="primary" onClick={() => setEditing({ mode: 'new' })}>
          + Добавить проверку
        </button>
      </div>

      {editing && <CheckForm key={editing.mode === 'edit' ? editing.check.id : 'new'} check={editing.mode === 'edit' ? editing.check : undefined} onDone={() => setEditing(null)} />}

      {all.length === 0 && <p className="muted">Проверок пока нет.</p>}

      {sections.map((s) => (
        <div key={s.key} className="card">
          <div className="group-header">
            <h3>{s.group ? s.group.name : 'Без группы'}</h3>
            {s.group && <StatusBadge status={s.group.status} />}
            {s.group && <MaintenanceBadge window={activeWindow({ groupId: s.group.id }, windows.data, now)} />}
          </div>
          <table>
            <thead>
              <tr>
                <th>Статус</th>
                <th>Проверка</th>
                <th>Ответ</th>
                <th>Последняя проверка</th>
                <th>Падение длится</th>
                <th>Интервал</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {s.items.map((c) => (
                <CheckRow key={c.id} check={c} now={now} maintenance={activeWindow({ checkId: c.id, groupId: c.groupId }, windows.data, now)} onEdit={() => setEditing({ mode: 'edit', check: c })} />
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {emptyGroups.length > 0 && (
        <details className="empty-groups">
          <summary>Пустые группы ({emptyGroups.length})</summary>
          <p className="muted small">
            В этих группах нет проверок. Добавьте проверку в группу через форму проверки или удалите группу в разделе{' '}
            <Link to="/groups">«Группы»</Link>.
          </p>
          <ul>
            {emptyGroups.map((g) => (
              <li key={g.id}>
                {g.name}
                <MaintenanceBadge window={activeWindow({ groupId: g.id }, windows.data, now)} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function CheckRow({ check: c, now, maintenance, onEdit }: { check: Check; now: number; maintenance: MaintenanceWindow | null; onEdit: () => void }) {
  const action = useCheckAction();
  const downFor = c.currentStatus === 'down' && c.statusChangedAt ? now - new Date(c.statusChangedAt).getTime() : null;

  return (
    <tr>
      <td>
        <StatusBadge status={c.currentStatus} paused={c.isPaused} />
        <MaintenanceBadge window={maintenance} />
        {c.isRunning && <div className="muted small">идёт проверка…</div>}
      </td>
      <td>
        <div className="check-name">
          <Link to={`/checks/${c.id}`}>{c.name}</Link> {c.isPublic && <span className="tag">публичная</span>}
        </div>
        <div className="muted small">{c.url}</div>
      </td>
      <td>{c.lastResponseTimeMs !== null ? `${c.lastResponseTimeMs} мс` : '—'}</td>
      <td>{formatAgo(c.lastCheckedAt, now)}</td>
      <td className={downFor !== null ? 'down-text' : ''}>{downFor !== null ? formatDuration(downFor) : '—'}</td>
      <td>{formatInterval(c.intervalSec)}</td>
      <td className="row-actions">
        <button disabled={c.isRunning} onClick={() => action.mutate({ id: c.id, action: 'run' })} title="Запустить проверку сейчас">
          Запустить
        </button>
        {c.isPaused ? (
          <button onClick={() => action.mutate({ id: c.id, action: 'resume' })}>Возобновить</button>
        ) : (
          <button onClick={() => action.mutate({ id: c.id, action: 'pause' })}>Пауза</button>
        )}
        <button onClick={onEdit}>Изменить</button>
        <button
          className="danger"
          onClick={() => {
            if (confirm(`Удалить проверку «${c.name}» вместе с историей?`)) action.mutate({ id: c.id, action: 'delete' });
          }}
        >
          Удалить
        </button>
        {action.error && (
          <div className="error small">
            {action.error instanceof ApiError && action.error.status === 409 ? 'Проверка уже выполняется' : String(action.error)}
          </div>
        )}
      </td>
    </tr>
  );
}
