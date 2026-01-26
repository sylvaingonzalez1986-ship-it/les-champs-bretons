/**
 * Validation Zod centralisée pour les données Supabase
 * Phase 3 - Sécurité: Validation des entrées/sorties
 */

import { z } from 'zod';

// ============================================================================
// SCHEMAS DE BASE
// ============================================================================

// UUID validation
export const uuidSchema = z.string().uuid('ID invalide');

// Email validation - plus tolerant pour les donnees existantes
export const emailSchema = z.string().email('Email invalide').toLowerCase().trim();

// Date ISO string
export const isoDateSchema = z.string().datetime({ message: 'Date invalide' });

// Phone validation - tolerant (accepte n'importe quel format)
export const phoneSchema = z
  .string()
  .max(30)
  .optional()
  .nullable();

// SIRET validation - tolerant (accepte vide ou 14 chiffres)
export const siretSchema = z
  .string()
  .max(20)
  .optional()
  .nullable();

// TVA number validation - tolerant
export const tvaNumberSchema = z
  .string()
  .max(20)
  .optional()
  .nullable();

// Postal code - tolerant (accepte n'importe quel format)
export const postalCodeSchema = z
  .string()
  .max(10)
  .optional()
  .nullable();

// ============================================================================
// SCHEMAS PROFIL UTILISATEUR
// ============================================================================

// Role avec valeur par defaut si invalide
export const userRoleSchema = z.enum(['client', 'pro', 'producer', 'admin']).catch('client');
// Category nullable et optionnel
export const userCategorySchema = z.enum(['restaurateur', 'epicerie', 'grossiste', 'producteur_maraicher', 'autre']).nullable().optional().catch(null);
export const proStatusSchema = z.enum(['pending', 'approved', 'rejected']).nullable().optional().catch(null);

export const userProfileSchema = z.object({
  id: uuidSchema,
  email: z.string().nullable().optional(),
  full_name: z.string().max(255).nullable().optional(),
  first_name: z.string().max(100).nullable().optional(),
  last_name: z.string().max(100).nullable().optional(),
  birth_date: z.string().nullable().optional(),
  role: userRoleSchema,
  category: userCategorySchema,
  pro_status: proStatusSchema,
  phone: phoneSchema,
  address: z.string().max(500).nullable().optional(),
  postal_code: postalCodeSchema,
  city: z.string().max(100).nullable().optional(),
  company_name: z.string().max(255).nullable().optional(),
  business_name: z.string().max(255).nullable().optional(),
  siret: siretSchema,
  tva_number: tvaNumberSchema,
  user_code: z.string().max(50).nullable().optional(),
  is_adult: z.boolean().nullable().optional(),
  age_verified_at: z.string().nullable().optional(),
  // Vente directe a la ferme (producteurs) - optional car peut ne pas exister en base
  vente_directe_ferme: z.boolean().nullable().optional(),
  adresse_retrait: z.string().max(500).nullable().optional(),
  horaires_retrait: z.string().max(1000).nullable().optional(),
  instructions_retrait: z.string().max(2000).nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
}).passthrough(); // Accepter des champs supplementaires non definis

export type ValidatedUserProfile = z.infer<typeof userProfileSchema>;

// Schema pour les mises à jour de profil (tous les champs optionnels)
export const userProfileUpdateSchema = userProfileSchema
  .omit({ id: true, created_at: true, updated_at: true })
  .partial();

// ============================================================================
// SCHEMAS PRODUCTEUR
// ============================================================================

export const producerSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(255),
  profile_id: uuidSchema.nullable(),
  region: z.string().max(100).nullable(),
  department: z.string().max(100).nullable(),
  city: z.string().max(100).nullable(),
  image: z.string().url().nullable().or(z.literal('')).nullable(),
  description: z.string().max(2000).nullable(),
  siret: siretSchema,
  tva_number: tvaNumberSchema,
  culture_outdoor: z.boolean().nullable(),
  culture_greenhouse: z.boolean().nullable(),
  culture_indoor: z.boolean().nullable(),
});

export type ValidatedProducer = z.infer<typeof producerSchema>;

// ============================================================================
// SCHEMAS PRODUIT
// ============================================================================

export const productStatusSchema = z.enum(['draft', 'published', 'archived']);

// Schema pour un palier de prix
export const priceTierSchema = z.object({
  minQuantity: z.number().int().min(1),
  price: z.number().min(0),
});

