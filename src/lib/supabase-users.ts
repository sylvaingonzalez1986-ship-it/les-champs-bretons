/**
 * Supabase Users Management API
 * Fonctions pour gérer les utilisateurs (profiles) et lier les producteurs
 *
 * Phase 3 - Sécurité:
 * - Validation Zod des entrées/sorties
 * - Masquage des erreurs techniques
 * - Timeouts globaux
 */

import { getValidSession, AuthSession, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-auth';
import {
  userProfileSchema,
  userProfileUpdateSchema,
  producerSchema,
  validateSafe,
  validateArraySafe,
  toUserError,
  USER_ERROR_MESSAGES,
  sanitizeString,
} from './validation';

// Timeout global pour les requêtes (15 secondes)
const REQUEST_TIMEOUT = 15000;

// Get headers with a valid (non-expired) token - use this for API calls
const getValidHeaders = (session: AuthSession) => {
  return {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
};

/**
 * Helper pour les requêtes avec timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout: number = REQUEST_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if ((error as Error).name === 'AbortError') {
      throw new Error('Timeout: Le serveur ne répond pas');
    }
    throw error;
  }
}

export function isUsersApiConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// Types
export type UserRole = 'client' | 'pro' | 'producer' | 'admin';
export type UserCategory = 'restaurateur' | 'epicerie' | 'grossiste' | 'producteur_maraicher' | 'autre' | null;
export type ProStatus = 'pending' | 'approved' | 'rejected' | null;

export interface UserProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  birth_date: string | null;
  role: UserRole;
  category: UserCategory;
  pro_status: ProStatus; // Status de validation du compte pro
  phone: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  company_name: string | null;
  business_name: string | null;
  siret: string | null;
  tva_number: string | null;
  user_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProducerWithProfile {
  id: string;
  name: string;
  profile_id: string | null;
  siret: string | null;
  tva_number: string | null;
  region: string | null;
}

// User role labels
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  client: 'Client',
  pro: 'Professionnel',
  producer: 'Producteur',
  admin: 'Administrateur',
};

export const USER_ROLE_COLORS: Record<UserRole, string> = {
  client: '#6BB5D9', // Sky Blue
  pro: '#4A9B9B', // Teal
  producer: '#5A9E5A', // Hemp Green
  admin: '#D4A853', // Gold
};

// Pro status labels and colors
export const PRO_STATUS_LABELS: Record<string, string> = {
  pending: 'En attente',
  approved: 'Approuve',
  rejected: 'Refuse',
};

export const PRO_STATUS_COLORS: Record<string, string> = {
  pending: '#F59E0B', // Orange/Amber
  approved: '#22C55E', // Green
  rejected: '#EF4444', // Red
};

// User category labels
export const USER_CATEGORY_LABELS: Record<string, string> = {
  restaurateur: 'Restaurateur',
  epicerie: 'Épicerie',
  grossiste: 'Grossiste',
  producteur_maraicher: 'Producteur Maraîcher',
  autre: 'Autre',
};

/**
 * Fetch all user profiles with optional filters
 */
export async function fetchUsers(filters?: {
  role?: UserRole;
  category?: UserCategory;
  search?: string;
}): Promise<{ users: UserProfile[]; error: Error | null }> {
  if (!isUsersApiConfigured()) {
    return { users: [], error: new Error(USER_ERROR_MESSAGES.SERVER) };
  }

  // Get a valid (non-expired) session
  const session = await getValidSession();

  if (!session?.access_token) {
    return { users: [], error: new Error(USER_ERROR_MESSAGES.AUTH) };
  }

  try {
    let url = `${SUPABASE_URL}/rest/v1/profiles?select=*&order=created_at.desc`;

    if (filters?.role) {
      url += `&role=eq.${encodeURIComponent(filters.role)}`;
    }

    if (filters?.category) {
      url += `&category=eq.${encodeURIComponent(filters.category)}`;
    }

    if (filters?.search) {
      const sanitizedSearch = sanitizeString(filters.search);
      url += `&or=(full_name.ilike.*${encodeURIComponent(sanitizedSearch)}*,email.ilike.*${encodeURIComponent(sanitizedSearch)}*)`;
    }

    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: getValidHeaders(session),
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const data = await response.json();

    // Valider les données reçues
    const validatedUsers = validateArraySafe(userProfileSchema, data);

    return { users: validatedUsers as UserProfile[], error: null };
  } catch (error) {
    const userMessage = toUserError(error, 'fetchUsers');
    return { users: [], error: new Error(userMessage) };
  }
}

/**
 * Update a user's role (admin only)
 */
export async function updateUserRole(
  userId: string,
  newRole: UserRole
): Promise<{ success: boolean; error: Error | null }> {
  if (!isUsersApiConfigured()) {
    return { success: false, error: new Error(USER_ERROR_MESSAGES.SERVER) };
  }

  const session = await getValidSession();
  if (!session?.access_token) {
    return { success: false, error: new Error(USER_ERROR_MESSAGES.AUTH) };
  }

  // Valider les entrées
  if (!userId || typeof userId !== 'string') {
    return { success: false, error: new Error(USER_ERROR_MESSAGES.VALIDATION) };
  }

  const validRoles = ['client', 'pro', 'producer', 'admin'];
  if (!validRoles.includes(newRole)) {
    return { success: false, error: new Error(USER_ERROR_MESSAGES.VALIDATION) };
  }

  try {
    // Get the current user's profile to check admin role
    const checkResponse = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=role`,
      {
        method: 'GET',
        headers: getValidHeaders(session),
      }
    );

    if (!checkResponse.ok) {
      return { success: false, error: new Error(USER_ERROR_MESSAGES.PERMISSION) };
    }

    const adminData = await checkResponse.json();
    if (!Array.isArray(adminData) || adminData.length === 0 || adminData[0].role !== 'admin') {
      return { success: false, error: new Error(USER_ERROR_MESSAGES.PERMISSION) };
    }

    // Admin check passed, proceed with update
    const response = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        headers: getValidHeaders(session),
        body: JSON.stringify({
          role: newRole,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    return { success: true, error: null };
  } catch (error) {
    const userMessage = toUserError(error, 'updateUserRole');
    return { success: false, error: new Error(userMessage) };
  }
}

/**
 * Update a user's pro status (admin only)
 * Used to approve or reject pro account requests
 */
export async function updateProStatus(
  userId: string,
  status: ProStatus
): Promise<{ success: boolean; error: Error | null }> {
  if (!isUsersApiConfigured()) {
    return { success: false, error: new Error(USER_ERROR_MESSAGES.SERVER) };
  }

  const session = await getValidSession();
  if (!session?.access_token) {
    return { success: false, error: new Error(USER_ERROR_MESSAGES.AUTH) };
  }

  // Valider les entrées
  if (!userId || typeof userId !== 'string') {
    return { success: false, error: new Error(USER_ERROR_MESSAGES.VALIDATION) };
  }

  const validStatuses = ['pending', 'approved', 'rejected', null];
  if (!validStatuses.includes(status)) {
    return { success: false, error: new Error(USER_ERROR_MESSAGES.VALIDATION) };
  }

  try {
    // Get the current user's profile to check admin role
    const checkResponse = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=role`,
      {
        method: 'GET',
        headers: getValidHeaders(session),
      }
    );

    if (!checkResponse.ok) {
      return { success: false, error: new Error(USER_ERROR_MESSAGES.PERMISSION) };
    }

    const adminData = await checkResponse.json();
    if (!Array.isArray(adminData) || adminData.length === 0 || adminData[0].role !== 'admin') {
      return { success: false, error: new Error(USER_ERROR_MESSAGES.PERMISSION) };
    }

    // Admin check passed, proceed with update
    const response = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        headers: getValidHeaders(session),
        body: JSON.stringify({
          pro_status: status,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    return { success: true, error: null };
  } catch (error) {
    const userMessage = toUserError(error, 'updateProStatus');
    return { success: false, error: new Error(userMessage) };
  }
}

/**
 * Update a user's category
 */
export async function updateUserCategory(
  userId: string,
  category: UserCategory
): Promise<{ success: boolean; error: Error | null }> {
  if (!isUsersApiConfigured()) {
    return { success: false, error: new Error(USER_ERROR_MESSAGES.SERVER) };
  }

  const session = await getValidSession();
  if (!session?.access_token) {
    return { success: false, error: new Error(USER_ERROR_MESSAGES.AUTH) };
  }

  // Valider les entrées
  if (!userId || typeof userId !== 'string') {
    return { success: false, error: new Error(USER_ERROR_MESSAGES.VALIDATION) };
  }

  try {
    const response = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        headers: getValidHeaders(session),
        body: JSON.stringify({
          category,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    return { success: true, error: null };
  } catch (error) {
    const userMessage = toUserError(error, 'updateUserCategory');
    return { success: false, error: new Error(userMessage) };
  }
}

/**
 * Update user's SIRET and TVA number
 */
export async function updateUserBusinessInfo(
  userId: string,
  updates: { siret?: string | null; tva_number?: string | null }
): Promise<{ success: boolean; error: Error | null }> {
  if (!isUsersApiConfigured()) {
    return { success: false, error: new Error(USER_ERROR_MESSAGES.SERVER) };
  }

  const session = await getValidSession();
  if (!session?.access_token) {
    return { success: false, error: new Error(USER_ERROR_MESSAGES.AUTH) };
  }

  // Valider les entrées
  if (!userId || typeof userId !== 'string') {
    return { success: false, error: new Error(USER_ERROR_MESSAGES.VALIDATION) };
  }

  // Valider SIRET si fourni
  if (updates.siret && !/^\d{14}$/.test(updates.siret)) {
    return { success: false, error: new Error('SIRET invalide (14 chiffres requis)') };
  }

  // Valider TVA si fourni
  if (updates.tva_number && !/^FR\d{11}$/.test(updates.tva_number)) {
    return { success: false, error: new Error('Numéro TVA invalide (format: FR + 11 chiffres)') };
  }

  try {
    const response = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        headers: getValidHeaders(session),
        body: JSON.stringify({
          ...updates,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    return { success: true, error: null };
  } catch (error) {
    const userMessage = toUserError(error, 'updateUserBusinessInfo');
    return { success: false, error: new Error(userMessage) };
  }
}

/**
 * Update multiple user fields at once
 */
export async function updateUserProfile(
  userId: string,
  updates: Partial<Pick<UserProfile, 'role' | 'category' | 'siret' | 'tva_number' | 'full_name'>>
): Promise<{ success: boolean; error: Error | null }> {
  if (!isUsersApiConfigured()) {
    return { success: false, error: new Error(USER_ERROR_MESSAGES.SERVER) };
  }

  const session = await getValidSession();
  if (!session?.access_token) {
    return { success: false, error: new Error(USER_ERROR_MESSAGES.AUTH) };
  }

  // Valider les entrées
  if (!userId || typeof userId !== 'string') {
    return { success: false, error: new Error(USER_ERROR_MESSAGES.VALIDATION) };
  }

  try {
    // Sanitize string inputs
    const sanitizedUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (updates.role) sanitizedUpdates.role = updates.role;
    if (updates.category !== undefined) sanitizedUpdates.category = updates.category;
    if (updates.siret !== undefined) sanitizedUpdates.siret = sanitizeString(updates.siret);
    if (updates.tva_number !== undefined) sanitizedUpdates.tva_number = sanitizeString(updates.tva_number);
    if (updates.full_name !== undefined) sanitizedUpdates.full_name = sanitizeString(updates.full_name);

    const response = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        headers: getValidHeaders(session),
        body: JSON.stringify(sanitizedUpdates),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    return { success: true, error: null };
  } catch (error) {
    const userMessage = toUserError(error, 'updateUserProfile');
    return { success: false, error: new Error(userMessage) };
  }
}

/**
 * Fetch producers with their profile_id (for linking)
 */
export async function fetchProducersWithProfiles(): Promise<{
  producers: ProducerWithProfile[];
  error: Error | null;
}> {
  if (!isUsersApiConfigured()) {
    return { producers: [], error: new Error(USER_ERROR_MESSAGES.SERVER) };
  }

  const session = await getValidSession();
  if (!session?.access_token) {
    return { producers: [], error: new Error(USER_ERROR_MESSAGES.AUTH) };
  }

  try {
    const response = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/producers?select=id,name,profile_id,siret,tva_number,region&order=name`,
      {
        method: 'GET',
        headers: getValidHeaders(session),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const data = await response.json();
    return { producers: data as ProducerWithProfile[], error: null };
  } catch (error) {
    const userMessage = toUserError(error, 'fetchProducersWithProfiles');
    return { producers: [], error: new Error(userMessage) };
  }
}

/**
 * Fetch users with role = 'producer' (for linking to a producer)
 */
export async function fetchProducerUsers(): Promise<{
  users: UserProfile[];
  error: Error | null;
}> {
  if (!isUsersApiConfigured()) {
    return { users: [], error: new Error(USER_ERROR_MESSAGES.SERVER) };
  }

  const session = await getValidSession();
  if (!session?.access_token) {
    return { users: [], error: new Error(USER_ERROR_MESSAGES.AUTH) };
  }

  try {
    const response = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/profiles?role=eq.producer&select=*&order=full_name`,
      {
        method: 'GET',
        headers: getValidHeaders(session),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const data = await response.json();
    const validatedUsers = validateArraySafe(userProfileSchema, data);
    return { users: validatedUsers as UserProfile[], error: null };
  } catch (error) {
    const userMessage = toUserError(error, 'fetchProducerUsers');
    return { users: [], error: new Error(userMessage) };
  }
}

/**
 * Link a producer to a profile
 * If the producer doesn't exist in Supabase, it will be created first
 */
export async function linkProducerToProfile(
  producerId: string,
  profileId: string | null,
  producerData?: { name: string; region?: string; siret?: string; tva_number?: string }
): Promise<{ success: boolean; error: Error | null }> {
  if (!isUsersApiConfigured()) {
    return { success: false, error: new Error(USER_ERROR_MESSAGES.SERVER) };
  }

  const session = await getValidSession();
  if (!session?.access_token) {
    return { success: false, error: new Error(USER_ERROR_MESSAGES.AUTH) };
  }

  // Valider les entrées
  if (!producerId || typeof producerId !== 'string') {
    return { success: false, error: new Error(USER_ERROR_MESSAGES.VALIDATION) };
  }

  try {
    // First, check if the producer exists in Supabase
    const checkResponse = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/producers?id=eq.${encodeURIComponent(producerId)}&select=id`,
      {
        method: 'GET',
        headers: getValidHeaders(session),
      }
    );

    if (!checkResponse.ok) {
      throw new Error(`HTTP error: ${checkResponse.status}`);
    }

    const existing = await checkResponse.json();

    // If producer doesn't exist in Supabase, create it first
    if (!existing || existing.length === 0) {
      if (!producerData) {
        return {
          success: false,
          error: new Error('Le producteur n\'existe pas. Veuillez d\'abord synchroniser les données.')
        };
      }

      // Create the producer in Supabase
      const createResponse = await fetchWithTimeout(
        `${SUPABASE_URL}/rest/v1/producers`,
        {
          method: 'POST',
          headers: getValidHeaders(session),
          body: JSON.stringify({
            id: producerId,
            name: sanitizeString(producerData.name),
            region: sanitizeString(producerData.region) || null,
            siret: sanitizeString(producerData.siret) || null,
            tva_number: sanitizeString(producerData.tva_number) || null,
            profile_id: profileId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        }
      );

      if (!createResponse.ok) {
        throw new Error(`HTTP error: ${createResponse.status}`);
      }

      return { success: true, error: null };
    }

    // Producer exists, update it with the profile_id
    const response = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/producers?id=eq.${encodeURIComponent(producerId)}`,
      {
        method: 'PATCH',
        headers: getValidHeaders(session),
        body: JSON.stringify({
          profile_id: profileId,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    return { success: true, error: null };
  } catch (error) {
    const userMessage = toUserError(error, 'linkProducerToProfile');
    return { success: false, error: new Error(userMessage) };
  }
}

/**
 * Get a single user by ID
 */
export async function fetchUserById(userId: string): Promise<{
  user: UserProfile | null;
  error: Error | null;
}> {
  if (!isUsersApiConfigured()) {
    return { user: null, error: new Error(USER_ERROR_MESSAGES.SERVER) };
  }

  const session = await getValidSession();
  if (!session?.access_token) {
    return { user: null, error: new Error(USER_ERROR_MESSAGES.AUTH) };
  }

  // Valider l'entrée
  if (!userId || typeof userId !== 'string') {
    return { user: null, error: new Error(USER_ERROR_MESSAGES.VALIDATION) };
  }

  try {
    const response = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=*`,
      {
        method: 'GET',
        headers: getValidHeaders(session),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const data = await response.json();
    const user = Array.isArray(data) && data.length > 0 ? data[0] : null;

    // Valider les données reçues
    if (user) {
      const validated = validateSafe(userProfileSchema, user);
      return { user: validated as UserProfile, error: null };
    }

    return { user: null, error: null };
  } catch (error) {
    const userMessage = toUserError(error, 'fetchUserById');
    return { user: null, error: new Error(userMessage) };
  }
}

/**
 * Count users by role
 */
export async function countUsersByRole(): Promise<{
  counts: Record<UserRole, number>;
  error: Error | null;
}> {
  const defaultCounts = { client: 0, pro: 0, producer: 0, admin: 0 };

  if (!isUsersApiConfigured()) {
    return { counts: defaultCounts, error: new Error(USER_ERROR_MESSAGES.SERVER) };
  }

  const session = await getValidSession();
  if (!session?.access_token) {
    return { counts: defaultCounts, error: new Error(USER_ERROR_MESSAGES.AUTH) };
  }

  try {
    const counts: Record<UserRole, number> = { ...defaultCounts };

    const response = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/profiles?select=role`,
      {
        method: 'GET',
        headers: getValidHeaders(session),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const data = await response.json();
    (data || []).forEach((user: { role: UserRole }) => {
      if (user.role in counts) {
        counts[user.role]++;
      }
    });

    return { counts, error: null };
  } catch (error) {
    const userMessage = toUserError(error, 'countUsersByRole');
    return { counts: defaultCounts, error: new Error(userMessage) };
  }
}

/**
 * Pre-register a user role/category for when they sign up
 * Stores pending invitations that get applied when user creates their account
 */
export interface PendingInvite {
  email: string;
  full_name?: string;
  role: UserRole;
  category?: UserCategory;
  invited_at: string;
  invited_by: string;
}

// Store pending invites in a separate table or localStorage
// For now, we'll update existing profiles only

/**
 * Update an existing user's role and info (for users who have already signed up)
 * To add a new user: they must first sign up, then admin can update their role
 */
export async function inviteUser(data: {
  email: string;
  full_name?: string;
  role?: UserRole;
  category?: UserCategory;
}): Promise<{ user: UserProfile | null; error: Error | null }> {
  if (!isUsersApiConfigured()) {
    return { user: null, error: new Error(USER_ERROR_MESSAGES.SERVER) };
  }

  const session = await getValidSession();
  if (!session?.access_token) {
    return { user: null, error: new Error(USER_ERROR_MESSAGES.AUTH) };
  }

  if (!data.email) {
    return { user: null, error: new Error('L\'email est requis') };
  }

  // Valider et sanitizer l'email
  const email = sanitizeString(data.email).toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { user: null, error: new Error('Email invalide') };
  }

  try {
    // Check if user already has a profile (meaning they signed up via auth)
    const checkResponse = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=*`,
      {
        method: 'GET',
        headers: getValidHeaders(session),
      }
    );

    if (!checkResponse.ok) {
      throw new Error(`HTTP error: ${checkResponse.status}`);
    }

    const existing = await checkResponse.json();

    if (existing && existing.length > 0) {
      // User exists - update their profile
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (data.role) updateData.role = data.role;
      if (data.category !== undefined) updateData.category = data.category;
      if (data.full_name) updateData.full_name = sanitizeString(data.full_name);

      const updateResponse = await fetchWithTimeout(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(existing[0].id)}`,
        {
          method: 'PATCH',
          headers: getValidHeaders(session),
          body: JSON.stringify(updateData),
        }
      );

      if (!updateResponse.ok) {
        throw new Error(`HTTP error: ${updateResponse.status}`);
      }

      const result = await updateResponse.json();
      const user = Array.isArray(result) ? result[0] : result;
      const validated = validateSafe(userProfileSchema, user);
      return { user: validated as UserProfile, error: null };
    } else {
      // User doesn't exist - they need to sign up first
      return {
        user: null,
        error: new Error(
          `L'utilisateur n'a pas encore de compte. ` +
          `Demandez-lui de s'inscrire d'abord, puis vous pourrez modifier son rôle.`
        )
      };
    }
  } catch (error) {
    const userMessage = toUserError(error, 'inviteUser');
    return { user: null, error: new Error(userMessage) };
  }
}

/**
 * Delete a user from the database (admin only)
 * This will delete the profile from the profiles table
 * Note: This does NOT delete the user from Supabase Auth - that requires admin API access
 */
export async function deleteUser(userId: string): Promise<{ success: boolean; error: Error | null }> {
  if (!isUsersApiConfigured()) {
    return { success: false, error: new Error(USER_ERROR_MESSAGES.SERVER) };
  }

  const session = await getValidSession();
  if (!session?.access_token) {
    return { success: false, error: new Error(USER_ERROR_MESSAGES.AUTH) };
  }

  // Valider l'entrée
  if (!userId || typeof userId !== 'string') {
    return { success: false, error: new Error(USER_ERROR_MESSAGES.VALIDATION) };
  }

  try {
    // Get the current user's profile to check admin role
    const checkResponse = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=role`,
      {
        method: 'GET',
        headers: getValidHeaders(session),
      }
    );

    if (!checkResponse.ok) {
      return { success: false, error: new Error(USER_ERROR_MESSAGES.PERMISSION) };
    }

    const adminData = await checkResponse.json();
    if (!Array.isArray(adminData) || adminData.length === 0 || adminData[0].role !== 'admin') {
      return { success: false, error: new Error(USER_ERROR_MESSAGES.PERMISSION) };
    }

    // Admin check passed, proceed with deletion
    // First, unlink any producers that reference this profile
    const unlinkResponse = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/producers?profile_id=eq.${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        headers: getValidHeaders(session),
        body: JSON.stringify({
          profile_id: null,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    if (!unlinkResponse.ok) {
      console.warn('[deleteUser] Warning: Could not unlink producers');
      // Continue anyway - the user might not have linked producers
    }

    // Now delete the profile from the profiles table
    const response = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
      {
        method: 'DELETE',
        headers: getValidHeaders(session),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    return { success: true, error: null };
  } catch (error) {
    const userMessage = toUserError(error, 'deleteUser');
    return { success: false, error: new Error(userMessage) };
  }
}
