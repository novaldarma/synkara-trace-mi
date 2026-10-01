-- Forward-only KPI definition change. Apply through Supabase migration workflow
-- after comparing remote migration history. Never run prior migrations blindly.
begin;

do $$
begin
  if exists (select 1 from public.source_field_map
             where kpi_code = 'external_uci.variable_cost_scenario_rp') then
    raise exception 'Review existing mappings for the legacy Rp scenario before upgrading the KPI';
  end if;
end $$;

update public.kpi_definitions
set kpi_code = 'external_uci.variable_cost_benchmark_usd',
    display_name = 'Indicative 2018 industrial-price electricity cost',
    unit_label = 'US$',
    formula_text = 'SUM(four predicted UCI Usage_kWh) * (106.46 KRW/kWh / 1099.2926 KRW/US$)',
    numerator_text = 'UCI predicted four-interval kWh times 2018 industrial sale price',
    denominator_text = '2018 annual average KRW per US dollar',
    filter_basis = 'UCI historical test cutoff only; national annual benchmarks fixed to 2018',
    limitations = 'National industrial electricity sale price (Korean Energy Agency/KEPCO, https://tips.energy.or.kr/statistics/statistics_view0703.do) converted with US Federal Reserve G.5A 2018 annual exchange rate (https://www.federalreserve.gov/releases/g5a/20210104/). This is not the UCI facility contract, the Case 2 company tariff, a bill or a saving. Interval meaning still requires confirmation.',
    definition_version = 2,
    updated_at = now()
where dataset_id = 'uci_steel_industry_2018_external'
  and kpi_code = 'external_uci.variable_cost_scenario_rp';

-- Also works in a database which was initialized without the legacy row.
insert into public.kpi_definitions
    (kpi_code,dataset_id,display_name,definition_status,unit_label,
     observation_grain,scope_label,formula_text,numerator_text,denominator_text,
     filter_basis,limitations,definition_version)
select 'external_uci.variable_cost_benchmark_usd',
       'uci_steel_industry_2018_external',
       'Indicative 2018 industrial-price electricity cost','team_defined','US$',
       'four_consecutive_15_minute_observations','external_steel_2018_backtest',
       'SUM(four predicted UCI Usage_kWh) * (106.46 KRW/kWh / 1099.2926 KRW/US$)',
       'UCI predicted four-interval kWh times 2018 industrial sale price',
       '2018 annual average KRW per US dollar',
       'UCI historical test cutoff only; national annual benchmarks fixed to 2018',
       '2018 published national annual averages, not the facility contract, company tariff, bill or saving; interval meaning needs confirmation.',2
where exists (select 1 from public.source_catalog where dataset_id = 'uci_steel_industry_2018_external')
on conflict (kpi_code) do nothing;

comment on view public.dashboard_energy_forecasts is
  'External UCI forecasts only. Displayed US$ cost uses separate published 2018 South Korean national industrial-price and annual exchange-rate benchmarks, not a source-facility or Case 2 tariff.';

commit;
