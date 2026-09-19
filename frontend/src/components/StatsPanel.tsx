import { useEffect, useState, type Dispatch, type KeyboardEvent, type PointerEvent, type SetStateAction } from 'react';
import { useStats } from '../api/hooks';
import type { StatsBucket, StatsRange } from '../api/types';
import { formatDuration } from '../format';

// A tick goes where the tick key (in the viewer's local time) changes between
// neighbouring buckets: every 3 h for a day, every midnight for a week, every
// 5th day for a month. The grid itself is UTC-aligned, local labels are not.
const RANGES: { value: StatsRange; label: string; tickKey: (d: Date) => string }[] = [
  { value: 'day', label: 'Сутки', tickKey: (d) => `${d.getDate()}-${Math.floor(d.getHours() / 3)}` },
  { value: 'week', label: 'Неделя', tickKey: (d) => d.toDateString() },
  { value: 'month', label: 'Месяц', tickKey: (d) => String(Math.floor(localDay(d) / 5)) },
];

function localDay(d: Date) {
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60_000) / 86_400_000);
}

const PLOT_H = 120;
const M = { top: 8, right: 12, bottom: 22, left: 48 };
const BAR_MAX = 24;
const MIN_BAR = 3; // a single failed probe must stay visible
const MIN_TICK_GAP = 44;

