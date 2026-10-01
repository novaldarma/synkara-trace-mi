-- SYNKARA TRACE-MI | 002: Case 2 source records, equipment, incidents and RCA.
-- Apply AFTER 001. No rows are loaded by this migration. Keep Excel/PPTX
-- provenance, units and source dates; PostgreSQL timestamps here are naive
-- because the competition files do not establish a source time zone.
-- Import order: source_catalog -> plants/assets -> Incident + Production +
-- Equipment -> RCA documents/slides -> verified case_links. Historical RCA
-- actions remain empty until the relevant PowerPoint slide is reviewed.

begin;

-- Composite references below prevent a prepared record from claiming a
-- different hash for its registered source file. Do not use AR/MTO as keys.
alter table public.source_catalog
    add constraint source_catalog_id_hash_dataset_unique
    unique (source_id, source_sha256, dataset_id);
alter table public.assets
    add constraint assets_id_plant_unique unique (asset_id, plant_code);

create table public.production_tag_catalog (
    record_id text primary key,
    dataset_id text not null default 'caliber2026_case2'
        check (dataset_id = 'caliber2026_case2'),
    source_id text not null,
    source_sha256 text not null,
    source_sheet text not null default 'PI Tag' check (source_sheet = 'PI Tag'),
    source_row integer not null check (source_row >= 2),
    source_row_id text not null,
    asset_id text not null,
    plant_code text not null,
    tag_name text not null,
    engineering_unit_as_provided text,
    instrument_tag_as_provided text,
    raw jsonb not null check (jsonb_typeof(raw) = 'object'),
    raw_types jsonb not null check (jsonb_typeof(raw_types) = 'object'),
    raw_number_formats jsonb not null check (jsonb_typeof(raw_number_formats) = 'object'),
    imported_at timestamptz not null default now(),
    constraint production_tag_source_fk foreign key (source_id, source_sha256, dataset_id)
        references public.source_catalog(source_id, source_sha256, dataset_id),
    constraint production_tag_asset_fk foreign key (asset_id, plant_code)
        references public.assets(asset_id, plant_code),
    constraint production_tag_source_row_unique unique (source_id, source_sheet, source_row),
    constraint production_tag_file_name_unique unique (source_id, tag_name)
);

comment on table public.production_tag_catalog is
  'Five independent PI Tag catalogs (seven tags each); PLANT_RATE can recur across files.';

create table public.production_records (
    record_id text primary key,
    dataset_id text not null default 'caliber2026_case2'
        check (dataset_id = 'caliber2026_case2'),
    source_id text not null,
    source_sha256 text not null,
    source_sheet text not null default 'Sheet2' check (source_sheet = 'Sheet2'),
    source_row integer not null check (source_row >= 2),
    source_row_id text not null,
    asset_id text not null,
    plant_code text not null,
    observed_at_raw text not null,
    observed_at_naive timestamp without time zone not null,
    time_grain text not null default 'hourly_as_provided'
        check (time_grain = 'hourly_as_provided'),
    raw jsonb not null check (jsonb_typeof(raw) = 'object'),
    raw_types jsonb not null check (jsonb_typeof(raw_types) = 'object'),
    raw_number_formats jsonb not null check (jsonb_typeof(raw_number_formats) = 'object'),
    imported_at timestamptz not null default now(),
    constraint production_records_source_fk foreign key (source_id, source_sha256, dataset_id)
        references public.source_catalog(source_id, source_sha256, dataset_id),
    constraint production_records_asset_fk foreign key (asset_id, plant_code)
        references public.assets(asset_id, plant_code),
    constraint production_records_row_unique unique (source_id, source_sheet, source_row),
    constraint production_records_hour_unique unique (source_id, observed_at_naive),
    constraint production_records_id_source_unique unique (record_id, source_id)
);

create index production_records_asset_time_idx
    on public.production_records (asset_id, observed_at_naive);

create table public.production_values (
    production_record_id text not null,
    source_id text not null,
    tag_name text not null,
    raw_value jsonb not null,
    numeric_value numeric,
    text_value text,
    engineering_unit_as_provided text,
    imported_at timestamptz not null default now(),
    primary key (production_record_id, tag_name),
    constraint production_values_parent_fk foreign key (production_record_id, source_id)
        references public.production_records(record_id, source_id) on delete restrict,
    constraint production_values_tag_fk foreign key (source_id, tag_name)
        references public.production_tag_catalog(source_id, tag_name),
    constraint production_values_type_check check (
        (jsonb_typeof(raw_value) = 'number'
         and numeric_value is not null and text_value is null)
        or
        (jsonb_typeof(raw_value) = 'string'
         and numeric_value is null and text_value is not null)
    )
);

