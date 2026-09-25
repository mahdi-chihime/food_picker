-- Foodie Pick: Teams schema for Supabase.
-- Run once in the Supabase SQL editor (safe to re-run).
-- Also enable: Authentication -> Sign In / Providers -> "Allow anonymous sign-ins".

-- ---------- Tables ----------

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  join_code text not null unique,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  nickname text not null check (char_length(nickname) between 1 and 24),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists public.restaurants (
  id uuid primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  emoji text not null default '🍽️' check (char_length(emoji) <= 16),
  tickets int not null default 1 check (tickets between 1 and 5),
  sitting_out boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists restaurants_team_idx on public.restaurants (team_id, position);

create table if not exists public.lunches (
  id uuid primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  emoji text not null default '🍽️' check (char_length(emoji) <= 16),
  mode text not null default 'wheel' check (mode in ('wheel', 'race', 'knockout')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists lunches_team_idx on public.lunches (team_id, created_at desc);

create table if not exists public.lunch_ratings (
  lunch_id uuid not null references public.lunches (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  rating int not null check (rating between 1 and 5),
  primary key (lunch_id, user_id)
);
create index if not exists lunch_ratings_team_idx on public.lunch_ratings (team_id);

-- ---------- Membership helper ----------

create or replace function public.is_member(t uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where team_id = t and user_id = auth.uid()
  );
$$;

-- ---------- Row level security ----------

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.restaurants enable row level security;
alter table public.lunches enable row level security;
alter table public.lunch_ratings enable row level security;

drop policy if exists "members read team" on public.teams;
create policy "members read team" on public.teams
  for select to authenticated using (public.is_member(id));

drop policy if exists "members read members" on public.team_members;
create policy "members read members" on public.team_members
  for select to authenticated using (public.is_member(team_id));

drop policy if exists "rename myself" on public.team_members;
create policy "rename myself" on public.team_members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "leave team" on public.team_members;
create policy "leave team" on public.team_members
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "members manage restaurants" on public.restaurants;
create policy "members manage restaurants" on public.restaurants
  for all to authenticated
  using (public.is_member(team_id)) with check (public.is_member(team_id));

drop policy if exists "members manage lunches" on public.lunches;
create policy "members manage lunches" on public.lunches
  for all to authenticated
  using (public.is_member(team_id)) with check (public.is_member(team_id));

drop policy if exists "members read ratings" on public.lunch_ratings;
create policy "members read ratings" on public.lunch_ratings
  for select to authenticated using (public.is_member(team_id));

drop policy if exists "rate as myself" on public.lunch_ratings;
create policy "rate as myself" on public.lunch_ratings
  for all to authenticated
  using (user_id = auth.uid() and public.is_member(team_id))
  with check (user_id = auth.uid() and public.is_member(team_id));

-- ---------- Create / join (the only way into a team) ----------

create or replace function public.create_team(p_name text, p_nick text)
returns public.teams
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.teams;
  code text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  loop
    select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', floor(random() * 31)::int + 1, 1), '')
      into code
      from generate_series(1, 6);
    exit when not exists (select 1 from public.teams where join_code = code);
  end loop;
  insert into public.teams (name, join_code, created_by)
    values (left(trim(p_name), 40), code, auth.uid())
    returning * into t;
  insert into public.team_members (team_id, user_id, nickname)
    values (t.id, auth.uid(), left(trim(p_nick), 24));
  return t;
end;
$$;

create or replace function public.join_team(p_code text, p_nick text)
returns public.teams
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.teams;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select * into t from public.teams where join_code = upper(trim(p_code));
  if t.id is null then
    raise exception 'Team not found. Check the code?';
  end if;
  insert into public.team_members (team_id, user_id, nickname)
    values (t.id, auth.uid(), left(trim(p_nick), 24))
    on conflict (team_id, user_id) do update set nickname = excluded.nickname;
  return t;
end;
$$;

revoke all on function public.create_team(text, text) from public, anon;
revoke all on function public.join_team(text, text) from public, anon;
grant execute on function public.create_team(text, text) to authenticated;
grant execute on function public.join_team(text, text) to authenticated;