export function StatsPanel({ checkId }: { checkId: number }) {
  const [range, setRange] = useState<StatsRange>('day');
  const stats = useStats(checkId, range);
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();

  const data = stats.data;
  const cfg = RANGES.find((r) => r.value === range)!;

  return (
    <div className="card">
      <div className="toolbar stats-toolbar">
        <h3>История</h3>
        <div className="segmented" role="radiogroup" aria-label="Период">
          {RANGES.map((r) => (
            <button key={r.value} role="radio" aria-checked={range === r.value} className={range === r.value ? 'active' : ''} onClick={() => setRange(r.value)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {stats.error && <p className="error">Не удалось загрузить историю</p>}
      {!data ? (
        !stats.error && <p className="muted">Загрузка…</p>
      ) : (
        <div className={stats.isPlaceholderData ? 'stats stale' : 'stats'}>
          <div className="summary">
            <Tile label="Аптайм" value={data.totals.uptime === null ? '—' : `${data.totals.uptime.toFixed(2)}%`} note={`${data.totals.checks} проверок, ${data.totals.failures} неудачных`} />
            <Tile label="Среднее время ответа" value={data.totals.avgMs === null ? '—' : `${data.totals.avgMs} мс`} note="по успешным проверкам" />
            <Tile label="Инцидентов" value={String(data.totals.incidents)} />
            <Tile label="Простой" value={data.totals.downtimeSec > 0 ? formatDuration(data.totals.downtimeSec * 1000) : '—'} note="по инцидентам" />
          </div>

          <div ref={ref} className="charts" onPointerLeave={() => setHover(null)}>
            {width > 0 && (
              <>
                <Chart
                  title="Неудачные проверки, % от числа проверок"
                  kind="bars"
                  buckets={data.buckets}
                  bucketSec={data.bucketSec}
                  tickKey={cfg.tickKey}
                  width={width}
                  hover={hover}
                  onHover={setHover}
                />
                <Chart
                  title="Среднее время ответа, мс"
                  kind="line"
                  buckets={data.buckets}
                  bucketSec={data.bucketSec}
                  tickKey={cfg.tickKey}
                  width={width}
                  hover={hover}
                  onHover={setHover}
                />
              </>
            )}
          </div>
          <div className="legend muted small">
            <span>
              <i className="key key-bar" /> неудачные проверки
            </span>
            <span>
              <i className="key key-gap" /> нет данных (проверка на паузе или сервис не работал)
            </span>
          </div>

          <details className="stats-table">
            <summary>Показать таблицей</summary>
            <table>
              <thead>
                <tr>
                  <th>Период</th>
                  <th>Проверок</th>
                  <th>Неудачных</th>
                  <th>Среднее, мс</th>
                  <th>Максимум, мс</th>
                </tr>
              </thead>
              <tbody>
                {data.buckets
                  .filter((b) => b.total > 0)
                  .reverse()
                  .map((b) => (
                    <tr key={b.t}>
                      <td>{bucketLabel(b.t, data.bucketSec)}</td>
                      <td>{b.total}</td>
                      <td>{b.failures > 0 ? `${b.failures} (${pct(b)}%)` : 0}</td>
                      <td>{b.avgMs ?? '—'}</td>
                      <td>{b.maxMs ?? '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {note && <div className="muted small">{note}</div>}
    </div>
  );
}

interface ChartProps {
  title: string;
  kind: 'bars' | 'line';
  buckets: StatsBucket[];
  bucketSec: number;
  tickKey: (d: Date) => string;
  width: number;
  hover: number | null;
  onHover: Dispatch<SetStateAction<number | null>>;
}

// Hand-drawn SVG: two small single-series charts do not justify a chart library.
// Both charts share the hover index, so the crosshair moves across them together.
function Chart({ title, kind, buckets, bucketSec, tickKey, width, hover, onHover }: ChartProps) {
  const n = buckets.length;
  const plotW = Math.max(10, width - M.left - M.right);
  const band = plotW / n;
  const x = (i: number) => M.left + band * i + band / 2;

  const yMax = kind === 'bars' ? 100 : niceCeil(Math.max(0, ...buckets.map((b) => b.avgMs ?? 0)));
  const y = (v: number) => M.top + PLOT_H - (v / (yMax || 1)) * PLOT_H;
  const yTicks = kind === 'bars' ? [0, 50, 100] : [0, yMax / 2, yMax];
  const base = M.top + PLOT_H;

  const indexAt = (clientX: number, el: Element) => {
    const px = clientX - el.getBoundingClientRect().left - M.left;
    return Math.min(n - 1, Math.max(0, Math.floor(px / band)));
  };
  const onPointer = (e: PointerEvent<SVGSVGElement>) => onHover(indexAt(e.clientX, e.currentTarget));
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowLeft') onHover((h) => Math.max(0, (h ?? n) - 1));
    else if (e.key === 'ArrowRight') onHover((h) => Math.min(n - 1, (h ?? n - 2) + 1));
    else return;
    e.preventDefault();
  };

  const bw = Math.min(BAR_MAX, Math.max(1, band - 2)); // 2px surface gap between neighbours
  const h = hover !== null ? buckets[hover] : null;

  return (
    <figure className="chart">
      <figcaption className="small muted">{title}</figcaption>
      <div className="chart-box">
        <svg
          width={width}
          height={M.top + PLOT_H + M.bottom}
          role="img"
          aria-label={`${title}. Стрелки влево и вправо — перемещение по периодам.`}
          tabIndex={0}
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onFocus={() => hover === null && onHover(n - 1)}
          onBlur={() => onHover(null)}
          onKeyDown={onKey}
        >
          {yTicks.map((v) => (
            <g key={v}>
              <line className="grid" x1={M.left} x2={M.left + plotW} y1={y(v)} y2={y(v)} />
              <text className="tick" x={M.left - 6} y={y(v)} dy="0.32em" textAnchor="end">
                {kind === 'bars' ? `${v}%` : formatMs(v)}
              </text>
            </g>
          ))}
          {spaced(ticks(buckets, bucketSec, tickKey).map(({ i, at }) => ({ at, px: x(i) - band / 2 + band * ((at - Date.parse(buckets[i].t)) / (bucketSec * 1000)) }))).map(
            ({ at, px }) => (
              <text key={at} className="tick" x={px} y={base + 16} textAnchor="middle">
                {tickLabel(at, bucketSec)}
              </text>
            ),
          )}

          {/* No data: a neutral mark on the baseline, so a gap is not read as "all fine". */}
          {buckets.map((b, i) => (b.total === 0 ? <rect key={`gap${b.t}`} className="nodata" x={x(i) - band / 2} width={band} y={base - 2} height={2} /> : null))}

          {kind === 'bars' &&
            buckets.map((b, i) => {
              if (b.failures === 0) return null;
              const top = Math.min(y(pct(b)), base - MIN_BAR);
              return <path key={b.t} className={`bar${hover === i ? ' hovered' : ''}`} d={roundTop(x(i) - bw / 2, top, bw, base - top)} />;
            })}

          {kind === 'line' && <LinePath buckets={buckets} x={x} y={y} base={base} />}

          {hover !== null && (
            <>
              <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={M.top} y2={base} />
              {kind === 'line' && buckets[hover].avgMs !== null && <circle className="dot" cx={x(hover)} cy={y(buckets[hover].avgMs!)} r={4} />}
            </>
          )}
        </svg>
        {h && kind === 'line' && (
          <div className="tooltip" style={tooltipPos(x(hover!), width)}>
            <div className="small muted">{bucketLabel(h.t, bucketSec)}</div>
            {h.total === 0 ? (
              <div>нет данных</div>
            ) : (
              <>
                <div>
                  <strong>{h.avgMs !== null ? `${h.avgMs} мс` : '—'}</strong> <span className="muted">среднее</span>
                  {h.maxMs !== null && (
                    <>
                      {' '}
                      · <strong>{h.maxMs} мс</strong> <span className="muted">макс.</span>
                    </>
                  )}
                </div>
                <div>
                  <strong>{h.failures > 0 ? `${pct(h)}%` : '0%'}</strong> <span className="muted">неудачных ({h.failures} из {h.total})</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </figure>
  );
}

// Breaks the line where there is no data instead of drawing across the gap.
function LinePath({ buckets, x, y, base }: { buckets: StatsBucket[]; x: (i: number) => number; y: (v: number) => number; base: number }) {
  const runs: [number, number][][] = [];
  let cur: [number, number][] = [];
  buckets.forEach((b, i) => {
    if (b.avgMs === null) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else cur.push([x(i), y(b.avgMs)]);
  });
  if (cur.length) runs.push(cur);

  return (
    <>
      {runs.map((pts, k) =>
        pts.length === 1 ? (
          <circle key={k} className="dot" cx={pts[0][0]} cy={pts[0][1]} r={2} />
        ) : (
          <g key={k}>
            <path className="area" d={`M${pts[0][0]},${base} ${pts.map((p) => `L${p[0]},${p[1]}`).join(' ')} L${pts[pts.length - 1][0]},${base} Z`} />
            <path className="line" d={pts.map((p, j) => `${j ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ')} />
          </g>
        ),
      )}
    </>
  );
}

// Column with a 4px rounded top and a square base.
function roundTop(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

function tooltipPos(px: number, width: number) {
  return px > width * 0.6 ? { right: width - px + 12 } : { left: px + 12 };
}

const pct = (b: StatsBucket) => Math.round((b.failures / b.total) * 1000) / 10;

function niceCeil(v: number) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((c) => c >= v)!;
}

function formatMs(v: number) {
  return v >= 1000 ? `${(v / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} с` : `${Math.round(v)}`;
}

// For each bucket that contains a local boundary: the bucket index and the
// boundary instant, found by stepping through the bucket in 15 min steps
// (all real timezone offsets are multiples of 15 min).
function ticks(buckets: StatsBucket[], bucketSec: number, key: (d: Date) => string) {
  const out: { i: number; at: number }[] = [];
  const step = 15 * 60_000;
  let prev = key(new Date(Date.parse(buckets[0].t) - step));
  buckets.forEach((b, i) => {
    const start = Date.parse(b.t);
    for (let t = start; t < start + bucketSec * 1000; t += step) {
      const k = key(new Date(t));
      if (k !== prev && i > 0) out.push({ i, at: t });
      prev = k;
    }
  });
  return out;
}

// Narrow screens: drop a label that would touch the previously kept one.
function spaced<T extends { px: number }>(items: T[]): T[] {
  const kept: T[] = [];
  for (const t of items) if (!kept.length || t.px - kept[kept.length - 1].px >= MIN_TICK_GAP) kept.push(t);
  return kept;
}

function tickLabel(at: number, bucketSec: number) {
  const d = new Date(at);
  return bucketSec < 3600 ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

function bucketLabel(iso: string, bucketSec: number) {
  const a = new Date(iso);
  const b = new Date(a.getTime() + bucketSec * 1000);
  const date = a.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  const time = (d: Date) => d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time(a)}–${time(b)}`;
}

// Callback ref: the observed element appears only once data has loaded.
function useWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}
