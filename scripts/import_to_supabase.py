"""Import validated Case 2, historical RCA or external energy into Supabase.

Run from the project root, after scripts/validate_data.py:
    python scripts/import_to_supabase.py --dry-run --dataset case2
    python scripts/import_to_supabase.py --dry-run --dataset rca
    python scripts/import_to_supabase.py --dry-run --dataset energy
    python -m pip install "psycopg[binary]>=3.2,<4"
    # Set SYNKARA_DATABASE_URL privately in the current shell, then:
    python scripts/import_to_supabase.py --execute --dataset rca

RCA is retained as unreviewed, post-incident source material. No RCA action is
imported before visual inspection. UCI steel energy is an external 2018 backtest,
never Chandra Asri meter readings. Never commit a DB URL.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from collections import Counter
from datetime import date, datetime, time
from decimal import Decimal
from itertools import zip_longest
from pathlib import Path
from typing import Any, Iterator


DATASET_ID = "caliber2026_case2"
ENERGY_DATASET_ID = "uci_steel_industry_2018_external"
EXPECTED = {
    "incidents.jsonl": 380,
    "incident_dashboard_rows.jsonl": 25,
    "production_tags.jsonl": 35,
    "production_readings.jsonl": 3600,
    "equipment_info_rows.jsonl": 70,
    "equipment_metadata.jsonl": 60,
    "equipment_limits.jsonl": 20,
    "equipment_conditions.jsonl": 130,
    "equipment_summary.jsonl": 65,
}
TARGET_TABLES = {
    "source_catalog": 11,
    "plants": 12,
    "production_tag_catalog": 35,
    "production_records": 3600,
    "production_values": 25200,
    "equipment_reference": 150,
    "equipment_observations": 130,
    "equipment_summary_values": 65,
    "incident_records": 380,
    "incident_source_summary": 25,
}
COMMON = ("record_id", "dataset_id", "source_id", "source_sha256",
          "source_sheet", "source_row", "source_row_id")
RAW = ("raw", "raw_types", "raw_number_formats")
ASSET = ("asset_id", "plant_code")
SQL_COLUMNS = {
    "source_catalog": ("source_id", "dataset_id", "origin_kind", "source_kind",
                       "relative_path", "source_sha256", "source_bytes", "source_scope",
                       "granularity_label", "record_count", "availability_note",
                       "visual_review_status"),
    "plants": ("plant_code", "detailed_observations_available"),
    "assets": ("asset_id", "plant_code", "asset_tag", "detailed_observations_available"),
    "production_tag_catalog": COMMON + ASSET + ("tag_name",
                               "engineering_unit_as_provided", "instrument_tag_as_provided") + RAW,
    "production_records": COMMON + ASSET + ("observed_at_raw", "observed_at_naive",
                           "time_grain") + RAW,
    "production_values": ("production_record_id", "source_id", "tag_name", "raw_value",
                          "numeric_value", "text_value", "engineering_unit_as_provided"),
    "equipment_reference": COMMON + ASSET + ("reference_kind", "raw", "raw_types",
                            "field_name_as_provided", "field_value_as_provided",
                            "post_event_context", "parameter_name_as_provided",
                            "parameter_label_raw", "unit_as_provided", "alarm_trip_raw",
                            "alarm_value_as_provided", "trip_value_as_provided",
                            "threshold_direction", "historical_valid_from"),
    "equipment_observations": COMMON + ASSET + ("observed_date_raw", "observed_date",
                              "observed_time", "available_at", "week_as_provided",
                              "health_status_as_provided", "time_grain", "measurements") + RAW,
    "equipment_summary_values": COMMON + ASSET + ("kpi_name_as_provided",
                                 "value_as_provided", "basis_as_provided", "time_scope") + RAW,
    "incident_records": COMMON + ("plant_code", "asset_tag_as_provided", "asset_id",
                         "occurred_date_raw", "occurred_date", "ar_no", "mto_no",
                         "rca_due_date", "overall_status_as_provided", "downtime_hours",
                         "actual_loss_kusd", "potential_loss_kusd",
                         "total_loss_kusd_as_provided") + RAW,
    "incident_source_summary": COMMON + RAW,
    "rca_documents": ("document_id", "dataset_id", "source_id", "source_sha256",
                      "source_file", "asset_id", "plant_code",
                      "linked_incident_record_id", "ar_no_as_provided",
                      "incident_occurred_date", "reported_date_raw", "reported_date",
                      "available_at", "slide_count", "markdown_relative_path",
                      "markdown_sha256", "link_status", "visual_review_status"),
    "rca_sections": ("slide_id", "dataset_id", "document_id", "source_id",
                     "source_sha256", "source_file", "markdown_relative_path",
                     "source_slide_number", "asset_id", "plant_code",
                     "incident_record_id", "content_role_hint", "document_time_scope",
                     "blocks_in_powerpoint_order", "text_block_count",
                     "unread_visual_count", "visual_review_status", "available_at"),
    "case_links": ("link_id", "dataset_id", "relation_kind", "incident_record_id",
                   "rca_document_id", "asset_id", "left_source_id", "right_source_id",
                   "match_status", "match_reason", "evidence_locator", "rule_version"),
    "energy_readings": ("record_id", "dataset_id", "source_id", "source_sha256",
                        "source_file", "source_csv_row", "sequence_index",
                        "source_time_label_raw", "source_date_label",
                        "timestamp_derived_naive", "time_derivation",
                        "timestamp_derivation_is_inference", "time_grain_as_provided",
                        "unit_usage", "usage_kwh",
                        "numeric_fields_for_historical_inspection", "source_fields_raw",
                        "calendar_features_derived", "future_target_feature_policy",
                        "source_scope"),
    "energy_model_runs": ("model_run_id", "dataset_id", "source_id", "source_sha256",
                          "prepared_readings_sha256", "model_version",
                          "selected_baseline", "selection_metric", "feature_policy",
                          "train_start_sequence_index", "train_end_sequence_index",
                          "validation_start_sequence_index", "validation_end_sequence_index",
                          "test_start_sequence_index", "test_end_sequence_index",
                          "test_cutoff_count", "validation_baselines", "test_baselines",
                          "interval_semantics_status", "source_scope", "generated_at_utc"),
    "energy_forecasts": ("forecast_id", "dataset_id", "model_run_id", "source_id",
                         "cutoff_sequence_index", "cutoff_timestamp_derived_naive",
                         "input_start_sequence_index", "input_end_sequence_index",
                         "input_start_timestamp_derived_naive",
                         "input_end_timestamp_derived_naive",
                         "target_start_sequence_index", "target_end_sequence_index",
                         "target_timestamps_derived_naive", "horizon_minutes",
                         "predicted_kwh_by_horizon", "predicted_hour_kwh_as_provided",
                         "data_split", "source_scope"),
    "energy_forecast_evaluations": ("forecast_id", "cutoff_sequence_index",
                                    "actual_kwh_by_horizon",
                                    "actual_hour_kwh_as_provided",
                                    "absolute_kwh_error_by_horizon",
                                    "absolute_hour_total_error_kwh", "evaluation_split"),
}
JSON_COLUMNS = {
    "raw", "raw_types", "raw_number_formats", "raw_value",
    "field_value_as_provided", "measurements", "value_as_provided",
    "blocks_in_powerpoint_order",
    "numeric_fields_for_historical_inspection", "source_fields_raw",
    "calendar_features_derived", "validation_baselines", "test_baselines",
}
KEYS = {
    "source_catalog": ("source_id",), "plants": ("plant_code",),
    "assets": ("asset_id",), "production_tag_catalog": ("record_id",),
    "production_records": ("record_id",),
    "production_values": ("production_record_id", "tag_name"),
    "equipment_reference": ("record_id",),
    "equipment_observations": ("record_id",),
    "equipment_summary_values": ("record_id",),
    "incident_records": ("record_id",),
    "incident_source_summary": ("record_id",),
    "rca_documents": ("document_id",), "rca_sections": ("slide_id",),
    "case_links": ("link_id",),
    "energy_readings": ("record_id",),
    "energy_model_runs": ("model_run_id",),
    "energy_forecasts": ("forecast_id",),
    "energy_forecast_evaluations": ("forecast_id",),
}
ORDER = ("source_catalog", "plants", "assets", "production_tag_catalog",
         "production_records", "production_values", "equipment_reference",
         "equipment_observations", "equipment_summary_values", "incident_records",
         "incident_source_summary")
RCA_ORDER = ("source_catalog", "rca_documents", "rca_sections", "case_links")
ENERGY_ORDER = ("source_catalog", "energy_readings", "energy_model_runs",
                "energy_forecasts", "energy_forecast_evaluations")


class ImportErrorSafe(Exception):
    """An input or database condition prevents a safe import."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ImportErrorSafe(message)


