import type { VaultCategory } from '@/api/types';

type WifiLike = { label: string; category: VaultCategory; ssid: string | null };

const PHONE_CHARS = /^[+\d\s\-().]+$/;

/**
 * The dialable form of a value that is a phone number on its own (7–15 digits, optional leading +,
 * spaces, dashes, dots or brackets), or `null`. Text around the number disqualifies it, so a note like
 * "Call 98450 12345 after 6" stays plain text rather than guessing.
 */
export function phoneNumberFrom(value: string): string | null {
  const v = value.trim();
  if (!PHONE_CHARS.test(v)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const digits = v.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return (v.startsWith('+') ? '+' : '') + digits;
}

export const telUrl = (number: string) => `tel:${number}`;

export function isWifiEntry(e: WifiLike): boolean {
  if (e.ssid) return true;
  const l = e.label.toLowerCase();
  return l.includes('wifi') || l.includes('wi-fi') || (e.category === 'access' && ['network', 'internet', 'router', 'pass'].some((w) => l.includes(w)));
}

/** Network name for the QR code: the stored one, else the label minus Wi-Fi words, else "<home> Wi-Fi". */
export function defaultSsid(e: WifiLike, homeName: string | undefined): string {
  if (e.ssid) return e.ssid;
  const cleaned = e.label.replace(/wi-?fi/gi, '').replace(/password/gi, '').replace(/credentials/gi, '').replace(/code/gi, '').replace(/pass/gi, '').trim();
  return cleaned || `${homeName || 'Home'} Wi-Fi`;
}