comment on table public.production_values is
  'Seven source signals per hourly record. Unit and tag scope belong to their own workbook.';

-- Equipment Info source rows (70), metadata fields (60), and reference limits
-- (20) are distinct records although normalized items may share an Excel row.
create table public.equipment_reference (
    record_id text primary key,
    dataset_id text not null default 'caliber2026_case2'
        check (dataset_id = 'caliber2026_case2'),
    source_id text not null,
    source_sha256 text not null,
    source_sheet text not null default 'Equipment Info'
        check (source_sheet = 'Equipment Info'),
    source_row integer not null check (source_row >= 1),
    source_row_id text not null,
    asset_id text not null,
    plant_code text not null,
    reference_kind text not null
        check (reference_kind in ('source_row', 'metadata', 'threshold')),
    raw jsonb check (raw is null or jsonb_typeof(raw) = 'object'),
    raw_types jsonb check (raw_types is null or jsonb_typeof(raw_types) = 'object'),
    field_name_as_provided text,
    field_value_as_provided jsonb,
    post_event_context boolean not null default false,
    parameter_name_as_provided text,
    parameter_label_raw text,
    unit_as_provided text,
    alarm_trip_raw text,
    alarm_value_as_provided numeric,
    trip_value_as_provided numeric,
    threshold_direction text,
    historical_valid_from date,
    imported_at timestamptz not null default now(),
    constraint equipment_reference_source_fk foreign key (source_id, source_sha256, dataset_id)
        references public.source_catalog(source_id, source_sha256, dataset_id),
    constraint equipment_reference_asset_fk foreign key (asset_id, plant_code)
        references public.assets(asset_id, plant_code),
    constraint equipment_reference_kind_data_check check (
        (reference_kind = 'source_row' and raw is not null)
        or (reference_kind = 'metadata' and field_name_as_provided is not null)
        or (reference_kind = 'threshold'
            and parameter_name_as_provided is not null
            and unit_as_provided is not null
            and alarm_value_as_provided is not null
            and trip_value_as_provided is not null)
    ),
    constraint equipment_reference_row_kind_unique
        unique (source_id, source_sheet, source_row, reference_kind)
);

create index equipment_reference_asset_kind_idx
    on public.equipment_reference (asset_id, reference_kind);
comment on column public.equipment_reference.post_event_context is
  'True for Failure Date, Dominant Failure Mode and Linked RCA; block these in pre-event replay.';
comment on column public.equipment_reference.historical_valid_from is
  'Unknown for supplied thresholds: NULL does not mean historically effective at every time.';

create table public.equipment_observations (
    record_id text primary key,
    dataset_id text not null default 'caliber2026_case2'
        check (dataset_id = 'caliber2026_case2'),
    source_id text not null,
    source_sha256 text not null,
    source_sheet text not null default 'Condition History'
        check (source_sheet = 'Condition History'),
    source_row integer not null check (source_row >= 2),
    source_row_id text not null,
    asset_id text not null,
    plant_code text not null,
    observed_date_raw text not null,
    observed_date date not null,
    observed_time time without time zone,
    available_at timestamp without time zone,
    week_as_provided integer,
    health_status_as_provided text not null,
    time_grain text not null default 'weekly_as_provided'
        check (time_grain = 'weekly_as_provided'),
    measurements jsonb not null
        check (jsonb_typeof(measurements) = 'array' and jsonb_array_length(measurements) = 4),
    raw jsonb not null check (jsonb_typeof(raw) = 'object'),
    raw_types jsonb not null check (jsonb_typeof(raw_types) = 'object'),
    raw_number_formats jsonb not null check (jsonb_typeof(raw_number_formats) = 'object'),
    imported_at timestamptz not null default now(),
    constraint equipment_observations_source_fk foreign key (source_id, source_sha256, dataset_id)
        references public.source_catalog(source_id, source_sha256, dataset_id),
    constraint equipment_observations_asset_fk foreign key (asset_id, plant_code)
        references public.assets(asset_id, plant_code),
    constraint equipment_observations_row_unique unique (source_id, source_sheet, source_row),
    constraint equipment_observations_week_unique unique (source_id, observed_date)
);