def digest(path: Path) -> str:
    require(path.is_file(), f"Berkas tidak ada: {path}")
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(chunk)
    return sha.hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    require(path.is_file(), f"Berkas tidak ada: {path}")
    value = json.loads(path.read_text(encoding="utf-8"))
    require(isinstance(value, dict), f"JSON bukan objek: {path}")
    return value


def records(path: Path, expected: int) -> Iterator[dict[str, Any]]:
    count = 0
    with path.open("r", encoding="utf-8") as stream:
        for count, line in enumerate(stream, start=1):
            value = json.loads(line)
            require(isinstance(value, dict), f"JSONL rusak: {path.name}:{count}")
            yield value
    require(count == expected, f"{path.name}: diharapkan {expected}, ditemukan {count}")


def asset_id(plant: str, tag: str) -> str:
    identity = f"{DATASET_ID}|{plant}|{tag}".encode("utf-8")
    return "case2_asset_" + hashlib.sha256(identity).hexdigest()


def normalized(source: dict[str, Any], row: dict[str, Any],
               with_asset: bool = True) -> dict[str, Any]:
    for key in COMMON:
        require(key in row, f"Kolom sumber tidak ada: {key}")
    require(row["dataset_id"] == DATASET_ID and
            row["source_sha256"] == source["sha256"] and
            row["source_id"] == source["source_id"],
            f"Provenance berbeda: {row['record_id']}")
    result = {key: row[key] for key in COMMON}
    if with_asset:
        plant, tag = row["plant"], row["asset_tag"]
        require(isinstance(plant, str) and isinstance(tag, str) and plant and tag,
                f"Identitas aset kosong: {row['record_id']}")
        result.update(asset_id=asset_id(plant, tag), plant_code=plant)
    return result