export const productSchema = z.object({
  id: z.string(),
  producer_id: z.string(),
  name: z.string().min(1, 'Nom requis').max(255),
  type: z.string().min(1).max(100),
  cbd_percent: z.number().min(0).max(100).nullable(),
  thc_percent: z.number().min(0).max(1).nullable(), // THC limite légale
  price_public: z.number().min(0, 'Prix doit être positif'),
  price_pro: z.number().min(0).nullable(),
  weight: z.string().max(50).nullable(),
  image: z.string().url().nullable().or(z.literal('')).nullable(),
  images: z.array(z.string().url()).nullable(),
  description: z.string().max(5000).nullable(),
  tva_rate: z.number().min(0).max(100),
  stock: z.number().int().min(0).nullable(),
  is_on_promo: z.boolean(),
  promo_percent: z.number().min(0).max(100).nullable(),
  visible_for_clients: z.boolean(),
  visible_for_pros: z.boolean(),
  status: productStatusSchema,
  lab_analysis_url: z.string().url().nullable().or(z.literal('')).nullable(),
  disponible_vente_directe: z.boolean(),
  price_tiers: z.array(priceTierSchema).nullable().optional(),
  price_pro_tiers: z.array(priceTierSchema).nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ValidatedProduct = z.infer<typeof productSchema>;

// Schema pour création de produit
export const productInsertSchema = productSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

// Schema pour mise à jour de produit
export const productUpdateSchema = productSchema
  .omit({ id: true, producer_id: true, created_at: true, updated_at: true })
  .partial();

// ============================================================================
// SCHEMAS COMMANDE
// ============================================================================

export const orderStatusSchema = z.enum([
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
]);

export const orderSchema = z.object({
  id: z.string(),
  customer_id: uuidSchema.nullable(),
  customer_email: emailSchema,
  customer_name: z.string().max(255),
  customer_phone: phoneSchema,
  shipping_address: z.string().max(500),
  shipping_postal_code: postalCodeSchema,
  shipping_city: z.string().max(100),
  status: orderStatusSchema,
  total_amount: z.number().min(0),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ValidatedOrder = z.infer<typeof orderSchema>;

// ============================================================================
// FONCTIONS DE VALIDATION
// ============================================================================

/**
 * Valide les données et retourne le résultat ou null
 * Ne throw jamais - retourne null en cas d'erreur
 */
export function validateSafe<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): T | null {
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  console.warn('[Validation] Invalid data:', result.error.issues);
  return null;
}

/**
 * Valide un tableau de données
 * Retourne uniquement les éléments valides
 */
export function validateArraySafe<T>(
  schema: z.ZodSchema<T>,
  data: unknown[]
): T[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => validateSafe(schema, item))
    .filter((item): item is T => item !== null);
}

/**
 * Valide les données avec message d'erreur utilisateur
 */
export function validateWithError<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { data: T | null; error: string | null } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { data: result.data, error: null };
  }
  // Retourne le premier message d'erreur lisible
  const firstError = result.error.issues[0];
  const errorMessage = firstError?.message || 'Données invalides';
  return { data: null, error: errorMessage };
}

// ============================================================================
// SANITIZATION
// ============================================================================

/**
 * Nettoie une chaîne pour éviter les injections
 */
export function sanitizeString(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .trim()
    .replace(/[<>]/g, '') // Supprime les balises HTML basiques
    .slice(0, 10000); // Limite la longueur
}

/**
 * Nettoie un objet en supprimant les champs dangereux
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const dangerous = ['__proto__', 'constructor', 'prototype'];
  const sanitized = { ...obj };

  for (const key of dangerous) {
    delete sanitized[key];
  }

  return sanitized;
}

// ============================================================================
// MASQUAGE DES ERREURS TECHNIQUES
// ============================================================================

// Messages d'erreur génériques pour l'utilisateur
export const USER_ERROR_MESSAGES = {
  GENERIC: 'Une erreur est survenue. Veuillez réessayer.',
  NETWORK: 'Problème de connexion. Vérifiez votre réseau.',
  AUTH: 'Session expirée. Veuillez vous reconnecter.',
  PERMISSION: 'Vous n\'avez pas les permissions nécessaires.',
  NOT_FOUND: 'Élément introuvable.',
  VALIDATION: 'Données invalides. Vérifiez votre saisie.',
  SERVER: 'Le serveur rencontre un problème. Réessayez plus tard.',
} as const;

/**
 * Convertit une erreur technique en message utilisateur
 * Log l'erreur technique en console pour le debug
 */
export function toUserError(error: unknown, context?: string): string {
  // Log technique pour debug
  console.error(`[Error${context ? ` - ${context}` : ''}]`, error);

  // Détection du type d'erreur
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    // Erreurs réseau
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout')) {
      return USER_ERROR_MESSAGES.NETWORK;
    }

    // Erreurs d'authentification
    if (msg.includes('auth') || msg.includes('token') || msg.includes('session') || msg.includes('401')) {
      return USER_ERROR_MESSAGES.AUTH;
    }

    // Erreurs de permission
    if (msg.includes('permission') || msg.includes('forbidden') || msg.includes('403') || msg.includes('unauthorized')) {
      return USER_ERROR_MESSAGES.PERMISSION;
    }

    // Erreurs 404
    if (msg.includes('not found') || msg.includes('404')) {
      return USER_ERROR_MESSAGES.NOT_FOUND;
    }

    // Erreurs de validation
    if (msg.includes('valid') || msg.includes('invalid') || msg.includes('required')) {
      return USER_ERROR_MESSAGES.VALIDATION;
    }

    // Erreurs serveur
    if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('server')) {
      return USER_ERROR_MESSAGES.SERVER;
    }
  }

  return USER_ERROR_MESSAGES.GENERIC;
}
