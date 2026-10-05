# v2 design system and motion — design

- **Date:** 2026-10-05
- **Status:** Draft, awaiting review
- **Sub-project:** 2b of the iOS beta (2a foundation ✓ → **2b v2 design system** → 2c beta readiness and external TestFlight)
- **Visual source of truth:** the design canvas https://claude.ai/artifact/KzbxigJR6WLhRXyz1LNFiZ. The "Refresh — v2" page holds the system board and screens; the "Motion" page holds the interactive motion prototypes.

## Context

The app is on Expo SDK 57 (React Native 0.86, React 19.2, expo-router 57) and its look is ad hoc: emoji icons, a cream and terracotta palette, the system font, and a set of known UI bugs. The owner chose the "v2 Door-blue" direction and a set of signature motion moments, prototyped on the canvas and approved. Implementation approach: hand-built tokens and primitives (A), plus one custom `Sheet` primitive (1).

## Goals

- One design system in `mobile/src/ui/` (tokens, primitives, icons, motion). No screen uses raw hex colours, font names, or `react-native` `Text`, `Pressable` or `Modal` directly.
- Every screen and sheet matches its v2 canvas artboard, or the v2 system where no artboard exists.
- The signature motion moments behave as prototyped, run on the UI thread, and degrade to fades under Reduce Motion.
- The known UI bugs are fixed (list below).
- The app's first automated tests cover the new pure logic, and CI runs them.

## Non-goals

- Dark mode. Tokens are light-only; `userInterfaceStyle` becomes `light`. Lamplight can become a second theme later.
- Backend or API changes.
- Native form-sheet routing (option 2), shared-element card-to-detail transitions, the invite-code flip.
- Android visual polish beyond "not broken". iOS is the beta target.
- Account deletion, privacy page, final icon and splash, EAS Update (2c).

## Design tokens: `src/ui/tokens.ts`

Replaces `src/ui/theme.ts`, which is deleted once nothing imports it.

| Group | Values |
|---|---|
| `color` | `bg #F6F5F1`, `surface #FFFFFF`, `surfaceSunk #F0EEE8`, `ink #15171C`, `ink2 #3B3F47`, `muted #5F646E`, `line #E6E3DC`, `accent #2747C9`, `accentSoft #E9EDFB`, `accentInk #1F3AA8`, `scrim rgba(21,23,28,0.4)` |
| `status` | `warn #A14B07` / `warnSoft #FDF1DC` / `warnInk #7A3A06`; `ok #157F3C` / `okSoft #E3F6E9` / `okInk #11652F`; `danger #B42318` / `dangerSoft #FDE7E5` / `dangerInk #7E1910` |
| `category` | `{ bg, fg }` per list kind (grocery, laundry, todo, custom), bill category (electricity, internet, water, gas, maintenance, maid, other) and vault category (utilities, contacts, access, documents, other). Every `fg` on its `bg` is at least 4.5:1. Values are taken from the canvas screens. |
| `font` | `display` = `BricolageGrotesque_700Bold`; `ui` = `Geist_400Regular` / `Geist_500Medium` / `Geist_600SemiBold`; `mono` = `GeistMono_500Medium` |
| `type` | `display 32/38`, `title 20/26`, `headline 17/22 600`, `body 15/22 400`, `label 13/18 500`, `caption 12/16 500` (uppercase, letter-spacing 0.48), `mono 15/22`. Numeric text uses `fontVariant: ['tabular-nums']`. |
| `space` | `space(n) = n * 4` |
| `radius` | `sm 8`, `md 12`, `lg 16`, `xl 24`, `full 999` |
| `motion` | `press { scale: 0.97, duration: 160, easing: bezier(0.23,1,0.32,1) }`; `sheetIn { 320ms, bezier(0.32,0.72,0,1) }`; `sheetOut { 200ms, same }`; `fade { 180ms }`; `spring { damping: 14, stiffness: 220 }` (bounce ≈ 0.25) |

