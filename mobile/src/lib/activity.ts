const DAY_MS = 86_400_000;
const VERBS = /^(Added|Created|Updated|Deleted|Completed|Cleared|Posted|Joined|Left|Marked|Reopened|Removed|Pinned|Unpinned|Started|Rolled|Paid)\b/;

/** Older bill descriptions already start with the actor's name; show it once. */
export function activitySentence(actorName: string, description: string): { actor: string; text: string } {
  const prefix = `${actorName} `;
  let text = actorName && description.startsWith(prefix) ? description.slice(prefix.length) : description;
  // The server capitalises descriptions ("Added bill …"); after the bold name they read as one sentence.
  // Only the verbs the server emits are lowercased, so a leading name or acronym stays as written.
  if (actorName && VERBS.test(text)) text = text[0].toLowerCase() + text.slice(1);
  return { actor: actorName, text };
}

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function groupByDay<T extends { created_at: string }>(rows: T[], now: Date): { title: 'Today' | 'Yesterday' | 'Earlier'; rows: T[] }[] {
  const groups: Record<'Today' | 'Yesterday' | 'Earlier', T[]> = { Today: [], Yesterday: [], Earlier: [] };
  const today = startOfLocalDay(now);
  for (const r of rows) {
    const diff = Math.round((today - startOfLocalDay(new Date(r.created_at))) / DAY_MS);
    groups[diff <= 0 ? 'Today' : diff === 1 ? 'Yesterday' : 'Earlier'].push(r);
  }
  return (['Today', 'Yesterday', 'Earlier'] as const).filter((t) => groups[t].length).map((t) => ({ title: t, rows: groups[t] }));
}

/** Live-update highlight is for other members' changes, never your own. */
export function isFreshFromOthers(createdBy: string | null | undefined, currentUserId: string | null | undefined): boolean {
  return Boolean(createdBy && currentUserId && createdBy !== currentUserId);
}

/**
 * Ids that just arrived from other members and have not been shown yet. Mutates `seen`: every id in `rows`
 * is marked seen, so a row is returned at most once. On the first load nothing is fresh.
 */
export function freshArrivals<T extends { id: string }>(
  seen: Set<string>, rows: T[], actorOf: (row: T) => string | null | undefined, me: string | null | undefined, firstLoad: boolean,
): string[] {
  const fresh: string[] = [];
  for (const r of rows) {
    if (!firstLoad && !seen.has(r.id) && isFreshFromOthers(actorOf(r), me)) fresh.push(r.id);
    seen.add(r.id);
  }
  return fresh;
}
