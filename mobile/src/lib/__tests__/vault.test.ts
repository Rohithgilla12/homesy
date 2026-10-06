import { defaultSsid, isWifiEntry, phoneNumberFrom, telUrl } from '../vault';

describe('phoneNumberFrom', () => {
  it('accepts common Indian and international formats', () => {
    expect(phoneNumberFrom('+91 98450 12345')).toBe('+919845012345');
    expect(phoneNumberFrom('098450-12345')).toBe('09845012345');
    expect(phoneNumberFrom('(080) 2345 6789')).toBe('08023456789');
    expect(phoneNumberFrom('+1 (415) 555-0100')).toBe('+14155550100');
  });
  it('rejects values that are not a phone number', () => {
    expect(phoneNumberFrom('4821#')).toBeNull();
    expect(phoneNumberFrom('homesy-2026')).toBeNull();
    expect(phoneNumberFrom('12345')).toBeNull();
    expect(phoneNumberFrom('1234567890123456')).toBeNull();
    expect(phoneNumberFrom('Call 98450 12345 after 6')).toBeNull();
    expect(phoneNumberFrom('2026-10-06')).toBeNull();
  });
  it('builds a tel: url without spaces', () => {
    expect(telUrl('+919845012345')).toBe('tel:+919845012345');
  });
});

describe('Wi-Fi helpers', () => {
  const entry = (label: string, category = 'access', ssid: string | null = null) =>
    ({ label, category, ssid }) as { label: string; category: 'access' | 'contacts'; ssid: string | null };
  it('detects Wi-Fi entries by label, or by a stored network name', () => {
    expect(isWifiEntry(entry('Wi-Fi password'))).toBe(true);
    expect(isWifiEntry(entry('Router pass'))).toBe(true);
    expect(isWifiEntry(entry('Gate code'))).toBe(false);
    expect(isWifiEntry(entry('Upstairs', 'access', 'Flat-4B'))).toBe(true);
  });
  it('prefers the stored network name, then a cleaned label, then the home name', () => {
    expect(defaultSsid(entry('Wi-Fi password', 'access', 'Flat-4B'), 'Beta Flat')).toBe('Flat-4B');
    expect(defaultSsid(entry('Airtel Wi-Fi password'), 'Beta Flat')).toBe('Airtel');
    expect(defaultSsid(entry('Wi-Fi password'), 'Beta Flat')).toBe('Beta Flat Wi-Fi');
  });
});
