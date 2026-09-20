#!/usr/bin/env node
// Proves the behaviour the assignment asks for, one scenario per bullet of
// "Ожидаемое поведение", against a running stack (docker compose up).
//
//   node scripts/verify.mjs                # everything (~7 min)
//   node scripts/verify.mjs --quick        # skip the slow ones (load, month, restart)
//   node scripts/verify.mjs --only=alerts,public
//
// Every scenario creates its own group and checks named "verify-<run id>-…"
// and removes them afterwards, so it can run against a stack that already has
// real checks in it. Exit code is 1 if any scenario failed.
import { execFileSync } from 'node:child_process';
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
const EMULATOR = `http://localhost:${env.TARGET_EMULATOR_PORT ?? 4000}`;
const MAILDEV = `http://localhost:${env.MAILDEV_WEB_PORT ?? 1080}`;
// Inside the compose network the checks address the emulator by service name.
const TARGET = 'http://target-emulator:4000';

const RUN_ID = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const name = (s) => `verify-${RUN_ID}-${s}`;
// The alert dispatcher reconciles every 15 s; allow one full cycle plus slack.
const MAIL_WAIT_MS = 20_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

let cookie = '';

async function api(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return res;
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

const target = {
  // Controls what the emulated site does, without touching the check itself.
  mode: (key, mode, extra = {}) =>
    fetch(`${EMULATOR}/control/switch/${key}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode, ...extra }) }),
  hits: async (path, since) => (await (await fetch(`${EMULATOR}/control/hits?path=${encodeURIComponent(path)}${since ? `&since=${since}` : ''}`)).json()),
  reset: () => fetch(`${EMULATOR}/control/switch`, { method: 'DELETE' }),
};

// Mail is not cleared: other runs (and the user's own checks) may be in there.
// Every scenario filters by its own unique check name.
const mailsFor = async (checkName) =>
  (await (await fetch(`${MAILDEV}/email`)).json()).filter((m) => m.subject.includes(checkName)).map((m) => m.subject);

// Opens an SSE stream and collects events, like a browser tab does.
function openStream(path) {
  const ac = new AbortController();
  const events = [];
  const started = fetch(API + path, { headers: { cookie }, signal: ac.signal }).then(
    async (res) => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read().catch(() => ({ done: true }));
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const type = frame.match(/^event: (.+)$/m)?.[1];
          const data = frame.match(/^data: (.+)$/m)?.[1];
          if (type) events.push({ at: now(), type, data: JSON.parse(data ?? 'null') });
        }
      }
    },
  );
  return { events, close: () => ac.abort(), started };
}

async function waitFor(predicate, timeoutMs, what) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for: ${what}`);
}

function psql(sql) {
  return execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', env.POSTGRES_USER, '-d', env.POSTGRES_DB, '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'], {
    cwd: ROOT,
    input: sql,
    encoding: 'utf8',
  }).trim();
}

// --- helpers for building the fixtures -------------------------------------

async function makeCheck(suffix, overrides = {}) {
  return api('/checks', {
    method: 'POST',
    body: {
      name: name(suffix),
      url: `${TARGET}/switch/${name(suffix)}`,
      intervalSec: 30,
      timeoutMs: 5000,
      expectedStatus: 200,
      expectedBodySubstring: null,
      isPublic: false,
      groupId: null,
      ...overrides,
    },
  });
}

// Manual runs make the scenarios deterministic and fast: the check is paused,
// so nothing else runs it, and each run() is exactly one probe.
async function runOnce(id) {
  await waitFor(async () => (await api(`/checks/${id}/run`, { method: 'POST', raw: true })).status === 202, 15_000, 'manual run accepted');
  // Returns the check as it is once the probe has been recorded.
  return waitFor(async () => {
    const check = await api(`/checks/${id}`);
    return check.isRunning ? null : check;
  }, 15_000, 'probe finished');
}

const created = { checks: new Set(), groups: new Set() };
async function track(kind, obj) {
  created[kind].add(obj.id);
  return obj;
}
async function cleanup() {
  for (const id of created.checks) await api(`/checks/${id}`, { method: 'DELETE', raw: true });
  for (const id of created.groups) await api(`/groups/${id}`, { method: 'DELETE', raw: true });
  created.checks.clear();
  created.groups.clear();
  await target.reset();
}

// --- scenarios --------------------------------------------------------------

const scenarios = [];
const scenario = (id, title, fn, { slow = false } = {}) => scenarios.push({ id, title, fn, slow });

