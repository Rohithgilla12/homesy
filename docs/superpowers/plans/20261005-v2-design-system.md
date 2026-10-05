# v2 Design System and Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Homesy mobile app on the v2 design system: tokens, primitives, Lucide icons, Geist and Bricolage fonts, a custom Sheet, and signature Reanimated motion. Fix the known UI bugs and add the app's first unit tests.

**Architecture:** Foundations come first:
- tested pure logic in `src/lib/`
- tokens and fonts
- primitives in `src/ui/`
- the Sheet
- motion components

Then each screen is rebuilt on them, one per task, keeping its queries, mutations and API calls unchanged. Visual parity is checked against the canvas artboards on the simulator.

**Tech Stack:**
- Expo SDK 57 (React Native 0.86, React 19.2), expo-router 57
- Reanimated 4.5 with react-native-worklets 0.10, react-native-gesture-handler 2.32
- lucide-react-native, expo-font with `@expo-google-fonts`, expo-haptics, expo-blur, `@react-native-community/datetimepicker`
- jest-expo

**Spec:** `docs/superpowers/specs/20261005-v2-design-system-design.md`
**Visual source:** https://claude.ai/artifact/KzbxigJR6WLhRXyz1LNFiZ (the "Refresh — v2" and "Motion" pages)

## Global Constraints

- **Public repo.** Run `gitleaks protect --staged --no-banner` before every commit and expect `no leaks found`.
- **Ask the owner before starting a dev server.** Use port `8091`, `--clear`, and `EXPO_PUBLIC_API_URL=https://homesy-api.gilla.fun` for smoke tests against production.
- **CLI invocations.** Run the Expo CLI as `./node_modules/.bin/expo` from `mobile/`. Run doctor as `rtk proxy npx --yes expo-doctor@latest`. Raw `npx expo` is rewritten by a shell hook and fails.
- **Installs.** Install every dependency with `./node_modules/.bin/expo install <pkg>`. Dev dependencies use `-- --save-dev`. Afterwards, check that `package.json` did not also add dev dependencies to `dependencies`, and remove any duplicates.
- **Design values.** No raw hex colours, font family names, or `react-native` `Text`, `Pressable` or `Modal` in `app/**` once a screen's task is done. Screens import UI only from `@/ui`.
- **Tokens.** Tokens are exactly the spec's values. Category tints are the values listed in Task 5.
- **Animation.** Animate only transform, opacity and blur, and only with Reanimated on the UI thread. Every animated component reads `useReducedMotion()` and falls back to short fades.
- **Haptics.** Haptics go only through `src/ui/haptics.ts`.
- **Behaviour is unchanged unless the spec says otherwise.** Every screen keeps its query keys, mutations, `api.*` calls, and invalidation.
- **Copy.** Copy may be tightened to match the canvas but never invents features. No new API fields.
- **Comments.** No comment banners. Match the surrounding comment density.
- **Gates.** After each task, run from `mobile/`:
  - `npm test` (from Task 2 on)
  - `./node_modules/.bin/tsc --noEmit`
  - `./node_modules/.bin/expo export --platform ios --output-dir dist/ios`

  Then `rm -rf dist`. All must pass before committing.

## Review Focus

1. **Day boundaries in local time.** "Due today" and "Today/Yesterday" groupings must follow the phone's local midnight, not UTC; India is UTC+5:30, so a UTC-based diff is wrong for half the day. Pinned by tests in Tasks 2 and 3 using local `Date` constructors around midnight.
2. **The Sheet with the keyboard up.** Add-bill and add-vault sheets must keep the focused input visible above the keyboard and still dismiss by drag. Pinned by the simulator check in Task 19.
3. **Live highlight only for others' changes.** Rows the current user just created must not flash blue; only rows from SSE whose actor is someone else do. Pinned by the `isFreshFromOthers` test in Task 3 and the smoke check in Task 20.
4. **Name stripping must not eat legitimate text.** "Rohith Gilla" stripped from "Rohith Gilla marked…" is fine. "Ro" must not be stripped from "Rohith…", and a description with no leading name stays unchanged. Pinned by Task 3 tests.
5. **Rupee formatting at Indian grouping and fractions.** For example `12345650` → `₹1,23,456.5`, `0` → `₹0`, `null` → `—`. Pinned by Task 2 tests.

---

### Task 1: Branch and dependencies

**Files:**
- Modify: `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`

**Interfaces:**
- Produces: installed packages; `npm test` script; `jest` preset `jest-expo`; `userInterfaceStyle: "light"`

- [ ] **Step 1: Branch**

```bash
cd /Users/rohithgilla/github.com/Rohithgilla12/homesy && git switch main && git pull && git switch -c feat/v2-design
```

- [ ] **Step 2: Install runtime dependencies**

From `mobile/`:

```bash
./node_modules/.bin/expo install expo-font @expo-google-fonts/bricolage-grotesque @expo-google-fonts/geist @expo-google-fonts/geist-mono lucide-react-native expo-haptics expo-blur @react-native-community/datetimepicker react-native-gesture-handler
./node_modules/.bin/expo install jest-expo jest @types/jest -- --save-dev
```

Then remove any of `jest`, `jest-expo` or `@types/jest` that also landed in `dependencies`.

- [ ] **Step 3: Confirm the font export names**

```bash
grep -oE "export (const|declare const) [A-Za-z_0-9]+" node_modules/@expo-google-fonts/bricolage-grotesque/index.d.ts node_modules/@expo-google-fonts/geist/index.d.ts node_modules/@expo-google-fonts/geist-mono/index.d.ts | grep -E "700Bold|400Regular|500Medium|600SemiBold"
```

Expected: `BricolageGrotesque_700Bold`, `Geist_400Regular`, `Geist_500Medium`, `Geist_600SemiBold`, `GeistMono_500Medium`. If a name differs, use the real one everywhere the plan names it, and ledger the ruling.

- [ ] **Step 4: Add the scripts and Jest config, and set light mode**

In `package.json`:
- add `"test": "jest"` to `scripts`
- add a top-level `"jest": { "preset": "jest-expo", "testMatch": ["**/__tests__/**/*.test.ts?(x)"] }`

In `app.json`, set `"userInterfaceStyle": "light"`.

- [ ] **Step 5: Gates and commit**

`expo-doctor` must report no issues. `tsc` passes. `npm test -- --passWithNoTests` exits 0.

```bash
git add mobile/package.json mobile/package-lock.json mobile/app.json && gitleaks protect --staged --no-banner && git commit -m "Add v2 design dependencies, Jest, and light-only appearance"
```

### Task 2: `src/lib/format.ts` (TDD)

**Files:**
- Create: `mobile/src/lib/format.ts`
- Test: `mobile/src/lib/__tests__/format.test.ts`

**Interfaces:**
- Produces:
  - `formatRupees(cents: number | null): string`
  - `relativeDue(due: string | null, today: Date): { label: string; tone: 'warn' | 'danger' } | null`
  - `relativeTime(iso: string, now: Date): string`
  - `shortDate(d: Date): string` (for example `"15 Oct"`)

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run them; expect failure**

