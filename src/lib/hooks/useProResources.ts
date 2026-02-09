/**
 * useProResources — React Query hook for pro resource directory
 * Follows project convention: Zustand = local state, React Query = server data
 */

import { useQuery } from '@tanstack/react-query';
import {
  getAuthenticatedHeaders,
  SUPABASE_URL,
} from '@/lib/supabase-sync-core';
import type { ProResourceCategory, ProResource } from '@/types/pro-resources';

const QUERY_KEYS = {
  categories: ['pro-resource-categories'] as const,
  resources: ['pro-resources'] as const,
};

async function fetchCategories(): Promise<ProResourceCategory[]> {
  const headers = await getAuthenticatedHeaders();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pro_resource_categories?active=eq.true&order=sort_order.asc`,
    { headers }
  );
  if (!res.ok) throw new Error(`Failed to fetch categories: ${res.status}`);
  return res.json();
}

async function fetchResources(): Promise<ProResource[]> {
  const headers = await getAuthenticatedHeaders();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pro_resources?active=eq.true&order=featured.desc,sort_order.asc,name.asc`,
    { headers }
  );
  if (!res.ok) throw new Error(`Failed to fetch resources: ${res.status}`);
  return res.json();
}

export function useProResourceCategories() {
  return useQuery({
    queryKey: QUERY_KEYS.categories,
    queryFn: fetchCategories,
    staleTime: 5 * 60 * 1000, // 5 min
  });
}

export function useProResources(categoryId?: string) {
  const query = useQuery({
    queryKey: QUERY_KEYS.resources,
    queryFn: fetchResources,
    staleTime: 5 * 60 * 1000,
  });

  // Client-side filter by category — avoids extra network calls when switching tabs
  const filtered = categoryId
    ? query.data?.filter((r) => r.category_id === categoryId)
    : query.data;

  return {
    ...query,
    data: filtered,
  };
}
