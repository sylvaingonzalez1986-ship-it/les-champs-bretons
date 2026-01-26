/**
 * SSL Certificate Configuration
 * Les Chanvriers Unis - MITM Protection
 *
 * IMPORTANT: Renouveler le certificat AVANT juin 2026
 */

// Hash SHA256 du certificat DigiCert Global G2 TLS RSA SHA256 2020 CA1
// Utilisé par Supabase (xxx.supabase.co)
export const SUPABASE_CERT_HASH = 'sha256/5tIxY0B3jMEQQQbXcbnOwdJA9paEhvu6hzId/R43jlA=';

// Date d'expiration estimée du certificat
// Warning: Mettre à jour AVANT cette date
export const CERT_EXPIRY_DATE = new Date('2026-06-20');

/**
 * Vérifier si le certificat doit être renouvelé
 * Retourne true si moins de 30 jours avant expiration
 */
export function shouldRenewCertificate(): boolean {
  const now = new Date();
  const daysUntilExpiry = Math.floor(
    (CERT_EXPIRY_DATE.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysUntilExpiry < 30) {
    console.warn(
      `[SSL] ATTENTION: Certificat expire dans ${daysUntilExpiry} jours!`,
      'Voir SSL_PINNING_DOCUMENTATION.md pour le renouvellement'
    );
    return true;
  }

  return false;
}
