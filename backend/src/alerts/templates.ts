import { config } from '../config.js';
import type { Mail } from './mailer.js';

export interface AlertContext {
  checkId: number;
  checkName: string;
  url: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  cause: string | null;
}

const fmtTime = (d: Date) =>
  new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'medium', timeZone: config.displayTimezone }).format(d) +
  ` (${config.displayTimezone})`;

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h && `${h} ч`, m && `${m} мин`, `${s} с`].filter(Boolean).join(' ');
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function render(subject: string, lines: [string, string][], link: string): Omit<Mail, 'to'> {
  const text = [...lines.map(([k, v]) => `${k}: ${v}`), '', `Панель: ${link}`].join('\n');
  const rows = lines.map(([k, v]) => `<tr><td style="color:#6b7280;padding:2px 12px 2px 0">${escape(k)}</td><td>${escape(v)}</td></tr>`).join('');
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px"><h3 style="margin:0 0 8px">${escape(subject)}</h3><table>${rows}</table><p><a href="${escape(link)}">Открыть проверку на панели</a></p></div>`;
  return { subject, text, html };
}

export function downAlert(ctx: AlertContext): Omit<Mail, 'to'> {
  return render(
    `[DOWN] ${ctx.checkName} недоступен`,
    [
      ['Проверка', ctx.checkName],
      ['URL', ctx.url],
      ['Недоступен с', fmtTime(ctx.startedAt)],
      ['Причина', ctx.cause ?? 'неизвестна'],
    ],
    `${config.publicBaseUrl}/checks/${ctx.checkId}`,
  );
}

export function upAlert(ctx: AlertContext): Omit<Mail, 'to'> {
  return render(
    `[UP] ${ctx.checkName} снова доступен`,
    [
      ['Проверка', ctx.checkName],
      ['URL', ctx.url],
      ['Недоступен с', fmtTime(ctx.startedAt)],
      ['Восстановлен', ctx.endedAt ? fmtTime(ctx.endedAt) : '—'],
      ['Длительность простоя', ctx.durationSec !== null ? fmtDuration(ctx.durationSec) : '—'],
    ],
    `${config.publicBaseUrl}/checks/${ctx.checkId}`,
  );
}
