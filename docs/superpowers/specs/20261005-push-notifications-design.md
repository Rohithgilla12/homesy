# Push notifications — design

Date: 2026-10-05. Status: approved in conversation, awaiting plan. Builds on the love-notes spec (`20261005-love-notes-design.md`); the bill and whiteboard triggers stand alone.

## Goal

Tell a member about things that happened while the app was closed: a love note arriving (immediately, or at 8 am local on its scheduled day), a bill due tomorrow or overdue, a bill marked paid by someone else, an urgent whiteboard note. Per-category toggles; the noisy "someone joined / added an item" category exists but is off by default.

## Approach

`expo-notifications` on the phone and Expo's push service in between, so the backend speaks one HTTPS API (`https://exp.host/--/api/v2/push/send`) and never touches APNs or FCM directly. Chosen over direct APNs/FCM (two protocols, certificate handling in Rust) and over a third-party service (another vendor for a hobby app). Expo's service is free and already tied to the EAS project.

One-time setup by the operator, outside the repo: an APNs key uploaded with `eas credentials` (iOS) and a Firebase project whose FCM v1 service-account JSON is uploaded to EAS (Android). The Android app also needs `google-services.json`; it is stored as an EAS file environment variable, not committed, and `app.json` points at it via `android.googleServicesFile`. Remote push does not work in Expo Go since SDK 53, so testing uses the development and production builds.

## Data model

Migration `0006_push.sql` (expand-only):

- `push_tokens`: id, user_id (FK users), token (unique), platform (`ios` | `android`), timezone (IANA name sent by the phone), device_name (nullable), created_at, last_seen_at, disabled_at (nullable; set when Expo reports `DeviceNotRegistered`).
- `users.notification_prefs jsonb not null default '{"notes":true,"bills":true,"whiteboard":true,"activity":false}'`.
- `notification_log`: dedupe_key (text, primary key), user_id, category, sent_at, ticket_id (nullable), receipt_status (nullable). The key makes every reminder idempotent, for example `bill:{id}:due_tomorrow`, `bill:{id}:overdue`, `note:{id}:delivered`.
- `love_notes.notified_at timestamptz` nullable, for the scheduled sweep.

## API

- `POST /me/push-token` `{ token, platform, timezone, device_name? }`: upsert by token, sets `user_id` to the caller (a token that moves to another account on the same phone is reassigned), refreshes `last_seen_at`, clears `disabled_at`. Called on every app start when permission is granted.
- `DELETE /me/push-token` `{ token }`: on sign-out, so the next user of the phone does not get the previous one's notes.
- `PATCH /me` gains `notification_prefs` (partial merge of the four booleans). `GET /me` returns them.

## Sending

A `notify` module in the backend:

- `notify(recipients: &[Uuid], category, Message { title, body, data })`. Loads enabled tokens for recipients whose `notification_prefs[category]` is true, skips the actor's own tokens, writes `notification_log` rows (`insert … on conflict do nothing`; a conflict means already sent, skip), then POSTs to Expo in chunks of 100 with `to`, `title`, `body`, `data`, `sound: "default"`, `priority: "high"` for notes and whiteboard, `"default"` for bills, and `channelId` on Android (`notes`, `bills`, `whiteboard`, `activity`).
- Tickets are stored; a receipts pass 15 minutes later (`/push/getReceipts`) marks `DeviceNotRegistered` tokens disabled and logs other errors at warn.
- `data` always carries `{ category, route, id }` so the app can deep-link, for example `{ route: "/notes", id }`, `{ route: "/bills" }`, `{ route: "/home" }`.
- Sending is fire-and-forget from handlers (`tokio::spawn`), never on the request path; failures are logged, never surfaced to the user.
- Rate: Expo allows 600 notifications per second per project; the household scale is far below that, so no queue beyond the spawn.

## Triggers

