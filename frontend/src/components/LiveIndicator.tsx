import type { LiveState } from '../api/useLiveStream';

const LABELS: Record<LiveState, string> = {
  connecting: 'подключение…',
  open: 'live',
  reconnecting: 'нет связи, переподключение…',
};

export function LiveIndicator({ state }: { state: LiveState }) {
  return (
    <span className={`live live-${state}`} title="Обновления с сервера в реальном времени (SSE)">
      <span className="dot" /> {LABELS[state]}
    </span>
  );
}