Run: `npm test -- format`
Expected: FAIL with "Cannot find module '../format'".

- [ ] **Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run them; expect a pass**

Run: `npm test -- format`
Expected: PASS, all tests.

- [ ] **Step 5: Gates and commit**

```bash
git add mobile/src/lib && gitleaks protect --staged --no-banner && git commit -m "Add tested rupee, due-date and relative-time formatting"
```

### Task 3: `src/lib/activity.ts` (TDD)

**Files:**
- Create: `mobile/src/lib/activity.ts`
- Test: `mobile/src/lib/__tests__/activity.test.ts`

**Interfaces:**
- Produces:
  - `activitySentence(actorName: string, description: string): { actor: string; text: string }`
  - `groupByDay<T extends { created_at: string }>(rows: T[], now: Date): { title: 'Today' | 'Yesterday' | 'Earlier'; rows: T[] }[]`
  - `isFreshFromOthers(createdBy: string | null | undefined, currentUserId: string | null | undefined): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
import { activitySentence, groupByDay, isFreshFromOthers } from '../activity';

describe('activitySentence', () => {
  it('strips a leading duplicate actor name', () => {
    expect(activitySentence('Ananya', 'Ananya marked Rent as PAID')).toEqual({ actor: 'Ananya', text: 'marked Rent as PAID' });
    expect(activitySentence('Rohith Gilla', 'Rohith Gilla rolled over "Wi-Fi" to Nov')).toEqual({ actor: 'Rohith Gilla', text: 'rolled over "Wi-Fi" to Nov' });
  });
  it('leaves descriptions without the name untouched', () => {
    expect(activitySentence('Ananya', 'Added bill "Water"')).toEqual({ actor: 'Ananya', text: 'Added bill "Water"' });
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
```

- [ ] **Step 2: Run them; expect failure**

Run: `npm test -- activity`
Expected: FAIL with "Cannot find module '../activity'".

- [ ] **Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run them; expect a pass.** Run `npm test -- activity`. Expected: all pass.
- [ ] **Step 5: Gates and commit** with the message `"Add tested activity sentence, day grouping and live-highlight rule"`.

### Task 4: `src/lib/errors.ts` and `src/lib/color.ts` (TDD)

**Files:**
- Create: `mobile/src/lib/errors.ts`, `mobile/src/lib/color.ts`
- Test: `mobile/src/lib/__tests__/errors.test.ts`, `mobile/src/lib/__tests__/color.test.ts`

**Interfaces:**
- Produces:
  - `friendlyError(err: unknown, context: 'signin' | 'signup' | 'generic'): string`
  - `avatarTint(userId: string): { bg: string; fg: string }`
  - `AVATAR_TINTS` (6 pairs)

- [ ] **Step 1: Write the failing tests**

```ts
// errors.test.ts
import { friendlyError } from '../errors';
const apiErr = (status: number, message: string) => Object.assign(new Error(message), { status });

describe('friendlyError', () => {
  it('maps auth failures', () => {
    expect(friendlyError(apiErr(401, 'unauthorized'), 'signin')).toBe('Wrong email or password');
    expect(friendlyError(apiErr(409, 'conflict: email already registered'), 'signup')).toBe('An account with this email already exists');
  });
  it('maps network and server failures', () => {
    expect(friendlyError(new TypeError('Network request failed'), 'generic')).toBe("Can't reach Homesy. Check your connection.");
    expect(friendlyError(apiErr(503, 'database unavailable'), 'generic')).toBe('Something went wrong on our side. Try again.');
  });
  it('passes through validation messages and falls back', () => {
    expect(friendlyError(apiErr(400, 'title required'), 'generic')).toBe('title required');
    expect(friendlyError('weird', 'generic')).toBe('Something went wrong.');
  });
});
```

```ts
// color.test.ts
import { AVATAR_TINTS, avatarTint } from '../color';

describe('avatarTint', () => {
  it('is deterministic per user', () => {
    expect(avatarTint('0199a1b2-aaaa')).toEqual(avatarTint('0199a1b2-aaaa'));
  });
  it('always returns one of the palette pairs', () => {
    for (const id of ['a', 'bb', 'ccc', '0199', 'user-123', 'z']) expect(AVATAR_TINTS).toContainEqual(avatarTint(id));
  });
});
```

- [ ] **Step 2: Run them; expect failure** (both modules are missing).

- [ ] **Step 3: Implement**

```ts
// errors.ts
type Context = 'signin' | 'signup' | 'generic';

export function friendlyError(err: unknown, context: Context): string {
  if (err instanceof TypeError) return "Can't reach Homesy. Check your connection.";
  const status = typeof err === 'object' && err !== null && 'status' in err ? Number((err as { status: unknown }).status) : NaN;
  const message = err instanceof Error ? err.message : '';
  if (status === 401 && context === 'signin') return 'Wrong email or password';
  if (status === 409 && context === 'signup') return 'An account with this email already exists';
  if (status >= 500) return 'Something went wrong on our side. Try again.';
  if (message) return message;
  return 'Something went wrong.';
}
```

```ts
// color.ts
export const AVATAR_TINTS = [
  { bg: '#E9EDFB', fg: '#1F3AA8' },
  { bg: '#E3F6E9', fg: '#11652F' },
  { bg: '#FDF1DC', fg: '#8A4307' },
  { bg: '#F3EEFB', fg: '#5A33A8' },
  { bg: '#FDE7E5', fg: '#7E1910' },
  { bg: '#E2F3F6', fg: '#0F5F6D' },
] as const;

export function avatarTint(userId: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}
```

- [ ] **Step 4: Run them; expect a pass.**
- [ ] **Step 5: Gates and commit** with the message `"Add tested friendly error messages and avatar tints"`.

### Task 5: Tokens, fonts, splash hold, root shell

**Files:**
- Create: `mobile/src/ui/tokens.ts`
- Modify: `mobile/app/_layout.tsx`

**Interfaces:**
- Produces:
  - `color`, `status`, `category`, `font`, `type`, `space(n)`, `radius`, `motion` from `@/ui/tokens`
  - the root renders inside `GestureHandlerRootView` once fonts load

- [ ] **Step 1: Write `src/ui/tokens.ts`**

