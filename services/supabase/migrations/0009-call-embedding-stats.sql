-- Read-only validation helper for Voyage embeddings stored in call_chunks.
-- Mirrors the knowledge_embedding_stats() RPC from 0003.

create or replace function call_embedding_stats(call_id_in uuid)
returns table (
  chunks_total int,
  chunks_with_embedding int,
  embedding_dims int,
  min_norm float,
  max_norm float,
  avg_norm float,
  duplicate_indexes int
)
language sql stable as $$
  with c as (
    select
      chunk_index,
      embedding,
      sqrt((embedding <#> embedding) * -1) as norm,
      vector_dims(embedding) as dims
    from call_chunks
    where call_id = call_id_in
  )
  select
    count(*)::int as chunks_total,
    count(*) filter (where embedding is not null)::int as chunks_with_embedding,
    max(dims)::int as embedding_dims,
    min(norm)::float as min_norm,
    max(norm)::float as max_norm,
    avg(norm)::float as avg_norm,
    (count(*) - count(distinct chunk_index))::int as duplicate_indexes
  from c;
$$;