def build(prepared: Path, report_path: Path) -> dict[str, dict[tuple, dict[str, Any]]]:
    report = read_json(report_path)
    require(report.get("technical_integrity_gate") == "PASS", "Validasi teknis belum PASS")
    manifest = read_json(prepared / "manifest.json")
    require(manifest.get("dataset_id") == DATASET_ID, "Dataset manifest keliru")
    require(digest(prepared / "manifest.json") ==
            report.get("input_metadata_sha256", {}).get("case2_manifest"),
            "Manifest berubah sesudah validasi; jalankan lagi validate_data.py")
    catalog = read_json(prepared / "source_catalog.json")
    require(digest(prepared / "source_catalog.json") ==
            manifest.get("source_catalog_sha256"), "Checksum source_catalog berbeda")
    sources = catalog.get("sources")
    require(isinstance(sources, list) and len(sources) == 11, "Katalog harus 11 sumber")
    by_source = {source["source_id"]: source for source in sources}
    require(len(by_source) == 11 and
            report.get("case2", {}).get("sources") == 11, "Sumber duplikat/tidak valid")
    for filename, count in EXPECTED.items():
        require(manifest.get("record_counts", {}).get(filename) == count and
                report.get("case2", {}).get("record_counts", {}).get(filename) == count,
                f"Jumlah audit tidak sama: {filename}")
        require(digest(prepared / filename) == manifest.get("output_sha256", {}).get(filename),
                f"Checksum berubah: {filename}")

    tables: dict[str, dict[tuple, dict[str, Any]]] = {table: {} for table in ORDER}

    def add(table: str, record: dict[str, Any]) -> None:
        require(set(record) == set(SQL_COLUMNS[table]),
                f"Pemetaan kolom tidak tepat: {table}, {record.get('record_id', '')}")
        key = tuple(record[field] for field in KEYS[table])
        require(key not in tables[table], f"Kunci impor berulang: {table} {key}")
        tables[table][key] = record

    source_totals: Counter[str] = Counter()
    for filename, count in EXPECTED.items():
        for row in records(prepared / filename, count):
            source = by_source.get(row.get("source_id"))
            require(source is not None, f"Source ID tidak dikenal: {filename}")
            source_totals[source["source_id"]] += 1
            require(row.get("source_file") == source["relative_path"],
                    f"Source path berbeda: {filename}")
            if filename == "production_tags.jsonl":
                base = normalized(source, row)
                add("production_tag_catalog", {**base, "tag_name": row["tag_name"],
                    "engineering_unit_as_provided": row["engineering_unit_as_provided"],
                    "instrument_tag_as_provided": row["raw"].get("instrumenttag"),
                    **{name: row[name] for name in RAW}})
            elif filename == "production_readings.jsonl":
                base = normalized(source, row)
                add("production_records", {**base,
                    **{key: row[key] for key in ("observed_at_raw", "observed_at_naive",
                                                   "time_grain") + RAW}})
                require(len(row["signals"]) == 7, "Production signals harus tujuh")
                for signal in row["signals"]:
                    value = signal["value"]
                    require(isinstance(value, (int, float, str)) and
                            not isinstance(value, bool), "Nilai Production tidak dikenal")
                    add("production_values", {
                        "production_record_id": row["record_id"],
                        "source_id": row["source_id"], "tag_name": signal["tag_name"],
                        "raw_value": value,
                        "numeric_value": value if isinstance(value, (int, float)) else None,
                        "text_value": value if isinstance(value, str) else None,
                        "engineering_unit_as_provided": signal["engineering_unit_as_provided"],
                    })
            elif filename in ("equipment_info_rows.jsonl", "equipment_metadata.jsonl",
                              "equipment_limits.jsonl"):
                base = normalized(source, row)
                item: dict[str, Any] = {key: None for key in SQL_COLUMNS["equipment_reference"]}
                item.update(base)
                if filename == "equipment_info_rows.jsonl":
                    item.update(reference_kind="source_row", raw=row["raw"],
                                raw_types=row["raw_types"])
                elif filename == "equipment_metadata.jsonl":
                    item.update(reference_kind="metadata",
                                field_name_as_provided=row["field_name"],
                                field_value_as_provided=row["value_as_provided"],
                                post_event_context=row["post_event_context"])
                else:
                    item.update(reference_kind="threshold",
                                parameter_name_as_provided=row["parameter_name"],
                                parameter_label_raw=row["parameter_label_raw"],
                                unit_as_provided=row["unit_as_provided"],
                                alarm_trip_raw=row["alarm_trip_raw"],
                                alarm_value_as_provided=row["alarm_value_as_provided"],
                                trip_value_as_provided=row["trip_value_as_provided"],
                                threshold_direction=row["direction"],
                                historical_valid_from=row["historical_valid_from"])
                item["post_event_context"] = item["post_event_context"] or False
                add("equipment_reference", item)
            elif filename == "equipment_conditions.jsonl":
                base = normalized(source, row)
                add("equipment_observations", {**base,
                    **{key: row[key] for key in ("observed_date_raw", "observed_date",
                        "observed_time", "available_at", "week_as_provided",
                        "health_status_as_provided", "time_grain", "measurements") + RAW}})
            elif filename == "equipment_summary.jsonl":
                base = normalized(source, row)
                add("equipment_summary_values", {**base,
                    "kpi_name_as_provided": row["kpi_name"],
                    **{key: row[key] for key in ("value_as_provided", "basis_as_provided",
                                                   "time_scope") + RAW}})
            elif filename == "incidents.jsonl":
                base = normalized(source, row, with_asset=False)
                add("incident_records", {**base, "plant_code": row["plant"],
                    "asset_tag_as_provided": row["asset_tag"],
                    "asset_id": asset_id(row["plant"], row["asset_tag"]),
                    **{key: row[key] for key in ("occurred_date_raw", "occurred_date",
                        "ar_no", "mto_no", "rca_due_date", "overall_status_as_provided",
                        "downtime_hours", "actual_loss_kusd", "potential_loss_kusd",
                        "total_loss_kusd_as_provided") + RAW}})
            else:
                base = normalized(source, row, with_asset=False)
                add("incident_source_summary", {**base,
                    **{key: row[key] for key in RAW}})

    detailed = {(source["plant"], source["asset_tag"]) for source in sources
                if source["category"] in ("production", "equipment")}
    require(len(detailed) == 5, "Diharapkan lima aset detail")
    asset_labels = {(row["plant_code"], row["asset_tag_as_provided"])
                    for row in tables["incident_records"].values()} | detailed
    for plant, tag in sorted(asset_labels):
        require(isinstance(plant, str) and plant.strip() and
                isinstance(tag, str) and tag.strip(), "Plant/tag kosong pada insiden")
        add("assets", {"asset_id": asset_id(plant, tag), "plant_code": plant,
                       "asset_tag": tag,
                       "detailed_observations_available": (plant, tag) in detailed})
    for plant in sorted({plant for plant, _ in asset_labels}):
        add("plants", {"plant_code": plant, "detailed_observations_available":
                       any(item[0] == plant for item in detailed)})

    for source in sources:
        kind = source["category"]
        expected_total = {"incident": 405, "production": 727,
                          "equipment": 69}[kind]
        require(source_totals[source["source_id"]] == expected_total,
                f"Jumlah baris sumber berbeda: {source['relative_path']}")
        add("source_catalog", {
            "source_id": source["source_id"], "dataset_id": DATASET_ID,
            "origin_kind": "competition_provided", "source_kind": kind,
            "relative_path": source["relative_path"], "source_sha256": source["sha256"],
            "source_bytes": source["bytes"], "source_scope":
                "historical_case2_12_plant_incident_portfolio" if kind == "incident"
                else "case2_five_example_assets_only",
            "granularity_label": {"incident": "event_and_provided_dashboard_rows",
                                  "production": "hourly_and_tag_catalog",
                                  "equipment": "weekly_and_full_period_source_summary"}[kind],
            "record_count": expected_total, "availability_note": None,
            "visual_review_status": "not_applicable",
        })
    for table, count in TARGET_TABLES.items():
        require(len(tables[table]) == count,
                f"Jumlah {table} berbeda: {len(tables[table])} vs {count}")
    print("PREFLIGHT LULUS: 11 sumber, 12 plant, 380 insiden, 3.600 Production,"
          " 130 Condition History.")
    print("RCA dan UCI energy belum diimpor; tabel demo publik tetap kosong.")
    return tables


