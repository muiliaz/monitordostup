import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Check, CheckInput, Group, GroupInput } from './types';

export const keys = {
  me: ['me'] as const,
  checks: ['checks'] as const,
  groups: ['groups'] as const,
};

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => api<{ username: string }>('/auth/me'), retry: false });
}

export function useChecks() {
  // TEMPORARY until SSE (stage 6): poll so scheduler results show up.
  return useQuery({ queryKey: keys.checks, queryFn: () => api<Check[]>('/checks'), refetchInterval: 5000 });
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
