-- Wave 1: switch knowledge_chunks_search from a single-kind filter to a
-- kinds[] filter. The analyze-call worker now wants to pull from
-- founder_video + reference_call + text_document in one go (the old
-- single-kind signature would have required 3 round-trips).

drop function if exists knowledge_chunks_search(vector, int, text);

create or replace function knowledge_chunks_search(
  query_embedding vector(1024),
  match_count int default 5,
  p_kinds text[] default null
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
  where p_kinds is null or i.kind = any(p_kinds)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
