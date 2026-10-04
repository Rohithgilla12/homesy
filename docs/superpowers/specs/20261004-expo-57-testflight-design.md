# Expo SDK 57 upgrade and internal TestFlight — design

- **Date:** 2026-10-04
- **Status:** Draft, awaiting review
- **Sub-project:** 2a of the iOS beta (2a foundation → 2b v2 design system → 2c beta readiness and external TestFlight)

This repository is public. Nothing in this document or the files it introduces may contain Apple credentials, certificates, provisioning profiles, API keys or personal device identifiers.

## Context

Homesy's mobile app is on Expo SDK 52 (React Native 0.76, React 18, expo-router 4). Since 28 April 2026, App Store Connect only accepts builds made with Xcode 26 or later against the iOS 26 SDK ([Apple](https://developer.apple.com/news/upcoming-requirements/)). Expo states that SDK 53 and below may or may not build with Xcode 26 depending on their libraries, and recommends upgrading to at least SDK 54 ([Expo](https://expo.dev/blog/app-store-connect-minimum-sdk-26)). The latest stable SDK is 57 (React Native 0.86, React 19.2), released 2026-06-30 with no breaking changes over SDK 56 ([changelog](https://expo.dev/changelog/sdk-57)). SDK 56 has a Hermes v1 memory regression with Reanimated and worklets that is fixed in `expo@57.0.9`; 2b will add Reanimated, so 2a targets 57 rather than stopping at 56.

The backend is live at `https://homesy-api.gilla.fun` (sub-project 1).

## Goals

- The app runs on Expo SDK 57 with every dependency at Expo's pinned versions, and `expo-doctor` reports no issues.
- Every PR touching `mobile/` is checked automatically: typecheck, doctor, and full iOS and web JS bundles.
- An EAS project exists with `development` and `production` build profiles; production builds point at `https://homesy-api.gilla.fun`.
- One production build, built by EAS with Xcode 26 and the iOS 26 SDK, is installed from internal TestFlight on the owner's iPhone and passes the smoke checklist against production.

## Non-goals

- The v2 design system, Reanimated, new fonts or icons (2b).
- Account deletion, privacy and support pages, the final icon and splash, a reviewer demo account, EAS Update, and external TestFlight (2c).
- Android builds or the Play Store.
- Fixing the known UI bugs (input styling, duplicated Activity names, tab contrast); 2b rebuilds those components.
- SDK 58, which is still in beta.

## Constraints

- **No native directories are committed.** The app uses Continuous Native Generation: `ios/` and `android/` are generated at build time.
- **The owner's Mac has Xcode 27.0.** SDK 57 is validated against Xcode 26.x, so 2a avoids local native builds; native builds run on EAS with its Xcode 26 image.
- **Apple authentication is interactive.** The owner runs the first `eas build` and each `eas submit` in this session with Apple ID and 2FA. EAS stores the distribution certificate and provisioning profile server-side.
- **The owner must be asked before any dev server starts** (Expo Go smoke test); use a non-default port in case one is already running.
- **The minimum iOS version becomes 16.4** (SDK 56 and later).

## Part 1: SDK upgrade

All work happens on branch `feat/expo-57`, one commit per step.

### Step 0: preparation

- **AsyncStorage:** downgrade `@react-native-async-storage/async-storage` from `^3.1.1` to the version Expo pins (2.2.0 from SDK 54; installed via `npx expo install`). v3 has a different, scoped-instance API and is outside every SDK's pin; the TanStack AsyncStorage persister expects the 2.x interface.
- **React Navigation imports:** confirm nothing in `mobile/app` or `mobile/src` imports `@react-navigation/*` directly. Expected: none, which makes the SDK 56 codemod a no-op.

### Steps 53, 54, 55, 56, 57

Each step runs `npx expo install expo@^<N>.0.0 --fix`, then the standard checks (below), then commits. Step-specific work:

| SDK | React Native / React | Step-specific work |
|---|---|---|
| 53 | 0.79 / 19.0 | React 19. Metro enforces `package.json` `exports`; fix any resolution failures the export check reveals. |
| 54 | 0.81 / 19.1 | No React Native `SafeAreaView` is used, so nothing to replace. Remove any stale `overrides` or `resolutions`. |
| 55 | 0.83 / 19.2 | Legacy architecture removed: delete `newArchEnabled` from `app.json`. Xcode 26 required (EAS only). |
| 56 | 0.85 / 19.2 | Run `npx expo-codemod sdk-56-expo-router-react-navigation-replace app src` (expected no changes). Check for the renamed router types (`Router` → `ImperativeRouter`, `Route` → `RoutePath`). Minimum iOS 16.4. |
| 57 | 0.86 / 19.2 | Upgrade only. |

### Standard checks (every step, no dev server)

Run from `mobile/`:

1. `npx expo-doctor@latest`: no failed checks.
2. `npm run typecheck` (`tsc --noEmit`): no errors.
3. `npx expo export --platform ios --output-dir <scratch>`: a full production JS bundle builds, which proves every import resolves under the new Metro rules.
4. `npx expo export --platform web --output-dir <scratch>`: the web bundle builds too. The web app is sub-project 3; this keeps it from rotting meanwhile.

If a step fails, it is fixed in that step's commit before moving on.

### Mobile CI

Add `.github/workflows/mobile.yml`. It runs on pushes to `main` and PRs that touch `mobile/**` or the workflow, plus `workflow_dispatch`, on `ubuntu-latest` with Node 22:

