export type User = { id: string; email: string; display_name: string; created_at: string };
export type Home = {
  id: string; name: string; emoji: string; invite_code: string; created_by: string; created_at: string;
};
export type Member = { user_id: string; display_name: string; email: string; role: 'owner' | 'member'; joined_at: string };
export type HomeDetail = Home & { members: Member[] };

export type ListKind = 'grocery' | 'laundry' | 'todo' | 'custom';
export type List = { id: string; home_id: string; kind: ListKind; name: string; created_at: string; open_count: number };
export type ListItem = {
  id: string; list_id: string; title: string; qty: string | null; note: string | null;
  done: boolean; done_by: string | null; done_at: string | null; created_by: string; created_at: string;
};

export type VaultCategory = 'utilities' | 'contacts' | 'access' | 'documents' | 'other';
export type VaultEntry = {
  id: string; home_id: string; category: VaultCategory; label: string; value: string;
  is_secret: boolean; pinned: boolean; created_by: string; updated_at: string;
};

export type NoticePriority = 'normal' | 'urgent';
export type BulletinNotice = {
  id: string;
  home_id: string;
  title: string;
  content: string;
  priority: NoticePriority;
  created_by: string;
  created_at: string;
};

export type Activity = {
  id: string;
  home_id: string;
  actor_id: string;
  action: string;
  resource_type: string;
  description: string;
  created_at: string;
};

export type ExpenseCategory = 'utilities' | 'groceries' | 'rent' | 'repairs' | 'household' | 'other';
export type Expense = {
  id: string;
  home_id: string;
  title: string;
  amount_cents: number;
  category: string;
  paid_by: string;
  created_at: string;
};

export type MemberSpend = {
  user_id: string;
  display_name: string;
  paid_cents: number;
  net_cents: number;
};

export type ExpenseBalances = {
  total_cents: number;
  per_member_cents: number;
  member_count: number;
  member_spends: MemberSpend[];
};

export const LIST_KIND_ICON: Record<ListKind, string> = { grocery: '🛒', laundry: '🧺', todo: '✅', custom: '📝' };
export const VAULT_CATEGORY_LABEL: Record<VaultCategory, string> = {
  utilities: 'Utilities & bills', contacts: 'Contacts', access: 'Access & codes', documents: 'Documents', other: 'Other',
};
export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  utilities: '💡 Utilities',
  groceries: '🛒 Groceries',
  rent: '🏠 Rent',
  repairs: '🔧 Repairs',
  household: '🛋️ Household',
  other: '📦 Other',
};

export type BillCategory =
  | 'electricity'
  | 'internet'
  | 'water'
  | 'gas'
  | 'maintenance'
  | 'maid'
  | 'other';

export type HouseholdBill = {
  id: string;
  home_id: string;
  title: string;
  category: BillCategory | string;
  amount_cents: number;
  consumer_id?: string | null;
  account_number?: string | null;
  due_date?: string | null;
  billing_period?: string | null;
  notes?: string | null;
  is_paid: boolean;
  paid_by?: string | null;
  paid_at?: string | null;
  payment_notes?: string | null;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
};

export const BILL_CATEGORY_CONFIG: Record<
  BillCategory,
  { label: string; icon: string; color: string }
> = {
  electricity: { label: 'Electricity', icon: '⚡', color: '#F59E0B' },
  internet: { label: 'Internet / Wi-Fi', icon: '🌐', color: '#3B82F6' },
  water: { label: 'Water', icon: '💧', color: '#06B6D4' },
  gas: { label: 'Gas / PNG', icon: '🔥', color: '#EF4444' },
  maintenance: { label: 'Maintenance', icon: '🏢', color: '#8B5CF6' },
  maid: { label: 'Domestic Help', icon: '🧹', color: '#EC4899' },
  other: { label: 'Other', icon: '📦', color: '#6B7280' },
};
