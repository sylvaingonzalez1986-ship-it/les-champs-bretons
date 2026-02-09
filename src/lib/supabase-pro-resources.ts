import { getSupabaseConfig, isSupabaseConfigured } from './env-validation';
import { secureFetch } from './ssl-pinning';
import { getValidSession } from './supabase-auth';
import type { ProResource, ProResourceCategory } from '@/types/pro-resources';

interface ProResourcesAdminResponse {
  categories: ProResourceCategory[];
  resources: ProResource[];
}

const readResponseError = async (response: Response, fallbackMessage: string) => {
  let message = fallbackMessage;

  try {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      if (typeof data?.error === 'string') {
        message = data.error;
      } else if (typeof data?.message === 'string') {
        message = data.message;
      }
    } else {
      const text = await response.text();
      if (text.trim()) {
        message = text.trim();
      }
    }
  } catch {
    // Ignore parse errors and keep fallback message.
  }

  return `${message} (HTTP ${response.status})`;
};

const getAuthHeaders = async () => {
  const session = await getValidSession();
  const token = session?.access_token;

  if (!token) {
    throw new Error('Utilisateur non authentifie');
  }

  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
};

export { isSupabaseConfigured };

export async function fetchProResourcesAdmin(): Promise<ProResourcesAdminResponse> {
  const { url } = getSupabaseConfig();
  const headers = await getAuthHeaders();

  const response = await secureFetch(`${url}/functions/v1/pro-resources-admin`, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response, 'Erreur lors du chargement du reseau pro'));
  }

  return response.json();
}

export async function addProResourceCategory(input: {
  name: string;
  slug: string;
  description?: string | null;
  color?: string | null;
  sort_order?: number;
  active?: boolean;
}): Promise<ProResourceCategory> {
  const { url } = getSupabaseConfig();
  const headers = await getAuthHeaders();

  const response = await secureFetch(`${url}/functions/v1/pro-resources-admin`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ type: 'category', data: input }),
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response, "Erreur lors de l'ajout de la categorie"));
  }

  return response.json();
}

export async function updateProResourceCategory(
  id: string,
  updates: Partial<Pick<ProResourceCategory, 'name' | 'description' | 'color' | 'sort_order' | 'active'>>
): Promise<ProResourceCategory> {
  const { url } = getSupabaseConfig();
  const headers = await getAuthHeaders();

  const response = await secureFetch(`${url}/functions/v1/pro-resources-admin`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ type: 'category', id, ...updates }),
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response, 'Erreur lors de la mise a jour de la categorie'));
  }

  return response.json();
}

export async function deleteProResourceCategory(id: string): Promise<void> {
  const { url } = getSupabaseConfig();
  const headers = await getAuthHeaders();

  const response = await secureFetch(`${url}/functions/v1/pro-resources-admin`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ type: 'category', id }),
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response, 'Erreur lors de la suppression de la categorie'));
  }
}

export async function addProResource(input: {
  category_id: string;
  name: string;
  description?: string | null;
  logo_url?: string | null;
  website_url?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  region?: string | null;
  tags?: string[] | null;
  featured?: boolean;
  active?: boolean;
  sort_order?: number;
}): Promise<ProResource> {
  const { url } = getSupabaseConfig();
  const headers = await getAuthHeaders();

  const response = await secureFetch(`${url}/functions/v1/pro-resources-admin`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ type: 'resource', data: input }),
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response, "Erreur lors de l'ajout de la ressource"));
  }

  return response.json();
}

export async function updateProResource(
  id: string,
  updates: Partial<Omit<ProResource, 'id'>>
): Promise<ProResource> {
  const { url } = getSupabaseConfig();
  const headers = await getAuthHeaders();

  const response = await secureFetch(`${url}/functions/v1/pro-resources-admin`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ type: 'resource', id, ...updates }),
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response, 'Erreur lors de la mise a jour de la ressource'));
  }

  return response.json();
}

export async function deleteProResource(id: string): Promise<void> {
  const { url } = getSupabaseConfig();
  const headers = await getAuthHeaders();

  const response = await secureFetch(`${url}/functions/v1/pro-resources-admin`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ type: 'resource', id }),
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response, 'Erreur lors de la suppression de la ressource'));
  }
}