scenario('crud', 'Проверку можно добавить, приостановить, возобновить, запустить вручную и удалить', async (log) => {
  const check = await track('checks', await makeCheck('crud'));
  log(`создана проверка #${check.id}`);

  await api(`/checks/${check.id}/pause`, { method: 'POST' });
  assert((await api(`/checks/${check.id}`)).isPaused, 'проверка на паузе');

  await target.mode(name('crud'), 'ok');
  const before = (await api(`/checks/${check.id}`)).lastCheckedAt;
  await runOnce(check.id);
  const after = await api(`/checks/${check.id}`);
  assert(after.lastCheckedAt !== before, 'ручной запуск выполнил проверку сразу');
  assert(after.currentStatus === 'up' && after.isPaused, 'статус обновился, проверка осталась на паузе');
  log(`ручной запуск: ${after.lastResponseTimeMs} мс, статус ${after.currentStatus}`);

  const settings = { intervalSec: 60, timeoutMs: 4000 };
  const edited = await api(`/checks/${check.id}`, { method: 'PUT', body: { ...check, ...settings } });
  assert(edited.intervalSec === 60 && edited.timeoutMs === 4000, 'настройки сохранились');

  await api(`/checks/${check.id}/resume`, { method: 'POST' });
  assert(!(await api(`/checks/${check.id}`)).isPaused, 'проверка возобновлена');

  await api(`/checks/${check.id}`, { method: 'DELETE' });
  created.checks.delete(check.id);
  assert((await api(`/checks/${check.id}`, { raw: true })).status === 404, 'проверка удалена');
});

scenario('live', 'Статусы на панели и публичной странице меняются сами, без обновления страницы', async (log) => {
  // Not paused: a paused check is reported as "мониторинг приостановлен" on
  // the public page, and here the point is the live status of a working one.
  await target.mode(name('live'), 'ok');
  const check = await track('checks', await makeCheck('live', { isPublic: true }));
  await waitFor(async () => (await api(`/checks/${check.id}`)).lastCheckedAt, 35_000, 'первая проверка выполнена');

  // Two clients at once, exactly like two browser tabs: the admin dashboard
  // and the public status page.
  const admin = openStream('/stream');
  const publicPage = openStream('/public/stream');
  await sleep(1000);
  const startedAt = now();

  await runOnce(check.id);

  // The first event of a run is the "probe started" patch; the status comes
  // with the one that carries the recorded result.
  const adminEvent = await waitFor(
    () => admin.events.find((e) => e.at > startedAt && e.type === 'check.upsert' && e.data.id === check.id && e.data.currentStatus),
    10_000,
    'событие со статусом на панели',
  );
  const publicEvent = await waitFor(() => publicPage.events.find((e) => e.at > startedAt && e.type === 'check' && e.data.id === check.id), 10_000, 'событие на публичной странице');
  admin.close();
  publicPage.close();

  log(`панель получила статус через ${adminEvent.at - startedAt} мс, публичная страница — через ${publicEvent.at - startedAt} мс`);
  assert(adminEvent.data.currentStatus === 'up', 'на панель пришёл новый статус');
  assert(publicEvent.data.status === 'up', 'на публичную страницу пришёл новый статус');
  assert(!('url' in publicEvent.data), 'публичное событие не содержит URL');
  log(`публичное событие: ${JSON.stringify(publicEvent.data)}`);
});

scenario('threshold', 'Кратковременный сбой падением не считается; инцидент появляется после порога и закрывается с длительностью', async (log) => {
  const check = await track('checks', await makeCheck('threshold'));
  await api(`/checks/${check.id}/pause`, { method: 'POST' });
  await target.mode(name('threshold'), 'ok');
  await runOnce(check.id);

  await target.mode(name('threshold'), 'error', { code: 503 });
  const afterOne = await runOnce(check.id);
  const incidentsAfterOne = await api(`/incidents?checkId=${check.id}`);
  assert(afterOne.currentStatus === 'up', 'после одной неудачи статус ещё "работает"');
  assert(incidentsAfterOne.length === 0, 'после одной неудачи инцидента нет');
  log('одна неудача: статус up, инцидентов 0');

  const afterTwo = await runOnce(check.id);
  const [incident] = await api(`/incidents?checkId=${check.id}`);
  assert(afterTwo.currentStatus === 'down', 'после второй неудачи статус "упал"');
  assert(incident && !incident.endedAt, 'инцидент открыт');
  log(`порог пройден: инцидент #${incident.id} открыт в ${incident.startedAt}`);

  await sleep(2000);
  await target.mode(name('threshold'), 'ok');
  const recovered = await runOnce(check.id);
  const [closed] = await api(`/incidents?checkId=${check.id}`);
  assert(recovered.currentStatus === 'up', 'после успеха статус "работает"');
  assert(closed.endedAt && closed.durationSec >= 1, `инцидент закрыт с длительностью (${closed.durationSec} с)`);
  log(`инцидент закрыт, длительность ${closed.durationSec} с`);
});

