import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useDeleteGroup, useGroups, useSaveGroup } from '../api/hooks';
import type { Group } from '../api/types';
import { StatusBadge } from '../components/StatusBadge';

function parseEmails(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function GroupForm({ group, onDone }: { group?: Group; onDone: () => void }) {
  const [name, setName] = useState(group?.name ?? '');
  const [emails, setEmails] = useState(group?.alertEmails.join('\n') ?? '');
  const save = useSaveGroup();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ id: group?.id, input: { name, alertEmails: parseEmails(emails) } }, { onSuccess: onDone });
  };

  return (
    <form className="card form" onSubmit={submit}>
      <h3>{group ? `Группа: ${group.name}` : 'Новая группа'}</h3>
      <label>
        Название
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        Адреса для оповещений (по одному в строке или через запятую)
        <textarea rows={4} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="ops@example.com" />
      </label>
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

export function GroupsPage() {
  const groups = useGroups();
  const remove = useDeleteGroup();
  const [editing, setEditing] = useState<Group | 'new' | null>(null);

  if (groups.isLoading) return <p>Загрузка…</p>;

  return (
    <section>
      <div className="toolbar">
        <h2>Группы и оповещения</h2>
        <button className="primary" onClick={() => setEditing('new')}>
          + Добавить группу
        </button>
      </div>

      {editing && <GroupForm key={editing === 'new' ? 'new' : editing.id} group={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}

      <p className="muted small">
        Письма о падении и восстановлении проверки уходят на адреса её группы. Для проверок без группы — на адреса из
        переменной <code>DEFAULT_ALERT_EMAILS</code> в <code>.env</code>.
      </p>

      <div className="card">
        {groups.data?.length === 0 ? (
          <p className="muted">Групп пока нет.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Статус</th>
                <th>Группа</th>
                <th>Проверок</th>
                <th>Адреса оповещений</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {groups.data?.map((g) => (
                <tr key={g.id}>
                  <td>
                    <StatusBadge status={g.status} />
                  </td>
                  <td>{g.name}</td>
                  <td>{g.checkCount}</td>
                  <td className="small">{g.alertEmails.length ? g.alertEmails.join(', ') : <span className="muted">не заданы</span>}</td>
                  <td className="row-actions">
                    <button onClick={() => setEditing(g)}>Изменить</button>
                    <button
                      className="danger"
                      onClick={() => {
                        if (confirm(`Удалить группу «${g.name}»? Проверки останутся без группы.`)) remove.mutate(g.id);
                      }}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