Old `space()` calls were 8-based and are converted by value (`space(2)` → `space(4)`), never reinterpreted.

## Fonts

- Packages: `@expo-google-fonts/bricolage-grotesque` (0.4.x), `@expo-google-fonts/geist` (0.4.x), `@expo-google-fonts/geist-mono` (0.4.x), `expo-font ~57.0.4`. All are SIL Open Font License.
- The root layout calls `useFonts` for the five faces, keeps the splash screen visible (`SplashScreen.preventAutoHideAsync`) until fonts resolve, then hides it.
- If loading fails, the app logs the error, hides the splash, and renders with system fonts. The `Text` primitive falls back when a face is missing.

## Primitives: `src/ui/`

One primitive per file. Screens import only from `@/ui`.

| Primitive | Contract |
|---|---|
| `Text` | `variant`: `display \| title \| headline \| body \| label \| caption \| mono`; `tone`: `ink \| ink2 \| muted \| accent \| accentInk \| warn \| ok \| danger \| onAccent`. Other `TextProps` pass through, except `style` is limited to layout (margins, alignment, `flex`). |
| `Pressable` | Wraps RN `Pressable` with a Reanimated scale to `motion.press` while pressed, a minimum 44 × 44 hit area (`hitSlop` when smaller), and `accessibilityRole` defaulting to `button`. Reduce Motion: no scale. |
| `Button` | `variant`: `primary \| secondary \| ghost \| danger`; `size`: `md \| sm`; `icon?`; `loading?` (spinner replaces the label, width preserved); `fullWidth?`. |
| `IconButton` | `icon`, a required `label` (becomes `accessibilityLabel`), `variant`: `plain \| outlined \| filled`, 40 pt. |
| `Input` | `label` (visible), `error?`, `hint?`, plus `TextInputProps`. The base look cannot be replaced; `containerStyle` accepts layout only. Focus: accent border plus a 3 pt `accentSoft` halo. `variant="code"` renders mono, centred, tracked, uppercase, for invite codes. |
| `DateField` | `label`, `value: string \| null` (`YYYY-MM-DD`), `onChange`. Opens `@react-native-community/datetimepicker` in compact iOS mode and emits ISO dates. |
| `Card` | Surface, hairline border, `radius.lg`, 1 pt shadow; `onPress?` makes it a `Pressable`. |
| `Pill` | `tone`: `accent \| neutral \| warn \| ok \| danger`; `icon?`. |
| `Chip` | `selected`, `onPress`, `icon?`; selection haptic. |
| `Sheet` | Described below. |
| `Screen` | `scroll?`, `refreshing?` / `onRefresh?` (the roof refresh control), and safe-area edges handled centrally. Background `color.bg`, 16 pt gutter. |
| `AppHeader` | Home-switcher pill (home emoji in a soft tile, name, chevron; opens the switcher sheet) and an initials avatar. Used as the `Tabs` `header`. |
| `TabBar` | Custom `Tabs` `tabBar`: Lucide icons, a soft `accentSoft` pill behind the active icon, labels Lists / Bills / Vault / Activity / Home, `muted` inactive and `accentInk` active, bottom safe-area padding. No transition between tabs. |
| `Icon` | `name` from a typed map (below) and `size`/`color`. The only place `lucide-react-native` is imported. Stroke width 1.75. |
| `Avatar` | Initials in a tinted circle; tint derived deterministically from the user id. |
| `EmptyState` | Icon tile, title, body, optional action. |

### Sheet

