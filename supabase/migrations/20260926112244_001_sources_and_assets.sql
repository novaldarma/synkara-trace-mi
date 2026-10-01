-- SYNKARA TRACE-MI | 001: source provenance and governed definitions.
-- No source rows are imported by this migration. Apply through Supabase CLI
-- migration history. Subsequent migrations must enable RLS and explicitly
-- restrict grants on EVERY new table they create.
-- All timestamps of Case 2 observations remain naive in later data tables;
-- the timestamptz columns below record only database/import administration.

begin;

create table public.source_catalog (
    source_id text primary key,
    dataset_id text not null,
    origin_kind text not null,
    source_kind text not null,
    relative_path text not null,
    source_sha256 text not null,
    source_bytes bigint not null check (source_bytes >= 0),
    source_version integer not null default 1 check (source_version > 0),
    source_scope text not null,
    granularity_label text not null,
    availability_note text,
    visual_review_status text not null default 'not_applicable',
    record_count integer check (record_count is null or record_count >= 0),
    imported_at timestamptz not null default now(),
    constraint source_catalog_dataset_origin_check check (
        (dataset_id = 'caliber2026_case2' and origin_kind = 'competition_provided')
        or
        (dataset_id = 'uci_steel_industry_2018_external' and origin_kind = 'external_demo')
    ),
    constraint source_catalog_kind_check check (
        source_kind in ('incident', 'production', 'equipment', 'historical_rca',
                        'external_electricity_history')
    ),
    constraint source_catalog_dataset_kind_check check (
        (dataset_id = 'caliber2026_case2' and source_kind <> 'external_electricity_history')
        or
        (dataset_id = 'uci_steel_industry_2018_external'
         and source_kind = 'external_electricity_history')
    ),
    constraint source_catalog_hash_check check (source_sha256 ~ '^[0-9a-f]{64}$'),
    constraint source_catalog_review_check check (
        visual_review_status in ('not_applicable', 'pending', 'reviewed')
    ),
    constraint source_catalog_review_scope_check check (
        (source_kind = 'historical_rca' and visual_review_status in ('pending', 'reviewed'))
        or
        (source_kind <> 'historical_rca' and visual_review_status = 'not_applicable')
    ),
    constraint source_catalog_unique_version unique (dataset_id, relative_path, source_sha256),
    constraint source_catalog_source_dataset_unique unique (source_id, dataset_id)
);

comment on table public.source_catalog is
  'One audited input file per row, including separate Case 2 and external UCI provenance.';
comment on column public.source_catalog.availability_note is
  'RCA conclusion availability is unknown; the document report date does not prove it.';

create table public.plants (
    plant_code text primary key,
    dataset_id text not null default 'caliber2026_case2'
        check (dataset_id = 'caliber2026_case2'),
    display_name_as_provided text,
    detailed_observations_available boolean not null default false,
    identity_status text not null default 'provided'
        check (identity_status in ('provided', 'team_defined', 'unavailable')),
    owner_label text not null default 'SYNKARA prototype',
    definition_version integer not null default 1 check (definition_version > 0),
    created_at timestamptz not null default now(),
    constraint plants_code_not_blank check (btrim(plant_code) <> '')
);

comment on table public.plants is
  'Twelve plant labels exist in Incident Database; only four have the five detailed assets.';

create table public.assets (
    asset_id text primary key,
    dataset_id text not null default 'caliber2026_case2'
        check (dataset_id = 'caliber2026_case2'),
    plant_code text not null references public.plants(plant_code),
    asset_tag text not null,
    equipment_type_as_provided text,
    detailed_observations_available boolean not null default false,
    identity_status text not null default 'provided'
        check (identity_status in ('provided', 'team_defined', 'unavailable')),
    owner_label text not null default 'SYNKARA prototype',
    definition_version integer not null default 1 check (definition_version > 0),
    created_at timestamptz not null default now(),
    constraint assets_tag_not_blank check (btrim(asset_tag) <> ''),
    constraint assets_identity_per_plant unique (dataset_id, plant_code, asset_tag)
);

comment on table public.assets is
  'Internal ID is stable and distinct from AR/MTO; tag uniqueness is only per dataset and plant.';

