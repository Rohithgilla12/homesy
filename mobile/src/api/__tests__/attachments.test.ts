import { needsConversion, pickContentType, uploadKindAllows } from '../attachments';

describe('attachment helpers', () => {
  it('converts HEIC and oversized images, keeps small jpeg/png as is', () => {
    expect(needsConversion('image/heic', 800)).toBe(true);
    expect(needsConversion('image/jpeg', 4000)).toBe(true);
    expect(needsConversion('image/jpeg', 1200)).toBe(false);
    expect(needsConversion('image/png', 2048)).toBe(false);
  });
  it('derives a content type from the picker result', () => {
    expect(pickContentType('photo.HEIC', undefined)).toBe('image/heic');
    expect(pickContentType('x.pdf', 'application/pdf')).toBe('application/pdf');
    expect(pickContentType('x.jpg', 'image/jpeg')).toBe('image/jpeg');
    expect(pickContentType('x.bin', undefined)).toBeNull();
  });
  it('allows pdf only for receipts and documents', () => {
    expect(uploadKindAllows('bill_receipt', 'application/pdf')).toBe(true);
    expect(uploadKindAllows('avatar', 'application/pdf')).toBe(false);
    expect(uploadKindAllows('avatar', 'image/png')).toBe(true);
  });
});
