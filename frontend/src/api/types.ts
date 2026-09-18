export type CheckStatus = 'unknown' | 'up' | 'down';

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
