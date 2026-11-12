-- ============================================================
-- Meu Anki: estrutura do banco no Supabase
-- Cole TUDO isto em: Supabase → SQL Editor → New query → Run
-- ============================================================

-- Cartas: cada linha é uma carta de um usuário (o conteúdo fica em "data")
create table if not exists public.cards (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id         text not null,
  data       jsonb not null,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists cards_user_updated on public.cards (user_id, updated_at);

-- Configurações de estudo (idioma, novas por dia...) de cada usuário
create table if not exists public.settings (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- O horário de alteração é sempre o do servidor (evita problema com relógio errado no celular)
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists cards_touch on public.cards;
create trigger cards_touch before insert or update on public.cards for each row execute function public.touch_updated_at();
drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before insert or update on public.settings for each row execute function public.touch_updated_at();

-- Segurança: cada usuário só enxerga e altera as PRÓPRIAS linhas
alter table public.cards enable row level security;
alter table public.settings enable row level security;
drop policy if exists "cards do dono" on public.cards;
create policy "cards do dono" on public.cards for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "settings do dono" on public.settings;
create policy "settings do dono" on public.settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Áudios: bucket privado "audio"; cada usuário só mexe na pasta com o próprio id (audio/<id-do-usuário>/...)
insert into storage.buckets (id, name, public) values ('audio', 'audio', false) on conflict (id) do nothing;
drop policy if exists "audio do dono - ler" on storage.objects;
drop policy if exists "audio do dono - enviar" on storage.objects;
drop policy if exists "audio do dono - alterar" on storage.objects;
drop policy if exists "audio do dono - apagar" on storage.objects;
create policy "audio do dono - ler" on storage.objects for select to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "audio do dono - enviar" on storage.objects for insert to authenticated
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "audio do dono - alterar" on storage.objects for update to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "audio do dono - apagar" on storage.objects for delete to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
