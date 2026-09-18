import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useChecks, useGroups, useMaintenance, useMaintenanceAction } from '../api/hooks';
import type { MaintenanceWindow } from '../api/types';
import { formatDateTime, formatDuration } from '../format';
import { useNow } from '../useNow';

// <input type="datetime-local"> works in local time without a zone.
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DURATIONS = [5, 15, 30, 60, 120, 240];

function WindowForm({ onDone }: { onDone: () => void }) {
  const checks = useChecks();
  const groups = useGroups();
  const action = useMaintenanceAction();
  const [target, setTarget] = useState('');
  // "now": starts immediately by the server clock, only a duration is sent.
  const [mode, setMode] = useState<'now' | 'scheduled'>('now');
  const [duration, setDuration] = useState(60);
  const [startsAt, setStartsAt] = useState(() => toLocalInput(new Date(Date.now() + 60 * 60_000)));
  const [endsAt, setEndsAt] = useState(() => toLocalInput(new Date(Date.now() + 2 * 60 * 60_000)));
  const [note, setNote] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const [kind, id] = target.split(':');
    const when =
      mode === 'now'
        ? { durationMinutes: duration }
        : { startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() };
    action.mutate(
      {
        kind: 'create',
        input: { checkId: kind === 'check' ? Number(id) : null, groupId: kind === 'group' ? Number(id) : null, note: note || null, ...when },
      },
      { onSuccess: onDone },
    );
  };

  return (
    <form className="card form" onSubmit={submit}>
      <h3>Новое окно обслуживания</h3>
      <div className="form-grid">
        <label className="wide">
          Для чего
          <select value={target} onChange={(e) => setTarget(e.target.value)} required>
            <option value="">— выберите проверку или группу —</option>
            <optgroup label="Группы (все проверки группы)">
              {groups.data?.map((g) => (
                <option key={g.id} value={`group:${g.id}`}>
                  {g.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Отдельные проверки">
              {checks.data?.map((c) => (
                <option key={c.id} value={`check:${c.id}`}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <div className="quick wide">
          <label className="checkbox">
            <input type="radio" checked={mode === 'now'} onChange={() => setMode('now')} /> Начать сейчас
          </label>
          <label className="checkbox">
            <input type="radio" checked={mode === 'scheduled'} onChange={() => setMode('scheduled')} /> Запланировать на время
          </label>
        </div>
        {mode === 'now' ? (
          <label>
            Длительность
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATIONS.map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} мин` : `${m / 60} ч`}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label>
              Начало
              <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
            </label>
            <label>
              Окончание
              <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required />
            </label>
          </>
        )}
        <label className="wide">
          Комментарий
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: обновление БД" />
        </label>
      </div>
      {action.error && <p className="error">{action.error instanceof ApiError ? action.error.describe() : String(action.error)}</p>}
      <div className="actions">
        <button type="submit" className="primary" disabled={action.isPending}>
          Создать
        </button>
        <button type="button" onClick={onDone}>
          Отмена
        </button>
      </div>
    </form>
  );
}

function WindowsTable({ windows, now, past }: { windows: MaintenanceWindow[]; now: number; past: boolean }) {
  const action = useMaintenanceAction();
  if (windows.length === 0) return <p className="muted">{past ? 'Прошедших окон нет.' : 'Активных и запланированных окон нет.'}</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Состояние</th>
          <th>Для чего</th>
          <th>Начало</th>
          <th>Окончание</th>
          <th>Комментарий</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {windows.map((w) => {
          const start = new Date(w.startsAt).getTime();
          const end = new Date(w.endsAt).getTime();
          const active = start <= now && now < end;
          return (
            <tr key={w.id}>
              <td>
                {past ? (
                  <span className="badge badge-unknown">завершено</span>
                ) : active ? (
                  <span className="badge badge-maint">идёт, ещё {formatDuration(end - now)}</span>
                ) : (
                  <span className="badge badge-unknown">через {formatDuration(start - now)}</span>
                )}
              </td>
              <td>{w.group ? <>группа «{w.group.name}»</> : w.check?.name}</td>
              <td>{formatDateTime(w.startsAt)}</td>
              <td>{formatDateTime(w.endsAt)}</td>
              <td className="small">{w.note ?? ''}</td>
              <td className="row-actions">
                {!past && (
                  <button onClick={() => action.mutate({ kind: 'end', id: w.id })}>{active ? 'Завершить сейчас' : 'Отменить'}</button>
                )}
                {past && (
                  <button className="danger" onClick={() => action.mutate({ kind: 'delete', id: w.id })}>
                    Удалить
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function MaintenancePage() {
  const current = useMaintenance('current');
  const past = useMaintenance('past');
  const [creating, setCreating] = useState(false);
  const now = useNow();

  // A window that just ended moves from "current" to "past" without a server event.
  const ended = (current.data ?? []).filter((w) => new Date(w.endsAt).getTime() <= now);
  const pastAll = [...ended, ...(past.data ?? [])];

  return (
    <section>
      <div className="toolbar">
        <h2>Окна обслуживания</h2>
        <button className="primary" onClick={() => setCreating(true)}>
          + Запланировать
        </button>
      </div>
      <p className="muted small">
        Во время окна проверки продолжают выполняться и статусы обновляются, но письма не отправляются. Если окно закончилось, а
        сайт всё ещё лежит, письмо уйдёт сразу после окончания окна.
      </p>
      {creating && <WindowForm onDone={() => setCreating(false)} />}
      <div className="card">
        <h3>Идут и запланированы</h3>
        <WindowsTable windows={(current.data ?? []).filter((w) => new Date(w.endsAt).getTime() > now)} now={now} past={false} />
      </div>
      <div className="card">
        <h3>Прошедшие</h3>
        <WindowsTable windows={pastAll} now={now} past />
      </div>
    </section>
  );
}