def build_rca(prepared: Path, case_dir: Path,
              report_path: Path) -> dict[str, dict[tuple, dict[str, Any]]]:
    report = read_json(report_path)
    require(report.get("technical_integrity_gate") == "PASS" and
            report.get("rca", {}).get("documents") == 5 and
            report.get("rca", {}).get("manual_visual_review_pending") == 55,
            "Validasi RCA belum PASS atau status visual tidak sesuai")
    manifest = read_json(prepared / "manifest.json")
    require(digest(prepared / "manifest.json") ==
            report.get("input_metadata_sha256", {}).get("rca_manifest") and
            manifest.get("dataset_id") == DATASET_ID, "Manifest RCA berubah sesudah validasi")
    catalog = read_json(prepared / "source_catalog.json")
    require(digest(prepared / "source_catalog.json") ==
            manifest.get("output_sha256", {}).get("source_catalog.json"),
            "Checksum katalog RCA tidak cocok")
    sources = catalog.get("sources")
    require(isinstance(sources, list) and len(sources) == 5,
            "Diperlukan lima file sumber RCA")
    by_source = {item["source_id"]: item for item in sources}
    require(len(by_source) == 5 and all(item.get("category") == "historical_rca"
                                         for item in sources), "Katalog RCA salah")
    for name in ("rca_documents.jsonl", "rca_slides.jsonl"):
        require(digest(prepared / name) == manifest.get("output_sha256", {}).get(name),
                f"Checksum {name} berbeda")
    case_manifest = read_json(case_dir / "manifest.json")
    require(digest(case_dir / "manifest.json") ==
            report.get("input_metadata_sha256", {}).get("case2_manifest") and
            digest(case_dir / "incidents.jsonl") ==
            case_manifest.get("output_sha256", {}).get("incidents.jsonl"),
            "Indeks insiden Case 2 berubah sesudah validasi")
    incidents = {row["record_id"]: row for row in records(case_dir / "incidents.jsonl", 380)}
    require(len(incidents) == 380, "ID insiden Case 2 duplikat")

    tables: dict[str, dict[tuple, dict[str, Any]]] = {name: {} for name in RCA_ORDER}

    def add(table: str, record: dict[str, Any]) -> None:
        require(set(record) == set(SQL_COLUMNS[table]), f"Kolom tidak cocok: {table}")
        key = tuple(record[field] for field in KEYS[table])
        require(key not in tables[table], f"Kunci RCA berulang: {table} {key}")
        tables[table][key] = record

    for source in sources:
        require(source.get("dataset_id") == DATASET_ID and source.get("slide_count") == 11,
                "Sumber RCA tidak sesuai dataset/jumlah slide")
        add("source_catalog", {
            "source_id": source["source_id"], "dataset_id": DATASET_ID,
            "origin_kind": "competition_provided", "source_kind": "historical_rca",
            "relative_path": source["relative_path"], "source_sha256": source["sha256"],
            "source_bytes": source["bytes"],
            "source_scope": "historical_case2_five_incident_specific_reports",
            "granularity_label": "11_slides_per_document", "record_count": 11,
            "availability_note": "Publication time unknown; Date Reported is not an availability timestamp",
            "visual_review_status": "pending",
        })

    docs_by_source = {}
    for doc in records(prepared / "rca_documents.jsonl", 5):
        source = by_source.get(doc.get("source_id"))
        incident = incidents.get(doc.get("linked_incident_record_id"))
        require(source is not None and incident is not None and
                doc.get("dataset_id") == DATASET_ID and
                doc.get("source_file") == source["relative_path"] and
                doc.get("source_sha256") == source["sha256"] and
                (doc.get("plant"), doc.get("asset_tag"), doc.get("ar_no"),
                 doc.get("incident_occurred_date")) ==
                (incident["plant"], incident["asset_tag"], incident["ar_no"],
                 incident["occurred_date"]) and
                doc.get("link_status") == "verified_by_tag_plant_AR_and_occurrence_date"
                and doc.get("visual_review_status") == "pending" and
                doc.get("available_at") is None and doc.get("slide_count") == 11,
                "Hubungan RCA dengan baris insiden tidak cocok")
        rel = doc["markdown_relative_path"]
        rel_path = Path(rel)
        require(not rel_path.is_absolute() and rel_path.parts[:1] == ("markdown",) and
                ".." not in rel_path.parts and rel_path.suffix == ".md" and
                manifest.get("markdown_sha256", {}).get(rel) == doc["markdown_sha256"]
                and digest(prepared / rel_path) == doc["markdown_sha256"],
                "Markdown RCA hilang/berubah atau path tidak aman")
        require(doc["source_id"] not in docs_by_source, "Sumber RCA berulang")
        docs_by_source[doc["source_id"]] = doc
        identity = asset_id(doc["plant"], doc["asset_tag"])
        add("rca_documents", {
            "document_id": doc["document_id"], "dataset_id": DATASET_ID,
            "source_id": doc["source_id"], "source_sha256": doc["source_sha256"],
            "source_file": doc["source_file"], "asset_id": identity,
            "plant_code": doc["plant"],
            "linked_incident_record_id": incident["record_id"],
            "ar_no_as_provided": doc["ar_no"],
            "incident_occurred_date": doc["incident_occurred_date"],
            "reported_date_raw": doc["reported_date_as_provided"],
            "reported_date": doc["reported_date"], "available_at": None,
            "slide_count": doc["slide_count"], "markdown_relative_path": rel,
            "markdown_sha256": doc["markdown_sha256"],
            "link_status": doc["link_status"], "visual_review_status": "pending",
        })
        link_seed = f"{DATASET_ID}|incident_rca|{incident['record_id']}|{doc['document_id']}"
        add("case_links", {
            "link_id": "case2_link_" + hashlib.sha256(link_seed.encode("utf-8")).hexdigest(),
            "dataset_id": DATASET_ID, "relation_kind": "incident_rca",
            "incident_record_id": incident["record_id"],
            "rca_document_id": doc["document_id"], "asset_id": identity,
            "left_source_id": incident["source_id"], "right_source_id": doc["source_id"],
            "match_status": "verified",
            "match_reason": "Matched source cover tag, plant, AR and occurrence date to the incident row; slide conclusions still await visual review",
            "evidence_locator": [
                f"{incident['source_file']}:Incident Database:row:{incident['source_row']}",
                f"{doc['source_file']}:slide:1",
            ],
            "rule_version": 1,
        })
    require(len(docs_by_source) == 5 and
            len({doc["linked_incident_record_id"] for doc in docs_by_source.values()}) == 5,
            "Kaitan RCA/insiden tidak satu-ke-satu")
    numbers: dict[str, set[int]] = {source: set() for source in docs_by_source}
    for slide in records(prepared / "rca_slides.jsonl", 55):
        doc = docs_by_source.get(slide.get("source_id"))
        require(doc is not None and slide.get("dataset_id") == DATASET_ID and
                slide.get("source_sha256") == doc["source_sha256"] and
                slide.get("source_file") == doc["source_file"] and
                slide.get("markdown_relative_path") == doc["markdown_relative_path"] and
                slide.get("linked_incident_record_id") == doc["linked_incident_record_id"] and
                (slide.get("asset_tag"), slide.get("plant")) ==
                (doc["asset_tag"], doc["plant"]) and
                slide.get("visual_review_status") == "pending" and
                slide.get("available_at") is None and
                slide.get("document_time_scope") == "post_incident_document" and
                isinstance(slide.get("blocks_in_powerpoint_order"), list),
                "Slide RCA tidak sesuai sumber/dokumen/status")
        no = slide["source_slide_number"]
        require(type(no) is int and 1 <= no <= 11 and no not in numbers[doc["source_id"]],
                "Nomor slide berulang/di luar 1–11")
        numbers[doc["source_id"]].add(no)
        add("rca_sections", {
            "slide_id": slide["slide_id"], "dataset_id": DATASET_ID,
            "document_id": doc["document_id"], "source_id": doc["source_id"],
            "source_sha256": slide["source_sha256"],
            "source_file": slide["source_file"],
            "markdown_relative_path": slide["markdown_relative_path"],
            "source_slide_number": no,
            "asset_id": asset_id(doc["plant"], doc["asset_tag"]),
            "plant_code": doc["plant"],
            "incident_record_id": doc["linked_incident_record_id"],
            "content_role_hint": slide["content_role_hint"],
            "document_time_scope": slide["document_time_scope"],
            "blocks_in_powerpoint_order": slide["blocks_in_powerpoint_order"],
            "text_block_count": slide["text_block_count"],
            "unread_visual_count": slide["unread_visual_count"],
            "visual_review_status": "pending", "available_at": None,
        })
    require(all(v == set(range(1, 12)) for v in numbers.values()),
            "Lima dokumen belum memuat semua 11 slide")
    require({table: len(rows) for table, rows in tables.items()} ==
            {"source_catalog": 5, "rca_documents": 5, "rca_sections": 55,
             "case_links": 5}, "Jumlah tabel RCA salah")
    print("PREFLIGHT RCA LULUS: 5 sumber/dokumen, 55 slide, 5 kaitan insiden.")
    print("Status visual pending; available_at tetap NULL; rca_actions tidak diisi.")
    return tables


