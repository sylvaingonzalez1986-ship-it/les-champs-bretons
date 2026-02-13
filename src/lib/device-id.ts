import { initializeSecureStorage, getItem, setItem } from './secure-storage';

const DEVICE_ID_KEY = 'device-id';

let cachedDeviceId: string | null = null;

function generateDeviceId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }

  const randomPart = Math.random().toString(36).slice(2);
  const timePart = Date.now().toString(36);
  return `dev_${timePart}_${randomPart}`;
}

export async function ensureDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  await initializeSecureStorage();
  const stored = await getItem(DEVICE_ID_KEY);
  if (stored) {
    cachedDeviceId = stored;
    return stored;
  }

  const deviceId = generateDeviceId();
  await setItem(DEVICE_ID_KEY, deviceId);
  cachedDeviceId = deviceId;
  return deviceId;
}

export function getCachedDeviceId(): string | null {
  return cachedDeviceId;
}