```ts
import { Easing } from 'react-native-reanimated';

export const color = {
  bg: '#F6F5F1', surface: '#FFFFFF', surfaceSunk: '#F0EEE8', ink: '#15171C', ink2: '#3B3F47', muted: '#5F646E',
  line: '#E6E3DC', accent: '#2747C9', accentSoft: '#E9EDFB', accentInk: '#1F3AA8', scrim: 'rgba(21,23,28,0.4)', onAccent: '#FFFFFF',
} as const;

export const status = {
  warn: '#A14B07', warnSoft: '#FDF1DC', warnInk: '#7A3A06',
  ok: '#157F3C', okSoft: '#E3F6E9', okInk: '#11652F',
  danger: '#B42318', dangerSoft: '#FDE7E5', dangerInk: '#7E1910',
} as const;

type Tint = { bg: string; fg: string };
export const category: {
  list: Record<'grocery' | 'laundry' | 'todo' | 'custom', Tint>;
  bill: Record<'electricity' | 'internet' | 'water' | 'gas' | 'maintenance' | 'maid' | 'other', Tint>;
  vault: Record<'utilities' | 'contacts' | 'access' | 'documents' | 'other' | 'wifi', Tint>;
} = {
  list: {
    grocery: { bg: '#E9EDFB', fg: '#2747C9' }, laundry: { bg: '#EEF4F1', fg: '#2F6B57' },
    todo: { bg: '#F3EEFB', fg: '#6B3FC4' }, custom: { bg: '#FDF1DC', fg: '#A14B07' },
  },
  bill: {
    electricity: { bg: '#FDF1DC', fg: '#A14B07' }, internet: { bg: '#E7EFFA', fg: '#245C9E' }, water: { bg: '#E2F3F6', fg: '#0F6A7A' },
    gas: { bg: '#FCE9E4', fg: '#A3381B' }, maintenance: { bg: '#F3EEFB', fg: '#6B3FC4' }, maid: { bg: '#FBEAF3', fg: '#9C2F6A' },
    other: { bg: '#F0EEE8', fg: '#3B3F47' },
  },
  vault: {
    utilities: { bg: '#FDF1DC', fg: '#A14B07' }, contacts: { bg: '#EEF4F1', fg: '#2F6B57' }, access: { bg: '#FDF1DC', fg: '#8A4307' },
    documents: { bg: '#E9EDFB', fg: '#1F3AA8' }, other: { bg: '#F0EEE8', fg: '#3B3F47' }, wifi: { bg: '#E9EDFB', fg: '#2747C9' },
  },
};

export const font = {
  display: 'BricolageGrotesque_700Bold',
  regular: 'Geist_400Regular', medium: 'Geist_500Medium', semibold: 'Geist_600SemiBold',
  mono: 'GeistMono_500Medium',
} as const;

export const type = {
  display: { fontFamily: font.display, fontSize: 32, lineHeight: 38, letterSpacing: -0.6 },
  title: { fontFamily: font.display, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  headline: { fontFamily: font.semibold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: font.medium, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: font.medium, fontSize: 12, lineHeight: 16, letterSpacing: 0.48, textTransform: 'uppercase' as const },
  mono: { fontFamily: font.mono, fontSize: 15, lineHeight: 22 },
} as const;

export const space = (n: number) => n * 4;
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, full: 999 } as const;

export const motion = {
  press: { scale: 0.97, duration: 160, easing: Easing.bezier(0.23, 1, 0.32, 1) },
  sheetIn: { duration: 320, easing: Easing.bezier(0.32, 0.72, 0, 1) },
  sheetOut: { duration: 200, easing: Easing.bezier(0.32, 0.72, 0, 1) },
  fade: { duration: 180 },
  spring: { damping: 14, stiffness: 220 },
  easeOut: Easing.bezier(0.23, 1, 0.32, 1),
} as const;
```

- [ ] **Step 2: Fonts, splash hold and gesture root in `app/_layout.tsx`**

Keep the existing session hydration, redirect logic, QueryClient and persister. Add:

```tsx
import { BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque';
import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold } from '@expo-google-fonts/geist';
import { GeistMono_500Medium } from '@expo-google-fonts/geist-mono';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { color } from '@/ui/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});
```

Inside `Root`:

```tsx
const [fontsLoaded, fontError] = useFonts({ BricolageGrotesque_700Bold, Geist_400Regular, Geist_500Medium, Geist_600SemiBold, GeistMono_500Medium });
const ready = hydrated && (fontsLoaded || !!fontError);
useEffect(() => { if (fontError) console.warn('font load failed', fontError); }, [fontError]);
useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);
if (!ready) return null; // the splash stays visible
```

- Wrap the returned tree in `<GestureHandlerRootView style={{ flex: 1, backgroundColor: color.bg }}>`.
- Change `StatusBar style="dark"` to stay dark.
- The old `ActivityIndicator` hydration view goes away (the splash covers it), which removes the white flash.

- [ ] **Step 3: Gates and commit.** Run all three gates, then commit with the message `"Add v2 tokens, load Geist and Bricolage behind the splash"`.

### Task 6: Core primitives

**Files:**
- Create in `mobile/src/ui/`: `haptics.ts`, `Text.tsx`, `Pressable.tsx`, `Icon.tsx`, `Button.tsx`, `IconButton.tsx`, `Card.tsx`, `Pill.tsx`, `Chip.tsx`, `Avatar.tsx`, `EmptyState.tsx`, `Screen.tsx`, `index.ts`

**Interfaces:**
- Consumes: `tokens.ts`, `@/lib/color`
- Produces (all exported from `@/ui`):
  - `Text`, `Pressable`, `Icon`, `IconName`, `Button`, `IconButton`, `Card`, `Pill`, `Chip`, `Avatar`, `EmptyState`, `Screen`
  - `haptic.light()`, `haptic.selection()`, `haptic.success()`, `haptic.warning()`

- [ ] **Step 1: `haptics.ts`**

```ts
import * as Haptics from 'expo-haptics';

const safe = (p: Promise<void>) => { p.catch(() => {}); };
export const haptic = {
  light: () => safe(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  selection: () => safe(Haptics.selectionAsync()),
  success: () => safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
};
```

- [ ] **Step 2: `Text.tsx`.** It maps `variant` to `type[variant]` and `tone` to a colour. `style` is typed to allow only layout keys.

```tsx
import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { color, status, type as typo } from './tokens';

const tones = {
  ink: color.ink, ink2: color.ink2, muted: color.muted, accent: color.accent, accentInk: color.accentInk,
  warn: status.warnInk, ok: status.okInk, danger: status.danger, onAccent: color.onAccent,
} as const;
type Layout = Pick<TextStyle, 'margin' | 'marginTop' | 'marginBottom' | 'marginLeft' | 'marginRight' | 'marginHorizontal' | 'marginVertical' | 'textAlign' | 'flex' | 'flexShrink' | 'alignSelf' | 'textDecorationLine' | 'fontVariant'>;

export type TextVariant = keyof typeof typo;
export function Text({ variant = 'body', tone = 'ink', style, ...p }: Omit<TextProps, 'style'> & { variant?: TextVariant; tone?: keyof typeof tones; style?: Layout }) {
  return <RNText {...p} style={[typo[variant], { color: tones[tone] }, style]} />;
}
```

- [ ] **Step 3: `Pressable.tsx`.** It applies a Reanimated scale to 0.97 while pressed, skipped under Reduce Motion, and keeps a minimum 44 pt target via `hitSlop`.

