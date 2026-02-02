// Supabase client with fetch API for app_data table
// Uses centralized environment validation and secure fetch

import { getSupabaseConfig, isSupabaseConfigured } from './env-validation';
import { secureFetch } from './ssl-pinning';
import { getValidSession } from './supabase-auth';

export interface AppDataItem {
  id: string;
  nom: string;
  description: string;
  valeur: string;
  created_at: string;
}

export interface AppDataInsert {
  nom: string;
  description: string;
  valeur: string;
}

const getAuthHeaders = async () => {
  const session = await getValidSession();
  const token = session?.access_token;

  if (!token) {
    throw new Error('Utilisateur non authentifié');
  }

  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
};

// Fetch all data from app_data table
export async function fetchAppData(): Promise<AppDataItem[]> {
  const { url } = getSupabaseConfig();
  const headers = await getAuthHeaders();

  const response = await secureFetch(`${url}/functions/v1/app-data-admin`, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    throw new Error('Erreur lors de la récupération des données');
  }

  return response.json();
}

// Add new item to app_data
export async function addAppData(item: AppDataInsert): Promise<AppDataItem> {
  const { url } = getSupabaseConfig();
  const headers = await getAuthHeaders();

  const response = await secureFetch(`${url}/functions/v1/app-data-admin`, {
    method: 'POST',
    headers,
    body: JSON.stringify(item),
  });

  if (!response.ok) {
    throw new Error("Erreur lors de l'ajout");
  }

  const data = await response.json();
  return Array.isArray(data) ? data[0] : data;
}

// Update an item in app_data
export async function updateAppData(id: string, item: Partial<AppDataInsert>): Promise<AppDataItem> {
  const { url } = getSupabaseConfig();
  const headers = await getAuthHeaders();

  const response = await secureFetch(`${url}/functions/v1/app-data-admin`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ id, ...item }),
  });

  if (!response.ok) {
    throw new Error('Erreur lors de la mise à jour');
  }

  const data = await response.json();
  return Array.isArray(data) ? data[0] : data;
}

// Delete an item from app_data
export async function deleteAppData(id: string): Promise<void> {
  const { url } = getSupabaseConfig();
  const headers = await getAuthHeaders();

  const response = await secureFetch(`${url}/functions/v1/app-data-admin`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ id }),
  });

  if (!response.ok) {
    throw new Error('Erreur lors de la suppression');
  }
}

// Re-export isSupabaseConfigured for backward compatibility
export { isSupabaseConfigured };