| event | recipients | category | copy | dedupe key |
| --- | --- | --- | --- | --- |
| love note created without `show_on` (or `show_on` ≤ today) | recipient | notes | "A note from {sender} {emoji}" / first line of body (60 chars) | `note:{id}:delivered` |
| scheduled note, hourly sweep | recipient | notes | same | same |
| bill due tomorrow, daily sweep | all members | bills | "{title} is due tomorrow" / "₹{amount} · tap to see who's paying" | `bill:{id}:due_tomorrow` |
| bill overdue (first day past due), daily sweep | all members | bills | "{title} is overdue" / "Due {date} · ₹{amount}" | `bill:{id}:overdue` |
| bill marked paid | other members | bills | "{payer} paid {title}" / "₹{amount} · don't pay again" | `bill:{id}:paid:{paid_at}` |
| bill marked unpaid | other members | bills | "{title} is pending again" | `bill:{id}:unpaid:{ts}` |
| urgent whiteboard note posted | other members | whiteboard | "{author}: {title}" / body | `notice:{id}` |
| member joined | owners | activity (off by default) | "{name} joined {home}" | `member:{home}:{user}` |
| list item added by someone else | other members | activity | "{name} added {item} to {list}" | `item:{id}` |

Sweeps run inside the API process (`tokio::spawn` loop started in `main`), hourly for scheduled notes and bills. "8 am local" and "tomorrow" are computed per recipient from the timezone of their most recently seen token (chrono-tz); a recipient with no token gets nothing, which is the correct outcome. The bill sweep considers a bill "due tomorrow" when the recipient's local date + 1 = `due_date` and sends between 08:00 and 09:00 local, so the hourly loop hits each timezone once. The note sweep sends when local date ≥ `show_on` and local hour ≥ 8, then sets `notified_at`; a phone that was off all day still gets it later that day.

## Mobile

- `src/push.ts`: `registerForPush()` asks permission with `expo-notifications`, gets the Expo token (`getExpoPushTokenAsync({ projectId })`), and POSTs it with `Localization.getCalendars()[0].timeZone` and the device name. Called after sign-in and on each cold start when permission is already granted. On sign-out it deletes the token first.
- Permission timing: not at launch. The prompt appears the first time something worth notifying exists: after creating or joining the first home, from a small card "Get a nudge when a note or bill arrives" with "Turn on" / "Not now". "Not now" is remembered for 7 days.
- Android channels created at startup: `notes` (high), `bills` (default), `whiteboard` (high), `activity` (low).
- Foreground: system banners are suppressed (`shouldShowAlert: false`); the existing in-app moments handle it (the notes banner, the live row). Background/quit: the system notification; tapping it routes with `router.push(data.route)` and, for notes, opens the note sheet.
- Badge: iOS badge = unread notes count, set when notes refetch; cleared when the notes card is opened.
- Settings: four `Switch` rows on the account card (Notes, Bills, Whiteboard, Everything else) bound to `PATCH /me`; a "Notifications are off for Homesy in Settings" hint with an "Open Settings" button when permission is denied.
- Types: `PushPrefs` in `src/api/types.ts`, mirrored from the Rust struct.

## Privacy

Love-note notifications show the sender and the first line only when the phone's lock-screen preview setting allows it; this is the OS's choice, not ours, so the title is enough on its own ("A note from Rohith 🥰"). Nothing in `data` contains note text. Tokens are per device and deleted on sign-out.

## Testing

- Backend: unit tests for the local-time windows (a recipient in Asia/Kolkata and one in America/Los_Angeles with the same bill), dedupe-key idempotency, pref filtering and actor exclusion; an integration test that the paid-bill handler enqueues exactly one notification per other member against a stubbed Expo endpoint (`EXPO_PUSH_URL` env, defaulting to the real one).
- Mobile: unit tests for the route map and the "Not now for 7 days" rule; a device test (TestFlight / APK) for the full path, since Expo Go cannot receive push.

## Out of scope

Rich notifications with images, notification history screen, email fallback, per-home muting, quiet hours (the 8 am rule covers scheduled items; immediate events are rare).
