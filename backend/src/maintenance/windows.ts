import type { MaintenanceWindow } from '@prisma/client';
import { prisma } from '../db.js';

// Window covering `at` for this check, either directly or via its group.
// If several overlap, the one ending last is returned (that is when alerts resume).
export function windowAt(check: { id: number; groupId: number | null }, at: Date): Promise<MaintenanceWindow | null> {
  return prisma.maintenanceWindow.findFirst({
    where: {
      OR: [{ checkId: check.id }, ...(check.groupId !== null ? [{ groupId: check.groupId }] : [])],
      startsAt: { lte: at },
      endsAt: { gt: at },
    },
    orderBy: { endsAt: 'desc' },
  });
}
