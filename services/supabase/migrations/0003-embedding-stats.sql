-- Read-only helpers for validating Gemini embeddings stored in knowledge_chunks.
-- Adds two RPC functions; no schema changes, no writes.

create or replace function knowledge_embedding_stats(item_id uuid)
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
    from knowledge_chunks
    where knowledge_item_id = item_id
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

create or replace function knowledge_embedding_global()
returns table (
  total_items int,
  items_with_chunks int,
  total_chunks int,
  distinct_dims text,
  null_embeddings int
)
language sql stable as $$
  select
    (select count(*)::int from knowledge_items) as total_items,
    (select count(distinct knowledge_item_id)::int from knowledge_chunks) as items_with_chunks,
    (select count(*)::int from knowledge_chunks) as total_chunks,
    (select array_agg(distinct vector_dims(embedding))::text
       from knowledge_chunks where embedding is not null) as distinct_dims,
    (select count(*)::int from knowledge_chunks where embedding is null) as null_embeddings;
$$;
