import { useEffect, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { setServerTime } from '../clock';
import { keys } from './hooks';
import type { Check, CheckResult, DashboardSummary, Group } from './types';

export type LiveState = 'connecting' | 'open' | 'reconnecting';

const RESULTS_KEPT = 50;

type Handlers = Record<string, (qc: QueryClient, data: any) => void>;

// Each server event patches the TanStack Query cache in place, so both tabs
// (each with its own EventSource) update without refetching whole lists.
const handlers: Handlers = {
  'check.upsert': (qc, patch: Partial<Check> & { id: number }) => {
    let known = false;
    qc.setQueryData<Check[]>(keys.checks, (list) =>
      list?.map((c) => {
        if (c.id !== patch.id) return c;
        known = true;
        return { ...c, ...patch };
      }),
    );
    qc.setQueryData<Check>(keys.check(patch.id), (c) => (c ? { ...c, ...patch } : c));
    // A check created in another tab: the list must be refetched to include it.
    if (!known) void qc.invalidateQueries({ queryKey: keys.checks, exact: true });
  },
  'check.deleted': (qc, { id }: { id: number }) => {
    qc.setQueryData<Check[]>(keys.checks, (list) => list?.filter((c) => c.id !== id));
    qc.removeQueries({ queryKey: keys.check(id) });
  },
  'check.result': (qc, result: CheckResult) => {
    qc.setQueryData<CheckResult[]>(keys.results(result.checkId), (list) => (list ? [result, ...list].slice(0, RESULTS_KEPT) : list));
  },
  'incident.opened': (qc) => void qc.invalidateQueries({ queryKey: ['incidents'] }),
  'incident.closed': (qc) => void qc.invalidateQueries({ queryKey: ['incidents'] }),
  'incident.updated': (qc) => void qc.invalidateQueries({ queryKey: ['incidents'] }),
  'group.status': (qc, { id, status }: { id: number; status: Group['status'] }) => {
    qc.setQueryData<Group[]>(keys.groups, (list) => list?.map((g) => (g.id === id ? { ...g, status } : g)));
  },
  'maintenance.changed': (qc) => void qc.invalidateQueries({ queryKey: ['maintenance'] }),
  summary: (qc, summary: DashboardSummary) => qc.setQueryData(keys.summary, summary),
  'groups.changed': (qc) => {
    void qc.invalidateQueries({ queryKey: keys.groups });
    // Group names are embedded in checks.
    void qc.invalidateQueries({ queryKey: keys.checks, exact: true });
  },
};

export function useLiveStream(url: string): LiveState {
  const qc = useQueryClient();
  const [state, setState] = useState<LiveState>('connecting');

  useEffect(() => {
    const es = new EventSource(url);

    // On every (re)connect refetch everything: events sent while we were
    // disconnected are not replayed, so resync from the source of truth.
    es.onopen = () => {
      setState('open');
      void qc.invalidateQueries();
    };
    // EventSource reconnects by itself (server sends retry: 3000).
    es.onerror = () => setState('reconnecting');

    es.addEventListener('hello', (e) => setServerTime(JSON.parse((e as MessageEvent).data).serverTime));
    for (const [type, handle] of Object.entries(handlers)) {
      es.addEventListener(type, (e) => handle(qc, JSON.parse((e as MessageEvent).data)));
    }
    return () => es.close();
  }, [qc, url]);

  return state;
}
