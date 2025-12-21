import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryClient } from './queryClient';

// Store is now mainly for UI state that doesn't persist, or optimistic updates
// Real data comes from React Query

interface UIStore {
  // Keep track of session state if needed
}

export const useUIStore = create<UIStore>((set) => ({
  // ...
}));

// API Hooks

export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: async () => {
      const res = await fetch('/api/stats');
      if (!res.ok) throw new Error('Failed to fetch stats');
      return res.json();
    }
  });
}

export function useDueCards() {
  return useQuery({
    queryKey: ['cards', 'due'],
    queryFn: async () => {
      const res = await fetch('/api/cards/due');
      if (!res.ok) throw new Error('Failed to fetch due cards');
      return res.json();
    }
  });
}

export function useAnswerCard() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, rating }: { id: string, rating: string }) => {
      const res = await fetch(`/api/cards/${id}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating })
      });
      if (!res.ok) throw new Error('Failed to answer card');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cards', 'due'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    }
  });
}

export function useAddNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to create note');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['cards'] });
    }
  });
}
