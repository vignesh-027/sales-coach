-- Wave 2: hybrid search — vector + Postgres FTS fused via Reciprocal Rank Fusion.
--
-- Pure vector misses exact-term matches (proper nouns, product names,
-- "state installation"). FTS catches those. RRF (k=60, Cormack et al.) fuses
-- the two rankings without needing a calibrated score scale.
--
-- We add a generated tsvector column + GIN index on both chunk tables and
-- expose two new RPCs:
--   - knowledge_chunks_hybrid_search(query_embedding, query_text, match_count, p_kinds)
--   - call_chunks_hybrid_search(query_embedding, query_text, match_count, p_call_id)
--
-- The old knowledge_chunks_search RPC stays in place (some scripts still use
-- it) but new code paths should use the hybrid variant.

-- ---------- knowledge_chunks ----------

alter table knowledge_chunks
  add column if not exists tsv tsvector
    generated always as (to_tsvector('english', chunk_text)) stored;

create index if not exists knowledge_chunks_tsv_idx
  on knowledge_chunks using gin (tsv);

drop function if exists knowledge_chunks_hybrid_search(vector, text, int, text[]);

create or replace function knowledge_chunks_hybrid_search(
  query_embedding vector(1024),
  query_text text,
  match_count int default 50,
  p_kinds text[] default null
)
returns table (
  knowledge_item_id uuid,
  chunk_index int,
  chunk_text text,
  start_ts_ms int,
  end_ts_ms int,
  distance float,
  vector_rank int,
  fts_rank int,
  fused_score float
)
language sql stable as $$
  with
  pool as (
    select c.id, c.knowledge_item_id, c.chunk_index, c.chunk_text,
           c.start_ts_ms, c.end_ts_ms, c.embedding, c.tsv
    from knowledge_chunks c
    join knowledge_items i on i.id = c.knowledge_item_id
    where p_kinds is null or i.kind = any(p_kinds)
  ),
  vec as (
    select id, knowledge_item_id, chunk_index, chunk_text,
           start_ts_ms, end_ts_ms,
           (embedding <=> query_embedding)::float as distance,
           row_number() over (order by embedding <=> query_embedding) as r
    from pool
    order by embedding <=> query_embedding
    limit greatest(match_count * 3, 50)
  ),
  fts as (
    select id, knowledge_item_id, chunk_index, chunk_text,
           start_ts_ms, end_ts_ms,
           row_number() over (
             order by ts_rank(tsv, plainto_tsquery('english', query_text)) desc
           ) as r
    from pool
    where tsv @@ plainto_tsquery('english', query_text)
    order by ts_rank(tsv, plainto_tsquery('english', query_text)) desc
    limit greatest(match_count * 3, 50)
  ),
  merged as (
    select
      coalesce(vec.id, fts.id) as id,
      coalesce(vec.knowledge_item_id, fts.knowledge_item_id) as knowledge_item_id,
      coalesce(vec.chunk_index, fts.chunk_index) as chunk_index,
      coalesce(vec.chunk_text, fts.chunk_text) as chunk_text,
      coalesce(vec.start_ts_ms, fts.start_ts_ms) as start_ts_ms,
      coalesce(vec.end_ts_ms, fts.end_ts_ms) as end_ts_ms,
      vec.distance,
      vec.r as vector_rank,
      fts.r as fts_rank,
      coalesce(1.0 / (60 + vec.r), 0) + coalesce(1.0 / (60 + fts.r), 0)
        as fused_score
    from vec
    full outer join fts on vec.id = fts.id
  )
  select knowledge_item_id, chunk_index, chunk_text, start_ts_ms, end_ts_ms,
         distance,
         coalesce(vector_rank, 0)::int as vector_rank,
         coalesce(fts_rank, 0)::int as fts_rank,
         fused_score
  from merged
  order by fused_score desc
  limit match_count;
$$;

-- ---------- call_chunks ----------

alter table call_chunks
  add column if not exists tsv tsvector
    generated always as (to_tsvector('english', chunk_text)) stored;

create index if not exists call_chunks_tsv_idx
  on call_chunks using gin (tsv);

drop function if exists call_chunks_hybrid_search(vector, text, int, uuid);

create or replace function call_chunks_hybrid_search(
  query_embedding vector(1024),
  query_text text,
  match_count int default 50,
  p_call_id uuid default null
)
returns table (
  call_id uuid,
  call_recording_id uuid,
  chunk_index int,
  chunk_text text,
  start_ts_ms int,
  end_ts_ms int,
  distance float,
  vector_rank int,
  fts_rank int,
  fused_score float
)
language sql stable as $$
  with
  pool as (
    select c.id, c.call_id, c.call_recording_id, c.chunk_index, c.chunk_text,
           c.start_ts_ms, c.end_ts_ms, c.embedding, c.tsv
    from call_chunks c
    where p_call_id is null or c.call_id = p_call_id
  ),
  vec as (
    select id, call_id, call_recording_id, chunk_index, chunk_text,
           start_ts_ms, end_ts_ms,
           (embedding <=> query_embedding)::float as distance,
           row_number() over (order by embedding <=> query_embedding) as r
    from pool
    order by embedding <=> query_embedding
    limit greatest(match_count * 3, 50)
  ),
  fts as (
    select id, call_id, call_recording_id, chunk_index, chunk_text,
           start_ts_ms, end_ts_ms,
           row_number() over (
             order by ts_rank(tsv, plainto_tsquery('english', query_text)) desc
           ) as r
    from pool
    where tsv @@ plainto_tsquery('english', query_text)
    order by ts_rank(tsv, plainto_tsquery('english', query_text)) desc
    limit greatest(match_count * 3, 50)
  ),
  merged as (
    select
      coalesce(vec.id, fts.id) as id,
      coalesce(vec.call_id, fts.call_id) as call_id,
      coalesce(vec.call_recording_id, fts.call_recording_id) as call_recording_id,
      coalesce(vec.chunk_index, fts.chunk_index) as chunk_index,
      coalesce(vec.chunk_text, fts.chunk_text) as chunk_text,
      coalesce(vec.start_ts_ms, fts.start_ts_ms) as start_ts_ms,
      coalesce(vec.end_ts_ms, fts.end_ts_ms) as end_ts_ms,
      vec.distance,
      vec.r as vector_rank,
      fts.r as fts_rank,
      coalesce(1.0 / (60 + vec.r), 0) + coalesce(1.0 / (60 + fts.r), 0)
        as fused_score
    from vec
    full outer join fts on vec.id = fts.id
  )
  select call_id, call_recording_id, chunk_index, chunk_text,
         start_ts_ms, end_ts_ms,
         distance,
         coalesce(vector_rank, 0)::int as vector_rank,
         coalesce(fts_rank, 0)::int as fts_rank,
         fused_score
  from merged
  order by fused_score desc
  limit match_count;
$$;
