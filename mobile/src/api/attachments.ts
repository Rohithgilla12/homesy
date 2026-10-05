import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { api } from './client';
import type { Attachment, AttachmentKind } from './types';

export const MAX_EDGE = 2048;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', pdf: 'application/pdf',
};

export type PickedFile = { uri: string; contentType: string; sizeBytes: number; width?: number; height?: number };

/** HEIC always converts (Android cannot show it); large images are downsized to keep uploads small. */
export function needsConversion(contentType: string, longEdge: number): boolean {
  return contentType === 'image/heic' || longEdge > MAX_EDGE;
}

export function pickContentType(name: string, mime: string | undefined): string | null {
  if (mime && (IMAGE_TYPES.includes(mime) || mime === 'application/pdf')) return mime;
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return BY_EXTENSION[ext] ?? null;
}

export function uploadKindAllows(kind: AttachmentKind, contentType: string): boolean {
  if (contentType === 'application/pdf') return kind === 'bill_receipt' || kind === 'vault_document';
  return IMAGE_TYPES.includes(contentType);
}

export function sizeLimitFor(contentType: string): number {
  return contentType === 'application/pdf' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
}

/** Pickers do not always report a size; the API refuses 0, so read the file when it is missing. */
export async function resolveSize(uri: string, reported: number | undefined | null): Promise<number> {
  if (reported && reported > 0) return reported;
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists ? info.size : 0;
}

/** Resizes and re-encodes when needed so the declared content type matches the bytes. */
export async function prepareImage(file: PickedFile): Promise<PickedFile> {
  const longEdge = Math.max(file.width ?? 0, file.height ?? 0);
  if (!needsConversion(file.contentType, longEdge)) return file;
  const ctx = ImageManipulator.manipulate(file.uri);
  if (longEdge > MAX_EDGE) ctx.resize((file.width ?? 0) >= (file.height ?? 0) ? { width: MAX_EDGE } : { height: MAX_EDGE });
  const rendered = await ctx.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  const info = await FileSystem.getInfoAsync(saved.uri);
  return {
    uri: saved.uri,
    contentType: 'image/jpeg',
    sizeBytes: info.exists ? info.size : 0,
    width: saved.width,
    height: saved.height,
  };
}

/** create → PUT straight to storage → complete. Progress is the upload fraction, 0..1. */
export async function uploadAttachment(
  homeId: string,
  kind: AttachmentKind,
  file: PickedFile,
  onProgress?: (fraction: number) => void,
): Promise<Attachment> {
  const ready = file.contentType.startsWith('image/') ? await prepareImage(file) : file;
  const slot = await api.createAttachment(homeId, { kind, content_type: ready.contentType, size_bytes: ready.sizeBytes });
  const task = FileSystem.createUploadTask(
    slot.upload_url,
    ready.uri,
    { httpMethod: 'PUT', headers: { 'Content-Type': ready.contentType }, uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT },
    (p) => onProgress?.(p.totalBytesExpectedToSend ? p.totalBytesSent / p.totalBytesExpectedToSend : 0),
  );
  const res = await task.uploadAsync();
  if (!res || res.status < 200 || res.status >= 300) throw new Error(`Upload failed (${res?.status ?? 'no response'})`);
  return api.completeAttachment(slot.id);
}
