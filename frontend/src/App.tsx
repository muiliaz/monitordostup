import { useEffect, useState } from 'react';

export function App() {
  const [health, setHealth] = useState<string>('…');

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((b: { status: string }) => setHealth(b.status))
      .catch(() => setHealth('unreachable'));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>Монитор доступности</h1>
      <p>Backend: {health}</p>
    </main>
  );
}
