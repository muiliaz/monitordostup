import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeNextRunAt } from './nextRun.js';

const t0 = new Date('2026-01-01T00:00:00.000Z');
const at = (ms: number) => new Date(t0.getTime() + ms);

test('fast run: next slot is one interval after the scheduled time', () => {
  assert.deepEqual(computeNextRunAt(t0, at(250), 30), at(30_000));
});

test('tick latency does not accumulate: anchor is the scheduled time, not the start', () => {
  // Started 900 ms late and took 100 ms; the grid stays at :00, :30, ...
  assert.deepEqual(computeNextRunAt(t0, at(1000), 30), at(30_000));
});

test('run longer than interval: missed slot is skipped, no catch-up run', () => {
  assert.deepEqual(computeNextRunAt(t0, at(45_000), 30), at(60_000));
});

test('finishing exactly on a slot boundary moves to the next slot', () => {
  assert.deepEqual(computeNextRunAt(t0, at(30_000), 30), at(60_000));
});

test('after long downtime: next future slot on the same grid', () => {
  const downtime = 4 * 3600_000 + 13 * 60_000 + 7_000; // 4h13m07s
  const next = computeNextRunAt(t0, at(downtime), 30);
  assert.equal((next.getTime() - t0.getTime()) % 30_000, 0);
  assert.ok(next.getTime() > at(downtime).getTime());
  assert.ok(next.getTime() - at(downtime).getTime() <= 30_000);
});
