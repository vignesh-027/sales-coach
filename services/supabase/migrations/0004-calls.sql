-- Slice 2: Sales Call ingestion + AI Report schema.
-- One call has N recordings (disconnect/reconnect → multiple files).
-- Each recording is transcribed independently. Once all are done, the call
-- transcripts are embedded into call_chunks and a Claude Haiku analysis
-- produces a structured call_reports row.

create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  call_type text not null
    check (call_type in ('pre_sale','sales_followup','sales_closing')),
  title text not null,
  salesperson_name text not null,
  client_name text not null,
  process_status text not null default 'queued'
    check (process_status in (
      'queued','transcribing','embedding','analyzing','done','failed'
    )),
  process_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists calls_type_idx on calls (call_type, created_at desc);

drop trigger if exists trg_calls_updated on calls;
create trigger trg_calls_updated
  before update on calls
  for each row execute function set_updated_at();

create table if not exists call_recordings (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id) on delete cascade,
  recording_index int not null,
  media_r2_key text not null,
  media_type text not null,
  source_format text not null
    check (source_format in ('audio','video')),
  duration_sec int,
  assemblyai_transcript_id text unique,
  webhook_secret text not null,
  transcribe_status text not null default 'queued'
    check (transcribe_status in ('queued','transcribing','done','failed')),
  transcribe_error text,
  created_at timestamptz not null default now(),
  unique (call_id, recording_index)
);
create index if not exists call_recordings_call_idx
  on call_recordings (call_id, recording_index);
create index if not exists call_recordings_aai_idx
  on call_recordings (assemblyai_transcript_id);

create table if not exists call_transcripts (
  id uuid primary key default gen_random_uuid(),
  call_recording_id uuid not null unique
    references call_recordings(id) on delete cascade,
  full_text text not null,
  segments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists call_chunks (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id) on delete cascade,
  call_recording_id uuid not null references call_recordings(id) on delete cascade,
  chunk_index int not null,
  chunk_text text not null,
  start_ts_ms int,
  end_ts_ms int,
  embedding vector(768) not null,
  created_at timestamptz not null default now(),
  unique (call_id, chunk_index)
);
create index if not exists call_chunks_vec_idx
  on call_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

create table if not exists call_reports (
  call_id uuid primary key references calls(id) on delete cascade,
  model text not null,
  prompt_version int not null,
  report jsonb not null,
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now()
);