create index equipment_observations_asset_date_idx
    on public.equipment_observations (asset_id, observed_date);
comment on column public.equipment_observations.available_at is
  'Not provided. For a replay, apply the documented end-of-day availability assumption in server logic; do not fill this with the observation date.';

create table public.equipment_summary_values (
    record_id text primary key,
    dataset_id text not null default 'caliber2026_case2'
        check (dataset_id = 'caliber2026_case2'),
    source_id text not null,
    source_sha256 text not null,
    source_sheet text not null default 'Performance Summary'
        check (source_sheet = 'Performance Summary'),
    source_row integer not null check (source_row >= 4),
    source_row_id text not null,
    asset_id text not null,
    plant_code text not null,
    kpi_name_as_provided text not null,
    value_as_provided jsonb not null,
    basis_as_provided text,
    time_scope text not null default 'full_period_retrospective_only'
        check (time_scope = 'full_period_retrospective_only'),
    raw jsonb not null check (jsonb_typeof(raw) = 'object'),
    raw_types jsonb not null check (jsonb_typeof(raw_types) = 'object'),
    raw_number_formats jsonb not null check (jsonb_typeof(raw_number_formats) = 'object'),
    imported_at timestamptz not null default now(),
    constraint equipment_summary_source_fk foreign key (source_id, source_sha256, dataset_id)
        references public.source_catalog(source_id, source_sha256, dataset_id),
    constraint equipment_summary_asset_fk foreign key (asset_id, plant_code)
        references public.assets(asset_id, plant_code),
    constraint equipment_summary_row_unique unique (source_id, source_sheet, source_row),
    constraint equipment_summary_kpi_unique unique (source_id, kpi_name_as_provided)
);

comment on table public.equipment_summary_values is
  'Provided full-period KPI, including duplicate-of-incident loss; never add to incident portfolio totals.';

create table public.incident_records (
    record_id text primary key,
    dataset_id text not null default 'caliber2026_case2'
        check (dataset_id = 'caliber2026_case2'),
    source_id text not null,
    source_sha256 text not null,
    source_sheet text not null default 'Incident Database'
        check (source_sheet = 'Incident Database'),
    source_row integer not null check (source_row >= 4),
    source_row_id text not null,
    plant_code text not null references public.plants(plant_code),
    asset_tag_as_provided text not null,
    asset_id text,
    occurred_date_raw text not null,
    occurred_date date not null,
    ar_no text,
    mto_no text,
    rca_due_date date,
    overall_status_as_provided text,
    downtime_hours numeric(14, 3) not null check (downtime_hours >= 0),
    actual_loss_kusd numeric(18, 4) not null check (actual_loss_kusd >= 0),
    potential_loss_kusd numeric(18, 4) not null check (potential_loss_kusd >= 0),
    total_loss_kusd_as_provided numeric(18, 4) not null,
    raw jsonb not null check (jsonb_typeof(raw) = 'object'),
    raw_types jsonb not null check (jsonb_typeof(raw_types) = 'object'),
    raw_number_formats jsonb not null check (jsonb_typeof(raw_number_formats) = 'object'),
    imported_at timestamptz not null default now(),
    constraint incident_records_source_fk foreign key (source_id, source_sha256, dataset_id)
        references public.source_catalog(source_id, source_sha256, dataset_id),
    constraint incident_records_asset_fk foreign key (asset_id, plant_code)
        references public.assets(asset_id, plant_code),
    constraint incident_records_source_row_unique unique (source_id, source_sheet, source_row),
    constraint incident_loss_reconciliation_check check (
        abs(total_loss_kusd_as_provided - actual_loss_kusd - potential_loss_kusd)
        <= 0.01
    )
);

create index incident_records_plant_date_idx
    on public.incident_records (plant_code, occurred_date);
create index incident_records_asset_date_idx
    on public.incident_records (asset_tag_as_provided, occurred_date);
create index incident_records_ar_nonnull_idx
    on public.incident_records (ar_no) where ar_no is not null;

comment on column public.incident_records.ar_no is
  'Nullable: 226 supplied n/a values. AR and MTO can repeat and are NEVER unique IDs.';
