import { formatRupees, relativeDue, relativeTime, shortDate } from '../format';

describe('formatRupees', () => {
  it('uses Indian digit grouping', () => {
    expect(formatRupees(12345650)).toBe('₹1,23,456.5');
    expect(formatRupees(245000)).toBe('₹2,450');
    expect(formatRupees(79900)).toBe('₹799');
  });
  it('keeps up to two decimals without trailing zeros', () => {
    expect(formatRupees(185025)).toBe('₹1,850.25');
    expect(formatRupees(185050)).toBe('₹1,850.5');
  });
  it('handles zero and missing amounts', () => {
    expect(formatRupees(0)).toBe('₹0');
    expect(formatRupees(null)).toBe('—');
  });
});

describe('relativeDue (local calendar days)', () => {
  const today = new Date(2026, 9, 3, 23, 30); // 3 Oct, 11:30 PM local
  it('counts days ahead', () => {
    expect(relativeDue('2026-10-15', today)).toEqual({ label: 'Due 15 Oct · in 12 days', tone: 'warn' });
  });
  it('says tomorrow and today', () => {
    expect(relativeDue('2026-10-04', today)).toEqual({ label: 'Due tomorrow', tone: 'warn' });
    expect(relativeDue('2026-10-03', today)).toEqual({ label: 'Due today', tone: 'warn' });
  });
  it('reports overdue in danger tone', () => {
    expect(relativeDue('2026-10-02', today)).toEqual({ label: 'Overdue by 1 day', tone: 'danger' });
    expect(relativeDue('2026-09-28', today)).toEqual({ label: 'Overdue by 5 days', tone: 'danger' });
  });
  it('treats just-after-midnight as the new day', () => {
    expect(relativeDue('2026-10-04', new Date(2026, 9, 4, 0, 5))).toEqual({ label: 'Due today', tone: 'warn' });
  });
  it('returns null without a due date', () => {
    expect(relativeDue(null, today)).toBeNull();
  });
});

describe('relativeTime', () => {
  const now = new Date(2026, 9, 5, 9, 0);
  it('covers the short ranges', () => {
    expect(relativeTime(new Date(2026, 9, 5, 8, 59, 40).toISOString(), now)).toBe('Just now');
    expect(relativeTime(new Date(2026, 9, 5, 8, 48).toISOString(), now)).toBe('12m');
    expect(relativeTime(new Date(2026, 9, 5, 6, 0).toISOString(), now)).toBe('3h');
  });
  it('switches to calendar words across midnight', () => {
    expect(relativeTime(new Date(2026, 9, 4, 23, 50).toISOString(), now)).toBe('Yesterday');
    expect(relativeTime(new Date(2026, 9, 3, 12, 0).toISOString(), now)).toBe('3 Oct');
  });
});

describe('shortDate', () => {
  it('formats day and short month', () => {
    expect(shortDate(new Date(2026, 0, 7))).toBe('7 Jan');
  });
});
