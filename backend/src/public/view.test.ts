import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Check } from '@prisma/client';
import { toPublicEvent } from './view.js';

const row: Check = {
  id: 7, groupId: 2, name: 'Site', url: 'http://internal:8080/health', intervalSec: 30, timeoutMs: 5000,
  expectedStatus: 200, expectedBodySubstring: 'secret', isPaused: false, isPublic: true, nextRunAt: new Date(),
  isRunning: false, lockedAt: null, consecutiveFailures: 2, consecutiveSuccesses: 0, failingSince: new Date(),
  currentStatus: 'down', statusChangedAt: new Date(1000), lastCheckedAt: new Date(2000), lastResponseTimeMs: 12,
  createdAt: new Date(),
};

test('public check update carries only whitelisted fields', () => {
  const out = toPublicEvent({ type: 'check.upsert', data: row });
  assert.deepEqual(out, { type: 'check', data: { id: 7, name: 'Site', status: 'down', since: new Date(1000), lastCheckedAt: new Date(2000) } });
  assert.ok(!JSON.stringify(out).includes('internal'));
});

test('private check update becomes a removal, never its data', () => {
  const out = toPublicEvent({ type: 'check.upsert', data: { ...row, isPublic: false } });
  assert.deepEqual(out, { type: 'check.removed', data: { id: 7 } });
});

test('paused public check is reported as paused', () => {
  const out = toPublicEvent({ type: 'check.upsert', data: { ...row, isPaused: true } });
  assert.equal(out?.type === 'check' && out.data.status, 'paused');
});

test('partial patches and admin-only events are dropped', () => {
  assert.equal(toPublicEvent({ type: 'check.upsert', data: { id: 7, isRunning: true } }), null);
  assert.equal(toPublicEvent({ type: 'group.status', data: { id: 2, status: 'down' } }), null);
  assert.equal(toPublicEvent({ type: 'incident.opened', data: {} as never }), null);
  assert.equal(toPublicEvent({ type: 'check.result', data: { checkId: 7, id: '1', checkedAt: new Date(), isSuccess: false, responseTimeMs: 1, httpCode: 500, errorMessage: 'x' } }), null);
});

test('list-level changes ask the page to refetch', () => {
  assert.deepEqual(toPublicEvent({ type: 'maintenance.changed', data: {} }), { type: 'changed', data: {} });
  assert.deepEqual(toPublicEvent({ type: 'groups.changed', data: {} }), { type: 'changed', data: {} });
});