```tsx
import { Pressable as RNPressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { motion } from './tokens';

const APressable = Animated.createAnimatedComponent(RNPressable);

export function Pressable({ style, onPressIn, onPressOut, hitSlop = 8, accessibilityRole = 'button', ...p }: Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const s = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <APressable
      {...p}
      hitSlop={hitSlop}
      accessibilityRole={accessibilityRole}
      onPressIn={(e) => { if (!reduce) s.value = withTiming(motion.press.scale, { duration: motion.press.duration, easing: motion.press.easing }); onPressIn?.(e); }}
      onPressOut={(e) => { s.value = withTiming(1, { duration: motion.press.duration, easing: motion.press.easing }); onPressOut?.(e); }}
      style={[style, anim]}
    />
  );
}
```

- [ ] **Step 4: `Icon.tsx`**, with the spec's mapping table:

```tsx
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
```

- [ ] **Step 5: `Button`, `IconButton`, `Card`, `Pill`, `Chip`, `Avatar`, `EmptyState`, `Screen`**

Each is built on `Pressable`, `Text` and tokens to these contracts (values from the spec and the v2 board).

**`Button`**
- **Props:** `{ title: string; onPress; variant?: 'primary'|'secondary'|'ghost'|'danger'; size?: 'md'|'sm'; icon?: IconName; loading?: boolean; disabled?: boolean; fullWidth?: boolean }`
- **Size:** `md` has padding `12/16` and radius `md`; `sm` has padding `8/14` and radius `full`.
- **Variant colours:**
  - primary: `accent` bg, `onAccent` text
  - secondary: `surface` bg with a 1 pt `line` border, `ink` text
  - ghost: transparent, `accentInk` text
  - danger: `dangerSoft` bg, `danger` text
- **Loading:** the label goes to `opacity: 0` with an `ActivityIndicator` centred over it in the text colour, so the width is preserved.
- **Accessibility:** `accessibilityState={{ disabled, busy: loading }}`.

**`IconButton`**
- **Props:** `{ icon: IconName; label: string; onPress; variant?: 'plain'|'outlined'|'filled'; tint? }`
- 40 × 40, radius `md`. `filled` is an `accent` bg with an `onAccent` icon; `outlined` is `surface` with a `line` border.
- `accessibilityLabel={label}`.

**`Card`**
- **Props:** `{ children; onPress?; padded?: boolean = true; style?: layout }`
- `surface` bg, 1 pt `line` border, radius `lg`, iOS shadow `{ shadowColor: ink, shadowOpacity: 0.04, shadowRadius: 2, shadowOffset: { height: 1 } }`, padding `space(4)`.
- Renders as `Pressable` when `onPress` is set.

**`Pill`**
- **Props:** `{ label: string; tone?: 'accent'|'neutral'|'warn'|'ok'|'danger'; icon?: IconName }`
- Padding `3/10`, radius `full`, `label` type.
- Tones: accent `accentSoft`/`accentInk`; neutral `surfaceSunk`/`ink2`; warn `warnSoft`/`warn`; ok `okSoft`/`okInk`; danger `dangerSoft`/`danger`.

**`Chip`**
- **Props:** `{ label: string; selected: boolean; onPress; icon?: IconName }`
- Padding `7/14`, radius `full`. Unselected is `surface` with a `line` border and `ink2` text; selected is an `ink` bg and border with `onAccent` text.
- Calls `haptic.selection()` before `onPress`.
- `accessibilityState={{ selected }}`.

**`Avatar`**
- **Props:** `{ userId: string; name: string; size?: number = 36 }`
- Initials are the first letters of the first two words, uppercased, using `avatarTint(userId)`.
- `accessibilityLabel={name}`.

**`EmptyState`**
- **Props:** `{ icon: IconName; title: string; body: string; actionLabel?; onAction? }`
- A centred `Card` with a 48 pt `surfaceSunk` icon tile, a `title`, a `body` in `muted`, and an optional primary `Button`.

**`Screen`**
- **Props:** `{ children; scroll?: boolean; edges?: Edge[]; contentStyle?: layout; refreshControl? }`
- `SafeAreaView` (from `react-native-safe-area-context`) with `edges` defaulting to `[]`: tab screens get insets from the header and tab bar.
- `bg` background, horizontal padding `space(4)`.
- When `scroll` is set, a `ScrollView` with `contentContainerStyle={{ paddingBottom: space(10), gap: space(3) }}`.

**`index.ts`** re-exports every primitive plus `tokens` (`export * from './tokens'`).

- [ ] **Step 6: Gates and commit.** Run all three gates, then commit with the message `"Add v2 primitives: Text, Pressable, Icon, Button, Card, Pill, Chip, Avatar, EmptyState, Screen"`.

### Task 7: `Input` and `DateField`

**Files:**
- Create: `mobile/src/ui/Input.tsx`, `mobile/src/ui/DateField.tsx`
- Modify: `mobile/src/ui/index.ts`

**Interfaces:**
- Produces:
  - `Input` (forwardRef `TextInput`), with props `label`, `error?`, `hint?`, `variant?: 'default'|'code'`, `containerStyle?` (layout only), plus `TextInputProps` minus `style`
  - `DateField({ label, value: string | null, onChange(v: string | null) })`

- [ ] **Step 1: `Input`**
- A visible `Text variant="label" tone="ink2"` label above the field.
- **Field:** `surface` bg, 1 pt `line` border, radius `md`, padding `12/14`, `body` type with `fontSize: 16`, `placeholderTextColor={color.muted}`.
- **Focus:** an `accent` border plus a 3 pt `accentSoft` halo (an outer `View` with a border, shown on `onFocus`).
- **Error:** a `danger` border and a `Text variant="label" tone="danger"` message below.
- **`code` variant:** `mono` type at size 22, `letterSpacing: 4`, centred, `autoCapitalize="characters"`, `maxLength={6}`.
- **Bug fix:** the component never spreads a caller `style` onto the base. `style` is not an accepted prop, so TypeScript forbids it.

- [ ] **Step 2: `DateField`**
- Renders a labelled row: label above, then a pressable field showing `shortDate` of the value or "Pick a date" in `muted`, with a clear `IconButton` (`close`) when set.
- On iOS it renders `<DateTimePicker mode="date" display="compact" value={parsed ?? new Date()} onChange={(_, d) => d && onChange(toIso(d))} />` inline.
- `toIso(d)` = `${y}-${pad(m)}-${pad(d)}` from **local** components.
- On other platforms it shows the picker in modal mode on press.

- [ ] **Step 3: Gates and commit** with the message `"Add v2 Input (fixes style override) and native DateField"`.

### Task 8: `Sheet`

**Files:**
- Create: `mobile/src/ui/Sheet.tsx`
- Modify: `mobile/src/ui/index.ts`

**Interfaces:**
- Produces: `Sheet({ visible: boolean; onClose(): void; title?: string; children; blur?: boolean = true })`

