-- Slice 1: Knowledge ingestion schema
-- Run against your Supabase project (SQL editor or supabase db push).

create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text,
  phone text,
  role text not null default 'viewer' check (role in ('viewer','admin')),
  created_at timestamptz not null default now()
);

create table if not exists knowledge_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('founder_video','reference_call')),
  title text not null,
  description text,
  media_r2_key text not null,
  media_type text not null,
  duration_sec int,
  process_status text not null default 'queued'
    check (process_status in ('queued','transcribing','embedding','done','failed')),
  process_error text,
  assemblyai_transcript_id text unique,
  webhook_secret text not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists knowledge_items_kind_idx on knowledge_items (kind, created_at desc);
create index if not exists knowledge_items_aai_idx on knowledge_items (assemblyai_transcript_id);

create table if not exists transcripts (
  id uuid primary key default gen_random_uuid(),
  knowledge_item_id uuid not null unique
    references knowledge_items(id) on delete cascade,
  full_text text not null,
  segments jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  knowledge_item_id uuid not null
    references knowledge_items(id) on delete cascade,
  chunk_index int not null,
  chunk_text text not null,
  start_ts_ms int,
  end_ts_ms int,
  embedding vector(768) not null,
  created_at timestamptz not null default now(),
  unique (knowledge_item_id, chunk_index)
);
create index if not exists knowledge_chunks_vec_idx
  on knowledge_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_knowledge_items_updated on knowledge_items;
create trigger trg_knowledge_items_updated
  before update on knowledge_items
  for each row execute function set_updated_at();

create or replace function knowledge_chunks_search(
  query_embedding vector(768),
  match_count int default 5
)
returns table (
  knowledge_item_id uuid,
  chunk_index int,
  chunk_text text,
  distance float
)
language sql stable as $$
  select
    knowledge_item_id,
    chunk_index,
    chunk_text,
    (embedding <=> query_embedding)::float as distance
  from knowledge_chunks
  order by embedding <=> query_embedding
  limit match_count;
$$;
