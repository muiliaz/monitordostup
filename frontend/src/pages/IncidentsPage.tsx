import { useIncidents } from '../api/hooks';
import { IncidentsTable } from '../components/IncidentsTable';

export function IncidentsPage() {
  const incidents = useIncidents();
  return (
    <section>
      <div className="toolbar">
        <h2>Журнал инцидентов</h2>
      </div>
      <div className="card">{incidents.isLoading ? <p>Загрузка…</p> : <IncidentsTable incidents={incidents.data ?? []} showCheck />}</div>
    </section>
  );
}