- [ ] **Step 1: Implement to the spec**
- **Container:** a transparent RN `Modal` with `animationType="none"`, `onRequestClose={onClose}`, and `statusBarTranslucent`.
- **Backdrop:** an `Animated.View` that fades `opacity` 0 → 1 over `motion.fade.duration`, containing a `BlurView intensity={20} tint="light"` (iOS, when `blur`) under a `scrim` `View`. Tapping it closes the sheet.
- **Panel:** an `Animated.View` translated by `translateY` from the panel height to 0 with `withTiming(0, motion.sheetIn)`. On close it animates to the height with `motion.sheetOut`, then `scheduleOnRN(onClose)`. Keep the `Modal` mounted until that exit finishes: internal `mounted` state is set true when `visible` turns true and false after the exit.
- **Drag:** `GestureDetector` with `Gesture.Pan()`.
  - `onUpdate`: `translateY = max(0, e.translationY)`; upward drag past 0 uses `e.translationY / 4` resistance.
  - `onEnd`: close if `translationY > height * 0.3 || e.velocityY > 110` (pt/s units from gesture-handler, which equals 0.11 pt/ms); otherwise spring back with `motion.spring`.
- **Layout:**
  - panel: `bg` background, top radii `xl`, a 36 × 5 `line`-coloured grab handle centred, an optional `Text variant="title"`, content with `gap: space(3)`
  - bottom padding is `insets.bottom + space(4)` from `useSafeAreaInsets()`
  - wrapped in `KeyboardAvoidingView behavior="padding"`
- **Stagger:** the first five direct children are wrapped in `Animated.View entering={FadeInDown.duration(220).delay(i * 40)}`.
- **Reduce Motion:** the panel fades instead of sliding, there's no stagger, and the blur is static.

- [ ] **Step 2: Gates and commit** with the message `"Add v2 Sheet: drawer-curve slide, drag to dismiss, blurred backdrop"`.

### Task 9: Motion components

**Files:**
- Create in `mobile/src/ui/motion/`: `AnimatedCheck.tsx`, `StrikeText.tsx`, `PaidStamp.tsx`, `CountUp.tsx`, `LiveRow.tsx`, `BlurReveal.tsx`, `RoofRefresh.tsx`, `Confetti.tsx`, `ColdStart.tsx`, `index.ts`
- Modify: `mobile/src/ui/index.ts` (re-export `./motion`)

**Interfaces:**
- Produces:
  - `AnimatedCheck({ checked: boolean; onPress(): void; label: string })`
  - `StrikeText({ children: string; struck: boolean })`
  - `PaidStamp({ by: string; when: string; refText?: string | null })`
  - `CountUp({ value: number; format(n: number): string; durationMs?: number })`
  - `LiveRow({ fresh: boolean; children })`
  - `BlurReveal({ secret: string; masked: string; revealed: boolean })`
  - `RoofRefresh`: hook `useRoofRefresh({ refreshing, onRefresh })` returning `{ onScroll, refreshControl, indicator }`
  - `Confetti({ fire: number })` (fires when the number changes)
  - `ColdStart({ onDone(): void })`

Each implements its spec row with the prototype's timings (`MotionCheck`, `MotionPaid`, `MotionLive`, `MotionReveal`, `MotionPull`, `MotionConfetti` on the canvas):

- **`AnimatedCheck`:**
  - A 26 pt circle. The fill pops on `withSequence(withTiming(0.78, {duration: 0}), withSpring(1, motion.spring))`.
  - The check `Path` is drawn with `useAnimatedProps` on `strokeDashoffset` (`strokeDasharray` 21, the length of `"m5 12 5 5 9-10"` in the 24 viewBox: 7.07 + 13.45, rounded up), 1 → 0 over 180 ms after a 60 ms delay.
  - Calls `haptic.light()` when becoming checked.
  - `accessibilityRole="checkbox"`, `accessibilityState={{ checked }}`.
- **`StrikeText`:** a 1.5 pt `muted` line whose `scaleX` animates 0 → 1 (origin left) over 160 ms after a 120 ms delay, measured to the text width via `onLayout`. The text tone shifts to `muted`.
- **`PaidStamp`:**
  - Shield `Icon` in a white 36 pt seal: scale 0.4 → 1 and rotate −14° → 0 on the spring.
  - A ring `View`: scale 0.7 → 1.9 and opacity 0.7 → 0 over 650 ms after 140 ms.
  - Text rises 5 pt → 0 over 260 ms after 160 ms.
  - Calls `haptic.success()` on mount.
  - `okSoft` container with `okInk` text: "Paid — don't pay again" / "`{by} · {when}`` · {refText}`".
- **`CountUp`:** animates a shared value from the previous to the new value (`withTiming`, ease-out cubic, `durationMs` defaulting to 600), driving a JS-side display via `useAnimatedReaction` → `scheduleOnRN(setDisplay)` at most every frame. Under Reduce Motion it jumps straight to the value.
- **`LiveRow`:** when `fresh`, uses `entering={FadeInDown.duration(220)}`, plus an overlay with an `accentSoft` background whose opacity animates 1 → 0 over 1500 ms after 220 ms.
- **`BlurReveal`:**
  - Two stacked `Text variant="mono"` with `expo-blur` `BlurView` overlays whose `intensity` animates via `useAnimatedProps`, with cross-faded opacity over 200 ms.
  - Calls `haptic.selection()` on reveal.
  - The caller owns the 30 s re-mask timer.
- **`useRoofRefresh`:**
  - Uses an `Animated.FlatList`/`ScrollView` `onScroll` (`useAnimatedScrollHandler`) to read the negative `contentOffset.y` as pull progress over an 80 pt threshold.
  - Renders the house SVG (roof, walls and door paths) with `strokeDashoffset` progress windows roof 0–0.45, walls 0.30–0.75, door 0.65–0.95.
  - Arms at 0.7 with `haptic.light()` once per pull.
  - Uses a native `RefreshControl` with `tintColor="transparent"` for the mechanics.
  - While `refreshing`, the mark breathes (scale 1 ↔ 1.08, 900 ms, `withRepeat`).
- **`Confetti`:** 24 `Animated.View` particles seeded per fire. Each translates along an upward cone, then falls 150 pt with rotation, opacity → 0, over 950 ms (`withTiming` sequences), colours from the brand palette. `pointerEvents="none"`. Renders nothing under Reduce Motion. Calls `haptic.success()`.
- **`ColdStart`:** a full-screen `bg` overlay with the house mark. The roof draws over 400 ms, then the overlay fades over 200 ms and calls `onDone`. Under Reduce Motion it skips straight to `onDone`.

- [ ] **Step 1: Implement the components above.** Each is under about 120 lines, using `react-native-svg` `Path` with `Animated.createAnimatedComponent(Path)` where strokes animate.
- [ ] **Step 2: Gates and commit** with the message `"Add v2 motion components: check, strike, stamp, count, live row, reveal, roof refresh, confetti, cold start"`.

### Task 10: App shell (`AppHeader`, `TabBar`, home switcher sheet, cold start)

**Files:**
- Create: `mobile/src/ui/AppHeader.tsx`, `mobile/src/ui/TabBar.tsx`
- Modify:
  - `mobile/src/ui/HomeSwitcher.tsx`: becomes `HomeSwitcherSheet`
  - `mobile/app/(app)/(tabs)/_layout.tsx`
  - `mobile/app/_layout.tsx`: mounts `ColdStart` once per cold start
  - `mobile/src/ui/index.ts`

