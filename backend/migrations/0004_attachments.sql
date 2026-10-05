-- 0004_attachments.sql
-- Generic attachments stored in R2; owners reference them by id (expand-only).

create table attachments (
  id            uuid primary key,
  home_id       uuid not null references homes(id) on delete cascade,
  uploaded_by   uuid not null references users(id) on delete cascade,
  kind          varchar(32) not null,
  content_type  varchar(100) not null,
  size_bytes    bigint not null,
  status        varchar(16) not null default 'pending',
  created_at    timestamptz not null default now()
);
create index attachments_home_idx on attachments(home_id, status, created_at);

alter table household_bills add column receipt_id uuid references attachments(id) on delete set null;
alter table users add column avatar_id uuid references attachments(id) on delete set null;
alter table homes add column cover_id uuid references attachments(id) on delete set null;

create table vault_entry_attachments (
  entry_id      uuid not null references vault_entries(id) on delete cascade,
  attachment_id uuid not null references attachments(id) on delete cascade,
  position      int not null default 0,
  primary key (entry_id, attachment_id)
);
