-- ProfNudge schema. Stores reminder data only: never review text, scores or grades.

create type nudge_status as enum ('waiting', 'done', 'skipped');

create table public.terms (
  user_id   uuid not null references auth.users on delete cascade,
  term_key  text not null check (term_key ~ '^(spring|summer|fall)-\d{4}$'),
  label     text not null,
  end_date  date not null,
  primary key (user_id, term_key)
);

create table public.tracked_professors (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users on delete cascade,
  rmp_id          integer not null,
  name            text not null check (length(name) <= 200),
  school          text not null default '' check (length(school) <= 200),
  term_key        text not null,
  status          nudge_status not null default 'waiting',
  nudges_sent     smallint not null default 0,
  last_nudged_at  timestamptz,
  created_at      timestamptz not null default now(),
  unique (user_id, rmp_id, term_key),
  foreign key (user_id, term_key) references public.terms (user_id, term_key) on delete cascade
);

create index tracked_professors_due on public.tracked_professors (status, nudges_sent) where status = 'waiting';

create table public.user_settings (
  user_id       uuid primary key references auth.users on delete cascade,
  unsubscribed  boolean not null default false
);

-- Row-level security: each student sees only their own rows.
alter table public.terms enable row level security;
alter table public.tracked_professors enable row level security;
alter table public.user_settings enable row level security;

create policy "own terms" on public.terms
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own professors" on public.tracked_professors
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own settings" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Clients may not tamper with nudge bookkeeping. (A column-level revoke is ignored while a
-- table-level UPDATE grant exists, so drop the table grant and re-grant only safe columns.)
revoke update on public.tracked_professors from anon, authenticated;
grant update (user_id, rmp_id, name, school, term_key, status) on public.tracked_professors to authenticated;

-- "Delete my account" from the popup.
create function public.delete_my_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
