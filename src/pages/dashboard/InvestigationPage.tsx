import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../../services/supabase";
import "./investigate.css";

type Incident = {
  record_id: string;
  source_id: string;
  source_row: number;
  occurred_date: string;
  occurred_date_raw: string;
  plant_code: string;
  asset_tag_as_provided: string;
  ar_no: string | null;
  mto_no: string | null;
  downtime_hours: number | string;
  actual_loss_kusd: number | string;
  potential_loss_kusd: number | string;
  overall_status_as_provided: string | null;
  raw: Record<string, unknown>;
};
type LinkRow = {
  link_id: string;
  incident_record_id: string;
  rca_document_id: string;
  asset_id: string;
  match_status: "verified";
  evidence_locator: string[];
};
type Document = {
  document_id: string;
  source_id: string;
  source_file: string;
  linked_incident_record_id: string;
  asset_id: string;
  plant_code: string;
  incident_occurred_date: string;
  ar_no_as_provided: string;
  reported_date_raw: string;
  available_at: null;
  visual_review_status: "pending" | "reviewed";
  slide_count: number;
};
type Block = { shape_path: string; kind: string; text: string | null };
type Slide = {
  slide_id: string;
  document_id: string;
  incident_record_id: string;
  source_slide_number: number;
  content_role_hint: string;
  visual_review_status: "pending" | "reviewed";
  text_block_count: number;
  unread_visual_count: number;
  blocks_in_powerpoint_order: Block[];
};
type SimilarRow = {
  record_id: string;
  occurred_date: string;
  plant_code: string;
  asset_tag_as_provided: string;
  raw: Record<string, unknown>;
};
type SimilarMatch = SimilarRow & {
  reasons: string[];
  tier: 1 | 2 | 3;
  samePlant: boolean;
};
type PreEvent = {
  assetId: string;
  observedDate: string;
  observationId: string;
  sourceId: string;
  status: string;
};
type TraceEvidenceItem = { statement: string; evidence_ids: string[] };
type TraceContributor = {
  statement: string;
  status: "possible" | "insufficient_evidence";
  supporting_evidence_ids: string[];
};
type TraceCandidateAction = {
  title: string;
  action: string;
  rationale: string;
  success_criteria: string;
  evidence_ids: string[];
};
type TraceAnalysis = {
  summary: string;
  observed_evidence: TraceEvidenceItem[];
  possible_contributors: TraceContributor[];
  contradicting_or_missing_evidence: string[];
  recommended_next_checks: string[];
  confidence_statement: string;
  abstain: boolean;
  candidate_action: TraceCandidateAction;
};
type TraceEvidenceRegistryItem = { evidence_id: string; meaning: string };
type TraceResponse = {
  generated: boolean;
  provider: string;
  model: string | null;
  trace_ai_version: string;
  analysis: TraceAnalysis;
  evidence_registry: TraceEvidenceRegistryItem[];
  limitation: string;
};
type TraceState = "idle" | "loading" | "ready" | "error";
type State = "loading" | "ready" | "missing" | "error";
type RCAState = "idle" | "loading" | "present" | "absent" | "error";

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const shortMoney = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
function money(kusd: number | string) {
  const usd = Number(kusd) * 1000;
  if (usd >= 1_000_000) return `US$${shortMoney.format(usd / 1_000_000)}M`;
  if (usd >= 1000) return `US$${shortMoney.format(usd / 1000)}K`;
  return `US$${number.format(usd)}`;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finite(value: unknown): value is number | string {
  return (
    (typeof value === "number" ||
      (typeof value === "string" && value.trim() !== "")) &&
    Number.isFinite(Number(value))
  );
}
function show(value: unknown): string {
  return value === null || value === undefined || value === ""
    ? "Unavailable in source"
    : String(value);
}
function fmt(value: number | string): string {
  return number.format(Number(value));
}
function isIncident(value: unknown): value is Incident {
  return (
    object(value) &&
    typeof value["record_id"] === "string" &&
    typeof value["source_id"] === "string" &&
    typeof value["source_row"] === "number" &&
    typeof value["occurred_date"] === "string" &&
    typeof value["occurred_date_raw"] === "string" &&
    typeof value["plant_code"] === "string" &&
    typeof value["asset_tag_as_provided"] === "string" &&
    (value["ar_no"] === null || typeof value["ar_no"] === "string") &&
    (value["mto_no"] === null || typeof value["mto_no"] === "string") &&
    (value["overall_status_as_provided"] === null ||
      typeof value["overall_status_as_provided"] === "string") &&
    finite(value["downtime_hours"]) &&
    finite(value["actual_loss_kusd"]) &&
    finite(value["potential_loss_kusd"]) &&
    object(value["raw"])
  );
}
function isLink(value: unknown): value is LinkRow {
  return (
    object(value) &&
    typeof value["link_id"] === "string" &&
    typeof value["incident_record_id"] === "string" &&
    typeof value["rca_document_id"] === "string" &&
    typeof value["asset_id"] === "string" &&
    value["match_status"] === "verified" &&
    Array.isArray(value["evidence_locator"]) &&
    value["evidence_locator"].every((item: unknown) => typeof item === "string")
  );
}
function isDocument(value: unknown): value is Document {
  return (
    object(value) &&
    typeof value["document_id"] === "string" &&
    typeof value["source_id"] === "string" &&
    typeof value["source_file"] === "string" &&
    typeof value["linked_incident_record_id"] === "string" &&
    typeof value["asset_id"] === "string" &&
    typeof value["plant_code"] === "string" &&
    typeof value["incident_occurred_date"] === "string" &&
    typeof value["ar_no_as_provided"] === "string" &&
    typeof value["reported_date_raw"] === "string" &&
    value["available_at"] === null &&
    value["slide_count"] === 11 &&
    (value["visual_review_status"] === "pending" ||
      value["visual_review_status"] === "reviewed")
  );
}
function isSlide(value: unknown): value is Slide {
  return (
    object(value) &&
    typeof value["slide_id"] === "string" &&
    typeof value["document_id"] === "string" &&
    typeof value["incident_record_id"] === "string" &&
    typeof value["source_slide_number"] === "number" &&
    typeof value["content_role_hint"] === "string" &&
    (value["visual_review_status"] === "pending" ||
      value["visual_review_status"] === "reviewed") &&
    typeof value["text_block_count"] === "number" &&
    typeof value["unread_visual_count"] === "number" &&
    Array.isArray(value["blocks_in_powerpoint_order"]) &&
    value["blocks_in_powerpoint_order"].every(
      (item: unknown) =>
        object(item) &&
        typeof item["shape_path"] === "string" &&
        typeof item["kind"] === "string" &&
        (item["text"] === null || typeof item["text"] === "string"),
    )
  );
}
function isSimilarRow(value: unknown): value is SimilarRow {
  return (
    object(value) &&
    typeof value["record_id"] === "string" &&
    typeof value["occurred_date"] === "string" &&
    typeof value["plant_code"] === "string" &&
    typeof value["asset_tag_as_provided"] === "string" &&
    object(value["raw"])
  );
}
function normalized(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLocaleLowerCase("en-US");
  return text && !["n/a", "na", "-", "unknown", "none"].includes(text)
    ? text
    : null;
}
function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}
function isTraceEvidenceItem(value: unknown): value is TraceEvidenceItem {
  return (
    object(value) &&
    typeof value["statement"] === "string" &&
    stringArray(value["evidence_ids"])
  );
}
function isTraceContributor(value: unknown): value is TraceContributor {
  return (
    object(value) &&
    typeof value["statement"] === "string" &&
    (value["status"] === "possible" ||
      value["status"] === "insufficient_evidence") &&
    stringArray(value["supporting_evidence_ids"])
  );
}
function isTraceCandidateAction(value: unknown): value is TraceCandidateAction {
  return (
    object(value) &&
    typeof value["title"] === "string" &&
    typeof value["action"] === "string" &&
    typeof value["rationale"] === "string" &&
    typeof value["success_criteria"] === "string" &&
    stringArray(value["evidence_ids"])
  );
}
function isTraceAnalysis(value: unknown): value is TraceAnalysis {
  return (
    object(value) &&
    typeof value["summary"] === "string" &&
    Array.isArray(value["observed_evidence"]) &&
    value["observed_evidence"].every(isTraceEvidenceItem) &&
    Array.isArray(value["possible_contributors"]) &&
    value["possible_contributors"].every(isTraceContributor) &&
    stringArray(value["contradicting_or_missing_evidence"]) &&
    stringArray(value["recommended_next_checks"]) &&
    typeof value["confidence_statement"] === "string" &&
    typeof value["abstain"] === "boolean" &&
    isTraceCandidateAction(value["candidate_action"])
  );
}
function isTraceResponse(value: unknown): value is TraceResponse {
  return (
    object(value) &&
    typeof value["generated"] === "boolean" &&
    typeof value["provider"] === "string" &&
    (value["model"] === null || typeof value["model"] === "string") &&
    typeof value["trace_ai_version"] === "string" &&
    isTraceAnalysis(value["analysis"]) &&
    Array.isArray(value["evidence_registry"]) &&
    value["evidence_registry"].every(
      (item: unknown) =>
        object(item) &&
        typeof item["evidence_id"] === "string" &&
        typeof item["meaning"] === "string",
    ) &&
    typeof value["limitation"] === "string"
  );
}