scenario('alerts', 'Письмо при падении, письмо при восстановлении, между ними писем нет', async (log) => {
  const group = await track('groups', await api('/groups', { method: 'POST', body: { name: name('mail'), alertEmails: ['verify@example.com'] } }));
  const check = await track('checks', await makeCheck('alerts', { groupId: group.id }));
  const subject = name('alerts');
  await api(`/checks/${check.id}/pause`, { method: 'POST' });
  await target.mode(subject, 'ok');
  await runOnce(check.id);

  await target.mode(subject, 'error', { code: 500 });
  await runOnce(check.id);
  await runOnce(check.id);
  const down = await waitFor(async () => {
    const m = await mailsFor(subject);
    return m.length >= 1 ? m : null;
  }, MAIL_WAIT_MS, 'письмо о падении');
  assert(down.length === 1 && down[0].startsWith('[DOWN]'), `одно письмо [DOWN]: ${down.join(', ')}`);
  log(`письмо о падении: ${down[0]}`);

  for (let i = 0; i < 3; i++) await runOnce(check.id);
  await sleep(MAIL_WAIT_MS);
  const stillOne = await mailsFor(subject);
  assert(stillOne.length === 1, `после ещё трёх неудач писем по-прежнему одно (сейчас ${stillOne.length})`);
  log('ещё три неудачи подряд — новых писем нет');

  await target.mode(subject, 'ok');
  await runOnce(check.id);
  const up = await waitFor(async () => {
    const m = await mailsFor(subject);
    return m.length >= 2 ? m : null;
  }, MAIL_WAIT_MS, 'письмо о восстановлении');
  assert(up.length === 2 && up.some((s) => s.startsWith('[UP]')), `второе письмо — [UP]: ${up.join(', ')}`);
  log(`письмо о восстановлении: ${up.find((s) => s.startsWith('[UP]'))}`);
});

scenario('maintenance', 'В окне обслуживания проверки идут и статус виден, письма не уходят; после окна лежащий сайт даёт письмо', async (log) => {
  const group = await track('groups', await api('/groups', { method: 'POST', body: { name: name('maint'), alertEmails: ['verify@example.com'] } }));
  const check = await track('checks', await makeCheck('maint', { groupId: group.id }));
  const subject = name('maint');
  await api(`/checks/${check.id}/pause`, { method: 'POST' });
  await target.mode(subject, 'ok');
  await runOnce(check.id);

  const window_ = await api('/maintenance', { method: 'POST', body: { checkId: check.id, groupId: null, durationMinutes: 30, note: 'verify' } });
  await target.mode(subject, 'error', { code: 500 });
  await runOnce(check.id);
  const inWindow = await runOnce(check.id);
  assert(inWindow.currentStatus === 'down', 'в окне проверки идут и статус меняется на "упал"');
  const [incident] = await api(`/incidents?checkId=${check.id}`);
  assert(incident && !incident.endedAt, 'инцидент в журнале открыт');

  await sleep(MAIL_WAIT_MS);
  const duringWindow = await mailsFor(subject);
  assert(duringWindow.length === 0, `во время окна писем нет (сейчас ${duringWindow.length})`);
  log('в окне: статус "упал", инцидент открыт, писем 0');

  await api(`/maintenance/${window_.id}/end`, { method: 'POST' });
  const afterWindow = await waitFor(async () => {
    const m = await mailsFor(subject);
    return m.length >= 1 ? m : null;
  }, MAIL_WAIT_MS, 'письмо после окончания окна');
  assert(afterWindow.length === 1 && afterWindow[0].startsWith('[DOWN]'), `после окна пришло [DOWN]: ${afterWindow.join(', ')}`);
  log(`после окончания окна: ${afterWindow[0]}`);
});

