import * as Linking from 'expo-linking';

type SafeUrlOptions = {
  allowMailto?: boolean;
  allowTel?: boolean;
};

function normalizeHttpUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^www\./i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return null;
}

export function getSafeExternalUrl(url: string, options: SafeUrlOptions = {}): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (options.allowMailto && /^mailto:/i.test(trimmed)) {
    return trimmed;
  }

  if (options.allowTel && /^tel:/i.test(trimmed)) {
    return trimmed;
  }

  const normalized = normalizeHttpUrl(trimmed);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function safeOpenExternalUrl(
  url: string,
  options: SafeUrlOptions = {}
): Promise<boolean> {
  const safeUrl = getSafeExternalUrl(url, options);
  if (!safeUrl) return false;

  const canOpen = await Linking.canOpenURL(safeUrl);
  if (!canOpen) return false;

  await Linking.openURL(safeUrl);
  return true;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function getSafeMailtoUrl(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed || !EMAIL_REGEX.test(trimmed)) return null;

  return `mailto:${trimmed}`;
}

export function getSafeTelUrl(phone: string): string | null {
  const trimmed = phone.trim();
  if (!trimmed) return null;

  let cleaned = trimmed.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('00')) {
    cleaned = `+${cleaned.slice(2)}`;
  }
  const digitsOnly = cleaned.replace(/\+/g, '');
  if (digitsOnly.length < 6) return null;

  return `tel:${cleaned}`;
}