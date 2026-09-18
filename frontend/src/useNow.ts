import { useEffect, useState } from 'react';
import { serverNow } from './clock';

// Re-render every `intervalMs` so relative times ("12с назад") keep moving.
// Returns the server's "now" (see clock.ts).
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
