import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Check, CheckInput, CheckResult, Group, GroupInput, Incident } from './types';

export const keys = {
  me: ['me'] as const,
  checks: ['checks'] as const,
  groups: ['groups'] as const,
  check: (id: number) => ['checks', id] as const,
  results: (id: number) => ['checks', id, 'results'] as const,
  incidents: (checkId?: number) => ['incidents', checkId ?? 'all'] as const,
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

export function useIncidents(checkId?: number) {
  const qs = checkId ? `?checkId=${checkId}` : '';
  return useQuery({ queryKey: keys.incidents(checkId), queryFn: () => api<Incident[]>(`/incidents${qs}`) });
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
