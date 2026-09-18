import type { FastifyBaseLogger } from 'fastify';
import type { AlertStatus, Incident } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { bus } from '../live/bus.js';
import { sendMail } from './mailer.js';
import { downAlert, upAlert, type AlertContext } from './templates.js';

const RECONCILE_MS = 15_000;
// A "sending" claim older than this belongs to a process that died mid-send.
const STALE_SENDING_MS = 2 * 60_000;
const BATCH = 50;

type Kind = 'down' | 'up';

const COLUMNS = {
  down: { status: 'down_alert_status', at: 'down_alert_at' },
  up: { status: 'up_alert_status', at: 'up_alert_at' },
} as const;

// Sends alerts based on incident state, not on in-memory events:
//   - every incident gets a DOWN alert, and after it ends an UP alert;
//   - an alert is claimed with a conditional UPDATE before sending, so the
//     periodic run and a kick() never send the same alert twice;
//   - a failed send releases the claim and is retried on the next run;
//   - nothing is lost if the process dies between the status change and
//     the send: the next process finds the incident still unalerted.
export class AlertDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private rerun = false;

  constructor(private readonly log: FastifyBaseLogger) {}

  start() {
    this.timer = setInterval(() => this.kick(), RECONCILE_MS);
    this.kick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  // Called on every status transition so alerts go out immediately,
  // not on the next periodic run. Runs never overlap in this process.
  kick() {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    this.reconcile()
      .catch((err) => this.log.error({ err }, 'alert reconcile failed'))
      .finally(() => {
        this.running = false;
        if (this.rerun) {
          this.rerun = false;
          this.kick();
        }
      });
  }

  private async reconcile() {
    await this.releaseStaleClaims();

    // DOWN alerts: every incident that has not been alerted yet (open, or
    // already closed if an earlier send kept failing — it still happened).
    const dueDown = await prisma.incident.findMany({
      where: { downAlertAt: null },
      orderBy: { startedAt: 'asc' },
      take: BATCH,
    });
    for (const incident of dueDown) await this.handle(incident, 'down');

    // UP alerts: closed incidents whose DOWN alert is settled.
    const dueUp = await prisma.incident.findMany({
      where: { endedAt: { not: null }, upAlertAt: null, downAlertStatus: { in: ['sent', 'no_recipients', 'skipped'] } },
      orderBy: { endedAt: 'asc' },
      take: BATCH,
    });
    for (const incident of dueUp) {
      // "Recovered" makes no sense to someone who never got "down".
      if (incident.downAlertStatus !== 'sent') await this.settle(incident.id, 'up', 'skipped');
      else await this.handle(incident, 'up');
    }
  }

  private async handle(incident: Incident, kind: Kind) {
    if (!(await this.claim(incident.id, kind))) return; // someone else took it

    const check = await prisma.check.findUnique({ where: { id: incident.checkId }, include: { group: true } });
    if (!check) return; // check deleted: its incidents are cascade-deleted too

    const recipients = check.group ? check.group.alertEmails : config.defaultAlertEmails;
    if (recipients.length === 0) {
      await this.settle(incident.id, kind, 'no_recipients');
      this.log.info({ incidentId: incident.id, checkId: check.id, kind }, 'alert not sent: no recipients');
      return;
    }

    const ctx: AlertContext = {
      checkId: check.id,
      checkName: check.name,
      url: check.url,
      startedAt: incident.startedAt,
      endedAt: incident.endedAt,
      durationSec: incident.durationSec,
      cause: incident.cause,
    };
    try {
      await sendMail({ to: recipients, ...(kind === 'down' ? downAlert(ctx) : upAlert(ctx)) });
      await this.settle(incident.id, kind, 'sent');
      this.log.info({ incidentId: incident.id, checkId: check.id, kind, to: recipients }, 'alert sent');
    } catch (err) {
      await this.release(incident.id, kind);
      this.log.warn({ err, incidentId: incident.id, kind }, 'alert send failed, will retry');
    }
  }

  private async claim(incidentId: number, kind: Kind): Promise<boolean> {
    const c = COLUMNS[kind];
    const n = await prisma.$executeRawUnsafe(
      `UPDATE incidents SET ${c.status} = 'sending', ${c.at} = now() WHERE id = $1 AND ${c.at} IS NULL`,
      incidentId,
    );
    return n === 1;
  }

  private async settle(incidentId: number, kind: Kind, status: AlertStatus) {
    const data = kind === 'down' ? { downAlertStatus: status, downAlertAt: new Date() } : { upAlertStatus: status, upAlertAt: new Date() };
    const incident = await prisma.incident.update({ where: { id: incidentId }, data });
    bus.publish({ type: 'incident.updated', data: incident });
  }

  private async release(incidentId: number, kind: Kind) {
    const data = kind === 'down' ? { downAlertStatus: null, downAlertAt: null } : { upAlertStatus: null, upAlertAt: null };
    await prisma.incident.update({ where: { id: incidentId }, data });
  }

  private async releaseStaleClaims() {
    const cutoff = new Date(Date.now() - STALE_SENDING_MS);
    for (const kind of ['down', 'up'] as const) {
      const c = COLUMNS[kind];
      const n = await prisma.$executeRawUnsafe(
        `UPDATE incidents SET ${c.status} = NULL, ${c.at} = NULL WHERE ${c.status} = 'sending' AND ${c.at} < $1`,
        cutoff,
      );
      if (n > 0) this.log.warn({ kind, released: n }, 'released stale alert claims');
    }
  }
}
