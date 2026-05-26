-- Slice 3: Auth + unified users table.
-- The users table from 0001-init.sql is unused; extend it into a single
-- people table covering admins/Google logins, salespeople, and clients.

-- 1) Extend users into the unified people table.
alter table users
  add column if not exists auth_user_id   uuid unique references auth.users(id) on delete set null,
  add column if not exists is_admin       boolean not null default false,
  add column if not exists is_salesperson boolean not null default false,
  add column if not exists is_client      boolean not null default false;

-- 2) Email is optional now (clients/reps may have none).
--    Unique only when present, case-insensitive.
alter table users alter column email drop not null;
alter table users drop constraint if exists users_email_key;
create unique index if not exists users_email_lower_unique
  on users (lower(email)) where email is not null;

-- 3) Same-name dedup for dictionary use.
create unique index if not exists users_name_lower_unique
  on users (lower(name));

-- 4) Calls: FKs to users(id) for both roles; keep denormalized names.
alter table calls
  add column if not exists salesperson_id uuid references users(id) on delete set null,
  add column if not exists client_id      uuid references users(id) on delete set null;

-- 5) Seed bootstrap admin. auth_user_id stays null until first Google sign-in.
insert into users (email, name, role, is_admin)
values ('vignesh.s@soexcellence.com', 'Vignesh S', 'admin', true)
on conflict ((lower(email))) where email is not null
do update set is_admin = true, role = 'admin', name = excluded.name;
