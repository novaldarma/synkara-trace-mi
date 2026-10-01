-- Register explicit source column -> KPI provenance after source imports.
-- Safe to rerun; there is one versioned mapping per file and field.
begin;

insert into public.source_field_map
 (dataset_id,source_id,source_sheet,field_path_as_provided,unit_as_provided,
  observation_grain,scope_label,field_meaning,definition_status,kpi_code,caveat)
select s.dataset_id,s.source_id,'Incident Database',m.column_name,m.unit,
       'incident_occurrence_date','historical_12_plant_portfolio',m.meaning,
       'provided',m.kpi,m.caveat
from public.source_catalog s
cross join (values
 ('Serial No','incident','Incident source row identity','case2.incident_count','Use the normalized source row record ID; AR/MTO may duplicate.'),
 ('Downtime (hrs)','hours','Recorded incident downtime','case2.recorded_downtime_hours','RUN_STATUS OFF is not downtime.'),
 ('Act. Loss (k US$)','k USD','Actual loss as provided','case2.actual_loss_kusd','Distinct from potential loss.'),
 ('Pot. Loss (k US$)','k USD','Potential exposure as provided','case2.potential_loss_kusd','Not an achieved saving.')
) as m(column_name,unit,meaning,kpi,caveat)
where s.source_kind='incident' and s.dataset_id='caliber2026_case2'
on conflict do nothing;

insert into public.source_field_map
 (dataset_id,source_id,source_sheet,field_path_as_provided,unit_as_provided,
  observation_grain,scope_label,field_meaning,definition_status,kpi_code,caveat)
select s.dataset_id,s.source_id,'Performance Summary','Availability (%)', '%',
       'full_period_source_summary','five_example_assets_only',
       'Equipment availability as stated in the source summary','provided',
       'case2.equipment_availability_as_provided',
       'Period boundaries have not been confirmed; never treat this as a replay KPI.'
from public.source_catalog s
where s.source_kind='equipment' and s.dataset_id='caliber2026_case2'
on conflict do nothing;

insert into public.source_field_map
 (dataset_id,source_id,source_sheet,field_path_as_provided,unit_as_provided,
  observation_grain,scope_label,field_meaning,definition_status,kpi_code,caveat)
select s.dataset_id,s.source_id,null,'Usage_kWh','kWh',
       '15_minute_source_record','external_steel_2018_backtest',
       'Historical consumption used by the source-order forecast','provided',
       'external_uci.forecast_hour_kwh',
       'Interval meter semantics need confirmation; no connection to Case 2 plant meters.'
from public.source_catalog s
where s.source_kind='external_electricity_history'
  and s.dataset_id='uci_steel_industry_2018_external'
on conflict do nothing;

commit;
