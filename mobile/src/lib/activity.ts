const DAY_MS = 86_400_000;

/** Older bill descriptions already start with the actor's name; show it once. */
export function activitySentence(actorName: string, description: string): { actor: string; text: string } {
  const prefix = `${actorName} `;
  const text = actorName && description.startsWith(prefix) ? description.slice(prefix.length) : description;
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
