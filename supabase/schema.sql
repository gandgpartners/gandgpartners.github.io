-- G&G — Glory & Grace partnership platform — schema
--
-- This table makes chat PERMANENT: history loads when a room opens, every
-- member message is saved, and a message stays saved until its author deletes
-- it. (Profiles still use Supabase Auth, and live chat + presence still run
-- over Supabase Realtime — those need no table.)
--
-- Run this once in the Supabase SQL Editor (Project: dvhmhxhpimlvcdbkkgev).
-- The publishable key can't run DDL, so it's applied from the dashboard.
-- Re-running is safe — everything is guarded with "if not exists" /
-- "drop policy if exists".

-- ---- messages: the conversation inside each room ----
-- channel_id is just the room's string id from app.js:
--   'main', 'gold', 'platinum', 'diamond', 'light'.
-- Rooms are defined in the client, so no separate channels table is needed.
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  channel_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists messages_channel_created_idx
  on public.messages (channel_id, created_at);

alter table public.messages enable row level security;

-- ---- media messages (photos + videos) ----
-- A message can carry a photo/video instead of (or alongside) text. media_url
-- points at a public object in the 'media' storage bucket; media_kind is
-- 'image' or 'video'. Files are stored UNCHANGED — full original quality.
alter table public.messages add column if not exists media_url  text;
alter table public.messages add column if not exists media_kind text;
-- Allow media-only rows: content may be null, but a row must carry text OR media.
alter table public.messages alter column content drop not null;
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages drop constraint if exists messages_content_len;
alter table public.messages add constraint messages_content_len
  check (content is null or char_length(content) <= 2000);
alter table public.messages drop constraint if exists messages_has_body;
alter table public.messages add constraint messages_has_body
  check (content is not null or media_url is not null);

-- Storage bucket 'media': public read, NO size limit (no downscaling on our
-- side), host-only upload/delete.
insert into storage.buckets (id, name, public, file_size_limit)
  values ('media', 'media', true, null)
  on conflict (id) do update set public = true, file_size_limit = null;
drop policy if exists "media public read" on storage.objects;
create policy "media public read" on storage.objects
  for select using (bucket_id = 'media');
drop policy if exists "host uploads media" on storage.objects;
create policy "host uploads media" on storage.objects
  for insert with check (
    bucket_id = 'media' and lower(auth.jwt() ->> 'email') = 'prophetdian@gmail.com'
  );
drop policy if exists "host deletes media" on storage.objects;
create policy "host deletes media" on storage.objects
  for delete using (
    bucket_id = 'media' and lower(auth.jwt() ->> 'email') = 'prophetdian@gmail.com'
  );

-- Everyone can read history (the app itself decides which rooms to show).
drop policy if exists "messages are readable by everyone" on public.messages;
create policy "messages are readable by everyone"
  on public.messages for select
  using (true);

-- FOR NOW: only the host account (prophetdian@gmail.com) may post, and only as
-- itself. Everyone else can sign in, read history and be present, but any
-- insert they attempt is rejected at the database — so the "owner only can
-- send" rule holds even if someone bypasses the client. To reopen posting to
-- all members later, drop the email clause below.
drop policy if exists "members insert their own messages" on public.messages;
drop policy if exists "only the host posts" on public.messages;
create policy "only the host posts"
  on public.messages for insert
  with check (
    auth.uid() = user_id
    and lower(auth.jwt() ->> 'email') = 'prophetdian@gmail.com'
  );

-- Members can delete their OWN messages (nobody else's) — "saved until you
-- delete it".
drop policy if exists "members delete their own messages" on public.messages;
create policy "members delete their own messages"
  on public.messages for delete
  using (auth.uid() = user_id);

-- live message updates for everyone currently viewing a room (guarded so
-- re-running this file never errors on an already-published table)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
