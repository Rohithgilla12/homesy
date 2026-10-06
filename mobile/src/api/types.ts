export type AttachmentKind = 'note_photo' | 'bill_receipt' | 'vault_document' | 'avatar' | 'home_cover';
export type Attachment = {
  id: string; kind: AttachmentKind; content_type: string; size_bytes: number; url: string; url_expires_at: string;
};

export type User = {
  id: string; email: string; display_name: string; created_at: string; avatar_id: string | null; avatar: Attachment | null;
};
export type Home = {
  id: string; name: string; emoji: string; invite_code: string; created_by: string; created_at: string;
  cover_id: string | null; cover: Attachment | null;
};
export type Member = {
  user_id: string; display_name: string; email: string; role: 'owner' | 'member'; joined_at: string;
  avatar_id: string | null; avatar: Attachment | null;
};
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
  is_secret: boolean; pinned: boolean; created_by: string; updated_at: string; attachments: Attachment[];
  ssid: string | null;
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

export const LIST_KIND_ICON: Record<ListKind, string> = { grocery: '🛒', laundry: '🧺', todo: '✅', custom: '📝' };
export const VAULT_CATEGORY_LABEL: Record<VaultCategory, string> = {
  utilities: 'Utilities & bills', contacts: 'Contacts', access: 'Access & codes', documents: 'Documents', other: 'Other',
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
  account_number: string | null;
  amount_cents: number | null;
  due_date: string | null; // YYYY-MM-DD
  billing_period: string;
  is_paid: boolean;
  paid_by: string | null;
  paid_at: string | null;
  payment_ref: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  paid_by_name: string | null;
  created_by_name: string | null;
  receipt_id: string | null;
  receipt: Attachment | null;
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
