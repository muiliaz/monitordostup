// Performs one HTTP check. Never throws: every failure becomes a ProbeResult.

export interface ProbeTarget {
  url: string;
  timeoutMs: number;
  expectedStatus: number;
  expectedBodySubstring: string | null;
}

export interface ProbeResult {
  isSuccess: boolean;
  responseTimeMs: number;
  httpCode: number | null;
  errorMessage: string | null;
}

// Enough for any sane "is the page alive" substring; protects memory from huge bodies.
const MAX_BODY_BYTES = 1024 * 1024;

async function readBodyCapped(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString('utf8');
}

function describeError(err: unknown, timeoutMs: number): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError') return `timeout after ${timeoutMs} ms`;
    if (err.name === 'AbortError') return 'aborted';
    // undici wraps network errors: the useful part (ECONNREFUSED, ENOTFOUND…) is in `cause`.
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    if (cause?.code) return `${cause.code}${cause.message ? `: ${cause.message}` : ''}`;
    return err.message;
  }
  return String(err);
}

// `abort` lets the scheduler cancel in-flight probes on shutdown.
export async function httpProbe(target: ProbeTarget, abort?: AbortSignal): Promise<ProbeResult> {
  const signals = [AbortSignal.timeout(target.timeoutMs), ...(abort ? [abort] : [])];
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  try {
    const res = await fetch(target.url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.any(signals),
      headers: { 'user-agent': 'monitordostup/1.0' },
    });
    // Response time covers the body too: that is what a visitor waits for.
    const body = await readBodyCapped(res);
    const responseTimeMs = elapsed();

    if (res.status !== target.expectedStatus) {
      return { isSuccess: false, responseTimeMs, httpCode: res.status, errorMessage: `expected HTTP ${target.expectedStatus}, got ${res.status}` };
    }
    if (target.expectedBodySubstring && !body.includes(target.expectedBodySubstring)) {
      return { isSuccess: false, responseTimeMs, httpCode: res.status, errorMessage: `body does not contain "${target.expectedBodySubstring}"` };
    }
    return { isSuccess: true, responseTimeMs, httpCode: res.status, errorMessage: null };
  } catch (err) {
    return { isSuccess: false, responseTimeMs: elapsed(), httpCode: null, errorMessage: describeError(err, target.timeoutMs) };
  }
}