create table public.kpi_definitions (
    kpi_code text primary key,
    dataset_id text not null
        check (dataset_id in ('caliber2026_case2', 'uci_steel_industry_2018_external')),
    display_name text not null,
    definition_status text not null
        check (definition_status in ('provided', 'team_defined', 'unavailable')),
    unit_label text,
    observation_grain text,
    scope_label text not null,
    formula_text text,
    numerator_text text,
    denominator_text text,
    filter_basis text,
    limitations text not null,
    owner_label text not null default 'SYNKARA prototype',
    definition_version integer not null default 1 check (definition_version > 0),
    updated_at timestamptz not null default now(),
    constraint kpi_code_dataset_unique unique (kpi_code, dataset_id),
    constraint kpi_unavailable_no_formula check (
        definition_status <> 'unavailable' or formula_text is null
    )
);

comment on table public.kpi_definitions is
  'One versioned definition per metric; links to input columns live in source_field_map.';

create table public.source_field_map (
    field_map_id uuid primary key default gen_random_uuid(),
    dataset_id text not null,
    source_id text not null,
    source_sheet text,
    source_slide_number integer
        check (source_slide_number is null or source_slide_number > 0),
    field_path_as_provided text not null,
    unit_as_provided text,
    observation_grain text not null,
    scope_label text not null,
    field_meaning text not null,
    definition_status text not null
        check (definition_status in ('provided', 'team_defined', 'unavailable')),
    kpi_code text,
    owner_label text not null default 'SYNKARA prototype',
    mapping_version integer not null default 1 check (mapping_version > 0),
    caveat text,
    created_at timestamptz not null default now(),
    constraint source_field_map_locator_check check (
        source_sheet is null or source_slide_number is null
    ),
    constraint source_field_map_path_not_blank check (btrim(field_path_as_provided) <> ''),
    constraint source_field_map_source_dataset_fk
        foreign key (source_id, dataset_id)
        references public.source_catalog(source_id, dataset_id),
    constraint source_field_map_kpi_dataset_fk
        foreign key (kpi_code, dataset_id)
        references public.kpi_definitions(kpi_code, dataset_id)
);

-- Nullable sheet/slide locators need COALESCE for a true uniqueness check.
create unique index source_field_map_source_locator_version_uq
    on public.source_field_map (
        source_id, coalesce(source_sheet, ''), coalesce(source_slide_number, 0),
        field_path_as_provided, mapping_version
    );
create index source_field_map_kpi_idx on public.source_field_map (kpi_code);

comment on table public.source_field_map is
  'Maps file plus sheet/slide plus source field, unit, grain and scope to one KPI definition.';

