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

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 4321 })),
  createUploadTask: jest.fn(),
  FileSystemUploadType: { BINARY_CONTENT: 1 },
}));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' } }));

describe('resolveSize', () => {
  const { resolveSize } = require('../attachments');
  it('keeps a positive picker size', async () => {
    expect(await resolveSize('file:///a', 10)).toBe(10);
  });
  it('reads the file when the picker gives no size', async () => {
    expect(await resolveSize('file:///a', undefined)).toBe(4321);
    expect(await resolveSize('file:///a', 0)).toBe(4321);
  });
});
