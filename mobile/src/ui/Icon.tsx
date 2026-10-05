import {
  Building2, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Copy, Droplet, Ellipsis, Eye, EyeOff, FileText, Flame, Folder, Globe,
  House, KeyRound, ListChecks, Lock, LogOut, Package, Pencil, Phone, Pin, Plus, QrCode, Receipt, RefreshCw, Share, Shirt, ShieldCheck,
  ShoppingCart, Sparkles, SquareCheck, StickyNote, Trash2, Undo2, Users, Wifi, X, Zap, type LucideIcon,
} from 'lucide-react-native';
import { color } from './tokens';

const ICONS = {
  'tab.lists': ListChecks, 'tab.bills': Zap, 'tab.vault': Lock, 'tab.activity': Clock, 'tab.home': House,
  'list.grocery': ShoppingCart, 'list.laundry': Shirt, 'list.todo': SquareCheck, 'list.custom': StickyNote,
  'bill.electricity': Zap, 'bill.internet': Globe, 'bill.water': Droplet, 'bill.gas': Flame, 'bill.maintenance': Building2, 'bill.maid': Sparkles, 'bill.other': Package,
  'vault.utilities': Receipt, 'vault.contacts': Phone, 'vault.access': KeyRound, 'vault.documents': FileText, 'vault.other': Folder, 'vault.wifi': Wifi,
  add: Plus, edit: Pencil, copy: Copy, copied: Check, delete: Trash2, reveal: Eye, hide: EyeOff, qr: QrCode, share: Share, paid: ShieldCheck,
  due: Clock, pin: Pin, undo: Undo2, nextCycle: RefreshCw, more: Ellipsis, chevronDown: ChevronDown, chevronRight: ChevronRight, back: ChevronLeft,
  close: X, members: Users, note: StickyNote, signOut: LogOut, check: Check,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;
export function Icon({ name, size = 22, tint = color.ink }: { name: IconName; size?: number; tint?: string }) {
  const C = ICONS[name];
  return <C size={size} color={tint} strokeWidth={1.75} />;
}