**Interfaces:**
- Consumes: the `api.homes` / `api.createHome` / `api.joinHome` calls and query keys from the existing `HomeSwitcher`
- Produces:
  - `<Tabs tabBar={(p) => <TabBar {...p} />} screenOptions={{ header: () => <AppHeader /> }}>`
  - `HomeSwitcherSheet({ visible, onClose })`

- [ ] **Step 1: `AppHeader`**
- **Left:** a `Pressable` pill (`surface`, `line` border, radius `full`) holding a 28 pt `accentSoft` circle with the home emoji, the home name in `headline`, and `Icon chevronDown`. It opens `HomeSwitcherSheet`.
- **Right:** an `Avatar` for the current user.
- Height 56 plus the top safe area, `bg` background.

- [ ] **Step 2: `TabBar`.** Five tabs, from route names to icons and labels: Lists `tab.lists`, Bills `tab.bills`, Vault `tab.vault`, Activity `tab.activity`, Home `tab.home`.
- **Active tab:** a 52 × 30 `accentSoft` pill behind the icon, with `accentInk` icon and label.
- **Inactive tab:** `muted`.
- **Label type:** `font.medium` at 11/14.
- **Layout:** top border `line`, `bg` background, padding bottom `insets.bottom`.
- **No animation** between tabs.
- `accessibilityRole="tab"` with `accessibilityState={{ selected }}`.

- [ ] **Step 3: `HomeSwitcherSheet`.** Port the logic from `HomeSwitcher.tsx` into a `Sheet` titled "Your homes".
- Rows show the emoji, the name, and a `check` icon for the active home.
- Two `Button variant="secondary" size="sm"` buttons, "Create home" and "Join with code", switch the sheet's internal view to a create form (emoji `Chip`s plus name `Input`) or a join form (`Input variant="code"`).
- Strings and API calls stay the same as today.

- [ ] **Step 4: Cold start.** In the root layout, after fonts are ready, render `<ColdStart onDone={() => setColdDone(true)} />` over the app until it finishes. Track this with a module-level flag so it runs once per process.

- [ ] **Step 5: Gates and commit** with the message `"Add v2 app shell: header, tab bar, home switcher sheet, cold start"`.

### Tasks 11–17: Screens

For every screen task:
- Keep every `useQuery`, `useMutation`, `api.*` call, query key and invalidation.
- Replace the layout with v2 primitives exactly as listed.
- Move every `Alert` that showed `e.message` to `friendlyError(e, …)`.
- Delete the screen's local `StyleSheet` styles that the primitives replace.
- Steps per task:
  1. Rebuild.
  2. Grep the file: `grep -nE "from 'react-native'.*\b(Text|Pressable|Modal)\b|#[0-9A-Fa-f]{6}|fontFamily" <file>` must print nothing.
  3. Gates.
  4. Commit `"Rebuild <screen> on v2"`.

The composition below is the spec for each screen's markup.

### Task 11: Sign in and sign up

**Files:** `mobile/app/(auth)/login.tsx`, `mobile/app/(auth)/signup.tsx`

- **Shared shell:** `Screen edges={['top','bottom']}` with content centred vertically.
  - A 56 pt `accent` rounded tile (radius 16) with `Icon tab.home` (white, 28).
  - Brand title: `Text variant="display"` at size 36, `"Homesy"` (login) or `"Create account"` (signup).
  - Subtitle: `Text tone="muted"`, keeping the existing strings.
- **Login fields:** `Input label="Email"` (placeholder `you@example.com`, email keyboard, `autoCapitalize="none"`) and `Input label="Password"` (placeholder `At least 8 characters`, secure).
- **Signup fields:** `Input label="Your name"` (placeholder `e.g. Rohith`), then Email and Password as above.
- **Action:** primary `Button fullWidth` "Sign in" or "Create account", with `loading` while the mutation runs.
- **Footer:** `Text tone="muted"` with an inline `accentInk` link: "New here? **Create an account**" or "Already have an account? **Sign in**".
- **Errors:** inline under the form in `Text tone="danger"` using `friendlyError(e, 'signin' | 'signup')`, instead of an `Alert`. Keep the existing validation strings.

### Task 12: Onboarding and Home tab

**Files:** `mobile/app/(app)/(tabs)/home.tsx`, `mobile/app/(app)/_layout.tsx`

- **Onboarding** (no homes; the existing branch in `(app)/_layout.tsx`):
  - `Screen scroll edges={['top','bottom']}`.
  - `Text variant="display"` "Welcome, {first name}", then the existing body copy in `muted`.
  - **Create** `Card`: `Text variant="title"` "Create your first home", emoji `Chip`s for the 8 emojis, `Input label="Home name"` (placeholder `e.g. Parents' house, Bangalore flat`), primary `Button` "Create home". On success it fires `Confetti` and `haptic.success()`.
  - **Join** `Card`: `Text variant="title"` "Join with an invite code", `Input variant="code" label="Invite code"`, primary `Button` "Join home".
  - **Account** `Card`: name and email, `Button variant="ghost"` "Sign out".
- **Home tab** (has homes): `Screen scroll`.
  - `Text variant="display"` with the home name.
  - **Whiteboard** `Card`: `Text variant="title"` "Fridge whiteboard" and `Button size="sm" variant="secondary" icon="add"` "Note".
    - Urgent notes: `dangerSoft` box, `Pill tone="danger"` "Urgent", title in `dangerInk`.
    - Normal notes: `surfaceSunk` box.
    - Each note has a delete `IconButton` (`close`).
    - Empty state: `Text tone="muted"` with the existing copy.
  - **Post note** `Sheet` "Post a note": Title `Input`, multiline Details `Input`, an "Urgent" `Switch` row (track `status.danger`), primary "Post note".
  - **Invite** `Card`: caption "Invite code", the code in `Text variant="mono"` at size 28 with `letterSpacing: 6` in `accentInk`, `Button size="sm" variant="secondary" icon="copy"` (shows "Copied" for 2.5 s), `Button size="sm" icon="share"` "Share", and a hint in `muted` "Anyone with this code can join this home."
  - **Members** `Card`: rows with `Avatar`, the name (plus `muted` "(you)"), the email in `muted`, and `Pill` Owner (`accent`) or Member (`neutral`).
  - **Account** `Card`: name, email, `Button variant="ghost" icon="signOut"` "Sign out".
  - `Button variant="danger" fullWidth` "Leave this home". Keep the existing confirm `Alert` with its strings.
- **Owner celebration:** when an SSE `member_joined` invalidation adds a new member to a home the current user owns while the Home tab is mounted, fire `Confetti`. Detect it by comparing the member count across renders.

### Task 13: Lists tab

**File:** `mobile/app/(app)/(tabs)/index.tsx`

