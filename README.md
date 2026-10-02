# Homesy

One app for every home you belong to — your parents' place, the flat you rent, anywhere you have a key.

**Core idea:** the *home* is the unit, not the user. You can be a member of
several homes (parents' house in Hyderabad, the rented flat in Bangalore, a
friend's place you crash at) and each home has its own members, lists, and a
vault of "important details". Nothing bleeds across homes.

```
homesy/
├── backend/   Rust · Axum 0.8 · SQLx · PostgreSQL · JWT
└── mobile/    Expo SDK 52 · Expo Router · TanStack Query · Zustand
```

## Domain model

```
User ──< HomeMember >── Home ──< List (grocery | laundry | todo | custom) ──< ListItem
                          ├────< VaultEntry (category, label, value, is_secret, pinned)
                          ├────< HouseholdBill (category, amount, due date, billing period, paid by)
                          ├────< BulletinNotice (title, content, priority normal | urgent)
                          └────< Activity (who did what, written by every mutation)
```

- A user joins a home with a 6-char invite code. Roles: `owner` | `member`.
- Everything is scoped to a home. Every API call checks membership.
- Bills are recurring: mark one paid (by you or another member), then "start next
  cycle" to reset it for the next billing period. Payment is announced in the activity
  feed so nobody pays twice.
- `is_secret` vault entries (Wi-Fi password, gate code) are masked in the UI
  until tapped; they are *not* encrypted at rest in this MVP — see "Next".
- Changes stream to every open client in the same home over SSE.

## Run it

```bash
# 1. Database
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env
cargo run            # runs migrations on boot, listens on :8080

# 3. Mobile
cd ../mobile
npm install
# point EXPO_PUBLIC_API_URL at your machine's LAN IP, not localhost, for a physical device
npx expo start
```

## API (all JSON, `Authorization: Bearer <jwt>` except /auth/* and /health)

| Method | Path                     | Notes                                   |
|--------|--------------------------|-----------------------------------------|
| GET    | /health                  | `ok`                                    |
| POST   | /auth/signup             | `{email, password, display_name}`       |
| POST   | /auth/login              | `{email, password}` → `{token, user}`   |
| GET    | /me                      |                                         |
| GET    | /homes                   | homes I belong to                       |
| POST   | /homes                   | `{name, emoji?}` → creates default lists|
| POST   | /homes/join              | `{code}`                                |
| GET    | /homes/{id}              | home + members                          |
| POST   | /homes/{id}/leave        | the last owner cannot leave             |
| GET    | /homes/{id}/activity     | `?limit=` (default 50, max 100)         |
| GET    | /homes/{id}/events       | SSE stream of changes in this home      |
| GET    | /homes/{id}/lists        |                                         |
| POST   | /homes/{id}/lists        | `{kind, name}`                          |
| GET    | /lists/{id}/items        |                                         |
| POST   | /lists/{id}/items        | `{title, qty?, note?}`                  |
| POST   | /lists/{id}/clear-completed | → `{deleted}`                        |
| PATCH  | /items/{id}              | `{title?, qty?, note?, done?}`          |
| DELETE | /items/{id}              |                                         |
| GET    | /homes/{id}/vault        |                                         |
| POST   | /homes/{id}/vault        | `{category, label, value, is_secret?, pinned?}` |
| PATCH  | /vault/{id}              |                                         |
| DELETE | /vault/{id}              |                                         |
| GET    | /homes/{id}/bulletin     |                                         |
| POST   | /homes/{id}/bulletin     | `{title, content, priority?}`           |
| DELETE | /bulletin/{id}           |                                         |
| GET    | /homes/{id}/bills        | unpaid first, then by due date          |
| POST   | /homes/{id}/bills        | `{title, category, billing_period, amount_cents?, account_number?, due_date? (YYYY-MM-DD), notes?}` |
| PATCH  | /bills/{id}              | any create field                        |
| POST   | /bills/{id}/pay          | `{paid_by?, payment_ref?, amount_cents?}`; `paid_by` defaults to you |
| POST   | /bills/{id}/unpay        |                                         |
| POST   | /bills/{id}/new-cycle    | `{billing_period, due_date?, amount_cents?}` resets to unpaid |
| DELETE | /bills/{id}              |                                         |

## Next (deliberately out of MVP)

Done since the first cut: realtime SSE per home (`GET /homes/{id}/events`), and a
persisted TanStack Query cache with optimistic list-item updates.

1. Vault encryption — client-side AES-GCM with a per-home key shared via the invite.
2. "Which home am I in?" — geofence per home address, auto-switch active home.
3. Push (Expo Notifications) for "X added 3 items to Groceries".
4. Realtime across multiple backend instances (the broadcast channel is in-process today).
