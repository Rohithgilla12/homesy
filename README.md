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
                          └────< VaultEntry (category, label, value, is_secret, pinned)
```

- A user joins a home with a 6-char invite code. Roles: `owner` | `member`.
- Every list and vault entry is scoped to a home. Every API call checks membership.
- `is_secret` vault entries (Wi-Fi password, gate code) are masked in the UI
  until tapped; they are *not* encrypted at rest in this MVP — see "Next".

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

## API (all JSON, `Authorization: Bearer <jwt>` except /auth/*)

| Method | Path                     | Notes                                   |
|--------|--------------------------|-----------------------------------------|
| POST   | /auth/signup             | `{email, password, display_name}`       |
| POST   | /auth/login              | `{email, password}` → `{token, user}`   |
| GET    | /me                      |                                         |
| GET    | /homes                   | homes I belong to                       |
| POST   | /homes                   | `{name, emoji?}` → creates default lists|
| POST   | /homes/join              | `{code}`                                |
| GET    | /homes/{id}              | home + members                          |
| GET    | /homes/{id}/lists        |                                         |
| POST   | /homes/{id}/lists        | `{kind, name}`                          |
| GET    | /lists/{id}/items        |                                         |
| POST   | /lists/{id}/items        | `{title, qty?, note?}`                  |
| PATCH  | /items/{id}              | `{title?, qty?, note?, done?}`          |
| DELETE | /items/{id}              |                                         |
| GET    | /homes/{id}/vault        |                                         |
| POST   | /homes/{id}/vault        | `{category, label, value, is_secret?, pinned?}` |
| PATCH  | /vault/{id}              |                                         |
| DELETE | /vault/{id}              |                                         |

## Next (deliberately out of MVP)

1. Realtime — SSE stream per home (`GET /homes/{id}/events`) using `tokio::sync::broadcast`.
2. Offline-first — TanStack Query persist + optimistic mutations (Expo side only).
3. Vault encryption — client-side AES-GCM with a per-home key shared via the invite.
4. "Which home am I in?" — geofence per home address, auto-switch active home.
5. Push (Expo Notifications) for "X added 3 items to Groceries".
