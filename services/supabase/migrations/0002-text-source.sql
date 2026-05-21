-- Add 'text_document' as a knowledge_items.kind, plus a source_format column
-- so we can distinguish audio vs video vs text without overloading kind.
alter table knowledge_items
  drop constraint if exists knowledge_items_kind_check;

alter table knowledge_items
  add constraint knowledge_items_kind_check
  check (kind in ('founder_video','reference_call','text_document'));

alter table knowledge_items
  add column if not exists source_format text
  check (source_format in ('audio','video','text'));

-- Backfill source_format from media_type for existing rows.
update knowledge_items
  set source_format = case
    when media_type in ('mp4','mov','webm','m4v') then 'video'
    when media_type in ('mp3','m4a','wav','aac','flac','ogg') then 'audio'
    when media_type in ('txt','md','pdf') then 'text'
    else 'audio'
  end
where source_format is null;
