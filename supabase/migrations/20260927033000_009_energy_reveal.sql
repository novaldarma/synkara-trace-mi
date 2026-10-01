-- Let an authenticated member request one historical holdout. The UI first
-- displays the stored forecast; this function does not attest that the user
-- viewed it. Underlying historical readings also remain browsable by members.
begin;

create function public.reveal_energy_forecast(p_forecast_id text)
returns table (
  forecast_id text,
  cutoff_sequence_index integer,
  actual_kwh_by_horizon numeric[],
  actual_hour_kwh_as_provided numeric,
  absolute_hour_total_error_kwh numeric
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_demo_member() then
    raise exception 'Access denied';
  end if;
  return query
    select e.forecast_id, e.cutoff_sequence_index,
           e.actual_kwh_by_horizon, e.actual_hour_kwh_as_provided,
           e.absolute_hour_total_error_kwh
    from public.energy_forecast_evaluations e
    join public.energy_forecasts f on f.forecast_id = e.forecast_id
    where e.forecast_id = p_forecast_id
      and f.dataset_id = 'uci_steel_industry_2018_external'
      and f.data_split = 'test';
end;
$$;

revoke all on function public.reveal_energy_forecast(text) from public, anon;
grant execute on function public.reveal_energy_forecast(text) to authenticated;
comment on function public.reveal_energy_forecast(text) is
  'Authorized retrospective holdout by exact UCI forecast ID; UI presents prediction before reveal, but there is no server attestation of viewing.';
commit;
