import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './api/client';
import { keys, useMe } from './api/hooks';
import { useLiveStream } from './api/useLiveStream';
import { LiveIndicator } from './components/LiveIndicator';
import { CheckDetailsPage } from './pages/CheckDetailsPage';
import { ChecksPage } from './pages/ChecksPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { MaintenancePage } from './pages/MaintenancePage';
import { GroupsPage } from './pages/GroupsPage';
import { LoginPage } from './pages/LoginPage';

function AdminLayout() {
  const me = useMe();

  if (me.error) return <LoginPage />;
  if (me.isPending) return <p className="container">Загрузка…</p>;
  return <AdminShell username={me.data.username} />;
}

// Rendered only when logged in, so the SSE stream is opened with a valid session.
function AdminShell({ username }: { username: string }) {
  const qc = useQueryClient();
  const live = useLiveStream('/api/stream');

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    // Refetch "me" first: its 401 switches the UI to the login form. Only then
    // drop the other cached data, so no admin page is left rendering without it.
    await qc.resetQueries({ queryKey: keys.me });
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] });
  };

  return (
    <>
      <header className="topbar">
        <strong>Монитор доступности</strong>
        <nav>
          <NavLink to="/" end>
            Проверки
          </NavLink>
          <NavLink to="/incidents">Инциденты</NavLink>
          <NavLink to="/maintenance">Обслуживание</NavLink>
          <NavLink to="/groups">Группы</NavLink>
        </nav>
        <span className="spacer" />
        <LiveIndicator state={live} />
        <span className="muted small">{username}</span>
        <button onClick={logout}>Выйти</button>
      </header>
      <main className="container">
        <Routes>
          <Route path="/" element={<ChecksPage />} />
          <Route path="/checks/:id" element={<CheckDetailsPage />} />
          <Route path="/incidents" element={<IncidentsPage />} />
          <Route path="/maintenance" element={<MaintenancePage />} />
          <Route path="/groups" element={<GroupsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/*" element={<AdminLayout />} />
    </Routes>
  );
}
