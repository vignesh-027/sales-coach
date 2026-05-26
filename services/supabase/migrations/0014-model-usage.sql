-- Unified per-call model usage ledger.
--
-- Replaces the three disconnected places usage lives today:
--   voyage_usage           — embed/rerank tokens
--   call_reports.in/out    — Claude tokens (one row per call)
--   AssemblyAI             — not tracked at all (the bug)
--
-- New shape: one row per model invocation, all providers, with a (scope, scope_id)
-- pair so calls and knowledge items can be drilled into without joining 3 tables.
--
-- Stage 1: additive only. voyage_usage and call_reports stay intact. Writers
-- start writing only to model_usage. After verification (see the plan), 0015
-- drops the legacy table and columns.

create table if not exists model_usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  provider text not null check (provider in ('voyage','anthropic','assemblyai')),
  kind     text not null check (kind in ('embed','rerank','llm','transcribe')),
  model    text not null,

  -- token-based providers (voyage embed/rerank, anthropic llm)
  input_tokens  int,
  output_tokens int,
  tokens        int,  -- denormalized total for fast monthly sums

  -- duration-based providers (assemblyai)
  duration_sec int,

  cost_usd numeric(12, 6) not null default 0,

  scope    text,   -- 'analyze_call' | 'ingest_call' | 'ingest_knowledge'
                   -- | 'knowledge_search' | 'transcribe_call' | 'transcribe_knowledge'
  scope_id uuid    -- call_id or knowledge_item_id
);

create index if not exists model_usage_created_idx
  on model_usage (created_at desc);

create index if not exists model_usage_provider_model_idx
  on model_usage (provider, model, created_at desc);

create index if not exists model_usage_scope_idx
  on model_usage (scope, scope_id);

-- Composite (created_at, provider, model) for per-month rollups. We do NOT
-- index date_trunc('month', created_at) directly because date_trunc on
-- timestamptz is STABLE (timezone-dependent), not IMMUTABLE, so Postgres
-- rejects it as an expression-index key. The /observability queries filter
-- with `created_at >= :from AND created_at < :to` — a range scan against this
-- composite is just as fast.
create index if not exists model_usage_created_provider_model_idx
  on model_usage (created_at desc, provider, model);

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) voyage_usage → model_usage (1:1)
insert into model_usage (created_at, provider, kind, model, tokens, cost_usd, scope, scope_id)
select
  created_at,
  'voyage',
  kind,
  model,
  tokens,
  cost_usd,
  scope,
  scope_id
from voyage_usage;

-- 2) call_reports → model_usage (anthropic / llm). Cost computed from the
--    pricing table in services/anthropic/models.ts; unknown models cost 0.
insert into model_usage (
  created_at, provider, kind, model,
  input_tokens, output_tokens, tokens,
  cost_usd, scope, scope_id
)
select
  cr.created_at,
  'anthropic',
  'llm',
  cr.model,
  coalesce(cr.input_tokens, 0),
  coalesce(cr.output_tokens, 0),
  coalesce(cr.input_tokens, 0) + coalesce(cr.output_tokens, 0),
  -- input_cost + output_cost
  (coalesce(cr.input_tokens, 0) * case cr.model
      when 'claude-haiku-4-5-20251001'   then 1.0
      when 'claude-sonnet-4-5-20250929'  then 3.0
      when 'claude-opus-4-1-20250805'    then 15.0
      else 0
    end / 1000000.0)
  + (coalesce(cr.output_tokens, 0) * case cr.model
      when 'claude-haiku-4-5-20251001'   then 5.0
      when 'claude-sonnet-4-5-20250929'  then 15.0
      when 'claude-opus-4-1-20250805'    then 75.0
      else 0
    end / 1000000.0),
  'analyze_call',
  cr.call_id
from call_reports cr
where cr.input_tokens is not null or cr.output_tokens is not null;

-- 3) Call recordings with completed AssemblyAI transcripts. Universal-2 list
--    price is $0.27/hour → $0.000075/sec. Older rows without duration_sec
--    are skipped (we don't have enough info to estimate).
insert into model_usage (
  created_at, provider, kind, model,
  duration_sec, cost_usd, scope, scope_id
)
select
  r.created_at,
  'assemblyai',
  'transcribe',
  'universal-2',
  r.duration_sec,
  (r.duration_sec * 0.27 / 3600.0),
  'transcribe_call',
  r.call_id
from call_recordings r
where r.assemblyai_transcript_id is not null
  and r.duration_sec is not null;

-- 4) Knowledge items transcribed via AssemblyAI.
insert into model_usage (
  created_at, provider, kind, model,
  duration_sec, cost_usd, scope, scope_id
)
select
  k.created_at,
  'assemblyai',
  'transcribe',
  'universal-2',
  k.duration_sec,
  (k.duration_sec * 0.27 / 3600.0),
  'transcribe_knowledge',
  k.id
from knowledge_items k
where k.assemblyai_transcript_id is not null
  and k.duration_sec is not null;
