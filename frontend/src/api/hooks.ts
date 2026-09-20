import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Check, CheckInput, CheckStats, DashboardSummary, StatsRange, CheckResult, Group, GroupInput, Incident, MaintenanceInput, MaintenanceWindow } from './types';

export const keys = {
  me: ['me'] as const,
  checks: ['checks'] as const,
  groups: ['groups'] as const,
  check: (id: number) => ['checks', id] as const,
  results: (id: number) => ['checks', id, 'results'] as const,
  // Last probe result of a check, pushed by the live stream (never fetched).
  lastResult: (id: number) => ['checks', id, 'lastResult'] as const,
  stats: (id: number, range: StatsRange) => ['checks', id, 'stats', range] as const,
  incidents: (checkId?: number) => ['incidents', checkId ?? 'all'] as const,
  maintenance: (scope: 'current' | 'past') => ['maintenance', scope] as const,
  summary: ['summary'] as const,
};

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => api<{ username: string }>('/auth/me'), retry: false });
}

export function useChecks() {
  return useQuery({ queryKey: keys.checks, queryFn: () => api<Check[]>('/checks') });
}

export function useCheck(id: number) {
  return useQuery({ queryKey: keys.check(id), queryFn: () => api<Check>(`/checks/${id}`) });
}

export function useResults(id: number, limit = 50) {
  return useQuery({ queryKey: keys.results(id), queryFn: () => api<CheckResult[]>(`/checks/${id}/results?limit=${limit}`) });
}

// Charts: the previous range stays on screen while the next one loads.
// The current bucket keeps filling, so the data is refreshed periodically.
export function useStats(id: number, range: StatsRange) {
  return useQuery({
    queryKey: keys.stats(id, range),
    queryFn: () => api<CheckStats>(`/checks/${id}/stats?range=${range}`),
    placeholderData: keepPreviousData,
    refetchInterval: range === 'day' ? 30_000 : 5 * 60_000,
  });
}

// Filled only by the `check.result` stream event: it shows what a manual
// "Проверить сейчас" produced, including a failure that is still below the
// threshold and so has not changed the status.
export function useLastResult(id: number) {
  return useQuery({ queryKey: keys.lastResult(id), queryFn: () => null as CheckResult | null, enabled: false, staleTime: Infinity });
}

export function useIncidents(checkId?: number) {
  const qs = checkId ? `?checkId=${checkId}` : '';
  return useQuery({ queryKey: keys.incidents(checkId), queryFn: () => api<Incident[]>(`/incidents${qs}`) });
}

// Pushed by the `summary` SSE event; fetched once on load and on reconnect.
export function useSummary() {
  return useQuery({ queryKey: keys.summary, queryFn: () => api<DashboardSummary>('/dashboard/summary') });
}

export function useGroups() {
  return useQuery({ queryKey: keys.groups, queryFn: () => api<Group[]>('/groups') });
}

// Checks and groups affect each other (group status, group names on checks),
// so any mutation refreshes both lists.
function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.checks });
    void qc.invalidateQueries({ queryKey: keys.groups });
  };
}

export function useSaveCheck() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, input }: { id?: number; input: CheckInput }) =>
      id ? api<Check>(`/checks/${id}`, { method: 'PUT', body: input }) : api<Check>('/checks', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useCheckAction() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'pause' | 'resume' | 'run' | 'delete' }) =>
      action === 'delete'
        ? api<Check | void>(`/checks/${id}`, { method: 'DELETE' })
        : api<Check>(`/checks/${id}/${action}`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useSaveGroup() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, input }: { id?: number; input: GroupInput }) =>
      id ? api<Group>(`/groups/${id}`, { method: 'PUT', body: input }) : api<Group>('/groups', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteGroup() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/groups/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useMaintenance(scope: 'current' | 'past') {
  return useQuery({ queryKey: keys.maintenance(scope), queryFn: () => api<MaintenanceWindow[]>(`/maintenance?scope=${scope}`) });
}

export function useMaintenanceAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { kind: 'create'; input: MaintenanceInput } | { kind: 'end' | 'delete'; id: number }) =>
      a.kind === 'create'
        ? api<MaintenanceWindow>('/maintenance', { method: 'POST', body: a.input })
        : a.kind === 'end'
          ? api<MaintenanceWindow>(`/maintenance/${a.id}/end`, { method: 'POST' })
          : api<MaintenanceWindow | void>(`/maintenance/${a.id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['maintenance'] }),
  });
}