- `npm ci`
- `npx expo-doctor@latest`
- `npm run typecheck`
- `npx expo export --platform ios`
- `npx expo export --platform web`

Concurrency: one run per ref, cancelling superseded PR runs.

### Smoke test (once, at SDK 57)

On the iOS 26.5 simulator via Expo Go, started through the Expo CLI (the App Store Expo Go for SDK 57 is still awaiting Apple's approval). Run it against the production API (`EXPO_PUBLIC_API_URL=https://homesy-api.gilla.fun`) with a throwaway account, which is deleted from the production database afterwards. Checklist:

1. Sign up, sign out, sign in.
2. Create a home; a second throwaway account joins it with the invite code (via `curl`).
3. Add list items with quantity and note; tick one off; clear completed.
4. **Live update:** the second account adds an item via `curl`, and it appears on the simulator without a manual refresh. This is the check most likely to break, because the SSE client depends on `XMLHttpRequest` `readyState` 3 and React Native refactored XHR events between 0.76 and 0.86.
5. Vault: add a secret Wi-Fi entry, reveal it, open the Wi-Fi QR sheet (the QR code renders).
6. Bills: add a bill with an ISO due date, mark it paid choosing the other member, undo.
7. Switch homes; sign out.

Afterwards, delete the two throwaway accounts and their homes from production. Delete homes first, because `homes.created_by` does not cascade.

## Part 2: EAS and internal TestFlight

### EAS project

`eas init`, logged in as `gilladude`, writes `extra.eas.projectId` and `owner` into `app.json`. Neither is secret.

### `mobile/eas.json`

```json
{
  "cli": { "version": ">= 18.0.0", "appVersionSource": "remote" },
  "build": {
    "development": {
      "distribution": "internal",
      "ios": { "simulator": true },
      "env": { "EXPO_PUBLIC_API_URL": "http://localhost:8080" }
    },
    "production": {
      "autoIncrement": true,
      "env": { "EXPO_PUBLIC_API_URL": "https://homesy-api.gilla.fun" }
    }
  },
  "submit": { "production": {} }
}
```

- **No `preview` profile.** Ad-hoc device builds need registered device UDIDs; TestFlight covers that need.
- **Build image:** EAS's default image for SDK 57 (Xcode 26.x). It is not pinned in 2a; if EAS moves the default to Xcode 27 before SDK 57 supports it, pin `ios.image` then.
- **Build numbers:** `appVersionSource: "remote"` with `autoIncrement` lets EAS own `buildNumber`. The user-facing `version` stays `0.1.0` in `app.json`.

### `mobile/app.json` changes

- `ios.config.usesNonExemptEncryption: false`. The app only uses standard HTTPS, so this sets `ITSAppUsesNonExemptEncryption` and skips the per-upload export-compliance question.
- `icon: "./assets/icon.png"`, a placeholder 1024 × 1024 PNG with no transparency: the v2 house mark in white on door-blue `#2747C9`. The final icon comes in 2c.
- An `expo-splash-screen` plugin entry: background `#F6F5F1` with the same mark, `imageWidth` 120.
- The source SVG for the mark is committed beside the PNG (`assets/icon.svg`), so the PNG can be regenerated.

### Owner's interactive steps

Run with `!` in the Claude Code session:

1. `! cd mobile && eas build -p ios --profile production`. The owner signs in with Apple ID and 2FA. EAS creates and stores the distribution certificate and provisioning profile, and registers the bundle ID `app.homesy.mobile`. The build runs on EAS.
2. `! cd mobile && eas submit -p ios --latest`. If no App Store Connect record exists, EAS creates one named **Homesy**. If the name is taken, use **Homesy: Shared Home**; the name can change later, the bundle ID cannot. EAS uploads the build.

### Internal TestFlight

In App Store Connect → TestFlight, create an internal group containing the owner and add the build. Internal testing needs no Beta App Review. After Apple finishes processing (typically 5–30 minutes), the owner installs it from the TestFlight app and runs the smoke checklist on the device against production. The live-update check runs again on real hardware.

## Verification

- **Each SDK step:** doctor, typecheck, and iOS and web exports pass, recorded in the commit.
- **CI:** the `mobile` workflow passes on the 2a PR.
- **Simulator:** all seven smoke checks pass at SDK 57.
- **Upload:** EAS reports that the build used an Xcode 26.x image, and App Store Connect accepts it without an SDK-version rejection. Any privacy-manifest warning email from Apple is recorded for 2c.
- **Device:** the TestFlight build installs on the owner's iPhone and passes the smoke checklist, live updates included.

## Risks

| Risk | Mitigation |
|---|---|
| SSE live updates break under React Native 0.86's reworked XHR events | Smoke step 4 on the simulator and on the device. If broken, switch the client to `fetch` with a streaming body reader (`globalThis.fetch` is `expo/fetch` from SDK 56). |
| A library misbehaves under React 19 or the stricter Metro `exports` (TanStack persister, `react-native-qrcode-svg`, zustand) | The export check per step catches resolution failures; the smoke test catches runtime ones. |
| "Homesy" is taken on the App Store | Use "Homesy: Shared Home". |
| EAS moves its default image to Xcode 27 before SDK 57 supports it | Pin `ios.image` to an Xcode 26 image in `eas.json`. |
| Safe-area 5.x and screens 4.26 shift layouts under the header or tab bar | Visual check during the smoke test; 2b replaces these layouts anyway. |