create table public.data_quality_issues (
    issue_id text primary key,
    dataset_id text not null
        check (dataset_id in ('caliber2026_case2', 'uci_steel_industry_2018_external')),
    source_id text,
    plant_code text references public.plants(plant_code),
    asset_id text references public.assets(asset_id),
    title text not null,
    description text not null,
    evidence_refs text[] not null default '{}'::text[],
    impact_and_handling text not null,
    severity text not null check (severity in ('P0', 'P1', 'P2')),
    issue_status text not null default 'open'
        check (issue_status in ('open', 'under_review', 'resolved')),
    evidence_status text not null default 'verified_prepared_rows'
        check (evidence_status in ('verified_prepared_rows',
                                  'text_extracted_visual_pending', 'team_assumption')),
    owner_label text not null default 'SYNKARA prototype',
    issue_version integer not null default 1 check (issue_version > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint data_quality_issues_evidence_refs_nonnull check (
        array_position(evidence_refs, null) is null
    ),
    constraint data_quality_issues_source_dataset_fk
        foreign key (source_id, dataset_id)
        references public.source_catalog(source_id, dataset_id),
    constraint data_quality_issues_company_scope_check check (
        dataset_id = 'caliber2026_case2' or (plant_code is null and asset_id is null)
    )
);

create index data_quality_issues_scope_idx
    on public.data_quality_issues (dataset_id, issue_status, severity);
create index data_quality_issues_asset_idx
    on public.data_quality_issues (asset_id) where asset_id is not null;

comment on table public.data_quality_issues is
  'Open source discrepancies remain visible; resolving one requires later evidence and a review.';

-- Definitions, not live KPI values. Source row and column links are imported
-- only after source_catalog contains the validated file identities.
insert into public.kpi_definitions
    (kpi_code, dataset_id, display_name, definition_status, unit_label,
     observation_grain, scope_label, formula_text, numerator_text,
     denominator_text, filter_basis, limitations)
values
    ('case2.incident_count', 'caliber2026_case2', 'Total incidents',
     'team_defined', 'incidents', 'event_date', 'historical_12_plant_portfolio',
     'COUNT(DISTINCT incident record ID)', 'Unique incident source rows', null,
     'Incident occurrence date and plant',
     'Case Book dataset coverage only; source Dashboard summary is a reconciliation input.'),
    ('case2.recorded_downtime_hours', 'caliber2026_case2', 'Recorded downtime',
     'team_defined', 'hours', 'event_date', 'historical_12_plant_portfolio',
     'SUM(Incident Database Downtime (hrs)) over unique incident rows',
     'Recorded incident downtime', null, 'Incident occurrence date and plant',
     'Do not infer downtime from the number of Production RUN_STATUS=OFF observations.'),
    ('case2.actual_loss_kusd', 'caliber2026_case2', 'Recorded actual loss',
     'team_defined', 'k USD', 'event_date', 'historical_12_plant_portfolio',
     'SUM(Incident Database Act. Loss (k US$)) over unique incident rows',
     'Actual loss', null, 'Incident occurrence date and plant',
     'Do not add Equipment Estimated Loss: it repeats example incident values.'),
    ('case2.potential_loss_kusd', 'caliber2026_case2', 'Recorded potential loss',
     'team_defined', 'k USD', 'event_date', 'historical_12_plant_portfolio',
     'SUM(Incident Database Pot. Loss (k US$)) over unique incident rows',
     'Potential loss', null, 'Incident occurrence date and plant',
     'Potential loss is not realized loss or achieved savings.'),
    ('case2.equipment_availability_as_provided', 'caliber2026_case2',
     'Equipment availability, source summary', 'provided', '%', '26_week_source_summary',
     'five_example_assets_only', null, null, null, 'Asset/source workbook',
     'Use Performance Summary as provided; never calculate as-of availability from 26 weekly points.'),
    ('case2.company_energy_unavailable', 'caliber2026_case2',
     'Company electricity consumption unavailable', 'unavailable', 'kWh', null,
     'Chandra_Asri_company_data_not_provided', null, null, null, null,
     'No Case 2 company electricity meter or tariff in the supplied baseline.'),
    ('external_uci.forecast_hour_kwh', 'uci_steel_industry_2018_external',
     'Four-interval historical electricity forecast', 'team_defined', 'kWh',
     'four_consecutive_15_minute_observations', 'external_steel_2018_backtest',
     'SUM(four cutoff-specific predicted Usage_kWh readings)',
     'Four predicted interval readings', null, 'Separate UCI historical cutoff',
     'Interval boundary semantics inferred; never label as company energy or current usage.'),
    ('external_uci.variable_cost_scenario_rp', 'uci_steel_industry_2018_external',
     'Illustrative variable electricity cost', 'team_defined', 'Rp',
     'four_consecutive_15_minute_observations', 'external_steel_2018_backtest',
     'SUM(predicted interval kWh * user scenario tariff Rp/kWh)',
     'Predicted kWh times assumed tariff', null, 'UCI cutoff and user tariff, independently selected',
     'Variable component only; same assumed tariff applies to held-out actual. Not a company bill.');

-- Seed known OPEN issues with locators. No unresolved source reading is
-- silently promoted to a verified operating threshold or RCA conclusion.
insert into public.data_quality_issues
    (issue_id, dataset_id, title, description, evidence_refs,
     impact_and_handling, severity, evidence_status)
values
    ('DQ-OFF-DOWNTIME', 'caliber2026_case2', 'OFF is not recorded downtime',
     'PU-2101B has 18 OFF observations vs 18.5 downtime hours; HE-3301 has 13 vs 12.',
     array['Production Sheet2 RUN_STATUS five assets', 'Incident Database rows 4–8'],
     'Display Production observations and Incident downtime separately.', 'P0',
     'verified_prepared_rows'),
    ('DQ-KO-VIBRATION-UNITS', 'caliber2026_case2', 'KO-3201 vibration sources differ',
     'Production vibration is MM/S with span 20 and 720 values above span; Equipment radial vibration is in micron.',
     array['Production RCA2 PI Tag and Sheet2', 'Equipment RCA2 Condition History'],
     'Keep source, time grain and units distinct; span is not a certified operating alarm.', 'P0',
     'verified_prepared_rows'),
    ('DQ-KO-THRESHOLD-CHRONOLOGY', 'caliber2026_case2',
     'KO-3201 45/75 limits and 60-micron alert have different contexts',
     'Equipment Info lists 45/75 micron; RCA2 slides discuss 60 and planned 45. The 22 April weekly reading and 27 April RCA narrative are not a verified continuous trace.',
     array['Equipment RCA2 Equipment Info and Condition History row 21',
           'RCA2 slides 3, 7 and 10 (visual review pending)'],
     'Replay uses source ALARM and dated measurements; do not assert a historical plant alarm setting or join the two traces.',
     'P0', 'text_extracted_visual_pending'),
    ('DQ-KO-DESIGN-LIFE', 'caliber2026_case2', 'KO-3201 bearing design life differs',
     'Equipment Info says five years while RCA2 slide 6 mentions six years.',
     array['Equipment RCA2 Equipment Info Design Life', 'RCA2 slide 6 (visual review pending)'],
     'Retain both sourced statements; verify before any asset-age recommendation.', 'P1',
     'text_extracted_visual_pending'),
    ('DQ-EQUIPMENT-PERIOD', 'caliber2026_case2', 'Equipment summary period not inferred from weekly points',
     'Performance Summary provides 26 weeks and 4368 hours; Condition History contains 26 weekly observations.',
     array['Five Equipment Performance Summary sheets', 'Five Condition History sheets'],
     'Keep provided KPI on full retrospective only; period boundaries are unverified.', 'P1',
     'verified_prepared_rows'),
    ('DQ-HE-INSTRUMENTS', 'caliber2026_case2', 'HE-3301 generic sensor fields need verification',
     'Production lists VIB and AMP fields even though Equipment Info names a heat exchanger.',
     array['Production RCA4 PI Tag', 'Equipment RCA4 Equipment Info'],
     'Show columns as provided; do not claim verified sensor installation.', 'P1',
     'verified_prepared_rows'),
    ('DQ-RCA-REVIEW', 'caliber2026_case2', 'RCA visual and availability review pending',
     'Five linked RCA files contain 55 slide extracts; publication time for conclusions is unknown.',
     array['RCA1–RCA5 PowerPoint slides 1–11'],
     'Keep available_at null; do not cite unchecked tables/matrices as verified or reveal RCA in pre-incident replay.',
     'P0', 'text_extracted_visual_pending'),
    ('DQ-UCI-TIME', 'uci_steel_industry_2018_external', 'External energy midnight/interval convention',
     '00:00 is the last raw row of each day and shifted only as an inferred display timestamp; the exact metering interval boundary remains unconfirmed.',
     array['UCI Steel_industry_data.csv raw date and NSM', 'Energy preparation manifest'],
     'Keep raw timestamp and source sequence; label forecast and cost as historical external simulation.',
     'P0', 'team_assumption');

-- Fail closed from the very first migration, including projects with old
-- automatic public-schema grants. Step 005 later grants narrowly scoped reads
-- after users, roles and RLS policies have been tested.
alter table public.source_catalog enable row level security;
alter table public.plants enable row level security;
alter table public.assets enable row level security;
alter table public.kpi_definitions enable row level security;
alter table public.source_field_map enable row level security;
alter table public.data_quality_issues enable row level security;

revoke all on table public.source_catalog, public.plants, public.assets,
    public.kpi_definitions, public.source_field_map, public.data_quality_issues
    from public, anon, authenticated;

-- Local server-side importer may use a secret service key; never put this
-- credential in Vite, GitHub, or browser code. service_role bypasses RLS.
grant select, insert, update, delete on table public.source_catalog, public.plants,
    public.assets, public.kpi_definitions, public.source_field_map,
    public.data_quality_issues to service_role;

commit;
