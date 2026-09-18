import { useState } from 'react';
import { ApiError } from '../api/client';
import { useCheckAction, useChecks, useGroups } from '../api/hooks';
import type { Check } from '../api/types';
import { CheckForm } from '../components/CheckForm';
import { StatusBadge } from '../components/StatusBadge';
import { formatAgo, formatDuration, formatInterval } from '../format';
import { useNow } from '../useNow';

type Editing = { mode: 'new' } | { mode: 'edit'; check: Check } | null;

export function ChecksPage() {
  const checks = useChecks();
  const groups = useGroups();
  const [editing, setEditing] = useState<Editing>(null);
  const now = useNow();

  if (checks.isLoading || groups.isLoading) return <p>Загрузка…</p>;
  if (checks.error) return <p className="error">Не удалось загрузить проверки</p>;

  const all = checks.data ?? [];
  const sections = [
    ...(groups.data ?? []).map((g) => ({ key: `g${g.id}`, group: g, items: all.filter((c) => c.groupId === g.id) })),
    { key: 'none', group: null, items: all.filter((c) => c.groupId === null) },
  ].filter((s) => s.group || s.items.length > 0);

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
          </div>
          {s.items.length === 0 ? (
            <p className="muted">В группе нет проверок.</p>
          ) : (
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
                  <CheckRow key={c.id} check={c} now={now} onEdit={() => setEditing({ mode: 'edit', check: c })} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </section>
  );
}

function CheckRow({ check: c, now, onEdit }: { check: Check; now: number; onEdit: () => void }) {
  const action = useCheckAction();
  const downFor = c.currentStatus === 'down' && c.statusChangedAt ? now - new Date(c.statusChangedAt).getTime() : null;

  return (
    <tr>
      <td>
        <StatusBadge status={c.currentStatus} paused={c.isPaused} />
        {c.isRunning && <div className="muted small">идёт проверка…</div>}
      </td>
      <td>
        <div className="check-name">
          {c.name} {c.isPublic && <span className="tag">публичная</span>}
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