comment on column public.incident_records.overall_status_as_provided is
  'Snapshot in provided workbook, not historical status on occurred_date.';

create table public.incident_source_summary (
    record_id text primary key,
    dataset_id text not null default 'caliber2026_case2'
        check (dataset_id = 'caliber2026_case2'),
    source_id text not null,
    source_sha256 text not null,
    source_sheet text not null default 'Dashboard'
        check (source_sheet = 'Dashboard'),
    source_row integer not null check (source_row >= 1),
    source_row_id text not null,
    raw jsonb not null check (jsonb_typeof(raw) = 'object'),
    raw_types jsonb not null check (jsonb_typeof(raw_types) = 'object'),
    raw_number_formats jsonb not null check (jsonb_typeof(raw_number_formats) = 'object'),
    imported_at timestamptz not null default now(),
    constraint incident_source_summary_source_fk foreign key (source_id, source_sha256, dataset_id)
        references public.source_catalog(source_id, source_sha256, dataset_id),
    constraint incident_source_summary_row_unique unique (source_id, source_sheet, source_row)
);

comment on table public.incident_source_summary is
  'Twenty-five nonempty original Dashboard rows for reconciliation, not additional incidents.';

create table public.rca_documents (
    document_id text primary key,
    dataset_id text not null default 'caliber2026_case2'
        check (dataset_id = 'caliber2026_case2'),
    source_id text not null,
    source_sha256 text not null,
    source_file text not null,
    asset_id text not null,
    plant_code text not null,
    linked_incident_record_id text not null references public.incident_records(record_id),
    ar_no_as_provided text not null,
    incident_occurred_date date not null,
    reported_date_raw text not null,
    reported_date date not null,
    available_at timestamp without time zone,
    slide_count smallint not null check (slide_count = 11),
    markdown_relative_path text not null,
    markdown_sha256 text not null check (markdown_sha256 ~ '^[0-9a-f]{64}$'),
    link_status text not null default 'verified_by_tag_plant_AR_and_occurrence_date'
        check (link_status in ('verified_by_tag_plant_AR_and_occurrence_date',
                              'proposed', 'unmatched')),
    visual_review_status text not null default 'pending'
        check (visual_review_status in ('pending', 'reviewed')),
    imported_at timestamptz not null default now(),
    constraint rca_documents_source_fk foreign key (source_id, source_sha256, dataset_id)
        references public.source_catalog(source_id, source_sha256, dataset_id),
    constraint rca_documents_asset_fk foreign key (asset_id, plant_code)
        references public.assets(asset_id, plant_code),
    constraint rca_documents_source_unique unique (source_id),
    constraint rca_documents_id_source_unique unique (document_id, source_id),
    constraint rca_documents_one_to_one_incident unique (linked_incident_record_id),
    constraint rca_documents_availability_unknown check (available_at is null)
);

comment on column public.rca_documents.available_at is
  'NULL: the report date does not prove when the conclusions were available.';

create table public.rca_sections (
    slide_id text primary key,
    dataset_id text not null default 'caliber2026_case2'
        check (dataset_id = 'caliber2026_case2'),
    document_id text not null,
    source_id text not null,
    source_sha256 text not null,
    source_file text not null,
    markdown_relative_path text not null,
    source_slide_number smallint not null check (source_slide_number between 1 and 11),
    asset_id text not null,
    plant_code text not null,
    incident_record_id text not null references public.incident_records(record_id),
    content_role_hint text not null,
    document_time_scope text not null default 'post_incident_document'
        check (document_time_scope = 'post_incident_document'),
    blocks_in_powerpoint_order jsonb not null
        check (jsonb_typeof(blocks_in_powerpoint_order) = 'array'),
    text_block_count integer not null check (text_block_count >= 0),
    unread_visual_count integer not null check (unread_visual_count >= 0),
    visual_review_status text not null default 'pending'
        check (visual_review_status in ('pending', 'reviewed')),
    available_at timestamp without time zone,
    imported_at timestamptz not null default now(),
    constraint rca_sections_document_fk foreign key (document_id, source_id)
        references public.rca_documents(document_id, source_id),
    constraint rca_sections_source_fk foreign key (source_id, source_sha256, dataset_id)
        references public.source_catalog(source_id, source_sha256, dataset_id),
    constraint rca_sections_asset_fk foreign key (asset_id, plant_code)
        references public.assets(asset_id, plant_code),
    constraint rca_sections_number_unique unique (document_id, source_slide_number),
    constraint rca_sections_slide_document_unique unique (slide_id, document_id),
    constraint rca_sections_availability_unknown check (available_at is null)
);

