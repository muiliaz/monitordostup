import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './api/client';
import { keys, useMe } from './api/hooks';
import { ChecksPage } from './pages/ChecksPage';
import { GroupsPage } from './pages/GroupsPage';
import { LoginPage } from './pages/LoginPage';

function AdminLayout() {
  const me = useMe();
  const qc = useQueryClient();

  if (me.error) return <LoginPage />;
  if (me.isPending) return <p className="container">Загрузка…</p>;

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
          <NavLink to="/groups">Группы</NavLink>
        </nav>
        <span className="spacer" />
        <span className="muted small">{me.data?.username}</span>
        <button onClick={logout}>Выйти</button>
      </header>
      <main className="container">
        <Routes>
          <Route path="/" element={<ChecksPage />} />
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