- Implementation: transparent RN `Modal`. The backdrop (`color.scrim`) fades in over `motion.fade`. On iOS an `expo-blur` `BlurView` (intensity 20) sits under the scrim. The panel translates from 100% to 0 with `motion.sheetIn` and closes with `motion.sheetOut`.
- Dismiss: drag down via `react-native-gesture-handler` (dismiss when translation > 30% of the panel height or velocity > 0.11 pt/ms; rubber-band resistance when dragging up past the top), backdrop tap, or `onRequestClose`.
- Layout: `radius.xl` top corners, a grab handle, an optional `title`, content, and bottom padding of the safe-area inset plus 16. `KeyboardAvoidingView` (`behavior="padding"`) keeps inputs visible.
- Content children fade and rise 8 pt in 40 ms steps on open (first five children only).
- Reduce Motion: backdrop and panel fade only, no blur animation, no stagger.

## Icons

`src/ui/Icon.tsx` maps semantic names to Lucide components:

| Group | Mapping |
|---|---|
| Tabs | lists `ListChecks`, bills `Zap`, vault `Lock`, activity `Clock`, home `House` |
| List kinds | grocery `ShoppingCart`, laundry `Shirt`, todo `SquareCheck`, custom `StickyNote` |
| Bill categories | electricity `Zap`, internet `Globe`, water `Droplet`, gas `Flame`, maintenance `Building2`, maid `Sparkles`, other `Package` |
| Vault categories | utilities `Receipt`, contacts `Phone`, access `KeyRound`, documents `FileText`, other `Folder`; Wi-Fi entries `Wifi` |
| Actions | add `Plus`, edit `Pencil`, copy `Copy`, copied `Check`, delete `Trash2`, reveal `Eye`, hide `EyeOff`, qr `QrCode`, share `Share`, paid `ShieldCheck`, due `Clock`, pin `Pin`, undo `Undo2`, nextCycle `RefreshCw`, more `Ellipsis`, chevronDown `ChevronDown`, chevronRight `ChevronRight`, back `ChevronLeft`, close `X`, members `Users`, note `StickyNote`, signOut `LogOut` |

Home emoji stay: they are user data, not interface icons.

## Motion

All motion uses Reanimated (UI thread) and animates only transform, opacity and blur. Every moment checks `useReducedMotion()`. Haptics use `expo-haptics ~57.0.3`.

| Moment | Behaviour | Spec | Haptic |
|---|---|---|---|
| Press | Every `Pressable` | scale 0.97, 160 ms ease-out, spring back | — |
| Tick off item | The circle fills with a spring pop (0.78 → 1), the check stroke draws (`strokeDashoffset` 1 → 0, 180 ms, 60 ms delay), the strike sweeps (160 ms, 120 ms delay), and after 340 ms the row moves to Done via a Reanimated layout transition (`LinearTransition`, 220 ms drawer curve) | Total under 600 ms | `impactAsync(Light)` on tick |
| Swipe item | Right reveals complete (accent), left reveals delete (danger). Commits past 35% width or velocity > 0.11 pt/ms; resistance past the ends | Gesture-handler `Swipeable` equivalent built on `Gesture.Pan` | `selectionAsync` when the threshold is crossed |
| Mark as paid | The action area cross-fades to the stamp: the shield scales in from 0.4 at −14° on the spring, one ring pulse (0.7 → 1.9, opacity 0.7 → 0, 650 ms), the text rises (260 ms, 160 ms delay). The banner total counts to the new value (600 ms ease-out cubic; undo 400 ms) | — | `notificationAsync(Success)` |
| Live update | Rows that arrive via SSE and were not created by the current user enter with opacity 0 → 1 and translateY 6 → 0 (220 ms), then an `accentSoft` background fades to transparent over 1.5 s. An `Avatar` chip shows the actor's initials | — | — |
| Reveal secret | Mask and value cross-fade with blur 8 → 0 (200 ms). Auto re-mask after 30 s with a draining timer bar | — | `selectionAsync` |
| Pull to refresh | A custom refresh indicator draws the house mark from pull progress (roof 0–45%, walls 30–75%, door 65–95%). It arms at 70% and breathes (scale 1 ↔ 1.08, 900 ms) while refreshing | — | `impactAsync(Light)` when armed |
| First home / member joined | 24 brand-colour particles burst from the home icon (950 ms) and the badge pops on the spring. Fires once when the user creates their first home, and on `member_joined` events for homes they own | Hand-built with Reanimated; no confetti library | `notificationAsync(Success)` |
| Cold start | After fonts load, an overlay draws the roof (400 ms) and fades into the app (200 ms). Cold start only; total ≤ 600 ms | — | — |
| Sheets | As in the Sheet section | — | — |