comment on table public.rca_sections is
  'Slide text and PowerPoint order as extracted; pending visual review prevents verified quotation claims.';

create table public.rca_actions (
    historical_action_id text primary key,
    document_id text not null,
    slide_id text not null,
    action_as_written text not null,
    owner_as_written text,
    plan_date_as_written text,
    source_status_as_written text,
    manual_review_status text not null default 'reviewed'
        check (manual_review_status = 'reviewed'),
    is_live_task boolean not null default false check (is_live_task = false),
    imported_at timestamptz not null default now(),
    constraint rca_actions_slide_document_fk foreign key (slide_id, document_id)
        references public.rca_sections(slide_id, document_id),
    constraint rca_actions_text_not_blank check (btrim(action_as_written) <> '')
);

comment on table public.rca_actions is
  'Only manually reviewed historical slide actions belong here, never app tasks or inferred current work orders.';

create table public.case_links (
    link_id text primary key,
    dataset_id text not null default 'caliber2026_case2'
        check (dataset_id = 'caliber2026_case2'),
    relation_kind text not null
        check (relation_kind in ('incident_rca', 'incident_asset', 'asset_source')),
    incident_record_id text references public.incident_records(record_id),
    rca_document_id text references public.rca_documents(document_id),
    asset_id text references public.assets(asset_id),
    left_source_id text,
    right_source_id text,
    match_status text not null check (match_status in ('verified', 'proposed', 'unmatched')),
    match_reason text not null,
    evidence_locator text[] not null default '{}'::text[],
    rule_version integer not null default 1 check (rule_version > 0),
    verified_at timestamptz,
    imported_at timestamptz not null default now(),
    constraint case_links_left_source_dataset_fk foreign key (left_source_id, dataset_id)
        references public.source_catalog(source_id, dataset_id),
    constraint case_links_right_source_dataset_fk foreign key (right_source_id, dataset_id)
        references public.source_catalog(source_id, dataset_id),
    constraint case_links_verified_requires_identity check (
        match_status <> 'verified'
        or
        (relation_kind = 'incident_rca' and incident_record_id is not null
         and asset_id is not null and rca_document_id is not null)
        or
        (relation_kind = 'incident_asset' and incident_record_id is not null
         and asset_id is not null)
        or
        (relation_kind = 'asset_source' and asset_id is not null
         and left_source_id is not null)
    )
);

create index case_links_incident_status_idx
    on public.case_links (incident_record_id, match_status);
comment on table public.case_links is
  'Provenance-aware proposed/verified/unmatched links. Five RCA links are verified by source fields, not by matching AR alone.';

-- All tables created by this step are closed from browser roles immediately.
-- The later 005 migration will define tested account-specific SELECT policies.
alter table public.production_tag_catalog enable row level security;
alter table public.production_records enable row level security;
alter table public.production_values enable row level security;
alter table public.equipment_reference enable row level security;
alter table public.equipment_observations enable row level security;
alter table public.equipment_summary_values enable row level security;
alter table public.incident_records enable row level security;
alter table public.incident_source_summary enable row level security;
alter table public.rca_documents enable row level security;
alter table public.rca_sections enable row level security;
alter table public.rca_actions enable row level security;
alter table public.case_links enable row level security;

revoke all on table public.production_tag_catalog, public.production_records,
    public.production_values, public.equipment_reference, public.equipment_observations,
    public.equipment_summary_values, public.incident_records, public.incident_source_summary,
    public.rca_documents, public.rca_sections, public.rca_actions, public.case_links
    from public, anon, authenticated;

-- Secret import process only. Neither service/secret key nor DB password may
-- be stored in this SQL file, a browser bundle, or a GitHub repository.
grant select, insert, update, delete on table public.production_tag_catalog,
    public.production_records, public.production_values, public.equipment_reference,
    public.equipment_observations, public.equipment_summary_values,
    public.incident_records, public.incident_source_summary, public.rca_documents,
    public.rca_sections, public.rca_actions, public.case_links to service_role;

commit;
