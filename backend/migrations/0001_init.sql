create table users (
  id            uuid primary key,
  email         text not null unique,
  password_hash text not null,
  display_name  text not null,
  created_at    timestamptz not null default now()
);

create table homes (
  id          uuid primary key,
  name        text not null,
  emoji       text not null default '🏠',
  invite_code text not null unique,
  created_by  uuid not null references users(id),
  created_at  timestamptz not null default now()
);

create table home_members (
  home_id   uuid not null references homes(id) on delete cascade,
  user_id   uuid not null references users(id) on delete cascade,
  role      text not null check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (home_id, user_id)
);
create index home_members_user_idx on home_members(user_id);

create table lists (
  id         uuid primary key,
  home_id    uuid not null references homes(id) on delete cascade,
  kind       text not null check (kind in ('grocery','laundry','todo','custom')),
  name       text not null,
  created_at timestamptz not null default now()
);
create index lists_home_idx on lists(home_id);

create table list_items (
  id         uuid primary key,
  list_id    uuid not null references lists(id) on delete cascade,
  title      text not null,
  qty        text,
  note       text,
  done       boolean not null default false,
  done_by    uuid references users(id),
  done_at    timestamptz,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create index list_items_list_idx on list_items(list_id, done, created_at);

create table vault_entries (
  id         uuid primary key,
  home_id    uuid not null references homes(id) on delete cascade,
  category   text not null,          -- utilities | contacts | access | documents | other
  label      text not null,
  value      text not null,
  is_secret  boolean not null default false,
  pinned     boolean not null default false,
  created_by uuid not null references users(id),
  updated_at timestamptz not null default now()
);
create index vault_home_idx on vault_entries(home_id, pinned desc, category);
