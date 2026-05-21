-- Extend knowledge_chunks_search with optional kind filter so the analyzer
-- can retrieve only reference_call chunks (founder_video transcripts are
-- always loaded whole as canon).

create or replace function knowledge_chunks_search(
  query_embedding vector(768),
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