**Never animated:** tab switches, scrolling, typing, keyboard-triggered actions.

## Screens

Each screen is rebuilt on the primitives. Behaviour, data flow, query keys and API calls are unchanged unless listed.

| Screen | Changes |
|---|---|
| Root `_layout.tsx` | Font loading and splash hold, cold-start overlay, root loading state on `color.bg`, `GestureHandlerRootView` at the root |
| `(auth)/login`, `(auth)/signup` | v2 layout with labelled inputs and `src/lib/errors.ts` messages |
| Onboarding (`(app)/(tabs)/home.tsx` with no homes) | v2 create and join cards; `Input variant="code"`; first-home celebration |
| `(app)/(tabs)/_layout.tsx` | `AppHeader` and `TabBar` |
| Lists (`index.tsx`) | Card rows with category tiles, open-count `Pill` ("All done" when 0), chevron, roof refresh, `EmptyState`; new-list `Sheet` with type `Chip`s |
| List detail (`lists/[id].tsx`) | Composer card (input, add `IconButton`, "+ Quantity" / "+ Note" chips that reveal fields), open and Done sections, tick motion, swipe actions, live-update highlight, "Clear done (n)" header action, edit-item `Sheet` |
| Bills (`bills.tsx`) | Summary banner with animated total (warn when anything is due, ok when everything is paid), filter `Chip`s with counts, bill cards (tile, title, category · period, amount, relative due `Pill`, consumer-ID row with copy, notes), paid stamp, a "More" `Sheet` (start next cycle, undo payment, delete); add-bill `Sheet` with category `Chip`s and `DateField`; pay `Sheet` with payer chips; next-cycle `Sheet` |
| Vault (`vault.tsx`) | Filter `Chip`s, "Pinned" section, entry rows (tile, label, Hidden `Pill`, masked value with blur reveal, Wi-Fi QR and copy actions), add and edit `Sheet`s, Wi-Fi QR `Sheet` |
| Activity (`activity.tsx`) | Sections Today / Yesterday / Earlier; rows with typed icon dots; sentence = actor name once plus the description with a leading duplicate name stripped; relative time on the right; "Live" `Pill` |
| Home (`home.tsx` with homes) | Whiteboard card (urgent notes in danger tone with an "Urgent" `Pill`), post-note `Sheet`, invite card (mono code, copy and share), members with `Avatar` and role `Pill`s, account section, "Leave home" `Button variant="danger"` |
| Home switcher (`HomeSwitcher.tsx`) | Becomes a `Sheet`: home rows with a selected check, create and join flows inside the same sheet |

`app.json`: `userInterfaceStyle` becomes `light`.

## Bug fixes included

1. `Input` style override that stripped the base look from six inputs.
2. Activity showing the actor's name twice.
3. Inactive tab labels at 3.2:1 contrast, and "Bills & Utili…" truncation.
4. Emoji tab icons ignoring the tint.
5. Sheets without bottom safe-area padding.
6. Raw "unauthorized" and other server strings shown to users.
7. Bare-looking invite-code inputs.
8. Free-text bill due dates (replaced by `DateField`).
9. White flash during the root loading state.

## Pure logic: `src/lib/` (unit-tested)

