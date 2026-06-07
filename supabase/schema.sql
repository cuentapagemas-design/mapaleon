-- =====================================================================
-- León TOP 20 — esquema Supabase (cuentas + favoritos + descuentos)
-- Ejecuta este SQL en: Supabase → SQL Editor → New query → Run.
-- Todo va con Row Level Security (RLS): el navegador usa la anon key y solo
-- puede tocar SUS propios datos. La escritura de descuentos queda para el
-- service role / panel de administración (no para anon).
-- =====================================================================

-- ---------- Perfiles (1:1 con auth.users) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  created_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
drop policy if exists "profiles_upsert_own" on public.profiles;
create policy "profiles_upsert_own" on public.profiles
  for insert with check (auth.uid() = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- Crea el perfil automáticamente al registrarse un usuario.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- Favoritos del usuario (sincronizados entre dispositivos) ----------
create table if not exists public.favorites (
  user_id     uuid not null references auth.users(id) on delete cascade,
  place_id    text not null,
  category    text,
  created_at  timestamptz not null default now(),
  primary key (user_id, place_id)
);
alter table public.favorites enable row level security;

drop policy if exists "favorites_own" on public.favorites;
create policy "favorites_own" on public.favorites
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- Descuentos (ofertas de locales) — lectura pública ----------
create table if not exists public.discounts (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,          -- p.ej. "2x1 en pinchos"
  business        text not null,          -- nombre del local
  description     text,
  terms           text,                   -- condiciones / letra pequeña
  category        text,                   -- tapeo | comida | visitar | otros
  discount_label  text,                   -- "-20%", "2x1", "Gratis"…
  code            text,                   -- código a mostrar (opcional)
  link_url        text,
  image_url       text,
  lat             double precision,
  lng             double precision,
  starts_at       timestamptz,
  ends_at         timestamptz,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
alter table public.discounts enable row level security;

-- Cualquiera (anon) puede LEER las ofertas activas. La escritura no tiene
-- policy para anon → solo el service role / panel admin puede crear/editar.
drop policy if exists "discounts_public_read" on public.discounts;
create policy "discounts_public_read" on public.discounts
  for select using (active = true);

-- ---------- Descuentos guardados por el usuario ("mis descuentos") ----------
create table if not exists public.discount_saves (
  user_id      uuid not null references auth.users(id) on delete cascade,
  discount_id  uuid not null references public.discounts(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (user_id, discount_id)
);
alter table public.discount_saves enable row level security;

drop policy if exists "discount_saves_own" on public.discount_saves;
create policy "discount_saves_own" on public.discount_saves
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- (Opcional) algunas ofertas de ejemplo:
-- insert into public.discounts (title, business, description, category, discount_label, code, active)
-- values ('2x1 en pinchos', 'La Bicha', 'De lunes a jueves', 'tapeo', '2x1', 'LEON2X1', true);
