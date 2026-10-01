-- SYNKARA TRACE-MI | 003: external UCI steel electricity backtest.
-- Apply AFTER 001 and 002. This migration does not import data or assign
-- Chandra Asri plant IDs to the external source. Later imports must verify
-- prepared manifests and hashes, then load source_catalog before these rows.
-- Source times are NAIVE; the source has no verified timezone. A final 00:00
-- on each labelled date is shifted ONLY in the separately marked derived time.

begin;

create table public.energy_readings (
    record_id text primary key,
    dataset_id text not null default 'uci_steel_industry_2018_external'
        check (dataset_id = 'uci_steel_industry_2018_external'),
    source_id text not null,
    source_sha256 text not null,
    source_file text not null,
    source_csv_row integer not null check (source_csv_row >= 2),
    sequence_index integer not null check (sequence_index between 1 and 35040),
    source_time_label_raw text not null,
    source_date_label date not null,
    timestamp_derived_naive timestamp without time zone not null,
    time_derivation text not null check (
        time_derivation in ('source_label_unchanged',
                            'source_00_00_at_end_of_day_shifted_to_next_day')
    ),
    timestamp_derivation_is_inference boolean not null,
    time_grain_as_provided text not null default '15_minute_record'
        check (time_grain_as_provided = '15_minute_record'),
    unit_usage text not null default 'kWh' check (unit_usage = 'kWh'),
    usage_kwh numeric(18, 6) not null check (usage_kwh >= 0),
    numeric_fields_for_historical_inspection jsonb not null
        check (jsonb_typeof(numeric_fields_for_historical_inspection) = 'object'),
    source_fields_raw jsonb not null
        check (jsonb_typeof(source_fields_raw) = 'object'),
    calendar_features_derived jsonb not null
        check (jsonb_typeof(calendar_features_derived) = 'object'),
    future_target_feature_policy text not null,
    source_scope text not null default 'external_steel_industry_south_korea_2018'
        check (source_scope = 'external_steel_industry_south_korea_2018'),
    imported_at timestamptz not null default now(),
    constraint energy_readings_source_fk foreign key
        (source_id, source_sha256, dataset_id)
        references public.source_catalog(source_id, source_sha256, dataset_id),
    constraint energy_readings_csv_order_check check (source_csv_row = sequence_index + 1),
    constraint energy_readings_midnight_inference_check check (
        timestamp_derivation_is_inference =
            (time_derivation = 'source_00_00_at_end_of_day_shifted_to_next_day')
    ),
    constraint energy_readings_source_sequence_unique unique (source_id, sequence_index),
    constraint energy_readings_source_csv_row_unique unique (source_id, source_csv_row),
    constraint energy_readings_derived_time_unique unique (source_id, timestamp_derived_naive)
);

create index energy_readings_source_time_idx
    on public.energy_readings (source_id, timestamp_derived_naive);

comment on table public.energy_readings is
  '2018 South Korea steel facility only; no foreign key or numeric join to Case 2 plant/production/incident.';
comment on column public.energy_readings.timestamp_derived_naive is
  'Source-order time inference for display/backtest; never overwrite raw label or claim a verified meter timestamp.';
comment on column public.energy_readings.numeric_fields_for_historical_inspection is
  'As-provided CO2 and power factors retained for source inspection, not future target features or company emissions.';

