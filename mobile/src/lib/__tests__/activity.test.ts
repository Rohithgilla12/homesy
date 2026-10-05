import { activitySentence, freshArrivals, groupByDay, isFreshFromOthers } from '../activity';

describe('activitySentence', () => {
  it('strips a leading duplicate actor name', () => {
    expect(activitySentence('Ananya', 'Ananya marked Rent as PAID')).toEqual({ actor: 'Ananya', text: 'marked Rent as PAID' });
    expect(activitySentence('Rohith Gilla', 'Rohith Gilla rolled over "Wi-Fi" to Nov')).toEqual({ actor: 'Rohith Gilla', text: 'rolled over "Wi-Fi" to Nov' });
  });
  it('lowercases the leading verb so it reads on from the name', () => {
    expect(activitySentence('Ananya', 'Added bill "Water"')).toEqual({ actor: 'Ananya', text: 'added bill "Water"' });
    expect(activitySentence('Ananya', 'Ananya Joined the home')).toEqual({ actor: 'Ananya', text: 'joined the home' });
  });
  it('keeps a leading acronym or name intact', () => {
    expect(activitySentence('Ananya', 'BESCOM bill paid')).toEqual({ actor: 'Ananya', text: 'BESCOM bill paid' });
    expect(activitySentence('', 'Added bill "Water"')).toEqual({ actor: '', text: 'Added bill "Water"' });
  });
  it('does not strip partial name matches', () => {
    expect(activitySentence('Ro', 'Rohith paid')).toEqual({ actor: 'Ro', text: 'Rohith paid' });
    expect(activitySentence('Ananya', 'Ananyas list updated')).toEqual({ actor: 'Ananya', text: 'Ananyas list updated' });
  });
});

describe('groupByDay (local midnight)', () => {
  const now = new Date(2026, 9, 5, 0, 30);
  const row = (d: Date, id: string) => ({ id, created_at: d.toISOString() });
  it('splits into Today, Yesterday, Earlier and keeps order', () => {
    const rows = [row(new Date(2026, 9, 5, 0, 10), 'a'), row(new Date(2026, 9, 4, 23, 55), 'b'), row(new Date(2026, 9, 1, 9, 0), 'c')];
    expect(groupByDay(rows, now)).toEqual([
      { title: 'Today', rows: [rows[0]] },
      { title: 'Yesterday', rows: [rows[1]] },
      { title: 'Earlier', rows: [rows[2]] }
    ]);
  });
  it('omits empty groups', () => {
    const rows = [row(new Date(2026, 9, 1, 9, 0), 'c')];
    expect(groupByDay(rows, now)).toEqual([{ title: 'Earlier', rows }]);
  });
});

describe('isFreshFromOthers', () => {
  it('is true only for another member', () => {
    expect(isFreshFromOthers('u2', 'u1')).toBe(true);
    expect(isFreshFromOthers('u1', 'u1')).toBe(false);
    expect(isFreshFromOthers(null, 'u1')).toBe(false);
    expect(isFreshFromOthers('u2', null)).toBe(false);
  });
});

describe('freshArrivals', () => {
  const me = 'me';
  const rows = [{ id: 'a', by: 'ann' }, { id: 'b', by: me }, { id: 'c', by: 'ann' }];
  it('returns nothing on the first load and marks everything seen', () => {
    const seen = new Set<string>();
    expect(freshArrivals(seen, rows, (r) => r.by, me, true)).toEqual([]);
    expect([...seen]).toEqual(['a', 'b', 'c']);
  });
  it('returns only unseen rows from other members', () => {
    const seen = new Set(['a']);
    expect(freshArrivals(seen, rows, (r) => r.by, me, false)).toEqual(['c']);
    expect(seen.has('b')).toBe(true);
  });
  it('never returns a row twice', () => {
    const seen = new Set(['a']);
    freshArrivals(seen, rows, (r) => r.by, me, false);
    expect(freshArrivals(seen, rows, (r) => r.by, me, false)).toEqual([]);
  });
});
