import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, type MonitorState } from './transitions.js';

const fresh: MonitorState = { currentStatus: 'unknown', consecutiveFailures: 0, consecutiveSuccesses: 0, failingSince: null, statusChangedAt: null };
const t = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s));

// Feeds a sequence of results, returns the transitions that happened.
function run(results: boolean[], start: MonitorState = fresh) {
  let state = start;
  const transitions: string[] = [];
  results.forEach((ok, i) => {
    const r = evaluate(state, ok, t(i * 30));
    state = r.state;
    if (r.transition) transitions.push(r.transition.kind);
  });
  return { state, transitions };
}

test('new check: first success -> up (not an incident)', () => {
  assert.deepEqual(run([true]).transitions, ['became_up']);
});

test('a single failure is not an outage', () => {
  const { state, transitions } = run([true, false, true]);
  assert.deepEqual(transitions, ['became_up']);
  assert.equal(state.currentStatus, 'up');
});

test('two failures in a row -> down, incident starts at the FIRST failure', () => {
  let state = run([true]).state;
  const first = evaluate(state, false, t(30));
  assert.equal(first.transition, null);
  const second = evaluate(first.state, false, t(60));
  assert.deepEqual(second.transition, { kind: 'went_down', startedAt: t(30) });
  assert.deepEqual(second.state.statusChangedAt, t(30));
  state = second.state;
  assert.equal(state.currentStatus, 'down');
});

test('many failures while down: exactly one went_down', () => {
  assert.deepEqual(run([true, false, false, false, false, false]).transitions, ['became_up', 'went_down']);
});

test('recovery after one success; the next outage is a new incident', () => {
  assert.deepEqual(run([true, false, false, false, true, true, false, false]).transitions, ['became_up', 'went_down', 'recovered', 'went_down']);
});

test('new check that never worked goes straight to down', () => {
  const { transitions, state } = run([false, false]);
  assert.deepEqual(transitions, ['went_down']);
  assert.equal(state.currentStatus, 'down');
});

test('failure streak interrupted by success resets failingSince', () => {
  const { state } = run([true, false, true, false]);
  assert.deepEqual(state.failingSince, t(90));
  assert.equal(state.consecutiveFailures, 1);
});
