#!/usr/bin/env node
// Arranges a believable dashboard on a running stack:
//   - emulator checks (the ones used for the scenarios) go into "Демо: эмулятор",
//   - a "Реальные сайты" group watches a few public third-party sites.
//
//   node scripts/demo-setup.mjs
//
// Idempotent: checks and groups are matched by name, existing ones are updated
// in place, so history, incidents and charts of already created checks survive.
// Intervals are deliberately polite (60 s and slower) — these are other people's
// servers.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const API = `http://localhost:${env.BACKEND_PORT ?? 3000}/api`;
const ALERT_EMAILS = (env.DEFAULT_ALERT_EMAILS ?? 'admin@example.com').split(',').map((s) => s.trim()).filter(Boolean);

const DEMO_GROUP = 'Демо: эмулятор';
const REAL_GROUP = 'Реальные сайты';

// Checked from the backend container before being added here: all answer in
// well under a second except httpbin, which is kept on purpose as a slow one.
const REAL_SITES = [
  { name: 'example.com', url: 'https://example.com', intervalSec: 60, timeoutMs: 5000, expectedStatus: 200, expectedBodySubstring: 'Example Domain' },
  { name: 'Cloudflare (trace)', url: 'https://cloudflare.com/cdn-cgi/trace', intervalSec: 60, timeoutMs: 5000, expectedStatus: 200, expectedBodySubstring: 'h=cloudflare.com' },
  // Expects 204, not 200: shows that the expected code is configurable.
  { name: 'Google (generate_204)', url: 'https://www.google.com/generate_204', intervalSec: 60, timeoutMs: 5000, expectedStatus: 204, expectedBodySubstring: null },
  { name: 'GitHub API', url: 'https://api.github.com/', intervalSec: 120, timeoutMs: 8000, expectedStatus: 200, expectedBodySubstring: 'current_user_url' },
  { name: 'Telegram', url: 'https://telegram.org', intervalSec: 120, timeoutMs: 8000, expectedStatus: 200, expectedBodySubstring: 'Telegram' },
  { name: 'Википедия (главная)', url: 'https://ru.wikipedia.org/wiki/Заглавная_страница', intervalSec: 300, timeoutMs: 10_000, expectedStatus: 200, expectedBodySubstring: 'Википедия' },
  // Answers in ~3 s: gives the response-time chart something other than a flat line.
  { name: 'httpbin (медленный)', url: 'https://httpbin.org/status/200', intervalSec: 300, timeoutMs: 15_000, expectedStatus: 200, expectedBodySubstring: null },
];

let cookie = '';

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

// Only the fields the API accepts; PUT wants the whole config.
const config = (c) => ({
  name: c.name,
  url: c.url,
  intervalSec: c.intervalSec,
  timeoutMs: c.timeoutMs,
  expectedStatus: c.expectedStatus,
  expectedBodySubstring: c.expectedBodySubstring,
  isPublic: c.isPublic,
  groupId: c.groupId,
});

async function ensureGroup(name, renameFrom = []) {
  const groups = await api('/groups');
  const existing = groups.find((g) => g.name === name);
  if (existing) return { group: existing, action: 'уже есть' };

  const old = groups.find((g) => renameFrom.includes(g.name));
  if (old) {
    await api(`/groups/${old.id}`, { method: 'PUT', body: { name, alertEmails: old.alertEmails } });
    return { group: { ...old, name }, action: `переименована из «${old.name}», проверки и их история остались на месте` };
  }
  return { group: await api('/groups', { method: 'POST', body: { name, alertEmails: ALERT_EMAILS } }), action: 'создана' };
}

async function main() {
  await login();

  const demo = await ensureGroup(DEMO_GROUP, ['Эмулятор']);
  console.log(`Группа «${DEMO_GROUP}»: ${demo.action}`);

  // Everything pointing at the emulator belongs to the demo group. Only the
  // group changes, so results, incidents and charts stay with the check.
  const checks = await api('/checks');
  const strays = checks.filter((c) => c.url.includes('target-emulator') && c.groupId !== demo.group.id);
  for (const c of strays) {
    await api(`/checks/${c.id}`, { method: 'PUT', body: { ...config(c), groupId: demo.group.id } });
    console.log(`  перенесена в демо-группу: «${c.name}» (история сохранена)`);
  }
  if (strays.length === 0) console.log('  переносить нечего');

  const real = await ensureGroup(REAL_GROUP);
  console.log(`\nГруппа «${REAL_GROUP}»: ${real.action}, оповещения на ${ALERT_EMAILS.join(', ') || '—'} (MailDev)`);

  for (const site of REAL_SITES) {
    const body = { ...site, isPublic: true, groupId: real.group.id };
    const existing = checks.find((c) => c.name === site.name);
    if (existing) {
      await api(`/checks/${existing.id}`, { method: 'PUT', body });
      console.log(`  обновлена: ${site.name} (${site.url})`);
    } else {
      const created = await api('/checks', { method: 'POST', body });
      console.log(`  добавлена #${created.id}: ${site.name} (${site.url}), интервал ${site.intervalSec} с`);
    }
  }

  console.log('\nГотово. Первые результаты появятся в течение интервала каждой проверки.');
  console.log('История у новых проверок пустая и наполняется по-настоящему: графики за неделю и месяц будут заполняться по мере работы.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
