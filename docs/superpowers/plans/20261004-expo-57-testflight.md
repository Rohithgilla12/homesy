# Expo SDK 57 Upgrade and Internal TestFlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the mobile app from Expo SDK 52 to SDK 57 with automated checks at every step, add mobile CI and EAS build profiles, and get one production build onto the owner's iPhone through internal TestFlight.

**Architecture:** Upgrade one SDK at a time with `expo install --fix`. Each step is gated by `expo-doctor`, `tsc`, and full iOS and web JS exports, none of which need a dev server, and each step is its own commit. A GitHub Actions job repeats those gates on every PR that touches `mobile/`. EAS builds in the cloud on its Xcode 26 image. The owner runs the Apple-authenticated commands (`eas build`, `eas submit`) interactively. One manual smoke checklist runs on the simulator and again on the device.

**Tech Stack:** Expo SDK 52→57, React Native 0.76→0.86, React 18→19.2, expo-router 4→57, EAS CLI 18.12, GitHub Actions, rsvg-convert, ImageMagick.

**Spec:** `docs/superpowers/specs/20261004-expo-57-testflight-design.md`

## Global Constraints

- **Public repo.** Never commit Apple credentials, certificates, profiles, `.p8` keys, device UDIDs or `.env` files. Run `gitleaks protect --staged --no-banner` before every commit and expect `no leaks found`.
- **Do not start a dev server without asking the owner.** Use port `8091` when one is approved, because the owner may already run one on the default port.
- **The final version is Expo SDK 57.** Every Expo-managed dependency goes to the version `expo install --fix` selects. No manual version pins except to fix a failure, and each such pin gets a ruling.
- **Run the Expo CLI as `./node_modules/.bin/expo`** from `mobile/`. In this environment a shell hook rewrites `npx expo …` to `npm run expo`, which fails with "Missing script: expo". Run `expo-doctor` as `rtk proxy npx --yes expo-doctor@latest`.
- **Scratch output** (exports, logs) goes in `SCRATCH=/private/tmp/claude-501/-Users-rohithgilla-github-com-Rohithgilla12-homesy/cb43e44d-f534-4823-a659-db8074dc322b/scratchpad/expo57`, created at the start (`mkdir -p "$SCRATCH"`), never in the repo. Add `dist/` to `mobile/.gitignore` for CI exports.
- **Keep the EAS project link the owner created:** `extra.eas.projectId` `25bd70bf-aa77-46f6-acca-530f8c2b69ac`, `owner` `gilladude`, and `ios.infoPlist.ITSAppUsesNonExemptEncryption: false`. That last key replaces the spec's `ios.config.usesNonExemptEncryption`; both set the same Info.plist key.
- **No native directories in git.** `ios/` and `android/` stay generated (CNG). If any appear locally, do not commit them.
- **No new comment banners.** Match the surrounding comment density.
- **Minimum iOS is 16.4** from SDK 56 onwards. No deployment-target override.
- **Ask the owner before:** starting a dev server, merging to `main`, and any App Store Connect or EAS action that changes their Apple account.

## Review Focus

1. **Live updates after the React Native upgrade.** The SSE client reads `xhr.responseText` at `readyState` 3, and React Native 0.79 to 0.86 refactored XHR events. A member's change must still appear without a refresh. Pinned by smoke check 4, on the simulator (Task 9) and on the device (Task 12), with a documented fallback.
2. **The persisted query cache across the AsyncStorage version change.** Moving from v3 to Expo's pinned 2.x must not crash on startup with a cache written by v3. A fresh TestFlight install has no old cache, but the Expo Go simulator might. Pinned by smoke check 1 after a relaunch (Task 9).
3. **Typecheck in CI without generated files.** `expo-env.d.ts` and `.expo/types` are gitignored and generated, so a clean checkout must still typecheck. Pinned by running the CI command sequence in a fresh clone (Task 8).
4. **Release builds point at production.** A build with no `EXPO_PUBLIC_API_URL` falls back to `localhost:8080` and silently fails on a phone. Pinned by checking the inlined URL in the production export (Task 10) and by the device sign-in (Task 12).
5. **The App Store name is taken.** EAS creates the App Store Connect record during submit. Pinned by the fallback name in Task 11.

