import type { MaintenanceWindow } from '../api/types';
import { formatUntil } from '../maintenance';
import { serverNow } from '../clock';

export function MaintenanceBadge({ window }: { window: MaintenanceWindow | null }) {
  if (!window) return null;
  return (
    <span className="badge badge-maint" title={window.note ?? 'Плановые работы: письма не отправляются'}>
      обслуживание до {formatUntil(window.endsAt, serverNow())}
    </span>
  );
}
