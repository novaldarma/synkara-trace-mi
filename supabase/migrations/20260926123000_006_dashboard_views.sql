-- SYNKARA TRACE-MI | 006: source-aware dashboard projections.
-- Apply after 001-005. All views use the CALLER's RLS permissions (Postgres 15+).
-- No visitor/anon grant: public visitors see only published synthetic fixtures
-- from demo_scenarios; source-backed dashboards require demo membership.

begin;

-- One incident is one source record. Summaries are grouped only by the
-- supplied occurrence date and plant, so UI filtering changes every total.
-- Actual and potential losses are never conflated or double counted through
-- Equipment Performance Summary or the source workbook Dashboard sheet.
create view public.dashboard_incident_daily
with (security_invoker = true) as
select
    i.occurred_date,
    i.plant_code,
    count(*)::integer as incident_count,
    coalesce(sum(i.downtime_hours), 0)::numeric(18, 3)
        as recorded_incident_downtime_hours,
    coalesce(sum(i.actual_loss_kusd), 0)::numeric(20, 4)
        as actual_loss_kusd,
    coalesce(sum(i.potential_loss_kusd), 0)::numeric(20, 4)
        as potential_loss_kusd
from public.incident_records i
group by i.occurred_date, i.plant_code;

comment on view public.dashboard_incident_daily is
  'Incident source rows only; kUSD is thousands of US dollars. Status is a present-file snapshot, not a past as-of status. Filter dates and plant before summing in UI.';

-- The original asset tag and source ID stay visible for drilldown. Do not
-- assume a missing asset_id means no incident or no asset in the plant.
create view public.dashboard_incident_assets
with (security_invoker = true) as
select
    i.occurred_date,
    i.plant_code,
    i.asset_tag_as_provided,
    i.asset_id,
    count(*)::integer as incident_count,
    coalesce(sum(i.downtime_hours), 0)::numeric(18, 3)
        as recorded_incident_downtime_hours,
    coalesce(sum(i.actual_loss_kusd), 0)::numeric(20, 4)
        as actual_loss_kusd,
    coalesce(sum(i.potential_loss_kusd), 0)::numeric(20, 4)
        as potential_loss_kusd
from public.incident_records i
group by i.occurred_date, i.plant_code, i.asset_tag_as_provided, i.asset_id;

comment on view public.dashboard_incident_assets is
  'Daily asset summary; filter occurrence date and plant before summing. Original asset tags may not map to a registered asset_id.';

-- Each row is one tag observation, NOT one hourly observation. Production
-- rate and status come from their own source file and are not aggregated
-- across instruments with different units or across plants.
create view public.dashboard_production_signals
with (security_invoker = true) as
select
    r.record_id as production_record_id,
    r.source_id,
    r.plant_code,
    r.asset_id,
    r.observed_at_raw,
    r.observed_at_naive,
    v.tag_name,
    v.raw_value,
    v.numeric_value,
    v.text_value,
    v.engineering_unit_as_provided,
    r.time_grain
from public.production_records r
join public.production_values v
  on v.production_record_id = r.record_id and v.source_id = r.source_id;

comment on view public.dashboard_production_signals is
  'One signal per asset and source hour; never count view rows as hours or sum a reused tag name across files.';

-- Condition History is weekly; a NULL source available_at is unknown, not
-- evidence that it was available at the beginning of its observation day.
create view public.dashboard_equipment_conditions
with (security_invoker = true) as
select
    e.record_id as observation_id,
    e.source_id,
    e.plant_code,
    e.asset_id,
    e.observed_date,
    e.observed_time,
    e.available_at,
    e.health_status_as_provided,
    e.measurements,
    e.time_grain
from public.equipment_observations e;

comment on view public.dashboard_equipment_conditions is
  'Historical condition observations, one weekly row per asset/date. Replay must call replay_equipment_condition with a cutoff.';

-- Supplied KPI values are full-period retrospective, not computed from 26
-- weekly observations. In particular, their loss must not be added to the
-- incident loss already reported by dashboard_incident_daily.
create view public.dashboard_equipment_kpis_as_provided
with (security_invoker = true) as
select
    s.record_id as source_kpi_record_id,
    s.source_id,
    s.plant_code,
    s.asset_id,
    s.kpi_name_as_provided,
    s.value_as_provided,
    s.basis_as_provided,
    s.time_scope
from public.equipment_summary_values s;

comment on view public.dashboard_equipment_kpis_as_provided is
  'Supplied full-period snapshot; never use as an as-of KPI or add its Estimated Loss to incident portfolio loss.';

-- Only source-verified incident/RCA links. Document availability is unknown;
-- this view is for retrospective inspection, never for pre-event replay.
create view public.dashboard_rca_links_retrospective
with (security_invoker = true) as
select
    l.link_id,
    l.incident_record_id,
    l.asset_id,
    l.rca_document_id,
    l.match_status,
    l.evidence_locator,
    d.source_file,
    d.visual_review_status,
    d.reported_date,
    d.available_at