def build_energy(prepared: Path, forecast_dir: Path,
                 report_path: Path) -> dict[str, dict[tuple, dict[str, Any]]]:
    report = read_json(report_path)
    require(report.get("technical_integrity_gate") == "PASS" and
            report.get("external_energy", {}).get("readings") == 35040 and
            report.get("external_forecast", {}).get("test_cutoffs") == 5277,
            "Validasi energi/forecast belum PASS")
    manifest = read_json(prepared / "manifest.json")
    summary = read_json(forecast_dir / "forecast_summary.json")
    audit_hashes = report.get("input_metadata_sha256", {})
    require(digest(prepared / "manifest.json") == audit_hashes.get("energy_manifest") and
            digest(forecast_dir / "forecast_summary.json") ==
            audit_hashes.get("energy_forecast_summary"),
            "Manifest energi/forecast berubah sejak validasi")
    catalog = read_json(prepared / "source_catalog.json")
    require(manifest.get("dataset_id") == ENERGY_DATASET_ID and
            catalog.get("dataset_id") == ENERGY_DATASET_ID and
            catalog.get("company_meter_data_available") is False and
            catalog.get("source_id") == manifest.get("source_id") and
            catalog.get("source_sha256") == manifest.get("source_sha256") and
            digest(prepared / "source_catalog.json") ==
            manifest.get("output_sha256", {}).get("source_catalog.json") and
            digest(prepared / "energy_readings.jsonl") ==
            manifest.get("output_sha256", {}).get("energy_readings.jsonl"),
            "Katalog, label eksternal, atau checksum UCI tidak cocok")
    require(summary.get("dataset_id") == ENERGY_DATASET_ID and
            summary.get("source_id") == manifest["source_id"] and
            summary.get("prepared_energy_sha256") ==
            manifest["output_sha256"]["energy_readings.jsonl"] and
            summary.get("model_version") == "baseline_15min_four_steps_v1" and
            summary.get("selected_baseline") in
                ("last_observation", "same_time_previous_day") and
            summary.get("selection_metric") ==
                "validation_mae_kwh_per_interval_all_horizons" and
            summary.get("allowed_forecast_features") == ["past_Usage_kWh_only"] and
            summary.get("test_cutoff_count") == 5277 and
            summary.get("split_sequence_index_inclusive") == {
                "train_reference_no_parameters_fitted": [1, 24480],
                "validation_targets": [24481, 29760],
                "test_targets": [29761, 35040],
            }, "Versi, split, atau fitur model tidak sesuai audit")
    for filename in ("test_predictions.jsonl", "test_holdout_evaluations.jsonl"):
        require(digest(forecast_dir / filename) ==
                summary.get("result_files", {}).get(filename),
                f"Checksum forecast berubah: {filename}")

    tables: dict[str, dict[tuple, dict[str, Any]]] = {name: {} for name in ENERGY_ORDER}

    def add(table: str, item: dict[str, Any]) -> None:
        require(set(item) == set(SQL_COLUMNS[table]), f"Kolom energi tidak cocok: {table}")
        key = tuple(item[field] for field in KEYS[table])
        require(key not in tables[table], f"ID energi berulang: {table} {key}")
        tables[table][key] = item

    source_id = catalog["source_id"]
    add("source_catalog", {
        "source_id": source_id, "dataset_id": ENERGY_DATASET_ID,
        "origin_kind": "external_demo", "source_kind": "external_electricity_history",
        "relative_path": catalog["source_name"],
        "source_sha256": catalog["source_sha256"],
        "source_bytes": catalog["source_size_bytes"],
        "source_scope": "external_steel_industry_south_korea_2018",
        "granularity_label": "15_minute_source_rows_2018",
        "record_count": 35040,
        "availability_note": "Historical external demonstration; measurement interval boundary unverified",
        "visual_review_status": "not_applicable",
    })
    stamps: list[str] = []
    usages: list[float] = []
    midnights = 0
    for seq, row in enumerate(records(prepared / "energy_readings.jsonl", 35040), 1):
        require(row.get("dataset_id") == ENERGY_DATASET_ID and
                row.get("source_id") == source_id and
                row.get("source_sha256") == catalog["source_sha256"] and
                row.get("source_file") == catalog["source_name"] and
                row.get("sequence_index") == seq and
                row.get("source_csv_row") == seq + 1 and
                row.get("source_scope") == "external_steel_industry_south_korea_2018" and
                row.get("source_fields_raw", {}).get("date") ==
                row.get("source_time_label_raw") and
                row.get("time_grain_as_provided") == "15_minute_record" and
                row.get("unit_usage") == "kWh", "Baris energi tidak sesuai sumber/urutan")
        shift = row["time_derivation"] == "source_00_00_at_end_of_day_shifted_to_next_day"
        require(shift == row["timestamp_derivation_is_inference"],
                "Penandaan pergeseran tengah malam tidak konsisten")
        midnights += shift
        stamps.append(row["timestamp_derived_naive"])
        usages.append(row["usage_kwh"])
        add("energy_readings", {key: row[key] for key in SQL_COLUMNS["energy_readings"]})
    require(midnights == 365 and stamps[0] == "2018-01-01T00:15" and
            stamps[-1] == "2019-01-01T00:00", "Rentang waktu energi berubah")

    split = summary["split_sequence_index_inclusive"]
    run_seed = (f"{ENERGY_DATASET_ID}|{source_id}|{summary['prepared_energy_sha256']}|"
                f"{summary['model_version']}|{summary['selected_baseline']}")
    run_id = "uci_energy_run_" + hashlib.sha256(run_seed.encode("utf-8")).hexdigest()
    add("energy_model_runs", {
        "model_run_id": run_id, "dataset_id": ENERGY_DATASET_ID,
        "source_id": source_id, "source_sha256": catalog["source_sha256"],
        "prepared_readings_sha256": summary["prepared_energy_sha256"],
        "model_version": summary["model_version"],
        "selected_baseline": summary["selected_baseline"],
        "selection_metric": summary["selection_metric"],
        "feature_policy": "past_Usage_kWh_only",
        "train_start_sequence_index": split["train_reference_no_parameters_fitted"][0],
        "train_end_sequence_index": split["train_reference_no_parameters_fitted"][1],
        "validation_start_sequence_index": split["validation_targets"][0],
        "validation_end_sequence_index": split["validation_targets"][1],
        "test_start_sequence_index": split["test_targets"][0],
        "test_end_sequence_index": split["test_targets"][1],
        "test_cutoff_count": summary["test_cutoff_count"],
        "validation_baselines": summary["validation_baselines"],
        "test_baselines": summary["test_baselines"],
        "interval_semantics_status": "assumption_needs_source_confirmation",
        "source_scope": "external_steel_industry_south_korea_2018",
        "generated_at_utc": summary["generated_at_utc"],
    })

    predictions = records(forecast_dir / "test_predictions.jsonl", 5277)
    evaluations = records(forecast_dir / "test_holdout_evaluations.jsonl", 5277)
    for offset, (pred, result) in enumerate(zip_longest(predictions, evaluations)):
        require(pred is not None and result is not None,
                "Jumlah prediksi dan evaluasi berbeda")
        cutoff = 29760 + offset
        actual = usages[cutoff:cutoff + 4]
        expected_pred = ([usages[cutoff - 1]] * 4
                         if summary["selected_baseline"] == "last_observation"
                         else usages[cutoff - 96:cutoff - 92])
        require(pred.get("forecast_id") == result.get("forecast_id") and
                pred.get("dataset_id") == ENERGY_DATASET_ID and
                pred.get("source_id") == source_id and
                pred.get("model_version") == summary["model_version"] and
                pred.get("method_selected_on_validation") ==
                summary["selected_baseline"] and
                pred.get("cutoff_sequence_index") == cutoff and
                result.get("cutoff_sequence_index") == cutoff and
                pred.get("cutoff_timestamp_derived_naive") == stamps[cutoff - 1] and
                pred.get("target_timestamps_derived_naive") == stamps[cutoff:cutoff + 4] and
                pred.get("input_window_sequence_index_inclusive") ==
                [cutoff - 95, cutoff] and
                pred.get("predicted_kwh_next_15_30_45_60_minutes") == expected_pred and
                result.get("actual_kwh_next_15_30_45_60_minutes") == actual and
                pred.get("split") == "test" and
                pred.get("source_scope") == "external_steel_industry_south_korea_2018",
                f"Cutoff/target historis tidak sesuai: {cutoff}")
        add("energy_forecasts", {
            "forecast_id": pred["forecast_id"], "dataset_id": ENERGY_DATASET_ID,
            "model_run_id": run_id, "source_id": source_id,
            "cutoff_sequence_index": cutoff,
            "cutoff_timestamp_derived_naive": pred["cutoff_timestamp_derived_naive"],
            "input_start_sequence_index": cutoff - 95,
            "input_end_sequence_index": cutoff,
            "input_start_timestamp_derived_naive":
                pred["input_window_derived_naive"][0],
            "input_end_timestamp_derived_naive":
                pred["input_window_derived_naive"][1],
            "target_start_sequence_index": cutoff + 1,
            "target_end_sequence_index": cutoff + 4,
            "target_timestamps_derived_naive":
                [datetime.fromisoformat(stamp) for stamp in
                 pred["target_timestamps_derived_naive"]],
            "horizon_minutes": [15, 30, 45, 60],
            "predicted_kwh_by_horizon": [Decimal(str(value)) for value in expected_pred],
            "predicted_hour_kwh_as_provided":
                pred["predicted_kwh_next_hour_assuming_interval_kwh"],
            "data_split": "test", "source_scope": pred["source_scope"],
        })
        add("energy_forecast_evaluations", {
            "forecast_id": result["forecast_id"],
            "cutoff_sequence_index": cutoff,
            "actual_kwh_by_horizon": [Decimal(str(value)) for value in actual],
            "actual_hour_kwh_as_provided":
                result["actual_kwh_next_hour_assuming_interval_kwh"],
            "absolute_kwh_error_by_horizon":
                [Decimal(str(value)) for value in result["absolute_kwh_error_by_horizon"]],
            "absolute_hour_total_error_kwh":
                result["absolute_one_hour_total_error_kwh"],
            "evaluation_split": result["split"],
        })
    require({table: len(rows) for table, rows in tables.items()} == {
        "source_catalog": 1, "energy_readings": 35040, "energy_model_runs": 1,
        "energy_forecasts": 5277, "energy_forecast_evaluations": 5277,
    }, "Jumlah hasil impor energi berbeda dari audit")
    print("PREFLIGHT ENERGY LULUS: 35.040 bacaan UCI; 1 model;"
          " 5.277 forecast dan 5.277 evaluasi.")
    print("Sumber baja Korea Selatan 2018; berkas forecast/holdout menyimpan kWh tanpa biaya atau tarif.")
    return tables