- `Screen` containing an `Animated.FlatList` wired to `useRoofRefresh` (`refreshing = isRefetching`, `onRefresh = refetch`).
- **Header row:** `Text variant="display"` "Lists", a subtitle `muted` "{n} lists · {open} open items", and `Button size="sm" variant="secondary" icon="add"` "New list".
- **Row:** `Card onPress` opening the list.
  - A 42 pt tile in `category.list[kind]` with `Icon list.{kind}` in the tile's `fg`.
  - Name in `headline`; the kind label in `muted` 13 ("Grocery list", "Laundry list", "To-do list", "Custom list").
  - `Pill` "{n} open" (`accent`) or "All done" (`neutral`).
  - `Icon chevronRight` in `muted`.
- **Empty state:** `EmptyState icon="list.custom"` with title "No lists in this home yet", body "Create a grocery, laundry, or to-do list to get started.", and action "Create a list".
- **New list** `Sheet` "New list": type `Chip`s (Groceries, Laundry, To-do, Custom, each with its icon), `Input label="Name"` with the existing per-type placeholders, primary "Create list".

### Task 14: List detail

**File:** `mobile/app/(app)/lists/[id].tsx`

- **Header** via `Stack.Screen options`:
  - title = list name, in `font.semibold` with `color.ink`
  - `headerTintColor: color.accentInk`, `headerShadowVisible: false`, `headerStyle: { backgroundColor: color.bg }`
  - right: "Clear done ({n})" as `Button variant="ghost" size="sm"`, shown only when n > 0
- **Below the header:**
  - `Text variant="display"` with the list name (size 30) and a `muted` "{open} to get".
  - **Composer** `Card` (padding 8):
    - an inline borderless `TextInput` with `accessibilityLabel="Add an item"`, styled from tokens (`body` 16, `ink`). This is the only raw `TextInput` allowed, because `Input`'s label doesn't fit here; document the exception in a code comment.
    - `IconButton variant="filled" icon="add" label="Add item"`
    - a row of `Chip`s "+ Quantity" and "+ Note", which toggle and reveal `Input label="Quantity"` and `Input label="Note"` (keeping the existing placeholders)
