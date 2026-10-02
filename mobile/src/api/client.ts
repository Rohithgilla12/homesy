import { useSession } from '@/store/session';
import type {
  Activity,
  BulletinNotice,
  Expense,
  ExpenseBalances,
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
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body?.error ?? res.statusText);
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

  // homes
  homes: () => request<Home[]>('/homes'),
  home: (id: string) => request<HomeDetail>(`/homes/${id}`),
  createHome: (b: { name: string; emoji?: string }) => request<Home>('/homes', { method: 'POST', body: json(b) }),
  joinHome: (code: string) => request<Home>('/homes/join', { method: 'POST', body: json({ code }) }),
  leaveHome: (id: string) => request<{ ok: true }>(`/homes/${id}/leave`, { method: 'POST' }),

  // activity
  activity: (homeId: string, limit: number = 50) =>
    request<Activity[]>(`/homes/${homeId}/activity?limit=${limit}`),

  // bulletin notices
  bulletin: (homeId: string) => request<BulletinNotice[]>(`/homes/${homeId}/bulletin`),
  createNotice: (homeId: string, b: { title: string; content: string; priority: NoticePriority }) =>
    request<BulletinNotice>(`/homes/${homeId}/bulletin`, { method: 'POST', body: json(b) }),
  deleteNotice: (id: string) => request<{ ok: true }>(`/bulletin/${id}`, { method: 'DELETE' }),

  // expenses
  expenses: (homeId: string) => request<Expense[]>(`/homes/${homeId}/expenses`),
  createExpense: (homeId: string, b: { title: string; amount_cents: number; category: string; paid_by?: string }) =>
    request<Expense>(`/homes/${homeId}/expenses`, { method: 'POST', body: json(b) }),
  deleteExpense: (id: string) => request<{ ok: true }>(`/expenses/${id}`, { method: 'DELETE' }),
  expenseBalances: (homeId: string) => request<ExpenseBalances>(`/homes/${homeId}/expenses/balances`),

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
  createVault: (homeId: string, b: { category: VaultCategory; label: string; value: string; is_secret?: boolean; pinned?: boolean }) =>
    request<VaultEntry>(`/homes/${homeId}/vault`, { method: 'POST', body: json(b) }),
  updateVault: (id: string, b: Partial<{ category: VaultCategory; label: string; value: string; is_secret: boolean; pinned: boolean }>) =>
    request<VaultEntry>(`/vault/${id}`, { method: 'PATCH', body: json(b) }),
  deleteVault: (id: string) => request<{ ok: true }>(`/vault/${id}`, { method: 'DELETE' }),

  // bills & utilities
  bills: (homeId: string) => request<HouseholdBill[]>(`/homes/${homeId}/bills`),
  createBill: (
    homeId: string,
    b: {
      title: string;
      category: string;
      amount_cents: number;
      consumer_id?: string;
      account_number?: string;
      due_date?: string;
      billing_period?: string;
      notes?: string;
    }
  ) => request<HouseholdBill>(`/homes/${homeId}/bills`, { method: 'POST', body: json(b) }),
  updateBill: (
    id: string,
    b: Partial<{
      title: string;
      category: string;
      amount_cents: number;
      consumer_id?: string;
      account_number?: string;
      due_date?: string;
      billing_period?: string;
      notes?: string;
      is_paid?: boolean;
      paid_by?: string;
      paid_at?: string;
      payment_notes?: string;
    }>
  ) => request<HouseholdBill>(`/bills/${id}`, { method: 'PATCH', body: json(b) }),
  payBill: (id: string, b?: { paid_by?: string; payment_notes?: string }) =>
    request<HouseholdBill>(`/bills/${id}/pay`, { method: 'POST', body: json(b ?? {}) }),
  unpayBill: (id: string) => request<HouseholdBill>(`/bills/${id}/unpay`, { method: 'POST' }),
  newCycleBill: (
    id: string,
    b?: { amount_cents?: number; due_date?: string; billing_period?: string }
  ) => request<HouseholdBill>(`/bills/${id}/new-cycle`, { method: 'POST', body: json(b ?? {}) }),
  deleteBill: (id: string) => request<{ ok: true }>(`/bills/${id}`, { method: 'DELETE' }),
};
