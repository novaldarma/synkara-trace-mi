-- Read-only checks for the project owner's Supabase SQL Editor.
-- Run these only in the intended project. They do not change data or migrations.
select
  (select count(*) from public.source_catalog where dataset_id='caliber2026_case2') as case2_files,
  (select count(*) from public.source_catalog where dataset_id='uci_steel_industry_2018_external') as external_files,
  (select count(*) from public.incident_records where dataset_id='caliber2026_case2') as incident_rows,
  (select count(*) from public.source_field_map where dataset_id='caliber2026_case2') as case2_mapped_fields,
  (select count(*) from public.source_field_map where dataset_id='uci_steel_industry_2018_external') as external_mapped_fields,
  (select count(*) from public.energy_forecast_evaluations) as imported_energy_evaluations,
  to_regprocedure('public.reveal_energy_forecast(text)') is not null as evaluation_rpc_installed,
  to_regprocedure('public.get_action_context_v2(text,text)') is not null as action_context_installed,
  to_regprocedure('public.list_actions_v2(text,text,text,integer)') is not null as action_list_installed,
  to_regprocedure('public.create_action_v2(text,uuid,text,jsonb,text)') is not null as action_create_installed,
  to_regprocedure('public.change_action_v2(uuid,text,integer,uuid,text,jsonb)') is not null as action_change_installed,
  to_regprocedure('public.get_action_v2(uuid)') is not null as action_detail_installed,
  to_regprocedure('public.historical_actions_v2()') is not null as historical_actions_installed;

-- Compare these with 011 before marking its history as applied. Presence
-- alone cannot prove a function's body, constraints or policies match.
select table_name, column_name, data_type from information_schema.columns
where table_schema='public' and (
  (table_name='followup_actions' and column_name in
    ('title','rationale','success_criteria','evidence_snapshot','workflow_version',
     'revision','request_key','review_priority','priority_reason',
     'responsible_function','completion_note','completion_reference',
     'verification_note','verified_by','verified_at')) or
  (table_name='action_events' and column_name in ('request_key','details')))
order by table_name,column_name;

select conrelid::regclass::text as action_table,conname,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in ('public.followup_actions'::regclass,
                   'public.action_events'::regclass)
  and conname in ('action_request_unique','action_v2_fields',
    'followup_actions_status_check','followup_actions_decision_status_check',
    'action_completion_evidence','action_verification_evidence',
    'action_event_request_unique','action_events_event_kind_check')
order by action_table,conname;

select tablename,policyname,cmd,roles,qual from pg_policies
where schemaname='public' and tablename in ('followup_actions','action_events')
  and policyname in ('action_member_read','action_event_member_read')
order by tablename,policyname;

select kpi_code, display_name, unit_label, definition_version, limitations
from public.kpi_definitions
where kpi_code in ('external_uci.variable_cost_scenario_rp','external_uci.variable_cost_benchmark_usd')
order by kpi_code;

select source_kind, relative_path, source_sha256, record_count
from public.source_catalog
order by source_scope,source_kind,relative_path;

-- Use `npx supabase migration list` in the linked CLI project as the
-- authoritative history comparison. SQL Editor execution can leave history
-- out of sync; do not insert into supabase_migrations manually.
