export class ApiError extends Error {
  constructor(
    public status: number,
    public body: { error?: string; issues?: { path: string; message: string }[] },
  ) {
    super(body.error ?? `HTTP ${status}`);
  }

  // Human-readable message for forms.
  describe(): string {
    if (this.body.issues?.length) {
      return this.body.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
    }
    return this.message;
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}
