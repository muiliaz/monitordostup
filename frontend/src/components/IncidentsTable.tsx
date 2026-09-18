import { Link } from 'react-router-dom';
import type { Incident } from '../api/types';
import { formatDateTime, formatDuration } from '../format';
import { useNow } from '../useNow';

export function IncidentsTable({ incidents, showCheck }: { incidents: Incident[]; showCheck: boolean }) {
  const now = useNow();
  if (incidents.length === 0) return <p className="muted">Инцидентов не было.</p>;

  return (
    <table>
      <thead>
        <tr>
          {showCheck && <th>Проверка</th>}
          <th>Начало</th>
          <th>Конец</th>
          <th>Длительность</th>
          <th>Причина</th>
        </tr>
      </thead>
      <tbody>
        {incidents.map((i) => {
          const ongoing = i.endedAt === null;
          const durationMs = ongoing ? now - new Date(i.startedAt).getTime() : (i.durationSec ?? 0) * 1000;
          return (
            <tr key={i.id}>
              {showCheck && <td>{i.check ? <Link to={`/checks/${i.check.id}`}>{i.check.name}</Link> : i.checkId}</td>}
              <td>{formatDateTime(i.startedAt)}</td>
              <td>{ongoing ? <span className="badge badge-down">продолжается</span> : formatDateTime(i.endedAt!)}</td>
              <td className={ongoing ? 'down-text' : ''}>{formatDuration(durationMs)}</td>
              <td className="small">{i.cause ?? '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
