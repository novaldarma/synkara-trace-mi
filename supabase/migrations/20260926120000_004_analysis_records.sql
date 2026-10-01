-- SYNKARA TRACE-MI | 004: investigation, review, and demo follow-up records.
-- Run after 001, 002, and 003. Historical incident/RCA source rows remain
-- immutable from the application. 005 must add account-specific RLS policies.

begin;

create table public.analysis_records (
    analysis_id uuid primary key default gen_random_uuid(),
    incident_record_id text not null references public.incident_records(record_id),
    analysis_mode text not null check (analysis_mode in ('replay', 'retrospective')),
    as_of_at timestamp without time zone,
    rule_version text not null check (btrim(rule_version) <> ''),
    result_kind text not null check (
        result_kind in ('rule_indication', 'ai_assisted_hypothesis', 'manual_note')
    ),
    assessment text not null check (btrim(assessment) <> ''),
    evidence_refs jsonb not null default '[]'::jsonb
        check (jsonb_typeof(evidence_refs) = 'array'),
    limitations text not null default '',
    review_status text not null default 'unreviewed'
        check (review_status in ('unreviewed', 'accepted', 'rejected')),
    created_by uuid not null references auth.users(id),
    created_at timestamptz not null default now(),
    constraint analysis_replay_time_check check (
        (analysis_mode = 'replay' and as_of_at is not null)
        or (analysis_mode = 'retrospective' and as_of_at is null)
    ),
    constraint analysis_id_incident_unique unique (analysis_id, incident_record_id)
);

create index analysis_records_incident_time_idx
    on public.analysis_records (incident_record_id, created_at desc);
create index analysis_records_author_idx
    on public.analysis_records (created_by, created_at desc);

comment on table public.analysis_records is
  'Derived investigation snapshots. Rule indications and AI hypotheses are not verified physical root causes.';
comment on column public.analysis_records.evidence_refs is
  'Source identifiers and locators. The server must check authorization and as-of availability for each reference.';
comment on column public.analysis_records.as_of_at is
  'Replay cutoff in source-local naive time; not a verified publication or availability time.';

create table public.review_flags (
    flag_id uuid primary key default gen_random_uuid(),
    analysis_id uuid not null references public.analysis_records(analysis_id),
    flag_kind text not null check (
        flag_kind in ('data_quality', 'time_availability', 'unit_mismatch',
                      'unverified_evidence', 'other')
    ),
    flag_text text not null check (btrim(flag_text) <> ''),
    evidence_refs jsonb not null default '[]'::jsonb
        check (jsonb_typeof(evidence_refs) = 'array'),
    resolution text not null default 'open'
        check (resolution in ('open', 'acknowledged', 'dismissed')),
    created_by uuid not null references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index review_flags_analysis_idx on public.review_flags (analysis_id, created_at);
comment on table public.review_flags is
  'Reviewer notes for derived analyses; the original data_quality_issues catalog is separate.';

create table public.followup_actions (
    action_id uuid primary key default gen_random_uuid(),
    incident_record_id text not null references public.incident_records(record_id),
    analysis_id uuid,
    source_rca_action_id text references public.rca_actions(historical_action_id),
    source_kind text not null check (
        source_kind in ('reviewed_rca_action', 'inspection_proposal', 'manual_proposal')
    ),
    action_text text not null check (btrim(action_text) <> ''),
    action_type text not null check (action_type in ('corrective', 'preventive')),
    evidence_refs jsonb not null default '[]'::jsonb
        check (jsonb_typeof(evidence_refs) = 'array'),
    decision text not null default 'pending'
        check (decision in ('pending', 'accepted', 'rejected')),
    decision_reason text,
    owner_user_id uuid references auth.users(id),
    due_at timestamptz,
    status text not null default 'draft'
        check (status in ('draft', 'assigned', 'in_progress', 'completed',
                         'canceled', 'rejected')),
    created_by uuid not null references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint followup_actions_analysis_incident_fk
        foreign key (analysis_id, incident_record_id)
        references public.analysis_records(analysis_id, incident_record_id),
    constraint followup_actions_rca_kind_check check (
        (source_kind = 'reviewed_rca_action' and source_rca_action_id is not null)
        or (source_kind <> 'reviewed_rca_action' and source_rca_action_id is null)
    ),
    constraint followup_actions_decision_status_check check (
        (decision = 'pending' and status = 'draft'
         and owner_user_id is null and due_at is null)
        or (decision = 'accepted' and status in
            ('assigned', 'in_progress', 'completed', 'canceled')
            and owner_user_id is not null and due_at is not null)
        or (decision = 'rejected' and status = 'rejected'
            and owner_user_id is null and due_at is null
            and decision_reason is not null and btrim(decision_reason) <> '')
    )
);

create index followup_actions_incident_idx
    on public.followup_actions (incident_record_id, created_at desc);
create index followup_actions_owner_status_idx
    on public.followup_actions (owner_user_id, status) where owner_user_id is not null;
create index followup_actions_creator_idx
    on public.followup_actions (created_by, created_at desc);

comment on table public.followup_actions is
  'Demo workflow proposals, not company CMMS work orders; neither the original incident nor RCA action status is modified.';

create table public.action_events (
    event_id bigint generated always as identity primary key,
    action_id uuid not null references public.followup_actions(action_id),
    actor_user_id uuid not null references auth.users(id),
    event_kind text not null check (
        event_kind in ('created', 'accepted', 'rejected', 'assigned',
                       'started', 'completed', 'canceled', 'reassigned', 'commented')
    ),
    old_status text,
    new_status text,
    old_owner_user_id uuid references auth.users(id),
    new_owner_user_id uuid references auth.users(id),
    event_note text,
    happened_at timestamptz not null default now()
);

create index action_events_action_time_idx
    on public.action_events (action_id, happened_at, event_id);

comment on table public.action_events is
  'Append-only event intent; 005 must prohibit browser UPDATE/DELETE and scope INSERT/SELECT by actor and action.';

-- Until 005 is implemented and tested, the browser roles have no access.
alter table public.analysis_records enable row level security;
alter table public.review_flags enable row level security;
alter table public.followup_actions enable row level security;
alter table public.action_events enable row level security;

revoke all on table public.analysis_records, public.review_flags,
    public.followup_actions, public.action_events
    from public, anon, authenticated;
revoke all on sequence public.action_events_event_id_seq
    from public, anon, authenticated;

grant select, insert, update, delete on table public.analysis_records,
    public.review_flags, public.followup_actions, public.action_events
    to service_role;
grant usage, select on sequence public.action_events_event_id_seq to service_role;

commit;
