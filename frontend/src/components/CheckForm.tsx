import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useGroups, useSaveCheck } from '../api/hooks';
import type { Check, CheckInput } from '../api/types';

const EMPTY: CheckInput = {
  name: '',
  url: 'http://target-emulator:4000/ok',
  intervalSec: 30,
  timeoutMs: 5000,
  expectedStatus: 200,
  expectedBodySubstring: null,
  isPublic: false,
  groupId: null,
};

function toInput(c: Check): CheckInput {
  return {
    name: c.name,
    url: c.url,
    intervalSec: c.intervalSec,
    timeoutMs: c.timeoutMs,
    expectedStatus: c.expectedStatus,
    expectedBodySubstring: c.expectedBodySubstring,
    isPublic: c.isPublic,
    groupId: c.groupId,
  };
}

export function CheckForm({ check, onDone }: { check?: Check; onDone: () => void }) {
  const [form, setForm] = useState<CheckInput>(check ? toInput(check) : EMPTY);
  const groups = useGroups();
  const save = useSaveCheck();

  const set = <K extends keyof CheckInput>(key: K, value: CheckInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ id: check?.id, input: form }, { onSuccess: onDone });
  };

  return (
    <form className="card form" onSubmit={submit}>
      <h3>{check ? `Редактирование: ${check.name}` : 'Новая проверка'}</h3>
      <div className="form-grid">
        <label>
          Название
          <input value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </label>
        <label className="wide">
          URL
          <input value={form.url} onChange={(e) => set('url', e.target.value)} required />
        </label>
        <label>
          Интервал, сек (30–3600)
          <input type="number" min={30} max={3600} value={form.intervalSec} onChange={(e) => set('intervalSec', Number(e.target.value))} />
        </label>
        <label>
          Таймаут, мс
          <input type="number" min={500} max={60000} value={form.timeoutMs} onChange={(e) => set('timeoutMs', Number(e.target.value))} />
        </label>
        <label>
          Ожидаемый HTTP-код
          <input type="number" min={100} max={599} value={form.expectedStatus} onChange={(e) => set('expectedStatus', Number(e.target.value))} />
        </label>
        <label className="wide">
          Подстрока в теле ответа (необязательно)
          <input value={form.expectedBodySubstring ?? ''} onChange={(e) => set('expectedBodySubstring', e.target.value || null)} />
        </label>
        <label>
          Группа
          <select value={form.groupId ?? ''} onChange={(e) => set('groupId', e.target.value ? Number(e.target.value) : null)}>
            <option value="">— без группы —</option>
            {groups.data?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={form.isPublic} onChange={(e) => set('isPublic', e.target.checked)} />
          Показывать на публичной странице
        </label>
      </div>
      {save.error && <p className="error">{save.error instanceof ApiError ? save.error.describe() : String(save.error)}</p>}
      <div className="actions">
        <button type="submit" className="primary" disabled={save.isPending}>
          Сохранить
        </button>
        <button type="button" onClick={onDone}>
          Отмена
        </button>
      </div>
    </form>
  );
}
