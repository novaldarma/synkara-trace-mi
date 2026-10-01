-- SYNKARA TRACE-MI | 007: invented visitor walkthroughs, draft only.
-- No source row, case asset, AR number, RCA quotation, UCI record or credential
-- is included. The three rows stay invisible to anon until a real reviewer
-- account approves and publishes them in a separate, audited step.
-- Apply after 001-006; do not edit the already-applied migrations.

begin;

insert into public.demo_scenarios
    (scenario_id, title, data_scope, payload, approved_by, published_at)
values
    (
        'synthetic-overview-v1',
        'Overview — fictional maintenance sample',
        'synthetic_public_demo',
        $fixture_overview$
        {
          "schema_version": 1,
          "origin": "synthetic_public_demo",
          "fictional": true,
          "display_notice": "ILLUSTRATIVE DEMO — invented records. No company or competition source data is shown.",
          "scenario_kind": "overview",
          "units": {
            "downtime": "hours",
            "actual_loss": "k USD",
            "potential_loss": "k USD"
          },
          "scope": {
            "plant_labels": ["DEMO-UNIT-A", "DEMO-UNIT-B"],
            "observation_window": "Fictional dates; not the Case 2 observation period"
          },
          "incident_examples": [
            {
              "id": "SYNTH-EVENT-001",
              "plant": "DEMO-UNIT-A",
              "asset": "SYNTH-PUMP-A",
              "date": "2026-02-02",
              "downtime_hours": 3,
              "actual_loss_kusd": 7,
              "potential_loss_kusd": 2,
              "status": "Illustrative review"
            },
            {
              "id": "SYNTH-EVENT-002",
              "plant": "DEMO-UNIT-B",
              "asset": "SYNTH-FAN-B",
              "date": "2026-02-05",
              "downtime_hours": 2,
              "actual_loss_kusd": 4,
              "potential_loss_kusd": 1,
              "status": "Illustrative review"
            }
          ],
          "summary": {
            "incident_count": 2,
            "recorded_downtime_hours": 5,
            "actual_loss_kusd": 11,
            "potential_loss_kusd": 3,
            "detailed_asset_count": 1
          },
          "navigation_hint": "Explore the interactive illustration; sign in as a judge to inspect the supplied Case 2 dataset."
        }
        $fixture_overview$::jsonb,
        null,
        null
    ),
    (
        'synthetic-replay-v1',
        'Condition replay — fictional pump',
        'synthetic_public_demo',
        $fixture_replay$
        {
          "schema_version": 1,
          "origin": "synthetic_public_demo",
          "fictional": true,
          "display_notice": "ILLUSTRATIVE DEMO — fictional time series. These are not equipment readings from Case 2.",
          "scenario_kind": "condition_replay",
          "asset": "SYNTH-PUMP-A",
          "plant": "DEMO-UNIT-A",
          "cutoff": "2026-02-01T23:59:00",
          "measurement_unit": "mm/s (fictional example)",
          "observations_available_by_cutoff": [
            {"timestamp": "2026-01-30T12:00:00", "vibration": 3.1},
            {"timestamp": "2026-01-31T12:00:00", "vibration": 3.8},
            {"timestamp": "2026-02-01T12:00:00", "vibration": 4.2}
          ],
          "pre_cutoff_action": "Illustrative suggestion: inspect the pump and confirm the instrument reading with an engineer.",
          "future_findings": "Unavailable in the public replay payload; use a controlled retrospective route after sign-in.",
          "source_notice": "No historical RCA text or company measurement is embedded in this fixture."
        }
        $fixture_replay$::jsonb,
        null,
        null
    ),
    (
        'synthetic-energy-v1',
        'Energy estimate — fictional intervals',
        'synthetic_public_demo',
        $fixture_energy$
        {
          "schema_version": 1,
          "origin": "synthetic_public_demo",
          "fictional": true,
          "display_notice": "ILLUSTRATIVE DEMO — invented kWh values, not UCI rows or Chandra Asri electricity usage.",
          "scenario_kind": "energy_forecast",
          "source_label": "Invented 15-minute electricity examples for the public walkthrough",
          "forecast_cutoff": "Fictional demonstration timestamp",
          "horizon_minutes": [15, 30, 45, 60],
          "predicted_kwh_by_horizon": [26, 27, 27, 28],
          "predicted_total_kwh_if_interval_interpretation_is_valid": 108,
          "tariff_rp_per_kwh": null,
          "variable_cost_rp": null,
          "cost_rule": "If a visitor chooses an illustrative Rp/kWh tariff, multiply it by the 108 kWh fictional total; never label the result a company bill.",
          "actual_or_accuracy": "Unavailable for the public fiction; the authenticated UCI backtest has separate historical evaluation."
        }
        $fixture_energy$::jsonb,
        null,
        null
    )
on conflict (scenario_id) do nothing;

-- The migration must never publish an unreviewed row, even if it is rerun.
do $$
begin
    if (select count(*) from public.demo_scenarios
        where scenario_id in ('synthetic-overview-v1', 'synthetic-replay-v1',
                              'synthetic-energy-v1')) <> 3
       or exists (
        select 1 from public.demo_scenarios
        where scenario_id in ('synthetic-overview-v1', 'synthetic-replay-v1',
                              'synthetic-energy-v1')
          and (approved_by is not null or published_at is not null
               or payload->>'origin' <> 'synthetic_public_demo'
               or payload->>'fictional' <> 'true')
    ) then
        raise exception 'Public scenario seed verification failed';
    end if;
end;
$$;

commit;