export default function InvestigationPage() {
  const { incidentId } = useParams<{ incidentId: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requestedBack = params.get("back");
  const backPath = requestedBack?.startsWith("/dashboard/problem-tank?")
    ? requestedBack
    : "/dashboard/problem-tank";
  const [incident, setIncident] = useState<Incident | null>(null);
  const [incidentStatus, setIncidentStatus] = useState<State>("loading");
  const [link, setLink] = useState<LinkRow | null>(null);
  const [document, setDocument] = useState<Document | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [rcaStatus, setRcaStatus] = useState<RCAState>("idle");
  const [similarRows, setSimilarRows] = useState<SimilarRow[]>([]);
  const [similarStatus, setSimilarStatus] = useState<State>("loading");
  const [preEvent, setPreEvent] = useState<PreEvent | null>(null);
  const [preEventStatus, setPreEventStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [traceStatus, setTraceStatus] = useState<TraceState>("idle");
  const [traceResult, setTraceResult] = useState<TraceResponse | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const traceRequestId = useRef(0);

  useEffect(() => {
    let active = true;
    setIncident(null);
    setIncidentStatus("loading");
    setLink(null);
    setDocument(null);
    setSlides([]);
    setRcaStatus("idle");
    setSimilarRows([]);
    setSimilarStatus("loading");
    setPreEvent(null);
    setPreEventStatus("loading");
    traceRequestId.current += 1;
    setTraceStatus("idle");
    setTraceResult(null);
    setTraceError(null);
    setHandoffError(null);
    if (!incidentId || incidentId.length > 200) {
      setIncidentStatus("missing");
      return () => {
        active = false;
      };
    }
    async function loadIncident() {
      const { data, error } = await supabase
        .from("incident_records")
        .select(
          "record_id,source_id,source_row,occurred_date,occurred_date_raw,plant_code,asset_tag_as_provided,ar_no,mto_no,downtime_hours,actual_loss_kusd,potential_loss_kusd,overall_status_as_provided,raw",
        )
        .eq("dataset_id", "caliber2026_case2")
        .eq("record_id", incidentId)
        .maybeSingle();
      if (!active) return;
      if (error) {
        setIncidentStatus("error");
        return;
      }
      if (!data) {
        setIncidentStatus("missing");
        return;
      }
      if (!isIncident(data) || data.record_id !== incidentId) {
        setIncidentStatus("error");
        return;
      }
      setRcaStatus("idle");
      setSimilarStatus("loading");
      setLink(null);
      setDocument(null);
      setSlides([]);
      setSimilarRows([]);
      setIncident(data);
      setIncidentStatus("ready");
    }
    void loadIncident();
    return () => {
      active = false;
    };
  }, [incidentId]);

  useEffect(() => {
    if (!incident || incident.record_id !== incidentId) return;
    let active = true;
    setLink(null);
    setDocument(null);
    setSlides([]);
    setRcaStatus("loading");
    async function loadRca() {
      const linkResult = await supabase
        .from("case_links")
        .select(
          "link_id,incident_record_id,rca_document_id,asset_id,match_status,evidence_locator",
        )
        .eq("dataset_id", "caliber2026_case2")
        .eq("relation_kind", "incident_rca")
        .eq("match_status", "verified")
        .eq("incident_record_id", incident!.record_id)
        .limit(2);
      if (!active) return;
      const links = linkResult.data ?? [];
      if (
        linkResult.error ||
        links.length > 1 ||
        links.some((row) => !isLink(row))
      ) {
        setRcaStatus("error");
        return;
      }
      if (links.length === 0) {
        setRcaStatus("absent");
        return;
      }
      const matched = links[0] as LinkRow;
      const { data: docData, error: docError } = await supabase
        .from("rca_documents")
        .select(
          "document_id,source_id,source_file,linked_incident_record_id,asset_id,plant_code,incident_occurred_date,ar_no_as_provided,reported_date_raw,available_at,visual_review_status,slide_count",
        )
        .eq("document_id", matched.rca_document_id)
        .eq("dataset_id", "caliber2026_case2")
        .maybeSingle();
      if (!active) return;
      if (
        docError ||
        !isDocument(docData) ||
        matched.incident_record_id !== incident!.record_id ||
        docData.linked_incident_record_id !== incident!.record_id ||
        docData.document_id !== matched.rca_document_id ||
        docData.asset_id !== matched.asset_id ||
        docData.plant_code !== incident!.plant_code ||
        docData.incident_occurred_date !== incident!.occurred_date ||
        (incident!.ar_no && docData.ar_no_as_provided !== incident!.ar_no)
      ) {
        setRcaStatus("error");
        return;
      }
      const sectionResult = await supabase
        .from("rca_sections")
        .select(
          "slide_id,document_id,incident_record_id,source_slide_number,content_role_hint,visual_review_status,text_block_count,unread_visual_count,blocks_in_powerpoint_order",
        )
        .eq("document_id", docData.document_id)
        .eq("dataset_id", "caliber2026_case2")
        .order("source_slide_number")
        .limit(12);
      if (!active) return;
      const rawSlides = sectionResult.data ?? [];
      if (
        sectionResult.error ||
        rawSlides.length !== 11 ||
        rawSlides.some(
          (row, index) =>
            !isSlide(row) ||
            row.document_id !== docData.document_id ||
            row.incident_record_id !== incident!.record_id ||
            row.source_slide_number !== index + 1,
        )
      ) {
        setRcaStatus("error");
        return;
      }
      setLink(matched);
      setDocument(docData);
      setSlides(rawSlides as Slide[]);
      setRcaStatus("present");
    }
    void loadRca();
    return () => {
      active = false;
    };
  }, [incident, incidentId]);

  // Retrospective only: find the last weekly row strictly before the recorded incident date.
  // The incident has no verified occurrence hour, so a same-day weekly row is excluded.
  useEffect(() => {
    if (!incident || incident.record_id !== incidentId) return;
    let active = true;
    setPreEvent(null);
    setPreEventStatus("loading");
    async function loadPreEvent() {
      try {
        const asset = await supabase
          .from("assets")
          .select("asset_id,asset_tag,plant_code")
          .eq("dataset_id", "caliber2026_case2")
          .eq("asset_tag", incident!.asset_tag_as_provided)
          .eq("plant_code", incident!.plant_code)
          .eq("detailed_observations_available", true)
          .maybeSingle();
        if (!active) return;
        if (asset.error) {
          setPreEventStatus("error");
          return;
        }
        if (!asset.data) {
          setPreEventStatus("ready");
          return;
        }
        const result = await supabase
          .from("equipment_observations")
          .select("record_id,source_id,observed_date,health_status_as_provided")
          .eq("dataset_id", "caliber2026_case2")
          .eq("asset_id", asset.data.asset_id)
          .lt("observed_date", incident!.occurred_date)
          .order("observed_date", { ascending: false })
          .limit(1);
        if (!active) return;
        if (result.error) {
          setPreEventStatus("error");
          return;
        }
        const row = result.data?.[0];
        if (
          row &&
          typeof row.record_id === "string" &&
          typeof row.source_id === "string" &&
          typeof row.observed_date === "string" &&
          row.observed_date < incident!.occurred_date &&
          typeof row.health_status_as_provided === "string"
        ) {
          setPreEvent({
            assetId: asset.data.asset_id,
            observedDate: row.observed_date,
            observationId: row.record_id,
            sourceId: row.source_id,
            status: row.health_status_as_provided,
          });
        } else if (row) {
          setPreEventStatus("error");
          return;
        }
        setPreEventStatus("ready");
      } catch {
        if (active) setPreEventStatus("error");
      }
    }
    void loadPreEvent();
    return () => {
      active = false;
    };
  }, [incident, incidentId]);

  useEffect(() => {
    if (!incident || incident.record_id !== incidentId) return;
    let active = true;
    setSimilarRows([]);
    setSimilarStatus("loading");
    async function loadSimilar() {
      const { data, count, error } = await supabase
        .from("incident_records")
        .select(
          "record_id,occurred_date,plant_code,asset_tag_as_provided,raw",
          { count: "exact" },
        )
        .eq("dataset_id", "caliber2026_case2")
        .order("record_id")
        .range(0, 999);
      if (!active) return;
      if (
        error ||
        count === null ||
        count !== (data ?? []).length ||
        (data ?? []).some((row) => !isSimilarRow(row))
      ) {
        setSimilarStatus("error");
        return;
      }
      setSimilarRows((data ?? []) as SimilarRow[]);
      setSimilarStatus("ready");
    }
    void loadSimilar();
    return () => {
      active = false;
    };
  }, [incident, incidentId]);

  const matches = useMemo<SimilarMatch[]>(() => {
    if (!incident || similarStatus !== "ready") return [];
    return similarRows
      .filter((row) => row.record_id !== incident.record_id)
      .flatMap((row) => {
        const component = normalized(incident.raw["Component"]);
        const equipmentType = normalized(incident.raw["Eq. Type"]);
        const mechanism = normalized(incident.raw["F Mechanism"]);
        const sameComponent =
          component !== null && component === normalized(row.raw["Component"]);
        const sameType =
          equipmentType !== null &&
          equipmentType === normalized(row.raw["Eq. Type"]);
        const genericLabel =
          mechanism === null ||
          ["high", "low", "other", "unknown", "normal"].includes(mechanism);
        const sameMechanism =
          !genericLabel && mechanism === normalized(row.raw["F Mechanism"]);
        // A broad equipment class or a generic mechanism by itself is not a useful failure match.
        if (!sameComponent && !sameType) return [];
        const tier: 1 | 2 | 3 = sameComponent ? 3 : sameMechanism ? 2 : 1;
        const reasons: string[] = [];
        if (sameComponent)
          reasons.push(`component: ${show(incident.raw["Component"])}`);
        if (sameType)
          reasons.push(`equipment type: ${show(incident.raw["Eq. Type"])}`);
        if (sameMechanism)
          reasons.push(
            `recorded mechanism label: ${show(incident.raw["F Mechanism"])}`,
          );
        const samePlant = row.plant_code === incident.plant_code;
        if (samePlant) reasons.push("same plant");
        return [{ ...row, reasons, tier, samePlant }];
      })
      .sort(
        (a, b) =>
          b.tier - a.tier ||
          Number(b.samePlant) - Number(a.samePlant) ||
          a.record_id.localeCompare(b.record_id),
      )
      .slice(0, 5);
  }, [incident, similarRows, similarStatus]);

  const strongMatches = matches.filter((item) => item.tier >= 2);
  const typeOnlyMatches = matches.filter((item) => item.tier === 1);
  const hasReviewedRca =
    document?.visual_review_status === "reviewed" &&
    slides.length === 11 &&
    slides.every(
      (slide) =>
        slide.visual_review_status === "reviewed" &&
        slide.unread_visual_count === 0,
    );
  const traceEvidenceMeaning = useMemo(() => {
    const entries =
      traceResult?.evidence_registry.map(
        (item) => [item.evidence_id, item.meaning] as const,
      ) ?? [];
    return new Map(entries);
  }, [traceResult]);

  async function analyzeWithTrace() {
    if (
      !incident ||
      incident.record_id !== incidentId ||
      traceStatus === "loading"
    )
      return;
    const requestId = ++traceRequestId.current;
    setTraceStatus("loading");
    setTraceResult(null);
    setTraceError(null);
    setHandoffError(null);
    try {
      const sessionResult = await supabase.auth.getSession();
      const token = sessionResult.data.session?.access_token;
      if (sessionResult.error || !token)
        throw new Error(
          "Your session is unavailable. Sign in again before running TRACE AI.",
        );

      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          mode: "retrospective",
          incidentId: incident.record_id,
          question:
            "Analyze the accessible evidence for this incident. Separate observed evidence from possible contributors, identify contradicting or missing evidence, recommend the next engineering checks, and draft one source-bound follow-up action for human review. Do not use an unreviewed RCA conclusion as fact.",
        }),
      });

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error(
          "TRACE AI returned a non-JSON response. Run this page through the Vercel server runtime.",
        );
      }
      if (!response.ok) {
        const message =
          object(payload) && typeof payload["error"] === "string"
            ? payload["error"]
            : `TRACE AI request failed (${response.status}).`;
        throw new Error(message);
      }
      if (!isTraceResponse(payload))
        throw new Error(
          "TRACE AI returned an unexpected response shape. No AI result is shown.",
        );
      if (requestId !== traceRequestId.current) return;
      setTraceResult(payload);
      setTraceStatus("ready");
    } catch (error) {
      if (requestId !== traceRequestId.current) return;
      setTraceError(
        error instanceof Error
          ? error.message
          : "TRACE AI could not analyze this incident.",
      );
      setTraceStatus("error");
    }
  }

  function evidenceLabel(ids: string[]) {
    if (ids.length === 0) return "No evidence ID supplied";
    return ids
      .map((id) =>
        traceEvidenceMeaning.has(id)
          ? `${id} — ${traceEvidenceMeaning.get(id)}`
          : id,
      )
      .join(" · ");
  }

  function reviewTraceAsDraft() {
    if (!incident || !traceResult || incident.record_id !== incidentId) return;

    const candidate = traceResult.analysis.candidate_action;
    const handoff = {
      version: 1,
      incident: incident.record_id,
      createdAt: new Date().toISOString(),
      generated: traceResult.generated,
      traceVersion: traceResult.trace_ai_version,
      candidate: {
        title: candidate.title,
        action: candidate.action,
        rationale: candidate.rationale,
        successCriteria: candidate.success_criteria,
      },
    };

    try {
      window.sessionStorage.setItem(
        `trace-mi:v5:trace-handoff:${incident.record_id}`,
        JSON.stringify(handoff),
      );
      setHandoffError(null);
      navigate(
        `/dashboard/actions?${new URLSearchParams({
          incidentId: incident.record_id,
          compose: "1",
          prefill: "trace",
        })}`,
      );
    } catch {
      setHandoffError(
        "TRACE draft handoff could not be prepared in this browser. No action was saved.",
      );
    }
  }

  return (
    <div className="app-shell investigate-page">
      <a className="skip-link" href="#investigation-content">
        Skip to investigation
      </a>
      <header className="app-topbar">
        <Link className="brand-link" to="/dashboard">
          SYNKARA <strong>TRACE-MI</strong>
        </Link>
        <nav aria-label="Dashboard navigation">
          <Link className="secondary-link" to={backPath}>
            ← Incident list
          </Link>
          <span aria-current="page">Investigation</span>
        </nav>
      </header>
      <main className="dashboard-content" id="investigation-content">
        <div className="dashboard-title">
          <p className="scope-label">
            CASE 2 · RETROSPECTIVE · AFTER THE INCIDENT
          </p>
          <h1>Follow one incident to its evidence</h1>
          <p>
            Start with its source row, compare documented observations, use
            TRACE AI to structure an evidence-bound review, then inspect any
            post-incident RCA before a human-approved action.
          </p>
        </div>
        {incidentStatus === "loading" && (
          <p className="route-status" role="status">
            Loading this incident…
          </p>
        )}
        {incidentStatus === "missing" && (
          <p className="route-status" role="alert">
            The incident was not found or is unavailable to this account. Return
            to Problem Tank to select a visible record.
          </p>
        )}
        {incidentStatus === "error" && (
          <p className="route-status" role="alert">
            The incident source could not be loaded or validated.
          </p>
        )}
        {incidentStatus === "ready" &&
          incident &&
          incident.record_id === incidentId && (
            <>
              <section
                className="panel investigate-case-intro"
                aria-label="Evidence boundary"
              >
                <p className="scope-label">
                  HISTORICAL CASE · {incident.plant_code}
                </p>
                <h2>
                  {incident.asset_tag_as_provided} · {incident.occurred_date}
                </h2>
                <p className="investigate-boundary">
                  The incident, similar records and RCA are retrospective. The
                  dated replay opens separately and shows only observations
                  available by its cutoff.
                </p>
              </section>
              <section
                className="panel"
                aria-labelledby="incident-facts-heading"
              >
                <p className="scope-label">1 · OBSERVED SOURCE RECORD</p>
                <h2 id="incident-facts-heading">
                  What did the incident record say?
                </h2>
                <p>{show(incident.raw["Risk Case Title"])}</p>
                <div className="case-facts">
                  <div>
                    <span>Recorded downtime</span>
                    <strong>{fmt(incident.downtime_hours)} h</strong>
                  </div>
                  <div>
                    <span>Actual loss</span>
                    <strong>{money(incident.actual_loss_kusd)}</strong>
                    <small>
                      Exact: {fmt(incident.actual_loss_kusd)} thousand USD
                    </small>
                  </div>
                  <div>
                    <span>Potential loss</span>
                    <strong>{money(incident.potential_loss_kusd)}</strong>
                    <small>
                      Exact: {fmt(incident.potential_loss_kusd)} thousand USD ·
                      separate exposure
                    </small>
                  </div>
                </div>
                <div className="investigate-source-links">
                  <Link
                    className="text-link"
                    to={`/data/incidents?${new URLSearchParams({ record: incident.record_id })}#incident-source-record`}
                  >
                    Open original Incident Database row {incident.source_row} ↗
                  </Link>
                </div>
                <details className="inline-evidence">
                  <summary>Source row and interpretation notes</summary>
                  <p>
                    Incident Database row {incident.source_row} · record{" "}
                    {incident.record_id} · source {incident.source_id} · raw
                    date {incident.occurred_date_raw}. AR:{" "}
                    {show(incident.ar_no)} · MTO: {show(incident.mto_no)} · Risk
                    Score: {show(incident.raw["Risk Score"])} · status snapshot:{" "}
                    {show(incident.overall_status_as_provided)}.
                  </p>
                  <p>
                    The source does not verify an event hour or time zone.
                    Potential loss is not realized loss; AR/MTO can repeat.
                  </p>
                </details>
              </section>

              <section className="panel" aria-labelledby="pre-event-heading">
                <p className="scope-label">
                  2 · EARLIER OBSERVATIONS · SEPARATE SOURCE
                </p>
                <h2 id="pre-event-heading">
                  What was recorded before the incident?
                </h2>
                {preEventStatus === "loading" && (
                  <p role="status">
                    Checking whether dated Equipment observations exist for this
                    asset…
                  </p>
                )}
                {preEventStatus === "error" && (
                  <p role="alert">
                    The earlier Equipment observation could not be checked. No
                    condition is inferred.
                  </p>
                )}
                {preEventStatus === "ready" && !preEvent && (
                  <p>
                    Detailed earlier Equipment observations are unavailable in
                    the supplied five-asset sample for this case. No normal
                    condition is inferred.
                  </p>
                )}
                {preEventStatus === "ready" && preEvent && (
                  <>
                    <p>
                      Last weekly Equipment record strictly before this incident
                      date:{" "}
                      <strong>
                        {preEvent.observedDate} · {preEvent.status}
                      </strong>
                      . A weekly reading is assumed available at the end of its
                      date; its exact historical availability is unverified.
                    </p>
                    <div className="investigate-source-links">
                      <Link
                        className="primary-link"
                        to={`/dashboard/problem-tank?${new URLSearchParams({ mode: "replay", asset: preEvent.assetId, cutoff: preEvent.observedDate })}`}
                      >
                        Rewind to {preEvent.observedDate} ↗
                      </Link>
                      <Link
                        className="text-link"
                        to={`/data/equipment?${new URLSearchParams({ source: preEvent.sourceId, observation: preEvent.observationId })}#equipment-source-observation`}
                      >
                        Open exact weekly source row ↗
                      </Link>
                    </div>
                    <details className="inline-evidence">
                      <summary>Observation source identity</summary>
                      <p>
                        Condition History · {preEvent.observationId} ·{" "}
                        {preEvent.sourceId}. Replay also shows Production
                        readings as a separate source with their own units. No
                        post-event RCA is used to produce this earlier
                        observation.
                      </p>
                    </details>
                  </>
                )}
              </section>

              <section className="panel" aria-labelledby="contributors-heading">
                <p className="scope-label">
                  3 · RETROSPECTIVE CLASSIFICATION SEARCH
                </p>
                <h2 id="contributors-heading">
                  Which past records merit comparison?
                </h2>
                <p className="source-note">
                  A common equipment class alone is not enough. A shared
                  component or equipment type plus a recorded mechanism label is
                  a classification match only; no shared physical cause has been
                  established.
                </p>
                {similarStatus === "loading" && (
                  <p role="status">
                    Comparing source classifications across accessible
                    incidents…
                  </p>
                )}
                {similarStatus === "error" && (
                  <p role="alert">
                    The comparison could not be completed or the source list was
                    truncated. No approximate matches are shown.
                  </p>
                )}
                {similarStatus === "ready" && (
                  <>
                    {strongMatches.length === 0 && (
                      <p role="status" className="investigate-rca-summary">
                        No convincing failure-pattern match is established by
                        the supplied classifications. A shared equipment type by
                        itself is too broad to infer a related cause.
                      </p>
                    )}
                    {strongMatches.length > 0 && (
                      <div className="similar-list">
                        {strongMatches.map((item) => (
                          <article key={item.record_id}>
                            <div>
                              <strong>{item.asset_tag_as_provided}</strong>
                              <small>
                                {item.plant_code} · {item.occurred_date} ·{" "}
                                {item.occurred_date > incident.occurred_date
                                  ? "later case"
                                  : item.occurred_date ===
                                      incident.occurred_date
                                    ? "same date; event order unknown"
                                    : "earlier case"}
                              </small>
                              <span className="investigate-similar-tier">
                                {item.tier === 3
                                  ? "Shared component"
                                  : "Shared type and label"}
                              </span>
                              <span>
                                Shared fields: {item.reasons.join(", ")}
                              </span>
                            </div>
                            <Link
                              className="text-link"
                              to={`/dashboard/investigation/${encodeURIComponent(item.record_id)}?${new URLSearchParams({ back: backPath })}`}
                            >
                              Inspect ↗
                            </Link>
                          </article>
                        ))}
                      </div>
                    )}
                    {typeOnlyMatches.length > 0 && (
                      <details className="inline-evidence">
                        <summary>
                          Explore records sharing only the equipment type (
                          {typeOnlyMatches.length} shown)
                        </summary>
                        <p>
                          These records have different or unverified failure
                          components and mechanisms. Their common type does not
                          make them similar failures.
                        </p>
                        <div className="similar-list">
                          {typeOnlyMatches.map((item) => (
                            <article key={item.record_id}>
                              <div>
                                <strong>{item.asset_tag_as_provided}</strong>
                                <small>
                                  {item.plant_code} · {item.occurred_date} ·{" "}
                                  {item.occurred_date > incident.occurred_date
                                    ? "later case"
                                    : item.occurred_date ===
                                        incident.occurred_date
                                      ? "same date; event order unknown"
                                      : "earlier case"}
                                </small>
                                <span>
                                  Shared field: {item.reasons.join(", ")}
                                </span>
                              </div>
                              <Link
                                className="text-link"
                                to={`/dashboard/investigation/${encodeURIComponent(item.record_id)}?${new URLSearchParams({ back: backPath })}`}
                              >
                                Inspect ↗
                              </Link>
                            </article>
                          ))}
                        </div>
                      </details>
                    )}
                    {matches.length > 0 && (
                      <details className="inline-evidence">
                        <summary>How records are selected</summary>
                        <p>
                          Up to five records are shown. Shared component is
                          ordered first, then equipment type plus recorded
                          mechanism label, then equipment type only. Same plant
                          and source record ID resolve ties. The search is
                          retrospective and can include later incidents; it is
                          not a predictive failure model. Source labels—class{" "}
                          {show(incident.raw["Eq. Class"])}, type{" "}
                          {show(incident.raw["Eq. Type"])}, component{" "}
                          {show(incident.raw["Component"])}, mechanism{" "}
                          {show(incident.raw["F Mechanism"])}—can be broad or
                          recorded after the event.
                        </p>
                      </details>
                    )}
                  </>
                )}
              </section>

              <section className="panel" aria-labelledby="trace-ai-heading">
                <p className="scope-label">4 · TRACE AI · EVIDENCE-TO-ACTION</p>
                <h2 id="trace-ai-heading">
                  What does the accessible evidence support?
                </h2>
                <p>
                  TRACE AI builds a server-side evidence package for this
                  incident and separates source facts, possible contributors,
                  missing evidence and next checks. It cannot approve work or
                  turn an unreviewed RCA slide into a confirmed cause.
                </p>
                <p className="source-note">
                  The deterministic similar-record search above remains a
                  separate comparison aid. TRACE AI does not treat a
                  classification match as proof of shared physical causation.
                </p>
                {traceStatus === "idle" && (
                  <button
                    className="primary-link"
                    type="button"
                    onClick={() => {
                      void analyzeWithTrace();
                    }}
                  >
                    Analyze accessible evidence
                  </button>
                )}
                {traceStatus === "loading" && (
                  <p className="route-status" role="status">
                    Building the bounded evidence package and asking TRACE AI…
                  </p>
                )}
                {traceStatus === "error" && (
                  <div>
                    <p className="route-status" role="alert">
                      {traceError}
                    </p>
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => {
                        void analyzeWithTrace();
                      }}
                    >
                      Try again
                    </button>
                  </div>
                )}
                {traceStatus === "ready" && traceResult && (
                  <>
                    <div className="investigate-rca-summary">
                      <p>
                        <strong>
                          {traceResult.generated
                            ? "AI DRAFT · VERIFY BEFORE USE"
                            : "SOURCE-BOUND SUMMARY · NO MODEL GENERATED"}
                        </strong>
                      </p>
                      <p>{traceResult.analysis.summary}</p>
                      <p>
                        <strong>Decision boundary:</strong>{" "}
                        {traceResult.analysis.abstain
                          ? "CAUSE UNDETERMINED — available evidence does not establish a physical root cause."
                          : "A causal statement still requires human verification against the cited source evidence."}
                      </p>
                    </div>

                    <div className="investigate-evidence-row">
                      <article>
                        <h3>Observed evidence</h3>
                        {traceResult.analysis.observed_evidence.length === 0 ? (
                          <p>No observed-evidence statement was returned.</p>
                        ) : (
                          traceResult.analysis.observed_evidence.map(
                            (item, index) => (
                              <div key={`trace-observed-${index}`}>
                                <p>{item.statement}</p>
                                <small>
                                  {evidenceLabel(item.evidence_ids)}
                                </small>
                              </div>
                            ),
                          )
                        )}
                      </article>
                      <article>
                        <h3>Possible contributors</h3>
                        {traceResult.analysis.possible_contributors.length ===
                        0 ? (
                          <p>
                            No contributor is supported strongly enough to
                            propose from the bounded evidence.
                          </p>
                        ) : (
                          traceResult.analysis.possible_contributors.map(
                            (item, index) => (
                              <div key={`trace-contributor-${index}`}>
                                <p>
                                  <strong>
                                    {item.status === "possible"
                                      ? "Possible"
                                      : "Insufficient evidence"}
                                    :
                                  </strong>{" "}
                                  {item.statement}
                                </p>
                                <small>
                                  {evidenceLabel(item.supporting_evidence_ids)}
                                </small>
                              </div>
                            ),
                          )
                        )}
                      </article>
                      <article>
                        <h3>Confidence / limitation</h3>
                        <p>{traceResult.analysis.confidence_statement}</p>
                        <small>
                          {traceResult.generated
                            ? "Model-generated structured draft · human verification required"
                            : "Deterministic source-bound fallback used"}
                        </small>
                      </article>
                    </div>

                    <div className="investigate-evidence-row">
                      <article>
                        <h3>Contradicting / missing evidence</h3>
                        <ul>
                          {traceResult.analysis.contradicting_or_missing_evidence.map(
                            (item, index) => (
                              <li key={`trace-gap-${index}`}>{item}</li>
                            ),
                          )}
                        </ul>
                      </article>
                      <article>
                        <h3>Recommended next checks</h3>
                        <ol>
                          {traceResult.analysis.recommended_next_checks.map(
                            (item, index) => (
                              <li key={`trace-check-${index}`}>{item}</li>
                            ),
                          )}
                        </ol>
                      </article>
                      <article>
                        <h3>Candidate action · not saved</h3>
                        <p>
                          <strong>
                            {traceResult.analysis.candidate_action.title}
                          </strong>
                        </p>
                        <p>{traceResult.analysis.candidate_action.action}</p>
                        <small>
                          {evidenceLabel(
                            traceResult.analysis.candidate_action.evidence_ids,
                          )}
                        </small>
                      </article>
                    </div>

                    <div className="insight-note">
                      <strong>Why this action:</strong>{" "}
                      {traceResult.analysis.candidate_action.rationale}
                      <br />
                      <strong>Success criteria:</strong>{" "}
                      {traceResult.analysis.candidate_action.success_criteria}
                    </div>
                    <details className="inline-evidence">
                      <summary>
                        TRACE AI evidence registry and limitation
                      </summary>
                      <p>{traceResult.limitation}</p>
                      <p>
                        <strong>Runtime:</strong> {traceResult.trace_ai_version}{" "}
                        ·{" "}
                        {traceResult.generated
                          ? traceResult.provider
                          : "deterministic fallback"}
                        {traceResult.generated && traceResult.model
                          ? ` · ${traceResult.model}`
                          : ""}
                      </p>
                      {traceResult.evidence_registry.map((item) => (
                        <p key={item.evidence_id}>
                          <strong>{item.evidence_id}</strong> — {item.meaning}
                        </p>
                      ))}
                    </details>
                    <p className="source-note">
                      The candidate above is advisory only. TRACE AI does not
                      save, assign, approve, complete or verify an action.
                      Continue to the human action workflow to create an
                      accountable record.
                    </p>
                    {handoffError && (
                      <p className="route-status" role="alert">
                        {handoffError}
                      </p>
                    )}
                    <button
                      className="primary-link"
                      type="button"
                      onClick={reviewTraceAsDraft}
                    >
                      Review as action draft
                    </button>
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => {
                        void analyzeWithTrace();
                      }}
                    >
                      Run analysis again
                    </button>
                  </>
                )}
              </section>

              <section className="panel" aria-labelledby="rca-heading">
                <p className="scope-label">5 · POST-INCIDENT RCA MATERIAL</p>
                <h2 id="rca-heading">
                  What does the linked RCA actually support?
                </h2>
                {rcaStatus === "loading" && (
                  <p role="status">
                    Checking verified document links and slide status…
                  </p>
                )}
                {rcaStatus === "absent" && (
                  <p role="status">
                    <strong>RCA not supplied in competition baseline.</strong>{" "}
                    This does not prove that no RCA exists outside the materials
                    supplied. A specific root cause cannot be confirmed from
                    this dataset.
                  </p>
                )}
                {rcaStatus === "error" && (
                  <p role="alert">
                    RCA link, document identity, or slide sequence could not be
                    validated. No RCA conclusions are shown.
                  </p>
                )}
                {rcaStatus === "present" &&
                  link?.incident_record_id === incident.record_id &&
                  document?.linked_incident_record_id ===
                    incident.record_id && (
                    <>
                      <p>
                        <strong>Linked document:</strong> {document.source_file}
                      </p>
                      <div className="investigate-rca-summary">
                        <p>
                          <strong>Document identity:</strong> linked to this
                          incident by verified identifiers.
                        </p>
                        <p>
                          <strong>Conclusion status:</strong>{" "}
                          {hasReviewedRca
                            ? "Slides marked visually reviewed; check the exact relevant slide before quoting its finding."
                            : "Slide interpretation pending visual review; no physical root cause is certified by this dashboard."}
                        </p>
                        <p>
                          <strong>Timing:</strong> post-incident material, never
                          evidence that its conclusions were available by an
                          earlier replay cutoff.
                        </p>
                      </div>
                      <div className="investigate-source-links">
                        <Link
                          className="text-link"
                          to={`/data/rca?${new URLSearchParams({ document: document.document_id })}#rca-source-document`}
                        >
                          Inspect linked RCA PDF rendition and slide extracts ↗
                        </Link>
                      </div>
                      <details className="inline-evidence">
                        <summary>Document link and timing</summary>
                        <p>
                          Link {link.link_id}:{" "}
                          {link.evidence_locator.length
                            ? link.evidence_locator.join("; ")
                            : "Verified source identifiers"}
                          . Document identity is verified; slide interpretation
                          is not. Reported date: {document.reported_date_raw};
                          full conclusion availability is unknown. The replay
                          excludes this RCA.
                        </p>
                      </details>
                      {(document.visual_review_status !== "reviewed" ||
                        slides.some(
                          (slide) =>
                            slide.visual_review_status !== "reviewed" ||
                            slide.unread_visual_count > 0,
                        )) && (
                        <p role="status">
                          <strong>Visual review pending.</strong> Extracted text
                          below is a source preview, not a visually verified
                          quotation or confirmed root cause. Check the original
                          slide and any diagrams/tables before citing a finding.
                        </p>
                      )}
                      <details className="investigate-rca-slides">
                        <summary>
                          Browse the 11 extracted slides and source locators
                        </summary>
                        {slides.map((slide) => (
                          <details
                            key={slide.slide_id}
                            style={{
                              padding: "12px 0",
                              borderTop: "1px solid #d7e1e3",
                            }}
                          >
                            <summary>
                              Slide {slide.source_slide_number} ·{" "}
                              {slide.content_role_hint} · visual check{" "}
                              {slide.visual_review_status}
                            </summary>
                            <p className="source-note">
                              Slide ID {slide.slide_id} · extracted blocks{" "}
                              {slide.text_block_count} · unread visual objects{" "}
                              {slide.unread_visual_count}. The role is an
                              indexing hint, not a verified conclusion.
                            </p>
                            {slide.blocks_in_powerpoint_order.map(
                              (block, index) => (
                                <div
                                  key={`${slide.slide_id}-${block.shape_path}-${index}`}
                                  style={{
                                    margin: "9px 0",
                                    padding: 12,
                                    borderLeft: "3px solid #81aaa6",
                                    background: "#f5f7f8",
                                  }}
                                >
                                  <small>
                                    Shape {block.shape_path} · {block.kind} ·{" "}
                                    {slide.visual_review_status ===
                                      "reviewed" &&
                                    slide.unread_visual_count === 0
                                      ? "extracted from visually reviewed slide"
                                      : "unverified extraction preview"}
                                  </small>
                                  {block.text === null ? (
                                    <p>
                                      Non-text content: inspect the original
                                      slide.
                                    </p>
                                  ) : (
                                    <pre
                                      style={{
                                        whiteSpace: "pre-wrap",
                                        overflowWrap: "anywhere",
                                        fontFamily: "inherit",
                                      }}
                                    >
                                      {block.text}
                                    </pre>
                                  )}
                                </div>
                              ),
                            )}
                          </details>
                        ))}
                      </details>
                      <p className="source-note">
                        A post-incident RCA is not evidence that its explanation
                        was available at the earlier replay cutoff. Text from
                        pending slides must not be promoted to a confirmed
                        finding or used for automatic action approval.
                      </p>
                    </>
                  )}
              </section>
              <section
                className="panel"
                aria-labelledby="evidence-summary-heading"
              >
                <p className="scope-label">6 · HUMAN-REVIEWED INTERPRETATION</p>
                <h2 id="evidence-summary-heading">
                  What can the engineer decide from this?
                </h2>
                <div className="investigate-evidence-row">
                  <article>
                    <h3>Recorded fact</h3>
                    <p>
                      {incident.asset_tag_as_provided} had a recorded incident
                      on {incident.occurred_date}, with{" "}
                      {fmt(incident.downtime_hours)} hours of downtime.
                    </p>
                    <small>Incident Database · row {incident.source_row}</small>
                  </article>
                  <article>
                    <h3>Check worth making</h3>
                    <p>
                      {preEvent
                        ? `A ${preEvent.status} appears in weekly Equipment data on ${preEvent.observedDate}. Check its instrument and measurement context before interpreting it.`
                        : "Earlier detailed Equipment observations have not been established for this case. Begin by checking the source classifications and operational records."}
                    </p>
                    <small>
                      {preEvent
                        ? `Condition History · ${preEvent.observationId}`
                        : "Human validation required"}
                    </small>
                  </article>
                  <article>
                    <h3>Cause assessment</h3>
                    <p>
                      {hasReviewedRca
                        ? "RCA slides are marked reviewed, but a specific finding still needs its exact slide citation and engineer validation."
                        : "A specific physical root cause is not verified in this view. Any linked RCA extraction remains a preview until its slides are checked visually."}
                    </p>
                    <small>
                      {document
                        ? `${document.source_file} · retrospective`
                        : "No verified RCA conclusion"}
                    </small>
                  </article>
                </div>
              </section>
              <section className="panel" aria-labelledby="followup-heading">
                <p className="scope-label">
                  7 · HUMAN DECISION · DEMO WORKFLOW
                </p>
                <h2 id="followup-heading">Propose a follow-up action</h2>
                <p>
                  Review a source-linked proposal, then assign it to the shared
                  demo account with a due date.
                </p>
                <div className="insight-note">
                  <strong>Human gate:</strong>{" "}
                  {traceResult
                    ? `TRACE AI has produced a candidate action above for review. Use Review as action draft to prefill a human-editable proposal. Saving creates only an unassigned proposal; acceptance or rejection happens later in the action workflow.`
                    : `No AI draft is required to continue. A human may create a source-linked inspection or follow-up, but must not promote an unreviewed RCA preview into a verified cause.`}
                </div>
                <Link
                  className="primary-link"
                  to={`/dashboard/actions?incidentId=${encodeURIComponent(incident.record_id)}&compose=1`}
                >
                  <svg
                    aria-hidden="true"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M12 4v16M4 12h16" />
                  </svg>
                  Draft an action for this case
                </Link>
                <Link
                  className="secondary-link"
                  style={{ marginLeft: 10 }}
                  to={`/dashboard/assistant?incident=${encodeURIComponent(incident.record_id)}`}
                >
                  Ask about this evidence ↗
                </Link>
                <p className="source-note">
                  The action workspace rebuilds and validates its own stable source
                  context before saving. TRACE evidence IDs are not treated as
                  persistent database evidence, and an unreviewed RCA remains
                  unverified context.
                </p>
              </section>
            </>
          )}
      </main>
    </div>
  );
}
