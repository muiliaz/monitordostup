import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketGrid, RANGES } from './stats.js';

test('grid ends with the bucket that contains now and has the configured size', () => {
  const now = new Date('2026-09-19T15:07:31Z');
  const day = bucketGrid('day', now);
  assert.equal(day.to.toISOString(), '2026-09-19T15:15:00.000Z');
  assert.equal(day.from.toISOString(), '2026-09-18T15:15:00.000Z');
  assert.equal((day.to.getTime() - day.from.getTime()) / 1000, RANGES.day.bucketSec * RANGES.day.buckets);

  const month = bucketGrid('month', now);
  assert.equal(month.to.toISOString(), '2026-09-19T18:00:00.000Z');
  assert.equal((month.to.getTime() - month.from.getTime()) / 86_400_000, 30);
});

test('rollup-backed ranges use whole-hour buckets', () => {
  for (const r of ['week', 'month'] as const) assert.equal(RANGES[r].bucketSec % 3600, 0);
});
