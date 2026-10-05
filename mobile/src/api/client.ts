import { useSession } from '@/store/session';
import type {
  Activity,
  Attachment,
  AttachmentKind,
  BulletinNotice,
  Home,
  HomeDetail,
  HouseholdBill,
  List,
  ListItem,
  ListKind,
  NoticePriority,
  User,
  VaultCategory,
  VaultEntry,
} from './types';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = useSession.getState().token;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) useSession.getState().signOut();
  // Axum's extractor rejections (e.g. 422 on a bad JSON body) are plain text, not `{ error }`.
  const text = await res.text();
  let body: unknown = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
  if (!res.ok) {
    const error = (body as { error?: unknown } | null)?.error;
    throw new ApiError(res.status, (typeof error === 'string' && error) || res.statusText || `HTTP ${res.status}`);
  }
  return body as T;
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  // auth
  signup: (b: { email: string; password: string; display_name: string }) =>
    request<{ token: string; user: User }>('/auth/signup', { method: 'POST', body: json(b) }),
  login: (b: { email: string; password: string }) =>
    request<{ token: string; user: User }>('/auth/login', { method: 'POST', body: json(b) }),
  me: () => request<User>('/me'),
  updateMe: (b: { display_name?: string; avatar_id?: string | null }) => request<User>('/me', { method: 'PATCH', body: json(b) }),
  config: () => request<{ attachments: boolean }>('/config'),

  // attachments: create a slot, PUT the bytes to upload_url, then complete
  createAttachment: (homeId: string, b: { kind: AttachmentKind; content_type: string; size_bytes: number }) =>
    request<{ id: string; upload_url: string; expires_at: string }>(`/homes/${homeId}/attachments`, { method: 'POST', body: json(b) }),
  completeAttachment: (id: string) => request<Attachment>(`/attachments/${id}/complete`, { method: 'POST' }),
  deleteAttachment: (id: string) => request<{ ok: true }>(`/attachments/${id}`, { method: 'DELETE' }),

  // homes
  homes: () => request<Home[]>('/homes'),
  home: (id: string) => request<HomeDetail>(`/homes/${id}`),
  createHome: (b: { name: string; emoji?: string }) => request<Home>('/homes', { method: 'POST', body: json(b) }),
  joinHome: (code: string) => request<Home>('/homes/join', { method: 'POST', body: json({ code }) }),
  updateHome: (id: string, b: { name?: string; emoji?: string; cover_id?: string | null }) =>
    request<Home>(`/homes/${id}`, { method: 'PATCH', body: json(b) }),
  leaveHome: (id: string) => request<{ ok: true }>(`/homes/${id}/leave`, { method: 'POST' }),

  // activity
  activity: (homeId: string, limit: number = 50) =>
    request<Activity[]>(`/homes/${homeId}/activity?limit=${limit}`),

  // bulletin notices
  bulletin: (homeId: string) => request<BulletinNotice[]>(`/homes/${homeId}/bulletin`),
  createNotice: (homeId: string, b: { title: string; content: string; priority: NoticePriority }) =>
    request<BulletinNotice>(`/homes/${homeId}/bulletin`, { method: 'POST', body: json(b) }),
  deleteNotice: (id: string) => request<{ ok: true }>(`/bulletin/${id}`, { method: 'DELETE' }),

  // lists
  lists: (homeId: string) => request<List[]>(`/homes/${homeId}/lists`),
  createList: (homeId: string, b: { kind: ListKind; name: string }) =>
    request<List>(`/homes/${homeId}/lists`, { method: 'POST', body: json(b) }),
  items: (listId: string) => request<ListItem[]>(`/lists/${listId}/items`),
  createItem: (listId: string, b: { title: string; qty?: string; note?: string }) =>
    request<ListItem>(`/lists/${listId}/items`, { method: 'POST', body: json(b) }),
  updateItem: (id: string, b: Partial<{ title: string; qty: string; note: string; done: boolean }>) =>
    request<ListItem>(`/items/${id}`, { method: 'PATCH', body: json(b) }),
  deleteItem: (id: string) => request<{ ok: true }>(`/items/${id}`, { method: 'DELETE' }),
  clearCompleted: (listId: string) =>
    request<{ deleted: number }>(`/lists/${listId}/clear-completed`, { method: 'POST' }),

  // vault
  vault: (homeId: string) => request<VaultEntry[]>(`/homes/${homeId}/vault`),
  createVault: (homeId: string, b: { category: VaultCategory; label: string; value: string; is_secret?: boolean; pinned?: boolean; attachment_ids?: string[] }) =>
    request<VaultEntry>(`/homes/${homeId}/vault`, { method: 'POST', body: json(b) }),
  updateVault: (id: string, b: Partial<{ category: VaultCategory; label: string; value: string; is_secret: boolean; pinned: boolean; attachment_ids: string[] }>) =>
    request<VaultEntry>(`/vault/${id}`, { method: 'PATCH', body: json(b) }),
  deleteVault: (id: string) => request<{ ok: true }>(`/vault/${id}`, { method: 'DELETE' }),

  // bills & utilities
  bills: (homeId: string) => request<HouseholdBill[]>(`/homes/${homeId}/bills`),
  createBill: (
    homeId: string,
    b: {
      title: string;
      category: string;
      billing_period: string;
      amount_cents?: number;
      account_number?: string;
      due_date?: string;
      notes?: string;
      receipt_id?: string | null;
    }
  ) => request<HouseholdBill>(`/homes/${homeId}/bills`, { method: 'POST', body: json(b) }),
  updateBill: (
    id: string,
    b: Partial<{
      title: string;
      category: string;
      billing_period: string;
      amount_cents: number;
      account_number: string;
      due_date: string;
      notes: string;
      receipt_id: string | null;
    }>
  ) => request<HouseholdBill>(`/bills/${id}`, { method: 'PATCH', body: json(b) }),
  // paid_by defaults to the caller on the backend
  payBill: (id: string, b?: { paid_by?: string; payment_ref?: string; amount_cents?: number }) =>
    request<HouseholdBill>(`/bills/${id}/pay`, { method: 'POST', body: json(b ?? {}) }),
  unpayBill: (id: string) => request<HouseholdBill>(`/bills/${id}/unpay`, { method: 'POST' }),
  newCycleBill: (id: string, b: { billing_period: string; amount_cents?: number; due_date?: string }) =>
    request<HouseholdBill>(`/bills/${id}/new-cycle`, { method: 'POST', body: json(b) }),
  deleteBill: (id: string) => request<{ ok: true }>(`/bills/${id}`, { method: 'DELETE' }),
};