scenario('overlap', 'Проверка, которая длится дольше интервала, не запускается второй раз параллельно себе', async (log) => {
  const key = name('overlap');
  await target.mode(key, 'slow', { ms: 45_000 });
  const check = await track('checks', await makeCheck('overlap', { intervalSec: 30, timeoutMs: 60_000 }));
  const since = new Date().toISOString();

  // The probe takes 45 s while the interval is 30 s: a second run must not start.
  await waitFor(async () => (await api(`/checks/${check.id}`)).isRunning, 35_000, 'проверка началась');
  await sleep(40_000);
  const during = await api(`/checks/${check.id}`);
  const hitsDuring = await target.hits(`/switch/${key}`, since);
  assert(during.isRunning, 'проверка всё ещё выполняется');
  assert(hitsDuring.length === 1, `за 40 с — ровно один запрос к сайту (сейчас ${hitsDuring.length})`);

  const stats = await api('/scheduler/stats');
  assert(stats.inFlight.filter((id) => id === check.id).length <= 1, 'проверка числится выполняющейся один раз');
  log(`через 40 с: проба ещё идёт, запросов к сайту ${hitsDuring.length}`);

  await waitFor(async () => !(await api(`/checks/${check.id}`)).isRunning, 30_000, 'проба завершилась');
  const nextRun = new Date((await api(`/checks/${check.id}`)).nextRunAt).getTime();
  assert(nextRun > now(), 'следующий запуск запланирован в будущем, залпа догоняющих проверок нет');
  log('после завершения следующий запуск запланирован на сетке, без догоняющих запусков');
}, { slow: true });

scenario('load', '50 проверок с интервалом 30 с не мешают друг другу, медленный сайт не задерживает остальные, интерфейс отвечает', async (log) => {
  const group = await track('groups', await api('/groups', { method: 'POST', body: { name: name('load'), alertEmails: [] } }));
  const slowKey = name('load-slow');
  await target.mode(slowKey, 'slow', { ms: 20_000 });
  const since = new Date().toISOString();

  const fast = [];
  for (let i = 0; i < 50; i++) {
    // Distinct URLs so the emulator's hit log can tell them apart.
    fast.push(await track('checks', await makeCheck(`load-${i}`, { url: `${TARGET}/ok?n=${i}`, groupId: group.id })));
  }
  await track('checks', await makeCheck('load-slow', { url: `${TARGET}/switch/${slowKey}`, timeoutMs: 30_000, groupId: group.id }));
  log('создано 50 быстрых проверок и одна медленная (20 с)');

  const apiLatency = [];
  const deadline = now() + 95_000;
  while (now() < deadline) {
    const t0 = now();
    await api('/checks');
    apiLatency.push(now() - t0);
    await sleep(2000);
  }

  const stats = await api('/scheduler/stats');
  // The stack may already have checks of its own pointing at /ok; count only
  // the targets this scenario created (/ok?n=0 … /ok?n=49).
  const hits = (await target.hits('/ok', since)).filter((h) => /^\?n=\d+$/.test(h.query));
  const distinctTargets = new Set(hits.map((h) => h.query)).size;
  const worstApi = Math.max(...apiLatency);
  // Independent of what the backend reports about itself: the emulator's own
  // hit log shows whether every target was really polled every 30 s while the
  // slow one was hanging.
  const perTarget = new Map();
  for (const h of hits) perTarget.set(h.query, [...(perTarget.get(h.query) ?? []), Date.parse(h.at)]);
  const gaps = [...perTarget.values()].flatMap((times) => times.sort((a, b) => a - b).slice(1).map((t, i) => t - times[i]));
  const worstGap = Math.max(...gaps);

  log(`за 95 с: ${hits.length} запросов к быстрым целям по ${distinctTargets} разным адресам`);
  log(`интервал между запросами к одной цели: максимум ${(worstGap / 1000).toFixed(1)} с при заданных 30 с`);
  log(`задержка старта по данным планировщика: p50 ${stats.startLagMs.p50} мс, p95 ${stats.startLagMs.p95} мс (окно 5 минут, могут попасть прошлые сценарии)`);
  log(`GET /api/checks во время нагрузки: медиана ${median(apiLatency)} мс, максимум ${worstApi} мс`);

  assert(hits.length >= 100, `каждая из 50 проверок отработала минимум дважды за 95 с (запросов ${hits.length})`);
  assert(distinctTargets === 50, `запросы идут по всем 50 целям (разных адресов ${distinctTargets})`);
  assert(worstGap < 40_000, `ни одна цель не ждала дольше 40 с между опросами (максимум ${(worstGap / 1000).toFixed(1)} с)`);
  assert(stats.startLagMs.p95 !== null && stats.startLagMs.p95 < 3000, `задержка старта p95 ниже 3 с (${stats.startLagMs.p95} мс)`);
  assert(worstApi < 1000, `панель отвечает быстро даже под нагрузкой (максимум ${worstApi} мс)`);
}, { slow: true });

