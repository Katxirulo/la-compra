-- =========================================================
--  La compra · Esquema de base de datos para Supabase
--  Ejecutar entero en: Supabase > SQL Editor > New query
-- =========================================================

-- Hogares (cada lista compartida)
create table if not exists public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 60),
  code       text not null unique,
  created_at timestamptz not null default now()
);

-- Miembros de cada hogar (usuarios anónimos de Supabase Auth)
create table if not exists public.members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- Productos de la lista
create table if not exists public.items (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  qty          text check (qty is null or char_length(qty) <= 20),
  checked      boolean not null default false,
  added_by     text,
  created_at   timestamptz not null default now()
);
create index if not exists items_household_idx on public.items (household_id);

-- Productos habituales (se alimentan solos con lo que se va añadiendo)
create table if not exists public.favorites (
  household_id uuid not null references public.households(id) on delete cascade,
  name_key     text not null,
  name         text not null,
  use_count    int  not null default 1,
  last_used    timestamptz not null default now(),
  primary key (household_id, name_key)
);

-- ---------- Seguridad (RLS) ----------
create or replace function public.is_member(h uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where household_id = h and user_id = auth.uid());
$$;

alter table public.households enable row level security;
alter table public.members    enable row level security;
alter table public.items      enable row level security;
alter table public.favorites  enable row level security;

drop policy if exists "ver mi hogar" on public.households;
create policy "ver mi hogar" on public.households
  for select to authenticated using (public.is_member(id));

drop policy if exists "ver miembros" on public.members;
create policy "ver miembros" on public.members
  for select to authenticated using (public.is_member(household_id));

drop policy if exists "gestionar productos" on public.items;
create policy "gestionar productos" on public.items
  for all to authenticated
  using (public.is_member(household_id))
  with check (public.is_member(household_id));

drop policy if exists "ver habituales" on public.favorites;
create policy "ver habituales" on public.favorites
  for select to authenticated using (public.is_member(household_id));

drop policy if exists "borrar habituales" on public.favorites;
create policy "borrar habituales" on public.favorites
  for delete to authenticated using (public.is_member(household_id));

-- ---------- Habituales automáticos ----------
create or replace function public.bump_favorite()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into favorites (household_id, name_key, name)
  values (new.household_id, lower(trim(new.name)), trim(new.name))
  on conflict (household_id, name_key)
  do update set use_count = favorites.use_count + 1,
                last_used = now(),
                name      = excluded.name;
  return new;
end $$;

drop trigger if exists items_bump_favorite on public.items;
create trigger items_bump_favorite
  after insert on public.items
  for each row execute function public.bump_favorite();

-- ---------- Crear hogar / unirse con código ----------
create or replace function public.create_household(p_name text, p_display_name text)
returns public.households language plpgsql security definer set search_path = public as $$
declare
  h      households;
  v_code text;
  i      int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1);
    end loop;
    exit when not exists (select 1 from households where code = v_code);
  end loop;

  insert into households (name, code) values (trim(p_name), v_code) returning * into h;
  insert into members (household_id, user_id, display_name)
  values (h.id, auth.uid(), trim(p_display_name));
  return h;
end $$;

create or replace function public.join_household(p_code text, p_display_name text)
returns public.households language plpgsql security definer set search_path = public as $$
declare h households;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into h from households where code = upper(trim(p_code));
  if not found then raise exception 'codigo no valido'; end if;

  insert into members (household_id, user_id, display_name)
  values (h.id, auth.uid(), trim(p_display_name))
  on conflict (household_id, user_id) do update set display_name = excluded.display_name;
  return h;
end $$;

revoke execute on function public.create_household(text, text) from anon, public;
revoke execute on function public.join_household(text, text)   from anon, public;
grant  execute on function public.create_household(text, text) to authenticated;
grant  execute on function public.join_household(text, text)   to authenticated;

-- ---------- Tiempo real ----------
alter table public.items     replica identity full;
alter table public.favorites replica identity full;
alter publication supabase_realtime add table public.items;
alter publication supabase_realtime add table public.favorites;
