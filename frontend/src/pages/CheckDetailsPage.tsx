import { Link, useParams } from 'react-router-dom';
import { useCheck, useIncidents, useResults } from '../api/hooks';
import { IncidentsTable } from '../components/IncidentsTable';
import { StatusBadge } from '../components/StatusBadge';
import { formatAgo, formatDateTime, formatDuration, formatInterval } from '../format';
import { useNow } from '../useNow';

export function CheckDetailsPage() {
  const id = Number(useParams().id);
  const check = useCheck(id);
  const results = useResults(id);
  const incidents = useIncidents(id);
  const now = useNow();

  if (check.isLoading) return <p>Загрузка…</p>;
  if (check.error || !check.data) return <p className="error">Проверка не найдена. <Link to="/">К списку</Link></p>;

  const c = check.data;
  const downFor = c.currentStatus === 'down' && c.statusChangedAt ? now - new Date(c.statusChangedAt).getTime() : null;

  return (
    <section>
      <p className="small">
        <Link to="/">← Все проверки</Link>
      </p>
      <div className="card">
        <div className="group-header">
          <h2>{c.name}</h2>
          <StatusBadge status={c.currentStatus} paused={c.isPaused} />
          {downFor !== null && <span className="down-text">лежит {formatDuration(downFor)}</span>}
        </div>
        <dl className="facts">
          <dt>URL</dt>
          <dd>{c.url}</dd>
          <dt>Интервал / таймаут</dt>
          <dd>
            {formatInterval(c.intervalSec)} / {c.timeoutMs} мс
          </dd>
          <dt>Ожидается</dt>
          <dd>
            HTTP {c.expectedStatus}
            {c.expectedBodySubstring && <> и «{c.expectedBodySubstring}» в теле</>}
          </dd>
          <dt>Последняя проверка</dt>
          <dd>
            {formatAgo(c.lastCheckedAt, now)}
            {c.lastResponseTimeMs !== null && `, ${c.lastResponseTimeMs} мс`}
          </dd>
          <dt>Неудач подряд</dt>
          <dd>{c.consecutiveFailures}</dd>
        </dl>
      </div>

      <div className="card">
        <h3>Инциденты</h3>
        {incidents.data && <IncidentsTable incidents={incidents.data} showCheck={false} />}
      </div>

      <div className="card">
        <h3>Последние проверки</h3>
        {results.data?.length === 0 ? (
          <p className="muted">Проверок ещё не было.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Время</th>
                <th>Результат</th>
                <th>HTTP</th>
                <th>Ответ</th>
                <th>Ошибка</th>
              </tr>
            </thead>
            <tbody>
              {results.data?.map((r) => (
                <tr key={r.id}>
                  <td>{formatDateTime(r.checkedAt)}</td>
                  <td>{r.isSuccess ? <span className="badge badge-up">успех</span> : <span className="badge badge-down">неудача</span>}</td>
                  <td>{r.httpCode ?? '—'}</td>
                  <td>{r.responseTimeMs} мс</td>
                  <td className="small">{r.errorMessage ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
