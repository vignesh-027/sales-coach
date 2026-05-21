-- Wave 3: observability — capture Voyage token usage + per-analysis retrieval
-- snapshots so retrieval quality can be measured instead of inferred.
--
-- voyage_usage: one row per Voyage API call (embed or rerank). Used by the
--               global /admin/observability page for token + cost rollups.
-- call_analysis_inputs: one row per call analysis with the full retrieval
--               funnel + the chunks Claude actually saw. Drives the per-call
--               and per-knowledge insets.

create table if not exists voyage_usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('embed', 'rerank')),
  model text not null,
  tokens int not null,
  cost_usd numeric(12, 6) not null default 0,
  scope text,     -- 'analyze_call' | 'knowledge_search' | 'ingest_call' | 'ingest_knowledge' | etc.
  scope_id uuid   -- the call_id or knowledge_item_id when known
);

create index if not exists voyage_usage_created_idx
  on voyage_usage (created_at desc);
create index if not exists voyage_usage_scope_idx
  on voyage_usage (scope, scope_id);

create table if not exists call_analysis_inputs (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id) on delete cascade,
  created_at timestamptz not null default now(),
  query_text text,
  vector_hits int not null default 0,
  fts_hits int not null default 0,
  fused_candidates int not null default 0,
  rerank_kept int not null default 0,
  rerank_dropped int not null default 0,
  rerank_fallback_used boolean not null default false,
  rerank_model text,
  -- [{ source, chunk_id?, parent_id, parent_title, snippet,
  --    vector_rank, fts_rank, fused_score, rerank_score, kept }]
  retrieved_chunks jsonb not null default '[]'::jsonb
);

create index if not exists call_analysis_inputs_call_idx
  on call_analysis_inputs (call_id, created_at desc);
create index if not exists call_analysis_inputs_created_idx
  on call_analysis_inputs (created_at desc);

-- Knowledge-item usage rollup: how often each item's chunks appeared in
-- analyses, and whether they survived the reranker.
create or replace view knowledge_item_usage_v as
  select
    (chunk->>'parent_id')::uuid as knowledge_item_id,
    count(*) as appearances,
    count(*) filter (where (chunk->>'kept')::boolean) as kept_count,
    count(*) filter (where not (chunk->>'kept')::boolean) as dropped_count,
    max(cai.created_at) as last_used_at
  from call_analysis_inputs cai
  cross join lateral jsonb_array_elements(cai.retrieved_chunks) as chunk
  where chunk->>'source' = 'knowledge'
    and chunk->>'parent_id' is not null
  group by 1;
