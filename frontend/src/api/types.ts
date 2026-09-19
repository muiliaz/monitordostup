export type CheckStatus = 'unknown' | 'up' | 'down';
export type AlertStatus = 'sending' | 'sent' | 'no_recipients' | 'skipped' | 'suppressed';

export interface GroupRef {
  id: number;
  name: string;
}

export interface Check {
  id: number;
  groupId: number | null;
  group?: GroupRef | null;
  name: string;
  url: string;
  intervalSec: number;
  timeoutMs: number;
  expectedStatus: number;
  expectedBodySubstring: string | null;
  isPaused: boolean;
  isPublic: boolean;
  isRunning: boolean;
  nextRunAt: string;
  currentStatus: CheckStatus;
  statusChangedAt: string | null;
  lastCheckedAt: string | null;
  lastResponseTimeMs: number | null;
  consecutiveFailures: number;
  createdAt: string;
}

export interface CheckInput {
  name: string;
  url: string;
  intervalSec: number;
  timeoutMs: number;
  expectedStatus: number;
  expectedBodySubstring: string | null;
  isPublic: boolean;
  groupId: number | null;
}

export interface Group {
  id: number;
  name: string;
  alertEmails: string[];
  checkCount: number;
  status: CheckStatus;
}

export interface GroupInput {
  name: string;
  alertEmails: string[];
}

export interface CheckResult {
  id: string;
  checkId: number;
  checkedAt: string;
  isSuccess: boolean;
  responseTimeMs: number;
  httpCode: number | null;
  errorMessage: string | null;
}

export interface Incident {
  id: number;
  checkId: number;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  cause: string | null;
  downAlertStatus: AlertStatus | null;
  downAlertAt: string | null;
  upAlertStatus: AlertStatus | null;
  upAlertAt: string | null;
  check?: { id: number; name: string; url: string; groupId: number | null };
}

export interface MaintenanceWindow {
  id: number;
  checkId: number | null;
  groupId: number | null;
  startsAt: string;
  endsAt: string;
  note: string | null;
  check: GroupRef | null;
  group: GroupRef | null;
}

// Either startsAt+endsAt, or only durationMinutes (= starts now by the server clock).
export interface MaintenanceInput {
  checkId: number | null;
  groupId: number | null;
  startsAt?: string;
  endsAt?: string;
  durationMinutes?: number;
  note: string | null;
}

export interface DashboardSummary {
  total: number;
  up: number;
  down: number;
  paused: number;
  unknown: number;
  uptime24h: number | null;
  computedAt: string;
}

export type PublicStatus = CheckStatus | 'paused';

export interface PublicCheck {
  id: number;
  name: string;
  status: PublicStatus;
  since: string | null;
  lastCheckedAt: string | null;
  group: string | null;
  uptime24h: number | null;
  maintenance: { startsAt: string; endsAt: string }[];
}

export type StatsRange = 'day' | 'week' | 'month';

export interface StatsBucket {
  t: string;
  total: number;
  failures: number;
  avgMs: number | null;
  maxMs: number | null;
}

export interface CheckStats {
  range: StatsRange;
  bucketSec: number;
  from: string;
  to: string;
  buckets: StatsBucket[];
  totals: { checks: number; failures: number; uptime: number | null; avgMs: number | null; incidents: number; downtimeSec: number };
}
