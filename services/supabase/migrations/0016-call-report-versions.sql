-- Version history for call_reports.
--
-- call_reports keeps only the LATEST analysis (PK = call_id, upserted on every
-- run). This table keeps EVERY analysis as an append-only snapshot so the UI can
-- show "N versions" and we can audit how a report changed across re-analyses.
--
-- Write rule (enforced in upsertCallReport): every analysis writes one row here.
--   - First analysis   → version_no = 1
--   - n-th re-analysis → version_no = n
-- So version_no == total number of analyses for the call.

create table if not exists call_report_versions (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id) on delete cascade,
  version_no int not null,
  model text not null,
  prompt_version int not null,
  report jsonb not null,
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now(),
  unique (call_id, version_no)
);

-- "latest version" / "count per call" lookups for observability.
create index if not exists call_report_versions_call_idx
  on call_report_versions (call_id, version_no desc);