from public.case_links l
join public.rca_documents d on d.document_id = l.rca_document_id
where l.relation_kind = 'incident_rca' and l.match_status = 'verified';

comment on view public.dashboard_rca_links_retrospective is
  'Verified link identity only. RCA text or visual evidence must still be checked slide by slide before quotation.';

-- A stored forecast is tied to its exact cutoff and model run. No actual
-- evaluation columns are exposed here; use a separate authorized reveal.
-- Energy scope is external 2018 steel data, with no join to Case 2 plants.
create view public.dashboard_energy_forecasts
with (security_invoker = true) as
select
    f.forecast_id,
    f.dataset_id,
    f.source_scope,
    f.model_run_id,
    m.model_version,
    m.selected_baseline,
    m.test_cutoff_count,
    f.source_id,
    f.cutoff_sequence_index,
    f.cutoff_timestamp_derived_naive,
    f.input_start_sequence_index,
    f.input_end_sequence_index,
    f.target_timestamps_derived_naive,
    f.horizon_minutes,
    f.predicted_kwh_by_horizon,
    f.predicted_hour_kwh_as_provided,
    m.interval_semantics_status
from public.energy_forecasts f
join public.energy_model_runs m
  on m.model_run_id = f.model_run_id and m.source_id = f.source_id;

comment on view public.dashboard_energy_forecasts is
  'External UCI forecast only. Cost and any IDR-to-USD display conversion are labeled user scenarios computed separately; no company electricity KPI is inferred.';

-- This SECURITY INVOKER function returns only allowed historical weekly
-- condition rows for one asset. A weekly row on the cutoff day is assumed
-- available at the end of that day, never at the start of the day.
create function public.replay_equipment_condition(
    p_asset_id text, p_as_of timestamp without time zone
) returns table (
    observation_id text,
    source_id text,
    plant_code text,
    asset_id text,
    observed_date date,
    health_status_as_provided text,
    measurements jsonb,
    availability_assumption text
) language sql stable security invoker
set search_path = ''
as $$
    select e.record_id, e.source_id, e.plant_code, e.asset_id,
           e.observed_date, e.health_status_as_provided, e.measurements,
           'end_of_observation_day_team_assumption'::text
    from public.equipment_observations e
    where e.asset_id = p_asset_id
      and p_asset_id is not null and p_as_of is not null
      and (e.observed_date < p_as_of::date
           or (e.observed_date = p_as_of::date
               and p_as_of::time >= time '23:59:00'))
    order by e.observed_date, e.record_id;
$$;

comment on function public.replay_equipment_condition(text, timestamp) is
  'Cutoff uses a documented end-of-day assumption for weekly observations; does not return post-event metadata, RCA, or full-period Equipment Summary.';

create function public.replay_production_signals(
    p_asset_id text, p_as_of timestamp without time zone
) returns table (
    production_record_id text,
    source_id text,
    plant_code text,
    asset_id text,
    observed_at_naive timestamp without time zone,
    tag_name text,
    numeric_value numeric,
    text_value text,
    engineering_unit_as_provided text
) language sql stable security invoker
set search_path = ''
as $$
    select r.record_id, r.source_id, r.plant_code, r.asset_id,
           r.observed_at_naive, v.tag_name, v.numeric_value, v.text_value,
           v.engineering_unit_as_provided
    from public.production_records r
    join public.production_values v
      on v.production_record_id = r.record_id and v.source_id = r.source_id
    where r.asset_id = p_asset_id
      and p_asset_id is not null and p_as_of is not null
      and r.observed_at_naive <= p_as_of
    order by r.observed_at_naive, r.record_id, v.tag_name;
$$;

comment on function public.replay_production_signals(text, timestamp) is
  'Returns Production observations only through cutoff, with original source units and no inferred Equipment/incident joins.';

-- Views are for authenticated, enrolled demo members; anonymous visitors
-- receive no grants on these views. The underlying RLS remains active.
revoke all on public.dashboard_incident_daily,
    public.dashboard_incident_assets, public.dashboard_production_signals,
    public.dashboard_equipment_conditions,
    public.dashboard_equipment_kpis_as_provided,
    public.dashboard_rca_links_retrospective,
    public.dashboard_energy_forecasts from public, anon, authenticated;

grant select on public.dashboard_incident_daily,
    public.dashboard_incident_assets, public.dashboard_production_signals,
    public.dashboard_equipment_conditions,
    public.dashboard_equipment_kpis_as_provided,
    public.dashboard_rca_links_retrospective,
    public.dashboard_energy_forecasts to authenticated;

revoke all on function public.replay_equipment_condition(text, timestamp)
    from public, anon;
grant execute on function public.replay_equipment_condition(text, timestamp)
    to authenticated;
revoke all on function public.replay_production_signals(text, timestamp)
    from public, anon;
grant execute on function public.replay_production_signals(text, timestamp)
    to authenticated;

commit;