create table public.energy_model_runs (
    model_run_id text primary key,
    dataset_id text not null default 'uci_steel_industry_2018_external'
        check (dataset_id = 'uci_steel_industry_2018_external'),
    source_id text not null,
    source_sha256 text not null,
    prepared_readings_sha256 text not null
        check (prepared_readings_sha256 ~ '^[0-9a-f]{64}$'),
    model_version text not null,
    selected_baseline text not null
        check (selected_baseline in ('last_observation', 'same_time_previous_day')),
    selection_metric text not null default 'validation_mae_kwh_per_interval_all_horizons',
    feature_policy text not null default 'past_Usage_kWh_only',
    train_start_sequence_index integer not null default 1 check (train_start_sequence_index = 1),
    train_end_sequence_index integer not null,
    validation_start_sequence_index integer not null,
    validation_end_sequence_index integer not null,
    test_start_sequence_index integer not null,
    test_end_sequence_index integer not null,
    test_cutoff_count integer not null check (test_cutoff_count > 0),
    validation_baselines jsonb not null
        check (jsonb_typeof(validation_baselines) = 'object'),
    test_baselines jsonb not null
        check (jsonb_typeof(test_baselines) = 'object'),
    interval_semantics_status text not null default 'assumption_needs_source_confirmation'
        check (interval_semantics_status = 'assumption_needs_source_confirmation'),
    source_scope text not null default 'external_steel_industry_south_korea_2018'
        check (source_scope = 'external_steel_industry_south_korea_2018'),
    generated_at_utc timestamptz not null,
    imported_at timestamptz not null default now(),
    constraint energy_model_runs_source_fk foreign key
        (source_id, source_sha256, dataset_id)
        references public.source_catalog(source_id, source_sha256, dataset_id),
    constraint energy_model_runs_order_check check (
        train_end_sequence_index >= train_start_sequence_index
        and validation_start_sequence_index = train_end_sequence_index + 1
        and validation_end_sequence_index >= validation_start_sequence_index
        and test_start_sequence_index = validation_end_sequence_index + 1
        and test_end_sequence_index >= test_start_sequence_index
        and test_end_sequence_index <= 35040
        and test_cutoff_count = test_end_sequence_index - test_start_sequence_index - 2
    ),
    constraint energy_model_runs_id_source_unique unique (model_run_id, source_id),
    constraint energy_model_runs_method_once_per_source unique
        (source_id, prepared_readings_sha256, model_version, selected_baseline)
);

comment on table public.energy_model_runs is
  'Baseline chosen on validation; all reported TEST metrics are held out chronologically.';
comment on column public.energy_model_runs.feature_policy is
  'Future CO2, Load_Type and power factor values are excluded from forecasting inputs.';

create table public.energy_forecasts (
    forecast_id text primary key,
    dataset_id text not null default 'uci_steel_industry_2018_external'
        check (dataset_id = 'uci_steel_industry_2018_external'),
    model_run_id text not null,
    source_id text not null,
    cutoff_sequence_index integer not null,
    cutoff_timestamp_derived_naive timestamp without time zone not null,
    input_start_sequence_index integer not null,
    input_end_sequence_index integer not null,
    input_start_timestamp_derived_naive timestamp without time zone not null,
    input_end_timestamp_derived_naive timestamp without time zone not null,
    target_start_sequence_index integer not null,
    target_end_sequence_index integer not null,
    target_timestamps_derived_naive timestamp without time zone[] not null,
    horizon_minutes integer[] not null default array[15, 30, 45, 60]
        check (horizon_minutes = array[15, 30, 45, 60]),
    predicted_kwh_by_horizon numeric(18, 6)[] not null,
    predicted_hour_kwh_as_provided numeric(18, 6) not null
        check (predicted_hour_kwh_as_provided >= 0),
    data_split text not null default 'test' check (data_split = 'test'),
    source_scope text not null default 'external_steel_industry_south_korea_2018'
        check (source_scope = 'external_steel_industry_south_korea_2018'),
    imported_at timestamptz not null default now(),
    constraint energy_forecasts_model_fk foreign key (model_run_id, source_id)
        references public.energy_model_runs(model_run_id, source_id),
    constraint energy_forecasts_cutoff_fk foreign key (source_id, cutoff_sequence_index)
        references public.energy_readings(source_id, sequence_index),
    constraint energy_forecasts_target_first_fk foreign key
        (source_id, target_start_sequence_index)
        references public.energy_readings(source_id, sequence_index),
    constraint energy_forecasts_target_last_fk foreign key
        (source_id, target_end_sequence_index)
        references public.energy_readings(source_id, sequence_index),
    constraint energy_forecasts_input_window_check check (
        input_start_sequence_index = cutoff_sequence_index - 95
        and input_end_sequence_index = cutoff_sequence_index
        and input_start_sequence_index >= 1
        and input_end_timestamp_derived_naive = cutoff_timestamp_derived_naive
    ),
    constraint energy_forecasts_target_window_check check (
        target_start_sequence_index = cutoff_sequence_index + 1
        and target_end_sequence_index = cutoff_sequence_index + 4
        and cardinality(target_timestamps_derived_naive) = 4
        and array_position(target_timestamps_derived_naive, null) is null
    ),
    constraint energy_forecasts_four_values_check check (
        cardinality(predicted_kwh_by_horizon) = 4
        and array_position(predicted_kwh_by_horizon, null) is null
        and predicted_kwh_by_horizon[1] >= 0
        and predicted_kwh_by_horizon[2] >= 0
        and predicted_kwh_by_horizon[3] >= 0
        and predicted_kwh_by_horizon[4] >= 0
        and abs(predicted_hour_kwh_as_provided
                - (predicted_kwh_by_horizon[1] + predicted_kwh_by_horizon[2]
                   + predicted_kwh_by_horizon[3] + predicted_kwh_by_horizon[4]))
            <= 0.000001
    ),
    constraint energy_forecasts_cutoff_once_per_model unique (model_run_id, cutoff_sequence_index),
    constraint energy_forecasts_id_cutoff_unique unique (forecast_id, cutoff_sequence_index)
);