| Module | Function | Behaviour |
|---|---|---|
| `format.ts` | `formatRupees(cents: number \| null): string` | `null` → `"—"`; en-IN grouping, at most 2 decimals, no trailing `.00` |
| `format.ts` | `relativeDue(due: string \| null, today: Date): { label: string; tone: 'warn' \| 'danger' \| 'neutral' } \| null` | `null` → `null`; due in the future: "Due 15 Oct · in 12 days" (warn), "Due tomorrow", "Due today" (warn); past: "Overdue by 3 days" (danger) |
| `format.ts` | `relativeTime(iso: string, now: Date): string` | "Just now", "12m", "3h", "Yesterday", "3 Oct" |
| `activity.ts` | `activitySentence(actorName: string, description: string): { actor: string; text: string }` | Strips a leading `actorName` (case-sensitive, followed by a space) from `description` |
| `activity.ts` | `groupByDay<T extends { created_at: string }>(rows: T[], now: Date): { title: 'Today' \| 'Yesterday' \| 'Earlier'; rows: T[] }[]` | Local-time day boundaries; omits empty groups; keeps input order |
| `errors.ts` | `friendlyError(err: unknown, context: 'signin' \| 'signup' \| 'generic'): string` | `ApiError` 401 in signin → "Wrong email or password"; 409 in signup → "An account with this email already exists"; network `TypeError` → "Can't reach Homesy. Check your connection."; 5xx → "Something went wrong on our side. Try again."; otherwise the server's message, or "Something went wrong." |
| `color.ts` | `avatarTint(userId: string): { bg: string; fg: string }` | Deterministic pick from 6 tint pairs, all at least 4.5:1 |

Tests: `jest-expo ~57.0.5` preset; `npm test` runs `jest`. CI's `mobile.yml` gains `npm test` after the typecheck.

## Dependencies added

All are installed with `expo install`, so versions follow SDK 57's pins.

- `expo-font ~57.0.4`, `@expo-google-fonts/bricolage-grotesque`, `@expo-google-fonts/geist`, `@expo-google-fonts/geist-mono`
- `lucide-react-native` (1.x; requires `react-native-svg`, already installed)
- `expo-haptics ~57.0.3`, `expo-blur ~57.0.3`, `@react-native-community/datetimepicker 9.1.0`
- `react-native-gesture-handler ~2.32.0` (already present transitively; becomes a direct dependency)
- Dev: `jest-expo ~57.0.5`, `jest`, `@types/jest`

## Verification

1. **Unit tests:** every `src/lib/` function, test-first, including edge cases (null amounts, overdue dates, day boundaries at local midnight, names that only partially match, unknown errors).
2. **CI gates:** `npm test`, `expo-doctor`, typecheck, and iOS and web exports.
3. **Visual parity:** on the iOS 26.5 simulator via Expo Go, a screenshot of every screen and sheet, compared side by side with its canvas artboard. Deviations are fixed or ruled.
4. **Motion:** each signature moment checked on the simulator against its prototype's timing; with Reduce Motion enabled (simulator Settings → Accessibility → Motion → Reduce Motion), each degrades to fades.
5. **Accessibility:** every `IconButton` has a label; tab labels and muted text measure at least 4.5:1; Dynamic Type at the largest standard size does not clip primary actions.
6. **Smoke checklist** (the 2a seven checks) against production with throwaway accounts, plus pay-on-behalf, Undo payment and sign-out, which were not exercised in 2a. Production smoke data is deleted afterwards.

## Risks

| Risk | Mitigation |
|---|---|
| `expo-blur` or the custom `Sheet` misbehaves with the keyboard on iOS 26 | `Sheet` keeps `KeyboardAvoidingView`; blur can be switched off per sheet; Expo Go testing covers it |
| Reanimated layout transitions stutter in long lists | Lists are small (tens of items); fall back to opacity-only enter and exit if profiling shows dropped frames |
| Font loading delays first paint | Splash is held only until `useFonts` resolves (local assets); failure falls back to system fonts |
| `lucide-react-native` adds bundle size | Named imports only through `Icon.tsx`; tree-shaken by Metro |
| The scope is every screen at once | The plan orders work as foundations (tokens, primitives, motion) before screens, one screen per task, each verified visually before the next |
