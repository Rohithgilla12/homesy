-- 0003_bills.sql
-- Dedicated Household Bills & Utilities Tracker

drop table if exists expenses;

create table household_bills (
  id             uuid primary key,
  home_id        uuid not null references homes(id) on delete cascade,
  title          varchar(255) not null,
  category       varchar(100) not null,
  account_number varchar(255),
  amount_cents   bigint,
  due_date       date,
  billing_period varchar(100) not null,
  is_paid        boolean not null default false,
  paid_by        uuid references users(id) on delete set null,
  paid_at        timestamptz,
  payment_ref    varchar(255),
  notes          text,
  created_by     uuid not null references users(id) on delete cascade,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index household_bills_home_idx on household_bills(home_id, is_paid, due_date);
