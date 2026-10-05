import { useEffect, useRef, useState } from 'react';
import { freshArrivals } from '@/lib/activity';

/** How long a row counts as fresh: LiveRow's rise plus glow, with a little slack. */
export const FRESH_MS = 1900;

/**
 * Tracks which rows arrived live from other members, for `LiveRow`. The seen-set resets whenever `scope`
 * changes (a different list or home), so switching never floods the screen with highlights, and a fresh id
 * stays fresh for the whole animation even if the screen re-renders meanwhile.
 */
export function useFreshRows<T extends { id: string }>(
  scope: string | null | undefined, rows: T[], loaded: boolean, actorOf: (row: T) => string | null | undefined, me: string | null | undefined,
) {
  const seen = useRef<{ scope: string | null | undefined; ids: Set<string> } | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!loaded) return;
    const firstLoad = !seen.current || seen.current.scope !== scope;
    if (firstLoad) seen.current = { scope, ids: new Set() };
    const arrived = freshArrivals(seen.current!.ids, rows, actorOf, me, firstLoad);
    if (arrived.length === 0) return;
    setFresh((f) => new Set([...f, ...arrived]));
    const t = setTimeout(() => setFresh((f) => { const n = new Set(f); arrived.forEach((id) => n.delete(id)); return n; }), FRESH_MS);
    timers.current.push(t);
  }, [rows, loaded, scope]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  /** Rows the current user created locally should never flash when the refetch brings them back. */
  const markSeen = (id: string) => seen.current?.ids.add(id);
  return { fresh, markSeen };
}
