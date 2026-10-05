const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

export function shortDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Indian digit grouping (1,23,456) with up to two decimals and no trailing zeros. */
export function formatRupees(cents: number | null): string {
  if (cents === null) return '—';
  const whole = Math.trunc(cents / 100).toString();
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = rest ? `${rest},${last3}` : last3;
  const frac = Math.abs(cents % 100);
  const decimals = frac === 0 ? '' : (frac / 100).toFixed(2).slice(1).replace(/0+$/, '');
  return `₹${grouped}${decimals}`;
}

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Calendar-day distance in the phone's local time zone; due is a YYYY-MM-DD date. */
export function relativeDue(due: string | null, today: Date): { label: string; tone: 'warn' | 'danger' } | null {
  if (!due) return null;
  const [y, m, d] = due.split('-').map(Number);
  const dueDate = new Date(y, m - 1, d);
  const diff = Math.round((dueDate.getTime() - startOfLocalDay(today)) / DAY_MS);
  if (diff > 1) return { label: `Due ${shortDate(dueDate)} · in ${diff} days`, tone: 'warn' };
  if (diff === 1) return { label: 'Due tomorrow', tone: 'warn' };
  if (diff === 0) return { label: 'Due today', tone: 'warn' };
  const n = -diff;
  return { label: `Overdue by ${n} ${n === 1 ? 'day' : 'days'}`, tone: 'danger' };
}

export function relativeTime(iso: string, now: Date): string {
  const t = new Date(iso);
  const secs = (now.getTime() - t.getTime()) / 1000;
  if (secs < 60) return 'Just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  const dayDiff = Math.round((startOfLocalDay(now) - startOfLocalDay(t)) / DAY_MS);
  if (dayDiff === 0) return `${Math.floor(secs / 3600)}h`;
  if (dayDiff === 1) return 'Yesterday';
  return shortDate(t);
}
