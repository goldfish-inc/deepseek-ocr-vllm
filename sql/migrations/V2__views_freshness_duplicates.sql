-- V2: Operational views for freshness and duplicates + mapping helper

-- Per-source freshness and duplicates count
create or replace view stage.v_documents_freshness as
select
  coalesce(s.name, 'unknown') as source_name,
  count(*) as documents,
  max(d.collected_at) as latest_collected_at,
  now() - max(d.collected_at) as freshness_lag,
  count(distinct d.content_sha) as distinct_docs,
  count(*) - count(distinct d.content_sha) as duplicate_count
from stage.documents d
left join control.sources s on s.id = d.source_id
group by coalesce(s.name, 'unknown');

-- Duplicate documents by content_sha
create or replace view stage.v_duplicates as
with dup as (
  select content_sha, count(*) as c
  from stage.documents
  where content_sha is not null and content_sha <> ''
  group by content_sha
  having count(*) > 1
)
select d.*
from stage.documents d
join dup on dup.content_sha = d.content_sha
order by d.content_sha, d.id;

-- Map stage.extractions to target table/column when db_mapping present
create or replace view curated.v_extractions_mapped as
select
  e.id,
  e.document_id,
  e.label,
  e.value,
  e.start,
  e."end",
  e.confidence,
  e.db_mapping,
  split_part(e.db_mapping, '.', 1) as target_schema,
  split_part(e.db_mapping, '.', 2) as target_table,
  split_part(e.db_mapping, '.', 3) as target_column,
  e.annotator,
  e.updated_at
from stage.extractions e
where e.db_mapping is not null and e.db_mapping <> '';

