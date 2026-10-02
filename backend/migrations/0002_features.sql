-- 0002_features.sql
-- Activities, Bulletin Notices, Expenses

create table activities (
  id            uuid primary key,
  home_id       uuid not null references homes(id) on delete cascade,
  actor_id      uuid not null references users(id) on delete cascade,
  action        varchar(100) not null,
  resource_type varchar(100) not null,
  description   text not null,
  created_at    timestamptz not null default now()
);
create index activities_home_idx on activities(home_id, created_at desc);

create table bulletin_notices (
  id         uuid primary key,
  home_id    uuid not null references homes(id) on delete cascade,
  title      varchar(255) not null,
  content    text not null,
  priority   varchar(50) not null check (priority in ('normal', 'urgent')),
  created_by uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index bulletin_notices_home_idx on bulletin_notices(home_id, created_at desc);

create table expenses (
  id           uuid primary key,
  home_id      uuid not null references homes(id) on delete cascade,
  title        varchar(255) not null,
  amount_cents bigint not null,
  category     varchar(100) not null,
  paid_by      uuid not null references users(id) on delete cascade,
  created_at   timestamptz not null default now()
);
create index expenses_home_idx on expenses(home_id, created_at desc);
