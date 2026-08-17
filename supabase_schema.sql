-- GUERRA PAISAGISMO — VISITAS
-- Execute no SQL Editor do Supabase.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  full_name text,
  role text not null default 'seller' check (role in ('seller','manager')),
  created_at timestamptz not null default now()
);

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  client_ref text,
  payload jsonb not null default '{}'::jsonb,
  photo_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists visits_org_id_idx on public.visits(org_id);
create index if not exists visits_created_by_idx on public.visits(created_by);
create index if not exists visits_updated_at_idx on public.visits(updated_at desc);

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.profiles where id = auth.uid()
$$;

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.visits enable row level security;

drop policy if exists "org members can read organization" on public.organizations;
create policy "org members can read organization"
on public.organizations for select
to authenticated
using (id = (select public.current_org_id()));

drop policy if exists "users can read own profile" on public.profiles;
create policy "users can read own profile"
on public.profiles for select
to authenticated
using (id = (select auth.uid()));

drop policy if exists "org members can read visits" on public.visits;
create policy "org members can read visits"
on public.visits for select
to authenticated
using (org_id = (select public.current_org_id()));

drop policy if exists "users can create visits in own org" on public.visits;
create policy "users can create visits in own org"
on public.visits for insert
to authenticated
with check (
  org_id = (select public.current_org_id())
  and created_by = (select auth.uid())
);

drop policy if exists "seller owner or manager can update visits" on public.visits;
create policy "seller owner or manager can update visits"
on public.visits for update
to authenticated
using (
  org_id = (select public.current_org_id())
  and (
    created_by = (select auth.uid())
    or (select public.current_role()) = 'manager'
  )
)
with check (
  org_id = (select public.current_org_id())
);

drop policy if exists "seller owner or manager can delete visits" on public.visits;
create policy "seller owner or manager can delete visits"
on public.visits for delete
to authenticated
using (
  org_id = (select public.current_org_id())
  and (
    created_by = (select auth.uid())
    or (select public.current_role()) = 'manager'
  )
);

-- Private storage bucket.
insert into storage.buckets (id, name, public)
values ('visit-photos', 'visit-photos', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists "org users can read visit photos" on storage.objects;
create policy "org users can read visit photos"
on storage.objects for select
to authenticated
using (
  bucket_id = 'visit-photos'
  and (storage.foldername(name))[1] = (select public.current_org_id())::text
);

drop policy if exists "org users can upload visit photos" on storage.objects;
create policy "org users can upload visit photos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'visit-photos'
  and (storage.foldername(name))[1] = (select public.current_org_id())::text
);

drop policy if exists "org users can update visit photos" on storage.objects;
create policy "org users can update visit photos"
on storage.objects for update
to authenticated
using (
  bucket_id = 'visit-photos'
  and (storage.foldername(name))[1] = (select public.current_org_id())::text
);

-- Primeiro cadastro:
-- 1) Crie sua organização:
-- insert into public.organizations(name) values ('Guerra Paisagismo') returning id;
--
-- 2) Crie usuários em Authentication > Users.
--
-- 3) Para cada usuário, cadastre o profile usando o UUID do usuário e da organização:
-- insert into public.profiles(id, org_id, full_name, role)
-- values ('UUID_DO_USUARIO', 'UUID_DA_ORGANIZACAO', 'Nome do usuário', 'manager');
--
-- Para vendedor, use role = 'seller'.