scenario('month', 'История за месяц открывается быстро, сколько бы проверок ни накопилось', async (log) => {
  const checks = [];
  for (let i = 0; i < 10; i++) checks.push(await track('checks', await makeCheck(`hist-${i}`, { intervalSec: 30 })));
  for (const c of checks) await api(`/checks/${c.id}/pause`, { method: 'POST' });
  const ids = checks.map((c) => c.id).join(',');

  // 10 checks x 30 days x every 30 s = 864 000 rows, rows of different checks
  // interleaved in time exactly as the scheduler would write them.
  log('засеваю 30 дней истории для 10 проверок (~864 000 результатов)…');
  const seedStarted = now();
  psql(`
    INSERT INTO check_results (check_id, checked_at, is_success, response_time_ms, http_code)
    SELECT c, t + (c % 10) * interval '1 second',
           random() > 0.01, (40 + random() * 250)::int, 200
    FROM generate_series(now() - interval '30 days', now(), interval '30 seconds') t,
         unnest(ARRAY[${ids}]) c;
    INSERT INTO check_results_hourly (check_id, hour, total, failures, sum_ms_ok, max_ms_ok)
    SELECT check_id, date_trunc('hour', checked_at, 'UTC'), count(*), count(*) FILTER (WHERE NOT is_success),
           coalesce(sum(response_time_ms) FILTER (WHERE is_success), 0), max(response_time_ms) FILTER (WHERE is_success)
    FROM check_results WHERE check_id IN (${ids}) GROUP BY 1, 2
    ON CONFLICT (check_id, hour) DO UPDATE SET total = EXCLUDED.total, failures = EXCLUDED.failures,
      sum_ms_ok = EXCLUDED.sum_ms_ok, max_ms_ok = EXCLUDED.max_ms_ok;
    ANALYZE check_results;
    ANALYZE check_results_hourly;`);
  const rows = Number(psql(`SELECT count(*) FROM check_results WHERE check_id IN (${ids})`));
  log(`засеяно ${rows.toLocaleString('ru-RU')} результатов за ${Math.round((now() - seedStarted) / 1000)} с`);

  const timings = {};
  for (const range of ['month', 'week', 'day']) {
    const t0 = now();
    const stats = await api(`/checks/${checks[0].id}/stats?range=${range}`);
    timings[range] = now() - t0;
    assert(stats.buckets.length > 0 && stats.totals.checks > 0, `данные за период "${range}" вернулись`);
  }
  log(`ответ API: месяц ${timings.month} мс, неделя ${timings.week} мс, сутки ${timings.day} мс`);
  assert(timings.month < 1000, `месяц открывается быстрее секунды (${timings.month} мс)`);
  assert(timings.week < 1000, `неделя открывается быстрее секунды (${timings.week} мс)`);
}, { slow: true });

scenario('public', 'Публичная страница по ссылке без входа показывает только разрешённое', async (log) => {
  const shown = await track('checks', await makeCheck('public-yes', { isPublic: true }));
  const hidden = await track('checks', await makeCheck('public-no', { isPublic: false }));

  const anonymous = await (await fetch(`${API}/public/status`)).json();
  const names = anonymous.checks.map((c) => c.name);
  assert(names.includes(shown.name), 'публичная проверка видна без входа');
  assert(!names.includes(hidden.name), 'непубличная проверка не видна');

  const body = JSON.stringify(anonymous);
  assert(!body.includes(shown.url) && !body.includes('target-emulator'), 'URL проверок наружу не отдаются');
  assert(!body.includes('verify@example.com'), 'адреса оповещений наружу не отдаются');

  const guarded = await fetch(`${API}/checks`);
  assert(guarded.status === 401, `админский API без входа отвечает 401 (получено ${guarded.status})`);
  log(`без входа видно ${anonymous.checks.length} проверок, админский API закрыт`);

  // Taking the flag away must remove it from the public page immediately.
  const stream = openStream('/public/stream');
  await sleep(700);
  await api(`/checks/${shown.id}`, { method: 'PUT', body: { ...shown, isPublic: false } });
  const removal = await waitFor(() => stream.events.find((e) => e.type === 'check.removed' && e.data.id === shown.id), 10_000, 'снятие проверки с публичной страницы');
  stream.close();
  const after = await (await fetch(`${API}/public/status`)).json();
  assert(removal && !after.checks.some((c) => c.id === shown.id), 'после снятия флага проверка исчезает с публичной страницы');
  log('снятие флага «публичная» убирает проверку со страницы сразу');
});