create index energy_forecasts_cutoff_time_idx
    on public.energy_forecasts (source_id, cutoff_timestamp_derived_naive);
comment on table public.energy_forecasts is
  '5,277 possible historical test cutoffs; predictions are fixed per cutoff and independent of user tariff.';
comment on column public.energy_forecasts.cutoff_sequence_index is
  'One-based UCI source order. UI/server must select the matching cutoff, never recycle another forecast.';

-- Kept in a separate table so the application can show the forecast first
-- and reveal the test outcome on a later authenticated evaluation request.
-- The complete underlying 2018 raw dataset is still accessible to permitted
-- users; this is a backtest workflow, not a claim of secrecy of historic data.
create table public.energy_forecast_evaluations (
    forecast_id text primary key,
    cutoff_sequence_index integer not null,
    actual_kwh_by_horizon numeric(18, 6)[] not null,
    actual_hour_kwh_as_provided numeric(18, 6) not null check (actual_hour_kwh_as_provided >= 0),
    absolute_kwh_error_by_horizon numeric(18, 6)[] not null,
    absolute_hour_total_error_kwh numeric(18, 6) not null
        check (absolute_hour_total_error_kwh >= 0),
    evaluation_split text not null default 'test_holdout_revealed_after_prediction'
        check (evaluation_split = 'test_holdout_revealed_after_prediction'),
    imported_at timestamptz not null default now(),
    constraint energy_evaluations_forecast_cutoff_fk
        foreign key (forecast_id, cutoff_sequence_index)
        references public.energy_forecasts(forecast_id, cutoff_sequence_index),
    constraint energy_evaluations_four_actuals_check check (
        cardinality(actual_kwh_by_horizon) = 4
        and array_position(actual_kwh_by_horizon, null) is null
        and actual_kwh_by_horizon[1] >= 0
        and actual_kwh_by_horizon[2] >= 0
        and actual_kwh_by_horizon[3] >= 0
        and actual_kwh_by_horizon[4] >= 0
        and abs(actual_hour_kwh_as_provided
                - (actual_kwh_by_horizon[1] + actual_kwh_by_horizon[2]
                   + actual_kwh_by_horizon[3] + actual_kwh_by_horizon[4]))
            <= 0.000001
    ),
    constraint energy_evaluations_four_errors_check check (
        cardinality(absolute_kwh_error_by_horizon) = 4
        and array_position(absolute_kwh_error_by_horizon, null) is null
        and absolute_kwh_error_by_horizon[1] >= 0
        and absolute_kwh_error_by_horizon[2] >= 0
        and absolute_kwh_error_by_horizon[3] >= 0
        and absolute_kwh_error_by_horizon[4] >= 0
    )
);

comment on table public.energy_forecast_evaluations is
  'Historical actuals and errors. Step 005 must not grant direct browser reads until its reveal rule is implemented.';

-- Price is deliberately absent: the Rp/kWh amount in the preparation script
-- is an ILLUSTRATIVE scenario only. Cost = sum(four predicted kWh) * user tariff;
-- actual comparison uses that same tariff after the holdout is revealed.

alter table public.energy_readings enable row level security;
alter table public.energy_model_runs enable row level security;
alter table public.energy_forecasts enable row level security;
alter table public.energy_forecast_evaluations enable row level security;

revoke all on table public.energy_readings, public.energy_model_runs,
    public.energy_forecasts, public.energy_forecast_evaluations
    from public, anon, authenticated;

-- Local-only importer may use a secret key; never include one in this file.
grant select, insert, update, delete on table public.energy_readings,
    public.energy_model_runs, public.energy_forecasts,
    public.energy_forecast_evaluations to service_role;

commit;