def execute(tables: dict[str, dict[tuple, dict[str, Any]]],
            order: tuple[str, ...] = ORDER, label: str = "Case 2") -> None:
    url = os.environ.get("SYNKARA_DATABASE_URL", "")
    require(url.startswith(("postgres://", "postgresql://")),
            "Atur SYNKARA_DATABASE_URL ke URI koneksi Postgres Supabase secara privat")
    try:
        import psycopg
        from psycopg.types.json import Jsonb
    except ImportError as exc:
        raise ImportErrorSafe('Pasang driver: python -m pip install "psycopg[binary]>=3.2,<4"') from exc

    try:
        with psycopg.connect(url, connect_timeout=15, sslmode="require") as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute("select pg_advisory_xact_lock(%s)", (26092612,))
                    if label == "RCA":
                        for doc in tables["rca_documents"].values():
                            left_source = next(
                                link["left_source_id"] for link in
                                tables["case_links"].values()
                                if link["rca_document_id"] == doc["document_id"]
                            )
                            cur.execute("select source_id, asset_id, plant_code, "
                                        "asset_tag_as_provided, occurred_date, ar_no "
                                        "from public.incident_records where record_id = %s",
                                        (doc["linked_incident_record_id"],))
                            found = cur.fetchone()
                            require(found is not None and
                                    found[0] == left_source and
                                    found[1] == doc["asset_id"] and
                                    found[2] == doc["plant_code"] and
                                    asset_id(found[2], found[3]) == doc["asset_id"] and
                                    found[4].isoformat() == doc["incident_occurred_date"] and
                                    found[5] == doc["ar_no_as_provided"],
                                    "Baris insiden RCA tidak cocok dengan database")
                    for table in order:
                        columns, key_fields = SQL_COLUMNS[table], KEYS[table]
                        keys = tables[table]
                        # Shared tables may already contain RCA/energy assets or sources;
                        # only this import's keys are compared. Other Case 2 records
                        # require separate import procedures and are preserved.
                        cur.execute("select " + ", ".join(key_fields) +
                                    " from public." + table)
                        present = set(tuple(item) for item in cur.fetchall())
                        overlap = present & keys.keys()
                        require(not overlap or overlap == keys.keys(),
                                f"{table}: impor sebelumnya hanya sebagian; periksa sebelum mengulang")
                        if overlap:
                            # For same IDs, at minimum verify all source hashes and
                            # full mapped values; check all imported rows, not a sample.
                            cur.execute("select " + ", ".join(columns) +
                                        " from public." + table)
                            for values in cur.fetchall():
                                current = dict(zip(columns, values))
                                pk = tuple(current[key] for key in key_fields)
                                if pk not in keys:
                                    continue
                                expected = keys[pk]
                                for col in columns:
                                    a, b = current[col], expected[col]
                                    if col in JSON_COLUMNS:
                                        a = json.dumps(a, sort_keys=True, ensure_ascii=False)
                                        b = json.dumps(b, sort_keys=True, ensure_ascii=False)
                                    elif isinstance(a, (datetime, date, time)):
                                        b = type(a).fromisoformat(b) if isinstance(b, str) else b
                                    elif isinstance(a, Decimal):
                                        b = Decimal(str(b))
                                    require(a == b, f"{table}: baris lama berubah ({pk[0]}), kolom {col}")
                            print(f"{table}: sudah identik ({len(keys)}); dilewati")
                            continue
                        placeholders = ", ".join(["%s"] * len(columns))
                        insert_sql = ("insert into public." + table + " (" +
                                      ", ".join(columns) + ") values (" +
                                      placeholders + ")")
                        # Psycopg 3 pipelines executemany(), avoiding tens of
                        # thousands of individual network round trips.
                        pending = list(keys.values())
                        for start in range(0, len(pending), 500):
                            chunk = pending[start:start + 500]
                            cur.executemany(insert_sql, [
                                tuple(Jsonb(row[col]) if col in JSON_COLUMNS and
                                      row[col] is not None else row[col]
                                      for col in columns)
                                for row in chunk
                            ])
                        print(f"{table}: {len(keys)} baris disiapkan dalam transaksi")
                    # The whole import commits only if every table has passed.
        print(f"SUKSES: transaksi {label} tersimpan; energi eksternal menyusul.")
    except psycopg.Error as exc:
        # Do not print connection URI, SQL parameters, or input source rows.
        constraint = getattr(exc.diag, "constraint_name", None)
        location = f" pada aturan {constraint}" if constraint else ""
        raise ImportErrorSafe(
            f"Transaksi dibatalkan; database melaporkan {exc.sqlstate or 'error'}{location}"
        ) from None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--dry-run", action="store_true", help="Periksa berkas tanpa koneksi DB")
    modes.add_argument("--execute", action="store_true", help="Tulis lewat satu transaksi DB")
    parser.add_argument("--dataset", choices=("case2", "rca", "energy"), default="case2")
    parser.add_argument("--prepared-dir", type=Path, default=Path("imports/prepared/case2"))
    parser.add_argument("--rca-dir", type=Path, default=Path("imports/prepared/rca"))
    parser.add_argument("--energy-dir", type=Path, default=Path("imports/prepared/energy"))
    parser.add_argument("--forecast-dir", type=Path,
                        default=Path("imports/prepared/energy_forecast"))
    parser.add_argument("--report", type=Path, default=Path("imports/prepared/validation_report.json"))
    args = parser.parse_args()
    try:
        if args.dataset == "case2":
            tables, order, label = build(args.prepared_dir, args.report), ORDER, "Case 2"
        elif args.dataset == "rca":
            tables, order, label = (build_rca(args.rca_dir, args.prepared_dir, args.report),
                                    RCA_ORDER, "RCA")
        else:
            tables, order, label = (build_energy(args.energy_dir, args.forecast_dir,
                                                 args.report), ENERGY_ORDER, "Energy UCI")
        if args.execute:
            execute(tables, order, label)
        else:
            print("DRY RUN: database tidak diakses; tak ada kunci diperlukan.")
    except (ImportErrorSafe, ValueError, KeyError, TypeError, OSError) as exc:
        print(f"GAGAL: {exc}", file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