---

### Task 1: Branch, record the EAS link, and take a baseline

**Files:**
- Modify: `mobile/app.json` (already modified by the owner's `eas init`; commit as-is)
- Modify: `mobile/eas.json` (already added by `eas build:configure`; it is replaced in Task 10, committed here as-is for history)
- Modify: `mobile/.gitignore` (add `dist/`)

**Interfaces:**
- Consumes: nothing
- Produces: branch `feat/expo-57`, plus baseline check results at SDK 52 recorded in the ledger

- [ ] **Step 1: Create the branch carrying the uncommitted EAS changes**

```bash
cd /Users/rohithgilla/github.com/Rohithgilla12/homesy
git switch -c feat/expo-57
printf 'dist/\n' >> mobile/.gitignore
git add mobile/app.json mobile/eas.json mobile/.gitignore
gitleaks protect --staged --no-banner
git commit -m "Link the EAS project (gilladude) and ignore export output"
```

Expected: a commit containing `projectId`, `owner`, `ITSAppUsesNonExemptEncryption`, the template `eas.json`, and the ignore entry.

- [ ] **Step 2: Confirm nothing imports React Navigation directly**

Run: `grep -rn "@react-navigation/" mobile/app mobile/src || echo "none"`
Expected: `none`. This makes the SDK 56 codemod in Task 5 a no-op.

- [ ] **Step 3: Baseline checks at SDK 52**

From `mobile/`:

```bash
rtk proxy npx --yes expo-doctor@latest > $SCRATCH/doctor-52.txt 2>&1; tail -15 $SCRATCH/doctor-52.txt
./node_modules/.bin/tsc --noEmit && echo "TYPECHECK OK"
./node_modules/.bin/expo export --platform ios --output-dir $SCRATCH/export-52-ios > $SCRATCH/export-52-ios.log 2>&1; echo "ios export exit=$?"
./node_modules/.bin/expo export --platform web --output-dir $SCRATCH/export-52-web > $SCRATCH/export-52-web.log 2>&1; echo "web export exit=$?"
```

Expected:
- doctor flags at least `@react-native-async-storage/async-storage` as outside SDK 52's pin
- `TYPECHECK OK`
- both exports `exit=0`

Record each result in the ledger as the baseline. A web export failure at baseline is not fixed here. Record it, and the step where it first passes becomes the evidence that fixed it.

---

### Tasks 2–6: One SDK step each (53, 54, 55, 56, 57)

These five tasks share the same skeleton. Each task's own text says what differs: its `N`, its extra work, and its commit message.

**Shared step skeleton for SDK `N`** (run from `mobile/`):

- [ ] **Step A: Upgrade**

```bash
./node_modules/.bin/expo install expo@^N.0.0 > $SCRATCH/install-N.log 2>&1 || ./node_modules/.bin/expo install expo@^N.0.0 -- --legacy-peer-deps >> $SCRATCH/install-N.log 2>&1
./node_modules/.bin/expo install --fix >> $SCRATCH/install-N.log 2>&1; echo "install exit=$?"
grep -E '"(expo|react|react-native|expo-router|@react-native-async-storage/async-storage)"' package.json
```

Expected: `install exit=0`. `package.json` shows `expo ~N.x`, plus React, React Native and `expo-router` at the SDK's versions from the table below.

| N | react-native | react | expo-router |
|---|---|---|---|
| 53 | 0.79.x | 19.0.x | ~5.1 |
| 54 | 0.81.x | 19.1.x | ~6.0 |
| 55 | 0.83.x | 19.2.x | ~55.0 |
| 56 | 0.85.x | 19.2.x | ~56.x |
| 57 | 0.86.x | 19.2.x | ~57.x |

If peer-dependency resolution fails, the command retries with `--legacy-peer-deps`. Ledger a ruling whenever the retry was needed.

- [ ] **Step B: Step-specific work** (each task's own text)

- [ ] **Step C: Gates**

```bash
rtk proxy npx --yes expo-doctor@latest > $SCRATCH/doctor-N.txt 2>&1; tail -15 $SCRATCH/doctor-N.txt
./node_modules/.bin/tsc --noEmit && echo "TYPECHECK OK"
./node_modules/.bin/expo export --platform ios --output-dir $SCRATCH/export-N-ios > $SCRATCH/export-N-ios.log 2>&1; echo "ios export exit=$?"
./node_modules/.bin/expo export --platform web --output-dir $SCRATCH/export-N-web > $SCRATCH/export-N-web.log 2>&1; echo "web export exit=$?"
```

Expected:
- doctor ends with "No issues detected" (or every remaining check is explained by a ledgered ruling)
- `TYPECHECK OK`
- both exports `exit=0`

On any failure, read the log tail and fix the cause in this task. Common causes:
- Metro `exports` resolution (SDK 53): update the offending import to the package's public entry point
- React 19 type changes (`@types/react` 19): adjust the typing at the reported line
- a library's removed API: switch to its replacement per its changelog

Never silence a check to get past it.

- [ ] **Step D: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/app.json mobile/app mobile/src
gitleaks protect --staged --no-banner
git commit -m "Upgrade mobile to Expo SDK N"
```

Ledger line per task: doctor result, typecheck result, both export exits.

### Task 2: SDK 53 (React 19, Metro exports)

- [ ] Steps A–D with `N=53`.
- [ ] **Step B extras:**
  - Check that `@react-native-async-storage/async-storage` is now Expo's pinned 2.1.x. If `--fix` left it at `^3`, run `./node_modules/.bin/expo install @react-native-async-storage/async-storage`.
  - Confirm `@types/react` moved to 19 (`grep '"@types/react"' package.json`). If not, run `./node_modules/.bin/expo install @types/react -- --save-dev`.
  - Confirm `typescript` moved to `~5.8`, likewise.

### Task 3: SDK 54 (React Native 0.81)

- [ ] Steps A–D with `N=54`.
- [ ] **Step B extras:**
  - `grep -n '"overrides"\|"resolutions"' package.json || echo none`. Expected `none`; remove any that appear.
  - Confirm AsyncStorage is now 2.2.x.

### Task 4: SDK 55 (legacy architecture removed)

- [ ] Steps A–D with `N=55`.
- [ ] **Step B extras:** delete `"newArchEnabled": true` from `mobile/app.json`, then check: `grep -c newArchEnabled app.json`. Expected `0`.

### Task 5: SDK 56 (expo-router without React Navigation)

- [ ] Steps A–D with `N=56`.
- [ ] **Step B extras:**
  - Run `rtk proxy npx --yes expo-codemod sdk-56-expo-router-react-navigation-replace app src`, then `git status --short app src`. Expected: no changes. Any change is reviewed and kept only if the typecheck passes.
  - Run `grep -rnE "\b(Router|Route)\b" app src | grep -i "expo-router" || echo none`. Expected `none`, meaning no imports of the renamed router types.

### Task 6: SDK 57

- [ ] Steps A–D with `N=57`. No step-specific work.
- [ ] **Step E:** confirm the final resolved versions: `./node_modules/.bin/expo --version` and `npm ls expo react react-native expo-router --depth=0`. Expected: expo 57.0.x where x ≥ 9, which includes the Hermes and worklets fix.

---

### Task 7: Mobile CI workflow

**Files:**
- Create: `.github/workflows/mobile.yml`

**Interfaces:**
- Consumes: the SDK 57 app from Task 6
- Produces: a `mobile` check on PRs touching `mobile/**`

- [ ] **Step 1: Write the workflow**

```yaml
name: mobile

# Gates every mobile change without a simulator: dependency health, types, and full iOS + web JS bundles.

on:
  push:
    branches: [main]
    paths:
      - "mobile/**"
      - ".github/workflows/mobile.yml"
  pull_request:
    branches: [main]
    paths:
      - "mobile/**"
      - ".github/workflows/mobile.yml"
  workflow_dispatch: {}

concurrency:
  group: mobile-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

jobs:
  check:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: mobile
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: mobile/package-lock.json
      - run: npm ci
      - run: npx --yes expo-doctor@latest
      # expo-env.d.ts is generated and gitignored; recreate the one line it holds so tsc sees Expo's types.
      - run: test -f expo-env.d.ts || printf '/// <reference types="expo/types" />\n' > expo-env.d.ts
      - run: npx tsc --noEmit
      - run: npx expo export --platform ios --output-dir dist/ios
      - run: npx expo export --platform web --output-dir dist/web
```

- [ ] **Step 2: Lint**

Run: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/mobile.yml
gitleaks protect --staged --no-banner
git commit -m "Add mobile CI: doctor, typecheck, iOS and web exports"
```

### Task 8: Prove CI's sequence on a clean checkout

**Files:** none (verification only)

**Interfaces:**
- Consumes: Tasks 6–7
- Produces: evidence for Review Focus 3

- [ ] **Step 1: Run CI's exact commands in a fresh clone of the branch**

```bash
CLEAN=$SCRATCH/clean-clone && rm -rf "$CLEAN" && git clone -q --branch feat/expo-57 /Users/rohithgilla/github.com/Rohithgilla12/homesy "$CLEAN"
cd "$CLEAN/mobile" && ls expo-env.d.ts .expo 2>&1 | head -2
npm ci > $SCRATCH/clean-ci.log 2>&1 && echo "npm ci OK"
test -f expo-env.d.ts || printf '/// <reference types="expo/types" />\n' > expo-env.d.ts
./node_modules/.bin/tsc --noEmit && echo "TYPECHECK OK"
./node_modules/.bin/expo export --platform ios --output-dir dist/ios > /dev/null 2>&1; echo "ios export exit=$?"
```

Expected:
- `ls` shows both missing, which is what CI sees
- `npm ci OK`
- `TYPECHECK OK`
- `ios export exit=0`

If the typecheck fails only because typed-route types are missing, run the export first and the typecheck second. Apply the same reordering to `mobile.yml`, ledger the ruling, and amend Task 7's commit with a new commit.

---

### Task 9: Simulator smoke test with Expo Go (ask the owner before starting the dev server)

**Files:** none

**Interfaces:**
- Consumes: the SDK 57 app; production API `https://homesy-api.gilla.fun`
- Produces: smoke checks 1–7 recorded in the ledger; throwaway accounts removed afterwards

- [ ] **Step 1: Ask the owner** for approval to start the Expo dev server on port 8091, against the production API.

- [ ] **Step 2: Start it (after approval)**

```bash
cd mobile && EXPO_PUBLIC_API_URL=https://homesy-api.gilla.fun ./node_modules/.bin/expo start --ios --port 8091
```

Run this in the background. It installs Expo Go for SDK 57 on the booted iOS 26.5 simulator and opens the app.

- [ ] **Step 3: Prepare the second client (curl)**

```bash
API=https://homesy-api.gilla.fun
B_EMAIL="smoke+b$(date +%s)@homesy.test"
B_TOKEN=$(curl -fsS -X POST $API/auth/signup -H 'content-type: application/json' -d "{\"email\":\"$B_EMAIL\",\"password\":\"smoke-test-password\",\"display_name\":\"Smoke B\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
```

- [ ] **Step 4: The owner runs checks 1–7** on the simulator. Claude performs the curl actions marked (C).
  1. Sign up as `smoke+a<ts>@homesy.test`, sign out, sign in. Force-quit Expo Go and reopen: the session and cached lists load with no crash (Review Focus 2).
  2. Create home "Smoke"; read the invite code aloud. (C) `curl -fsS -X POST $API/homes/join -H "authorization: Bearer $B_TOKEN" -H 'content-type: application/json' -d '{"code":"<CODE>"}'`
  3. In Groceries, add "Milk" with qty "2" and note "toned"; tick it; Clear done.
  4. **Live update.** With Groceries open on the simulator, (C) look up the list id via `GET /homes/<id>/lists`, then add "Eggs" through `POST /lists/<list>/items` as account B. "Eggs" appears within about 3 s without touching the screen.
  5. Vault: add "Wi-Fi password" (Access & codes, Secret on). It shows masked; tap to reveal; open the QR sheet and see the QR code render.
  6. Bills: add "Electricity", ₹1850, due date `2026-10-15`, period "October 2026". Mark it paid choosing "Smoke B"; the card shows paid by Smoke B. Undo.
  7. Create a second home, switch between the two, then sign out.

  Expected: all seven pass. Record each in the ledger as pass or fail with a note.

- [ ] **Step 5: If check 4 fails, apply the fallback.** Replace the XHR transport in `mobile/src/api/events.ts` with `fetch` plus `response.body.getReader()` and a `TextDecoder`, keeping the same parsing and reconnect logic. Repeat check 4, then commit with the message "Stream SSE with fetch on React Native 0.86". This is the only code change allowed in this task.

- [ ] **Step 6: Stop the dev server and clean up production**

```bash
ssh "$HOMESY_SSH" "docker exec homesy-postgres psql -U homesy -d homesy -c \"delete from homes where created_by in (select id from users where email like 'smoke+%@homesy.test');\" -c \"delete from users where email like 'smoke+%@homesy.test';\""
```

`$HOMESY_SSH` comes from the `deploy-homesy` skill. Expected: one `DELETE n` line per table and no errors.

---

### Task 10: EAS build profiles, placeholder icon and splash

**Files:**
- Modify: `mobile/eas.json` (replace)
- Create: `mobile/assets/icon.svg`, `mobile/assets/icon.png`, `mobile/assets/splash-icon.svg`, `mobile/assets/splash-icon.png`
- Modify: `mobile/app.json` (icon, splash plugin)
- Modify: `mobile/package.json` (`expo-splash-screen`)

**Interfaces:**
- Consumes: SDK 57 app
- Produces:
  - `production` profile with `EXPO_PUBLIC_API_URL=https://homesy-api.gilla.fun`
  - `development` simulator profile
  - `icon` and splash configured in the public config

- [ ] **Step 1: Replace `mobile/eas.json`**

```json
{
  "cli": {
    "version": ">= 18.12.2",
    "appVersionSource": "remote"
  },
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
  "submit": {
    "production": {}
  }
}
```

- [ ] **Step 2: Write the icon SVG** to `mobile/assets/icon.svg`: the v2 house mark, white on door-blue, full bleed, no transparency.

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#2747C9"/>
  <g transform="translate(212 212) scale(25)" fill="none" stroke="#FFFFFF" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 10.5 12 3l9 7.5"/>
    <path d="M5 9.5V21h14V9.5"/>
    <path d="M10 21v-6h4v6"/>
  </g>
</svg>
```

Write `mobile/assets/splash-icon.svg` the same way, with no background `rect` and stroke `#2747C9`.

- [ ] **Step 3: Rasterise. The icon must have no alpha channel (App Store rule).**

```bash
cd mobile/assets
rsvg-convert -w 1024 -h 1024 icon.svg -o icon.png && magick icon.png -background '#2747C9' -alpha remove -alpha off icon.png
rsvg-convert -w 1024 -h 1024 splash-icon.svg -o splash-icon.png
magick identify -format '%f %wx%h alpha=%A\n' icon.png splash-icon.png
```

Expected: `icon.png 1024x1024 alpha=Undefined` (or `False`), and `splash-icon.png 1024x1024 alpha=Blend`/`True`.

- [ ] **Step 4: Configure `app.json`.** Install the splash plugin, then edit.

Run: `cd mobile && ./node_modules/.bin/expo install expo-splash-screen`

In `app.json` under `expo`:
- add `"icon": "./assets/icon.png"`
- in `plugins`, add the following, keeping the existing entries:

```json
["expo-splash-screen", { "image": "./assets/splash-icon.png", "imageWidth": 120, "backgroundColor": "#F6F5F1" }]
```

- [ ] **Step 5: Verify the public config and the production API URL**

```bash
cd mobile && ./node_modules/.bin/expo config --type public | grep -E "icon|splash|ITSAppUsesNonExemptEncryption|projectId" | head
EXPO_PUBLIC_API_URL=https://homesy-api.gilla.fun ./node_modules/.bin/expo export --platform ios --output-dir $SCRATCH/export-prod > /dev/null 2>&1; grep -rl "homesy-api.gilla.fun" $SCRATCH/export-prod | head -1
```

Expected:
- `icon` is `./assets/icon.png`, the splash plugin is present, and `ITSAppUsesNonExemptEncryption` is `false`
- the projectId is unchanged
- the export grep prints a bundle path, proving the URL is inlined (Review Focus 4)

- [ ] **Step 6: Gates and commit**

Run the Task 2–6 Step C gates. Then:

```bash
git add mobile/eas.json mobile/app.json mobile/package.json mobile/package-lock.json mobile/assets
gitleaks protect --staged --no-banner
git commit -m "Add EAS build profiles, placeholder icon and splash"
```

---

### Task 11: PR, CI, merge (ask the owner before merging)

**Files:** none

**Interfaces:**
- Consumes: branch `feat/expo-57`
- Produces: SDK 57 on `main`

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feat/expo-57
gh pr create --base main --title "Upgrade mobile to Expo SDK 57, add mobile CI and EAS profiles" --fill
gh pr checks --watch
```

Expected: the `mobile / check` job passes. The `api` workflow does not run, because no backend paths changed.

- [ ] **Step 2: Ask the owner to approve the merge.** Then run `gh pr merge --merge --delete-branch` and `git switch main && git pull`.

### Task 12: Production build, submit, internal TestFlight, device smoke (owner-interactive)

**Files:** none in the repo

**Interfaces:**
- Consumes: `main` at SDK 57
- Produces: a TestFlight build installed on the owner's iPhone

- [ ] **Step 1: The owner runs the first production build**

`! cd mobile && eas build -p ios --profile production`

The owner answers the prompts: log in to the Apple account, then let EAS generate the distribution certificate and provisioning profile. Expected: the build finishes on EAS. Record the build URL and the Xcode version from its "Set up build environment" step in the ledger, from `eas build:view <id>` or the build page. Expected Xcode: `26.x`.

- [ ] **Step 2: The owner submits**

`! cd mobile && eas submit -p ios --latest`

If prompted for an app name and **"Homesy"** is rejected as taken, enter **"Homesy: Shared Home"** (Review Focus 5). Expected: the upload succeeds. Record the App Store Connect app id in the `deploy-homesy` operator skill, not the repo.

- [ ] **Step 3: Internal TestFlight (owner, App Store Connect web)**

After Apple's processing email arrives:
- TestFlight → Internal Testing → create group "Owner" with the owner's Apple ID
- add the build
- install from the TestFlight app on the iPhone

Record any privacy-manifest warning email for 2c.

- [ ] **Step 4: Device smoke**

Repeat Task 9's checks 1–7 on the iPhone against production, with fresh throwaway accounts and Claude performing the curl actions, then the Task 9 Step 6 cleanup. Expected: all pass. **Check 4 (live update) on real hardware is the acceptance gate for 2a.**

### Task 13: Docs

**Files:**
- Modify: `CLAUDE.md` (mobile commands and architecture)
- Modify: `README.md` (stack line, run instructions)
- Modify: `~/.claude/skills/deploy-homesy/SKILL.md` (outside the repo: EAS project and App Store Connect notes)

**Interfaces:**
- Consumes: Tasks 1–12
- Produces: docs matching the shipped setup

- [ ] **Step 1: Update `CLAUDE.md`**
  - Stack line: `Expo SDK 57 (React Native 0.86, React 19.2), Expo Router 57`.
  - Mobile commands: replace `npm run typecheck` with the CI gate sequence, and add `eas build -p ios --profile production` / `eas submit -p ios --latest`, both run by the owner because they need Apple login.
  - Note that the mobile CI job is the only automated check for the app, and that `EXPO_PUBLIC_API_URL` for builds comes from `eas.json` profiles.

- [ ] **Step 2: Update `README.md`.** The stack line becomes `Expo SDK 57 · Expo Router · TanStack Query · Zustand`.

- [ ] **Step 3: Update the operator skill.** Add the EAS project id, the App Store Connect app name and id, the TestFlight group, and the cleanup SQL for smoke accounts.

- [ ] **Step 4: Commit straight to `main`.** Docs-only commits go to `main`, matching the earlier spec and plan commits. No workflow runs on these paths.

```bash
git add CLAUDE.md README.md
gitleaks protect --staged --no-banner
git commit -m "Document the SDK 57 toolchain, mobile CI and EAS release flow"
```
