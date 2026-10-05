# Love notes — design

Date: 2026-10-05. Status: approved in conversation, awaiting plan. Depends on the attachments spec (`20261005-attachments-r2-design.md`) for the optional photo.

## Goal

A member writes a short, private note to one other member of the same home: a few lines of text, an emoji, optionally a photo, and optionally a date on which it should appear. Only the sender and the recipient can ever see it. Notes are one-way: a reply is simply a new note back. It should feel like finding a card on the pillow, not like a chat.

## Visibility rule

A note is readable by exactly two users: `sender_id` and `recipient_id`. Nobody else in the home, including owners, can list or read it. The whiteboard stays the household-wide channel.

## Data model

Migration `0005_love_notes.sql` (expand-only):

| column | type | notes |
| --- | --- | --- |
| id | uuid | v7 |
| home_id | uuid | FK homes; both users must be members at write time |
| sender_id | uuid | FK users |
| recipient_id | uuid | FK users, ≠ sender |
| body | text | 1–500 characters after trim |
| emoji | text | one grapheme from a fixed picker list; nullable |
| photo_id | uuid | FK attachments (kind `note_photo`), nullable, `on delete set null` |
| show_on | date | nullable; the local calendar day the note becomes visible to the recipient |
| created_at | timestamptz | |
| read_at | timestamptz | nullable; set by the recipient |

Index on `(recipient_id, home_id, show_on, created_at desc)` and `(sender_id, home_id)`.

"Visible" for the recipient means `show_on is null or show_on <= today`, where today is the recipient's local date sent by the client as `?today=YYYY-MM-DD` (the API has no idea of the phone's timezone; the same convention bills use for due dates). The sender always sees their own notes, including scheduled ones, marked "Scheduled for 14 Feb".

## API

All routes require `AuthUser` and `ensure_member` on the home.

- `GET /homes/{id}/notes?today=YYYY-MM-DD` → `{ received: Note[], sent: Note[] }`. `received` is visible notes where the caller is the recipient (newest first, 100 max); `sent` is every note the caller sent. Each `Note` carries `photo` as an `Attachment` with a presigned URL when present. Hidden (future) notes never appear in `received`.
- `POST /homes/{id}/notes` body `{ recipient_id, body, emoji?, photo_id?, show_on? }`. Validates length, that the recipient is a current member and not the sender, that `photo_id` is a `ready` `note_photo` uploaded by the sender, and that `show_on` is today or later. Returns the note.
- `POST /notes/{id}/read` recipient only; sets `read_at` if null. Returns the note.
- `DELETE /notes/{id}` sender only (a sent note can be taken back); deletes the photo attachment too.
- Activity: none. A love note is private, so it is never written to `activities` and never broadcast with its content.
- Realtime: the handler broadcasts `note_delivered` with payload `{ recipient_id, note_id }` only, no body. The SSE hook invalidates `['notes', homeId]` when the event's `recipient_id` is the current user, so a note shows up live without leaking anything to other listeners (the broadcast is home-wide, so the payload must stay content-free). Scheduled notes are not broadcast at creation; the app refetches notes on foreground and when the local date changes.

Errors: 400 validation, 403 not a member / not the recipient / not the sender, 404.

## Mobile

- Query key `['notes', homeId, today]`; `today` from `toIsoDate(new Date())`, recomputed on app foreground so a note scheduled for today appears on first open that morning.
- **Notes card** on the Home tab between the whiteboard and the invite card. Title "Notes", a `Pill` badge with the unread count, up to three received notes (sender avatar, emoji, first line, relative time; tap opens the full note in a `Sheet` and marks it read), a "See all" link when there are more, and a "Write a note" button. An empty card reads "Leave a note for someone in this home."
- **Write sheet**: recipient `Chip`s (every other member, avatar + name), an emoji row (fixed set of 12: ❤️ 🥰 🌸 ☕ 🍰 🎉 🌙 ☀️ 🫶 🏡 🐣 ✨), a multiline `Input` (500 chars, counter after 400), an `AttachmentPicker` for one photo (hidden when attachments are disabled), a `DateField` "Show on" that defaults to empty ("right away"), and a "Send note" button. Success closes the sheet with the success haptic and a brief confetti burst from the existing overlay.
- **Note sheet** (read view): the emoji large, the photo if any, the body in `type.body`, "From Ananya · Yesterday", and for the sender's own notes a "Scheduled for 14 Feb" pill plus "Take back".
- **Arrival moment**: when `received` gains a note the user hasn't seen (`useFreshRows` with `sender_id` as the actor), the Home tab shows a soft banner at the top ("You have a note from Ananya 🥰", accentSoft, slides in with the sheet curve, taps open it) and plays the light haptic. If the user is on another tab, the Home tab icon gets a 6 pt accent dot until the note is opened. Under Reduce Motion the banner fades.
- **All notes** screen (`app/(app)/notes.tsx`, stack route): two `Chip` filters, Received / Sent, each a list of rows like the card's.
- Privacy on the device: notes are in the persisted TanStack cache like everything else; signing out already clears it.

## Copy

Short and warm, no exclamation marks beyond the user's own text. "Write a note", "Send note", "Take back", "Show on", "You have a note from {name}", "Leave a note for someone in this home."

## Testing

- Backend integration tests: visibility (a third member gets neither list; the recipient never sees a future `show_on`; the sender sees it), recipient must be a member, read marks once, delete is sender-only, the broadcast payload carries no body.
- Mobile unit tests: unread count, `today` recomputation on foreground, note grouping for the card (max three, newest first).
- Simulator pass: write → arrive on the second account via SSE → banner → read; a scheduled note appearing after a date change; Reduce Motion.

## Out of scope

Replies and threads, reactions, editing a sent note, notes to more than one person, push notifications (no push infrastructure yet; the banner covers the in-app case and push is a 2c-level feature).
