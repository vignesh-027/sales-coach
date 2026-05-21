-- Migrate embedding dimension 768 (Gemini) -> 1024 (Voyage voyage-4-large).
--
-- pgvector cannot ALTER a vector column's dimension in place, and the existing
-- 768-d data is meaningless under the new model anyway. We wipe both chunk
-- tables, drop dependent indexes + RPCs, change the column type, then recreate
-- the index and RPC with the new dimension.
--
-- Source items (knowledge_items, calls, call_recordings, transcripts) are
-- preserved. Run `scripts/voyage-reembed-all.ts` after applying this migration
-- to refill the chunk tables.

begin;

-- 1. Drop dependent index + RPC before changing the column type.
drop index if exists knowledge_chunks_vec_idx;
drop index if exists call_chunks_vec_idx;
drop function if exists knowledge_chunks_search(vector, int, text);
drop function if exists knowledge_chunks_search(vector, int);

-- 2. Wipe existing 768-d rows. Source items keep their `done` status; they'll
-- repopulate via the bulk re-embed script.
truncate table knowledge_chunks;
truncate table call_chunks;

-- 3. Change column dimension on both chunk tables.
alter table knowledge_chunks
  alter column embedding type vector(1024);
alter table call_chunks
  alter column embedding type vector(1024);

-- 4. Recreate IVFFlat indexes at the new dim.
create index knowledge_chunks_vec_idx
  on knowledge_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index call_chunks_vec_idx
  on call_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

-- 5. Recreate the search RPC at the new dim, preserving the kind filter
-- signature added in 0006.
create or replace function knowledge_chunks_search(
  query_embedding vector(1024),
  match_count int default 5,
  p_kind text default null
)
returns table (
  knowledge_item_id uuid,
  chunk_index int,
  chunk_text text,
  start_ts_ms int,
  end_ts_ms int,
  distance float
)
language sql stable as $$
  select
    c.knowledge_item_id,
    c.chunk_index,
    c.chunk_text,
    c.start_ts_ms,
    c.end_ts_ms,
    (c.embedding <=> query_embedding)::float as distance
  from knowledge_chunks c
  join knowledge_items i on i.id = c.knowledge_item_id
  where p_kind is null or i.kind = p_kind
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

commit;
