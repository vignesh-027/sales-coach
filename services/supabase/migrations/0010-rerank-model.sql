-- Slice 5 (Wave 1): admin-tunable reranker model.
--
-- Voyage ships two rerank models (rerank-2.5-lite, rerank-2.5). The picker
-- in Manage Users writes here; workers read via the same 5-min cached
-- getRerankModel() helper that powers getLlmModel().

alter table app_settings
  add column if not exists rerank_model text not null
    default 'rerank-2.5-lite';