- **Open items:** a `Card` with rows.
  - Each row: `AnimatedCheck`, the title in `headline` with an optional qty `Pill tone="neutral"`, the note in `muted` 13, and an edit `IconButton` (`edit`).
  - Each row is wrapped in `LiveRow fresh={isFreshFromOthers(item.created_by, me.id) && arrivedViaSse}`. "Arrived via SSE" means the id wasn't present in the previous render's data **and** it wasn't created by this user. Track a `Set` of ids seen on first load.
  - **Swipe:** each row is wrapped in a `GestureDetector` `Gesture.Pan`. Right reveals an `accent` "Done" action and completes the item; left reveals a `danger` "Delete" action and deletes it (keeping today's confirm `Alert`). `haptic.selection()` fires once when the 35% threshold is crossed, and a commit happens at 35% or velocity > 110.
- **Tick sequence:** `AnimatedCheck` → `StrikeText` → after 340 ms, call the existing `updateItem({ done: true })` mutation. The row moves into Done via `Animated.View layout={LinearTransition.duration(220)}` with `entering`/`exiting` fades.
- **Done section:** caption "Done · {n}", then a `Card` (`surfaceSunk` tint) of rows with a static checked `AnimatedCheck`. Tapping one un-ticks it.
- **Edit** `Sheet` "Edit item": Title, Quantity and Note `Input`s, a Completed `Switch` (track `accent`), primary "Save changes", `danger` "Delete item".
- **Empty state:** `EmptyState icon="list.grocery"` with title "No items in this list" and body "Add your first item using the box above."

### Task 15: Bills

**File:** `mobile/app/(app)/(tabs)/bills.tsx`

- `Screen` containing an `Animated.FlatList` with `useRoofRefresh`.
- **Header:** `Text variant="display"` "Bills" and `Button size="sm" icon="add"` "Add bill".
- **Summary banner** (when there are bills):
  - **Due** (anything unpaid): `warnSoft` card with a 40 pt circle filled `surface` at 60% over the banner, holding `Icon due` in `warn`, the title "{n} bill(s) due this month" in `warnInk` `headline`, the body "Pay in your utility app, then mark it paid so nobody pays twice." in `label`, and the total via `CountUp value={totalUnpaidCents} format={formatRupees}` in `headline` 20.
  - **All paid:** `okSoft` with `Icon paid`, "All bills paid", "Nobody needs to pay anything right now."
- **Filters:** `Chip`s "All {n}", "Due {n}", "Paid {n}".
- **Bill card:**
  - Top row: a 42 pt tile in `category.bill[cat]` with `Icon bill.{cat}`, the title in `headline`, "{Category label} · {billing_period}" in `muted` 13, and the amount via `formatRupees` in `headline` 20 with tabular figures (`muted` when paid).
  - **Unpaid:** a `Pill` from `relativeDue(bill.due_date, new Date())` (warn/danger tone, `due` icon), or `Pill tone="warn"` "Unpaid for {period}" when there's no due date.
  - **Consumer ID:** if `account_number` is set, a `surfaceSunk` row with caption "Consumer ID", the value in `mono`, and a copy `IconButton` (icon flips to `copied` for 2 s).
  - **Notes:** in `muted` 13.
  - **Actions:** unpaid shows primary `Button` "Mark as paid" (flex 1) plus `IconButton icon="more" label="More options"`. Paid shows `PaidStamp by={payerName} when={shortDate(paid_at)} refText={payment_ref}` plus the `more` `IconButton`.
- **More** `Sheet` (title = bill title):
  - "Start next cycle" (`nextCycle`) opens the Next-cycle `Sheet`.
  - "Undo payment" (`undo`), paid only, calls the existing `unpayBill` mutation behind the existing confirm.
  - "Delete bill" (`delete`, `danger`) keeps the existing confirm.
- **Add bill** `Sheet` "Add a bill":
  - category `Chip`s with icons (7)
  - `Input label="Title"`, `Input label="Amount (₹)"` (decimal pad), `DateField label="Due date"`, `Input label="Consumer / account ID"`, `Input label="Billing period"` (prefilled with the current month), `Input label="Notes"`
  - primary "Add bill"
  - The existing validation messages appear as an inline `danger` error.
- **Pay** `Sheet` "Confirm payment":
  - a summary `Card` (`okSoft`) with the title, the amount, and the consumer ID
  - caption "Who paid?", then payer `Chip`s ("You" plus member names; the current user is preselected)
  - `Input label="Payment reference"` (prefilled "Paid via UPI / GPay")
  - primary "Confirm, mark as paid", which fires `haptic.success()` via `PaidStamp` mount
- **Next cycle** `Sheet`: `Input label="Billing period"` (prefilled with next month), `Input label="Amount (₹)"`, `DateField label="Due date"`, primary "Start next cycle".
- **Empty states:** `EmptyState icon="bill.electricity"` with the existing title and body variants per filter.

### Task 16: Vault

**File:** `mobile/app/(app)/(tabs)/vault.tsx`

- `Screen scroll`.
- **Header:** `Text variant="display"` "Vault", subtitle `muted` "Wi-Fi, codes and contacts for this home", and `IconButton variant="filled" icon="add" label="Add detail"`.
- **Filters:** a horizontal scroll of `Chip`s: All, Utilities & bills, Contacts, Access & codes, Documents, Other.
- **Sections:** caption "Pinned", then one per category (or the single filtered section), each a `Card` of entry rows.
- **Entry row:**
  - A 40 pt tile in `category.vault[isWifi ? 'wifi' : cat]` with the matching icon.
  - The label in `headline` (normal case) plus `Pill tone="neutral" icon="pin"` when pinned and `Pill tone="neutral"` "Hidden" when secret.
  - **Value:** secret entries use `BlurReveal masked="••••••••••" secret={value} revealed={revealedIds.has(id)}`, plus a `Button size="sm" variant="ghost" icon="reveal"` "Show"/"Hide". On reveal, start a 30 s timer to re-mask. Non-secret values show `Text` selectable.
  - **Wi-Fi entries** also get `Button size="sm" variant="secondary" icon="qr"` "QR code" and `icon="copy"` "Copy".
  - Right side: a copy `IconButton` and an edit `IconButton`.
- **Add/Edit** `Sheet`s: category `Chip`s, `Input label="Label"`, `Input label="Value"`, "Secret" and "Pin to top" `Switch` rows (track `accent`), primary "Save", and `danger` "Delete detail" (edit only).
- **Wi-Fi QR** `Sheet` "Wi-Fi fast connect":
  - the explanation in `muted`
  - a `Card` with the existing on-device `QRCode` (size 220, colour `color.ink`)
  - `Input label="Network name (SSID)"`
  - a password row (caption plus `mono`) with a copy `IconButton`
  - primary "Copy Wi-Fi password"
  - The `escapeWifi` logic stays unchanged.

### Task 17: Activity

**File:** `mobile/app/(app)/(tabs)/activity.tsx`

- `Screen` containing a `SectionList` built from `groupByDay(activities, new Date())`.
- **Header:** `Text variant="display"` "Activity" and `Pill tone="ok"` "Live" with a 7 pt `ok` dot that breathes (opacity 1 ↔ 0.35, 2 s, `withRepeat`; static under Reduce Motion).
- **Section headers:** captions "Today", "Yesterday", "Earlier".
- **Rows**, inside a `Card` per section, separated by `line` hairlines:
  - **Icon dot** (34 pt circle): by resource type, `bill` paid → `okSoft`/`ok` `paid`; other bill → `warnSoft`/`warn` `bill.electricity`; `notice` → `dangerSoft`/`danger` `pin`; `vault` → `surfaceSunk`/`ink2` `tab.vault`; `member` → `surfaceSunk`/`ink2` `members`; `item` completed → `accentSoft`/`accent` `check`; `item`/`list` other → `accentSoft`/`accent` `list.grocery`.
  - **Sentence:** `Text` with the actor in `font.semibold`, then `activitySentence(name, description).text`.
  - **Time:** `relativeTime(created_at, new Date())` in `muted` 12.5 on the right.
- New rows from others are wrapped in `LiveRow`.
- **Empty state:** `EmptyState icon="tab.activity"` with "No activity yet" and the existing body.

### Task 18: Cleanup and CI

**Files:**
- Delete: `mobile/src/ui/theme.ts`, `mobile/src/ui/primitives.tsx`, `mobile/src/ui/HomeSwitcher.tsx` (if fully replaced by `HomeSwitcherSheet`)
- Modify: `.github/workflows/mobile.yml`

- [ ] **Step 1: Confirm nothing imports the old modules, then delete them**

Run: `grep -rnE "ui/(theme|primitives|HomeSwitcher)'" mobile/app mobile/src || echo none`
Expected: `none`. Then delete the files.

- [ ] **Step 2: Global design-value grep**

```bash
grep -rnE "#[0-9A-Fa-f]{6}|fontFamily|from 'react-native'.*\b(Text|Pressable|Modal)\b" mobile/app | grep -v "^\s*//" || echo clean
```

Expected: `clean`. The allowed exception is the composer `TextInput` noted in Task 14; the grep doesn't match `TextInput`.

- [ ] **Step 3: CI runs the tests.** In `mobile.yml`, add `- run: npm test -- --ci` after the typecheck step, then lint with actionlint.

- [ ] **Step 4: Gates and commit** with the message `"Remove the pre-v2 theme and primitives; run unit tests in CI"`.

### Task 19: Visual parity, motion and accessibility check (ask before starting the dev server)

**Files:** none (verification); fixes go in follow-up commits.

- [ ] **Step 1: Ask the owner,** then start the Expo dev server on 8091 with `--clear` and the production URL. Use `serve-sim` for the browser view, and `xcrun simctl io booted screenshot` for evidence.
- [ ] **Step 2: Compare screens with the canvas.** With a throwaway account, capture every screen and sheet:
  - sign in and sign up
  - onboarding
  - Lists, list detail with open and done items, edit sheet
  - Bills with due and paid bills, plus the add, pay, more and next-cycle sheets
  - Vault with secret masked and revealed, plus the QR sheet
  - Activity
  - Home with whiteboard, invite and members
  - the home switcher

  Compare each side by side with its canvas artboard. Each deviation is either fixed or given a ledgered ruling.
- [ ] **Step 3: Motion.** Exercise each signature moment and confirm its timing against the prototypes. With the keyboard up in the add-bill sheet, confirm the focused field stays visible and drag-to-dismiss still works (Review Focus 2).
- [ ] **Step 4: Reduce Motion.** Turn it on in the simulator under Settings → Accessibility → Motion. Check that every moment degrades to a fade and the confetti doesn't render.
- [ ] **Step 5: Accessibility.** Turn on VoiceOver in Settings → Accessibility. Every `IconButton` announces its label, and tabs announce "tab, selected". Check the largest standard Dynamic Type size: primary buttons don't clip.

### Task 20: Smoke, PR, review, merge (ask the owner before merging)

- [ ] **Step 1: Smoke test.** Run 2a's seven checks against production, plus pay-on-behalf, Undo payment, and sign out. Smoke B makes live changes via `curl` so the live highlight shows and the owner's own changes don't flash (Review Focus 3). Delete the smoke accounts and homes afterwards (homes first).
- [ ] **Step 2: PR.** Push `feat/v2-design` and open a PR. Watch the `mobile` CI check, which now includes unit tests.
- [ ] **Step 3: Review.** Run the whole-branch review with a fresh reviewer on the most capable model, then do the fix pass per executing-plans.
- [ ] **Step 4: Merge.** Ask the owner, then merge. Then update `CLAUDE.md`: add a "Design system" section covering `@/ui` only, tokens, motion rules and Reduce Motion, the `npm test` command, and the `--clear` note for `EXPO_PUBLIC_*`. Commit the docs to `main`.
