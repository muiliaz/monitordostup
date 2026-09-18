import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { keys } from '../api/hooks';

export function LoginPage() {
  const qc = useQueryClient();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api('/auth/login', { method: 'POST', body: { username, password } });
      await qc.invalidateQueries({ queryKey: keys.me });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Неверный логин или пароль' : String(err));
    }
  };

  return (
    <main className="login">
      <form className="card form" onSubmit={submit}>
        <h2>Вход в панель</h2>
        <label>
          Логин
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label>
          Пароль
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary">
          Войти
        </button>
      </form>
    </main>
  );
}