scenario('restart', 'После перезапуска сервера проверки продолжаются, пропущенное — пробел в истории, а не падение', async (log) => {
  const check = await track('checks', await makeCheck('restart', { intervalSec: 30 }));
  await target.mode(name('restart'), 'ok');
  await waitFor(async () => (await api(`/checks/${check.id}`)).lastCheckedAt !== null, 45_000, 'первая проверка');
  const before = await api(`/checks/${check.id}`);

  log('останавливаю backend…');
  const stoppedAt = new Date();
  execFileSync('docker', ['compose', 'stop', 'backend'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(45_000); // longer than the interval: at least one run is missed
  const startedAt = new Date();
  execFileSync('docker', ['compose', 'start', 'backend'], { cwd: ROOT, stdio: 'ignore' });
  await waitFor(async () => (await fetch(`${API}/health`).catch(() => null))?.ok, 60_000, 'backend поднялся');
  await login();
  log(`backend не работал ${Math.round((startedAt - stoppedAt) / 1000)} с`);

  const after = await waitFor(async () => {
    const c = await api(`/checks/${check.id}`);
    return new Date(c.lastCheckedAt) > new Date(before.lastCheckedAt) ? c : null;
  }, 60_000, 'проверка возобновилась');
  assert(after.intervalSec === before.intervalSec && after.url === before.url, 'настройки проверки сохранились');
  assert(after.currentStatus === 'up', `статус не стал "упал" (сейчас ${after.currentStatus})`);
  assert((await api(`/incidents?checkId=${check.id}`)).length === 0, 'простой сервера не создал инцидент');

  const results = await api(`/checks/${check.id}/results?limit=100`);
  const gaps = results
    .map((r) => new Date(r.checkedAt).getTime())
    .sort((a, b) => a - b)
    .map((t, i, all) => (i === 0 ? 0 : t - all[i - 1]));
  const biggest = Math.max(...gaps);
  assert(!results.some((r) => new Date(r.checkedAt) > stoppedAt && new Date(r.checkedAt) < startedAt), 'за время простоя результатов не записано');
  assert(biggest > 40_000, `в истории виден пробел (${Math.round(biggest / 1000)} с)`);
  log(`в истории пробел ${Math.round(biggest / 1000)} с, инцидентов 0, проверки идут дальше`);
}, { slow: true });

// --- runner -----------------------------------------------------------------

function assert(condition, what) {
  if (!condition) throw new Error(`не выполнено: ${what}`);
  checksPassed.push(what);
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
let checksPassed = [];

async function main() {
  const args = process.argv.slice(2);
  const quick = args.includes('--quick');
  const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length).split(',');
  const selected = scenarios.filter((s) => (only ? only.includes(s.id) : !(quick && s.slow)));

  console.log(`Проверка работоспособности, запуск ${RUN_ID}`);
  console.log(`API ${API}, эмулятор ${EMULATOR}, почта ${MAILDEV}\n`);
  await login();

  const results = [];
  for (const s of selected) {
    const started = now();
    checksPassed = [];
    const lines = [];
    const log = (m) => lines.push(`      · ${m}`);
    console.log(`▶ ${s.id}: ${s.title}`);
    try {
      await s.fn(log);
      results.push({ id: s.id, ok: true });
      console.log(lines.join('\n'));
      for (const c of checksPassed) console.log(`      ✓ ${c}`);
      console.log(`  PASS ${s.id} (${((now() - started) / 1000).toFixed(1)} с)\n`);
    } catch (err) {
      results.push({ id: s.id, ok: false, err });
      console.log(lines.join('\n'));
      for (const c of checksPassed) console.log(`      ✓ ${c}`);
      console.log(`  FAIL ${s.id} (${((now() - started) / 1000).toFixed(1)} с): ${err.message}\n`);
    }
    await cleanup().catch((err) => console.log(`  (не удалось убрать за собой: ${err.message})`));
  }

  const failed = results.filter((r) => !r.ok);
  console.log('─'.repeat(70));
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}`);
  console.log(`\n${results.length - failed.length} из ${results.length} сценариев пройдено`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error('Скрипт остановлен:', err);
  await cleanup().catch(() => {});
  process.exit(1);
});
