-- Slice 4: Global app settings.
-- Singleton table holding admin-tunable runtime config. Today: only the
-- Claude LLM model used for call analysis. The embedding model stays
-- hardcoded (changing it requires a re-embed pass, not a runtime toggle).
--
-- Row identity is fixed: `id = 'global'`. We seed it on migrate. Reads/writes
-- go through services/supabase/queries/app-settings.ts which caches the
-- value for 5 min in-process.

create table if not exists app_settings (
  id text primary key default 'global'
    check (id = 'global'),
  llm_model text not null default 'claude-haiku-4-5-20251001',
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id) on delete set null
);

-- Seed the singleton row if missing. Safe to re-run.
insert into app_settings (id) values ('global')
  on conflict (id) do nothing;

drop trigger if exists trg_app_settings_updated on app_settings;
create trigger trg_app_settings_updated
  before update on app_settings
  for each row execute function set_updated_at();
