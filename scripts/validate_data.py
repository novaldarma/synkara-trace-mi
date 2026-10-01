"""Audit prepared SYNKARA datasets and known source conflicts before import.

Run from project root: python scripts/validate_data.py
Standard library only. Reads prepared data; writes an aggregate-only report to
imports/prepared/validation_report.json. Never uploads or modifies source data.

A successful technical check does not complete manual review of 55 RCA slides,
authorize quotations from unreviewed matrices, or prove deployment security.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import tempfile
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable


CASE_ID = "caliber2026_case2"
ENERGY_ID = "uci_steel_industry_2018_external"
ASSETS = {
    "PU-2101B": "ARP", "KO-3201": "ZCU", "PM-4405B": "NUP",
    "HE-3301": "ZCU", "BL-5702": "OPP",
}
CASE_COUNTS = {
    "incidents.jsonl": 380, "incident_dashboard_rows.jsonl": 25,
    "production_tags.jsonl": 35, "production_readings.jsonl": 3600,
    "equipment_info_rows.jsonl": 70, "equipment_metadata.jsonl": 60,
    "equipment_limits.jsonl": 20, "equipment_conditions.jsonl": 130,
    "equipment_summary.jsonl": 65,
}
RCA_COUNTS = {"rca_documents.jsonl": 5, "rca_slides.jsonl": 55}
HORIZON = 4
TRAIN_END = 24480
VALIDATION_END = 29760
EXPECTED_TEST_CUTOFFS = 5277


class ValidationError(Exception):
    """An input is missing, changed, or inconsistent with the audited case."""


def ensure(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    ensure(path.is_file(), f"Berkas tidak ditemukan: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    ensure(isinstance(data, dict), f"Objek JSON tidak valid: {path}")
    return data


def rows(path: Path, expected: int) -> Iterable[dict[str, Any]]:
    ensure(path.is_file(), f"Berkas tidak ditemukan: {path}")
    count = 0
    with path.open("r", encoding="utf-8") as stream:
        for count, line in enumerate(stream, start=1):
            item = json.loads(line)
            ensure(isinstance(item, dict), f"Objek rusak: {path.name} baris {count}")
            yield item
    ensure(count == expected, f"{path.name}: seharusnya {expected}, ditemukan {count}")


def check_hash(path: Path, expected: str | None) -> None:
    ensure(isinstance(expected, str) and len(expected) == 64,
           f"Checksum tidak tersedia/valid untuk {path}")
    ensure(path.is_file() and sha256(path) == expected,
           f"Checksum berbeda untuk {path}; siapkan ulang dari sumber yang sah")


def load_manifest(folder: Path, dataset_id: str) -> dict[str, Any]:
    manifest = read_json(folder / "manifest.json")
    ensure(manifest.get("dataset_id") == dataset_id and manifest.get("schema_version") == 1,
           f"Manifest tidak sesuai dataset/skema: {folder}")
    return manifest


def catalog(folder: Path, expected_id: str, expected_count: int,
            catalog_hash: str) -> dict[str, dict[str, Any]]:
    path = folder / "source_catalog.json"
    check_hash(path, catalog_hash)
    source = read_json(path)
    ensure(source.get("dataset_id") == expected_id and source.get("schema_version") == 1,
           f"Katalog sumber bukan dataset yang diharapkan: {folder}")
    entries = source.get("sources")
    ensure(isinstance(entries, list) and len(entries) == expected_count,
           f"Jumlah sumber di katalog salah: {folder}")
    indexed = {entry["source_id"]: entry for entry in entries}
    ensure(len(indexed) == len(entries), f"ID sumber berulang: {folder}")
    return indexed


def close(actual: Any, expected: float, label: str, tolerance: float = 0.01) -> None:
    ensure(type(actual) in (int, float) and math.isfinite(actual) and
           abs(actual - expected) <= tolerance, f"{label}: {actual!r}, diharapkan {expected}")


def check_case(case_dir: Path) -> tuple[dict[str, Any], dict[str, dict[str, Any]],
                                                dict[str, Any]]:
    manifest = load_manifest(case_dir, CASE_ID)
    ensure(manifest.get("source_file_count") == 11 and
           manifest.get("record_counts") == CASE_COUNTS,
           "Jumlah workbook/baris Case 2 berubah dari audit")
    sources = catalog(case_dir, CASE_ID, 11, manifest.get("source_catalog_sha256"))
    ensure(Counter(item.get("category") for item in sources.values()) ==
           Counter({"incident": 1, "production": 5, "equipment": 5}),
           "Kategori workbook Case 2 tidak sesuai")
    ids: set[str] = set()
    data: dict[str, list[dict[str, Any]]] = {}
    for name, count in CASE_COUNTS.items():
        check_hash(case_dir / name, manifest.get("output_sha256", {}).get(name))
        loaded = []
        for row in rows(case_dir / name, count):
            identity = row.get("record_id")
            ensure(isinstance(identity, str) and identity.startswith("case2_") and
                   identity not in ids, f"ID internal kosong/duplikat: {name}")
            ids.add(identity)
            source = sources.get(row.get("source_id"))
            ensure(source is not None and row.get("dataset_id") == CASE_ID and
                   row.get("source_file") == source.get("relative_path") and
                   row.get("source_sha256") == source.get("sha256") and
                   isinstance(row.get("source_sheet"), str) and
                   type(row.get("source_row")) is int and row["source_row"] >= 1,
                   f"Asal berkas/sheet/baris tidak konsisten: {name} ID {identity}")
            if "asset_tag" in row and name != "incidents.jsonl":
                ensure(row["asset_tag"] in ASSETS and row.get("plant") == ASSETS[row["asset_tag"]],
                       f"Plant/aset tidak cocok pada {name} ID {identity}")
            loaded.append(row)
        data[name] = loaded

    incidents = data["incidents.jsonl"]
    incident_index = {item["record_id"]: item for item in incidents}
    ensure(len(incident_index) == 380 and len({i["source_row"] for i in incidents}) == 380,
           "Baris insiden berganda atau hilang")
    ensure(len({item["plant"] for item in incidents}) == 12,
           "Cakupan 12 label plant tidak sesuai")
    ensure(min(item["occurred_date"] for item in incidents) == "2024-01-04" and
           max(item["occurred_date"] for item in incidents) == "2026-07-25",
           "Rentang tanggal kejadian berubah")
    sums = {key: sum((Decimal(str(item[key])) for item in incidents), Decimal(0))
            for key in ("downtime_hours", "actual_loss_kusd", "potential_loss_kusd",
                        "total_loss_kusd_as_provided")}
    for field, amount in (("downtime_hours", "2261.1"),
                          ("actual_loss_kusd", "61886.46"),
                          ("potential_loss_kusd", "5307.97"),
                          ("total_loss_kusd_as_provided", "67194.43")):
        ensure(abs(sums[field] - Decimal(amount)) <= Decimal("0.01"),
               f"Rekonsiliasi {field} gagal: {sums[field]}")
    for item in incidents:
        ensure(abs(Decimal(str(item["actual_loss_kusd"])) +
                   Decimal(str(item["potential_loss_kusd"])) -
                   Decimal(str(item["total_loss_kusd_as_provided"]))) <= Decimal("0.01"),
               f"Komponen loss tidak cocok pada insiden baris {item['source_row']}")
    missing_ar = [i for i in incidents if i.get("ar_no") is None]
    ensure(len(missing_ar) == 226 and all(str(i["raw"]["AR No."]).lower() == "n/a"
                                          for i in missing_ar),
           "AR n/a harus tetap mentah dan normalisasi null sesuai audit")
    ar_refs: dict[str, list[int]] = defaultdict(list)
    mto_refs: dict[str, list[int]] = defaultdict(list)
    for item in incidents:
        if item["ar_no"] is not None:
            ar_refs[item["ar_no"]].append(item["source_row"])
        mto_refs[item["mto_no"]].append(item["source_row"])
    duplicated_ar = {name: indexes for name, indexes in ar_refs.items() if len(indexes) > 1}
    duplicated_mto = {name: indexes for name, indexes in mto_refs.items() if len(indexes) > 1}
    ensure(duplicated_ar == {
        "AR-2026-OP2-0171": [132, 334], "AR-2024-ZCU-0236": [136, 191]
    } and duplicated_mto == {"MTO-2026-OPP-0096": [8, 99]},
           "Daftar AR/MTO berulang berubah; periksa sebelum membuat kunci/join")
    ensure(sum(item["rca_due_date"] is None for item in incidents) == 197 and
           all(str(item["raw"]["RCA Due Date"]).lower() == "n/a"
               for item in incidents if item["rca_due_date"] is None),
           "Jumlah tenggat RCA kosong berubah atau nilai mentah hilang")
    status_counts = Counter(item["overall_status_as_provided"] for item in incidents)
    ensure(status_counts == {
        "RISK CLOSED": 113, "CA/PA EXECUTION": 92, "RCA PROCESS": 71,
        "RISK CANCELED": 47, "MONITORING RESULT": 37, "NEW REGISTERED": 20,
    }, "Distribusi status snapshot Incident berbeda dari audit")
    dashboards = {item["source_row"]: item["raw"] for item in
                  data["incident_dashboard_rows.jsonl"]}
    for row_number, label, expected in ((3, "Total Incidents", 380),
                                        (4, "Total Downtime (hrs)", 2261.1),
                                        (5, "Total Loss (k US$)", 67194.43)):
        row = dashboards.get(row_number, {})
        ensure(row.get("A") == label, f"Label ringkasan workbook baris {row_number} berubah")
        close(row.get("B"), expected, label)

    counts_by_asset: dict[str, Counter[str]] = defaultdict(Counter)
    production_tags: dict[tuple[str, str], dict[str, Any]] = {}
    for item in data["production_tags.jsonl"]:
        counts_by_asset[item["asset_tag"]]["tags"] += 1
        key = item["source_id"], item["tag_name"]
        ensure(key not in production_tags, "PI Tag duplikat pada satu workbook")
        production_tags[key] = item
    production_times: dict[str, list[datetime]] = defaultdict(list)
    off_counts: Counter[str] = Counter()
    ko_vibration: list[float] = []
    for item in data["production_readings.jsonl"]:
        tag = item["asset_tag"]
        counts_by_asset[tag]["production"] += 1
        production_times[tag].append(datetime.fromisoformat(item["observed_at_naive"]))
        signals = item.get("signals")
        ensure(isinstance(signals, list) and len(signals) == 7 and
               len({signal["tag_name"] for signal in signals}) == 7,
               f"Tujuh sinyal Production tidak lengkap: {tag}")
        for signal in signals:
            meta = production_tags.get((item["source_id"], signal["tag_name"]))
            ensure(meta is not None and signal["engineering_unit_as_provided"] ==
                   meta["engineering_unit_as_provided"],
                   f"PI Tag/satuan sinyal berbeda: {tag}")
            if signal["tag_name"] == "RUN_STATUS" and signal["value"] == "OFF":
                off_counts[tag] += 1
            if tag == "KO-3201" and signal["tag_name"] == "KO3201_VIB":
                ko_vibration.append(signal["value"])
    ensure(off_counts == {"PU-2101B": 18, "KO-3201": 32, "PM-4405B": 8,
                          "HE-3301": 13, "BL-5702": 14},
           "Jumlah bacaan RUN_STATUS=OFF berubah dari audit")
    plant_rate_tags = [tag for (source_id, name), tag in production_tags.items()
                       if name == "PLANT_RATE"]
    ensure(len(plant_rate_tags) == 5 and
           {tag["raw"]["instrumenttag"] for tag in plant_rate_tags} == {"PLTRMT.PV"} and
           {tag["asset_tag"]: tag["engineering_unit_as_provided"] for tag in plant_rate_tags} == {
               "PU-2101B": "T/H", "KO-3201": "T/H", "PM-4405B": "T/H (equiv.)",
               "HE-3301": "T/H", "BL-5702": "T/H",
           }, "Tag PLANT_RATE bersama/satuannya berubah; jangan gabung nilai antarfile")
    ko_vib_meta = next((tag for tag in production_tags.values()
                        if tag["asset_tag"] == "KO-3201" and tag["tag_name"] == "KO3201_VIB"), None)
    ensure(ko_vib_meta is not None and ko_vib_meta["raw"]["span"] == 20 and
           ko_vib_meta["engineering_unit_as_provided"] == "MM/S" and
           len(ko_vibration) == 720 and all(isinstance(v, (float, int)) and v > 20
                                            for v in ko_vibration),
           "Konflik span KO-3201 dengan 720 bacaan tidak sesuai audit")
    for name, counter_key in (("equipment_info_rows.jsonl", "info"),
                              ("equipment_metadata.jsonl", "metadata"),
                              ("equipment_limits.jsonl", "limits"),
                              ("equipment_conditions.jsonl", "conditions"),
                              ("equipment_summary.jsonl", "summary")):
        for item in data[name]:
            counts_by_asset[item["asset_tag"]][counter_key] += 1
    for asset in ASSETS:
        expected = Counter(tags=7, production=720, info=14, metadata=12,
                           limits=4, conditions=26, summary=13)
        ensure(counts_by_asset[asset] == expected,
               f"Cakupan aset {asset} berubah: {counts_by_asset[asset]}")
        stamps = sorted(production_times[asset])
        ensure(len(set(stamps)) == 720 and
               all(b - a == timedelta(hours=1) for a, b in zip(stamps, stamps[1:])),
               f"Seri Production tidak utuh per jam: {asset}")
    by_asset_condition: dict[str, list[date]] = defaultdict(list)
    for item in data["equipment_conditions.jsonl"]:
        ensure(item.get("time_grain") == "weekly_as_provided" and
               item.get("available_at") is None and
               isinstance(item.get("measurements"), list) and
               len(item["measurements"]) == 4,
               "Granularitas/status ketersediaan Equipment rusak")
        by_asset_condition[item["asset_tag"]].append(date.fromisoformat(item["observed_date"]))
    for asset, dates in by_asset_condition.items():
        ordered = sorted(dates)
        ensure(len(set(ordered)) == 26 and
               all(b - a == timedelta(days=7) for a, b in zip(ordered, ordered[1:])),
               f"Seri Equipment mingguan tidak utuh: {asset}")
    ensure(any(i["asset_tag"] == "KO-3201" and i["observed_date"] == "2026-04-22" and
               i["health_status_as_provided"] == "ALARM" for i in
               data["equipment_conditions.jsonl"]),
           "Bukti replay KO-3201 tanggal 22 April tidak tersedia")
    ko_conditions = {item["observed_date"]: item for item in
                     data["equipment_conditions.jsonl"] if item["asset_tag"] == "KO-3201"}
    pre_event = ko_conditions["2026-04-22"]
    event_week = ko_conditions.get("2026-04-29")
    ensure(pre_event["source_row"] == 21 and pre_event["week_as_provided"] == 20 and
           abs(pre_event["measurements"][0]["value"] - 71.674) < 1e-6 and
           abs(pre_event["measurements"][1]["value"] - 1372.791) < 1e-6 and
           event_week is not None and event_week["source_row"] == 22 and
           event_week["health_status_as_provided"] == "TRIP",
           "Nilai mingguan KO untuk replay berubah; batasi bukti hingga cutoff")
    ko_prod_unit = ko_vib_meta["engineering_unit_as_provided"]
    ko_eq_unit = pre_event["measurements"][0]["unit_as_provided"]
    ensure(ko_prod_unit == "MM/S" and ko_eq_unit == "micron",
           "Satuan dua sumber vibration KO tidak boleh digabung tanpa bukti fisik")
    ko_limit = next((row for row in data["equipment_limits.jsonl"]
                     if row["asset_tag"] == "KO-3201" and
                     row["parameter_name"] == "DE Radial Vibration"), None)
    ensure(ko_limit is not None and ko_limit["alarm_value_as_provided"] == 45 and
           ko_limit["trip_value_as_provided"] == 75 and ko_limit["unit_as_provided"] == "micron",
           "Rujukan ambang KO 45/75 micron berubah")
    summary_by_asset = {(i["asset_tag"], i["kpi_name"]): i
                        for i in data["equipment_summary.jsonl"]}
    meta_by_asset = {(i["asset_tag"], i["field_name"]): i
                     for i in data["equipment_metadata.jsonl"]}
    incident_examples = {item["asset_tag"]: item for item in incidents
                         if item["source_row"] in range(4, 9)}
    ensure(set(incident_examples) == set(ASSETS),
           "Lima insiden demo pada baris 4–8 tidak lengkap")
    for asset in ASSETS:
        case = incident_examples[asset]
        close(summary_by_asset[(asset, "Estimated Loss (k USD)")]["value_as_provided"],
              case["actual_loss_kusd"], f"Loss summary {asset}")
        close(summary_by_asset[(asset, "Total Downtime (hours)")]["value_as_provided"],
              case["downtime_hours"], f"Downtime summary {asset}")
        close(summary_by_asset[(asset, "Monitoring Period (weeks)")]["value_as_provided"],
              26, f"Monitoring Period {asset}")
        close(summary_by_asset[(asset, "Period Hours")]["value_as_provided"],
              4368, f"Period Hours {asset}")
        ensure(summary_by_asset[(asset, "Period Hours")]["time_scope"] ==
               "full_period_retrospective_only" and
               all(meta_by_asset[(asset, field)]["post_event_context"] is True
                   for field in ("Linked RCA / AR No.", "Failure Date", "Dominant Failure Mode")),
               f"Field pascainsiden/periode summary tidak terlindungi penandanya: {asset}")
    ensure("Heat Exchanger" in meta_by_asset[("HE-3301", "Equipment Type")]["value_as_provided"] and
           ("HE-3301", "HE3301_VIB") in {(i["asset_tag"], i["tag_name"])
                                            for i in data["production_tags.jsonl"]},
           "Metadata generik HE-3301 berubah; instrumentasi belum diverifikasi")
    downtime_gap = {asset: {
        "observed_off_rows": off_counts[asset],
        "recorded_incident_downtime_hours": incident_examples[asset]["downtime_hours"],
    } for asset in ASSETS}
    ensure(downtime_gap["PU-2101B"] == {
               "observed_off_rows": 18, "recorded_incident_downtime_hours": 18.5
           } and downtime_gap["HE-3301"] == {
               "observed_off_rows": 13, "recorded_incident_downtime_hours": 12
           }, "Dua perbedaan OFF vs downtime tidak boleh disamakan")
    return manifest, incident_index, {
        "sources": 11, "record_counts": dict(CASE_COUNTS),
        "plant_labels": 12, "incident_date_range": ["2024-01-04", "2026-07-25"],
        "downtime_hours": float(sums["downtime_hours"]),
        "loss_actual_kusd": float(sums["actual_loss_kusd"]),
        "loss_potential_kusd": float(sums["potential_loss_kusd"]),
        "missing_ar_count": len(missing_ar),
        "missing_rca_due_date_count": 197,
        "duplicated_ar_source_rows": duplicated_ar,
        "duplicated_mto_source_rows": duplicated_mto,
        "status_snapshot_counts": dict(status_counts),
        "production_off_vs_incident_hours_by_asset": downtime_gap,
        "ko_production_vibration_above_provided_span_rows": len(ko_vibration),
        "ko_vibration_units_from_distinct_sources": [ko_prod_unit, ko_eq_unit],
        "equipment_summary_period_hours_as_provided": 4368,
        "equipment_summary_period_context": "full_period_retrospective_only",
        "equipment_post_event_fields_marked_count": 5 * 3,
    }


def check_rca(folder: Path, incidents: dict[str, Any]) -> dict[str, Any]:
    manifest = load_manifest(folder, CASE_ID)
    ensure(manifest.get("document_count") == 5 and manifest.get("slide_count") == 55,
           "Jumlah dokumen/slide RCA salah")
    sources = catalog(folder, CASE_ID, 5,
                      manifest.get("output_sha256", {}).get("source_catalog.json"))
    for name, count in RCA_COUNTS.items():
        check_hash(folder / name, manifest.get("output_sha256", {}).get(name))
    documents = list(rows(folder / "rca_documents.jsonl", 5))
    slides = list(rows(folder / "rca_slides.jsonl", 55))
    docs_by_source = {item["source_id"]: item for item in documents}
    ensure(len(docs_by_source) == 5 and {item["asset_tag"] for item in documents} == set(ASSETS),
           "Lima dokumen RCA/aset tidak lengkap")
    verified_links = set()
    for doc in documents:
        source = sources.get(doc["source_id"])
        incident = incidents.get(doc["linked_incident_record_id"])
        ensure(source is not None and incident is not None and
               doc["dataset_id"] == CASE_ID and doc["source_file"] == source["relative_path"] and
               doc["source_sha256"] == source["sha256"] and
               doc["asset_tag"] == incident["asset_tag"] and
               doc["plant"] == incident["plant"] and doc["ar_no"] == incident["ar_no"] and
               doc["incident_occurred_date"] == incident["occurred_date"] and
               doc["link_status"] == "verified_by_tag_plant_AR_and_occurrence_date" and
               doc["slide_count"] == 11,
               f"Kaitan dokumen RCA tidak terverifikasi: {doc.get('asset_tag')}")
        ensure(doc["available_at"] is None and doc["visual_review_status"] == "pending",
               "Tanggal tersedia/review RCA tidak boleh direka")
        rel = doc["markdown_relative_path"]
        ensure(rel.startswith("markdown/") and rel.endswith(".md") and
               ".." not in Path(rel).parts and rel in manifest.get("markdown_sha256", {}),
               "Path markdown RCA tidak aman/tidak tercatat")
        check_hash(folder / rel, doc["markdown_sha256"])
        ensure(manifest["markdown_sha256"][rel] == doc["markdown_sha256"],
               "Checksum markdown RCA berbeda pada manifest")
        verified_links.add(doc["linked_incident_record_id"])
    ensure(len(verified_links) == 5, "Kelima RCA harus tertaut ke insiden berbeda")
    slide_nums: dict[str, set[int]] = defaultdict(set)
    slide_ids: set[str] = set()
    for slide in slides:
        source = sources.get(slide["source_id"])
        doc = docs_by_source.get(slide["source_id"])
        ensure(source is not None and doc is not None and slide["dataset_id"] == CASE_ID and
               slide["source_sha256"] == source["sha256"] and
               slide["source_file"] == doc["source_file"] and
               slide["linked_incident_record_id"] == doc["linked_incident_record_id"] and
               slide["asset_tag"] == doc["asset_tag"] and
               slide["markdown_relative_path"] == doc["markdown_relative_path"] and
               slide["document_time_scope"] == "post_incident_document" and
               slide["available_at"] is None and slide["visual_review_status"] == "pending",
               "Sumber/link/status salah pada slide RCA")
        number = slide["source_slide_number"]
        ensure(type(number) is int and 1 <= number <= 11 and
               slide["slide_id"] not in slide_ids and number not in slide_nums[slide["source_id"]],
               "ID atau nomor slide RCA kosong/berulang")
        slide_nums[slide["source_id"]].add(number)
        slide_ids.add(slide["slide_id"])
    ensure(all(numbers == set(range(1, 12)) for numbers in slide_nums.values()) and
           manifest.get("visual_review_pending") == 55,
           "Cakupan/review visual RCA tidak sesuai 55 slide")
    return {"documents": 5, "slides": 55, "verified_incident_links": 5,
            "manual_visual_review_pending": 55,
            "quotation_status": "not_approved_until_each_relevant_slide_is_visually_checked"}


def check_energy(folder: Path) -> tuple[list[float], list[str], dict[str, Any],
                                         dict[str, Any]]:
    manifest = load_manifest(folder, ENERGY_ID)
    ensure(manifest.get("readings_count") == 35040 and
           manifest.get("source_day_count") == 365 and
           manifest.get("midnight_adjustment_count") == 365,
           "Cakupan/jam 00:00 energi berubah")
    for name in ("energy_readings.jsonl", "source_catalog.json"):
        check_hash(folder / name, manifest.get("output_sha256", {}).get(name))
    source = read_json(folder / "source_catalog.json")
    ensure(source.get("dataset_id") == ENERGY_ID and
           source.get("source_id") == manifest.get("source_id") and
           source.get("source_sha256") == manifest.get("source_sha256") and
           source.get("company_meter_data_available") is False,
           "Katalog UCI tidak berlabel eksternal dengan benar")
    values, stamps = [], []
    days: Counter[str] = Counter()
    ids: set[str] = set()
    prev: datetime | None = None
    midnights = 0
    co2_zero = 0
    for index, row in enumerate(rows(folder / "energy_readings.jsonl", 35040), start=1):
        ensure(row.get("dataset_id") == ENERGY_ID and
               row.get("source_id") == manifest["source_id"] and
               row.get("source_sha256") == manifest["source_sha256"] and
               row.get("sequence_index") == index and row.get("source_csv_row") == index + 1 and
               row.get("source_scope") == "external_steel_industry_south_korea_2018" and
               row.get("record_id") not in ids,
               f"Asal/indeks/ID energi rusak pada bacaan {index}")
        ids.add(row["record_id"])
        raw = row.get("source_fields_raw")
        ensure(isinstance(raw, dict) and row.get("source_time_label_raw") == raw.get("date") and
               row.get("usage_kwh") == float(raw["Usage_kWh"]),
               f"Nilai mentah dan hasil energi tidak sama pada bacaan {index}")
        source_time = datetime.strptime(row["source_time_label_raw"], "%d/%m/%Y %H:%M")
        derived = datetime.fromisoformat(row["timestamp_derived_naive"])
        midnight = source_time.hour == 0 and source_time.minute == 0
        ensure(derived == source_time + (timedelta(days=1) if midnight else timedelta()) and
               row.get("timestamp_derivation_is_inference") is midnight and
               row.get("source_date_label") == source_time.date().isoformat() and
               row.get("time_grain_as_provided") == "15_minute_record",
               f"Derivasi waktu energi tidak konsisten pada bacaan {index}")
        if prev is not None:
            ensure(derived - prev == timedelta(minutes=15),
                   f"Jeda/duplikat energi pada bacaan {index}")
        prev = derived
        day = row["source_date_label"]
        days[day] += 1
        if midnight:
            midnights += 1
            ensure(days[day] == 96, f"00:00 bukan observasi terakhir pada label {day}")
        co2_zero += float(raw["CO2(tCO2)"]) == 0.0
        values.append(row["usage_kwh"])
        stamps.append(row["timestamp_derived_naive"])
    ensure(len(days) == 365 and all(v == 96 for v in days.values()) and
           midnights == 365 and co2_zero == 20990 and
           stamps[0] == "2018-01-01T00:15" and stamps[-1] == "2019-01-01T00:00",
           "Jumlah hari, CO2 nol, atau rentang waktu UCI tidak sesuai")
    return values, stamps, manifest, {
        "dataset_id": ENERGY_ID, "readings": len(values), "source_days": len(days),
        "inferred_midnight_shifts": midnights, "co2_zeros_as_provided": co2_zero,
        "source_scope": "external_steel_industry_south_korea_2018",
    }


def reference_metrics(values: list[float], start: int, end: int, method: str) -> tuple[float, float]:
    interval_error, hour_error, count = 0.0, 0.0, 0
    for cutoff in range(start - 1, end - HORIZON):
        historical = values[cutoff - 95:cutoff + 1]
        prediction = [historical[-1]] * 4 if method == "last_observation" else historical[:4]
        actual = values[cutoff + 1:cutoff + 5]
        interval_error += sum(abs(p - a) for p, a in zip(prediction, actual))
        hour_error += abs(sum(prediction) - sum(actual))
        count += 1
    return interval_error / (count * 4), hour_error / count


def reference_distribution(values: list[float], start: int, end: int,
                           method: str) -> dict[str, float]:
    errors = []
    for cutoff in range(start - 1, end - HORIZON):
        history = values[cutoff - 95:cutoff + 1]
        forecast = [history[-1]] * HORIZON if method == "last_observation" else history[:HORIZON]
        actual = values[cutoff + 1:cutoff + 1 + HORIZON]
        errors.append(abs(sum(forecast) - sum(actual)))
    errors.sort()
    ensure(len(errors) > 0, "Distribusi galat kosong")

    def at(p: float) -> float:
        position = (len(errors) - 1) * p
        low = int(position)
        high = min(low + 1, len(errors) - 1)
        return errors[low] * (high - position) + errors[high] * (position - low) if high != low else errors[low]

    return {"median": at(0.5), "p90": at(0.9), "p95": at(0.95),
            "p99": at(0.99), "maximum": errors[-1]}


def check_forecast(folder: Path, values: list[float], stamps: list[str],
                   energy_manifest: dict[str, Any]) -> dict[str, Any]:
    summary = read_json(folder / "forecast_summary.json")
    ensure(summary.get("dataset_id") == ENERGY_ID and
           summary.get("source_id") == energy_manifest.get("source_id") and
           summary.get("prepared_energy_sha256") ==
           energy_manifest.get("output_sha256", {}).get("energy_readings.jsonl") and
           summary.get("model_version") == "baseline_15min_four_steps_v1" and
           summary.get("test_cutoff_count") == EXPECTED_TEST_CUTOFFS and
           summary.get("split_sequence_index_inclusive") == {
               "train_reference_no_parameters_fitted": [1, TRAIN_END],
               "validation_targets": [TRAIN_END + 1, VALIDATION_END],
               "test_targets": [VALIDATION_END + 1, 35040],
           }, "Forecast tidak sesuai sumber/versi/split kronologis")
    for name in ("test_predictions.jsonl", "test_holdout_evaluations.jsonl"):
        check_hash(folder / name, summary.get("result_files", {}).get(name))
    selection = summary.get("selected_baseline")
    ensure(selection in ("last_observation", "same_time_previous_day"),
           "Metode forecast tidak dikenal")
    validator_metrics = {method: reference_metrics(values, TRAIN_END, VALIDATION_END, method)
                         for method in ("last_observation", "same_time_previous_day")}
    chosen = min(validator_metrics, key=lambda name: validator_metrics[name][0])
    ensure(selection == chosen, "Pemilihan baseline memakai periode yang tidak sesuai validasi")
    ensure(not any(key in summary for key in ("scenario_tariff_rp_per_kwh", "scenario_tariff_status",
                    "scenario_mean_absolute_one_hour_variable_cost_error_rp", "cost_formula")),
           "Ringkasan forecast masih memuat skenario biaya lama")
    for method, (mae, hour_mae) in validator_metrics.items():
        reported = summary.get("validation_baselines", {}).get(method, {})
        close(reported.get("mae_kwh_per_interval_all_horizons"), mae,
              f"MAE validasi {method}", 1e-5)
        close(reported.get("mean_absolute_one_hour_total_error_kwh"), hour_mae,
              f"MAE satu jam validasi {method}", 1e-5)
        expected = reference_distribution(values, TRAIN_END, VALIDATION_END, method)
        for key, value in expected.items():
            close(reported.get("four_interval_total_absolute_error_distribution_kwh", {}).get(key),
                  value, f"Distribusi validasi {method} {key}", 1e-5)
    for method in ("last_observation", "same_time_previous_day"):
        mae, hour_mae = reference_metrics(values, VALIDATION_END, len(values), method)
        reported = summary.get("test_baselines", {}).get(method, {})
        close(reported.get("mae_kwh_per_interval_all_horizons"), mae,
              f"MAE test {method}", 1e-5)
        close(reported.get("mean_absolute_one_hour_total_error_kwh"), hour_mae,
              f"MAE total satu jam test {method}", 1e-5)
        expected = reference_distribution(values, VALIDATION_END, len(values), method)
        for key, value in expected.items():
            close(reported.get("four_interval_total_absolute_error_distribution_kwh", {}).get(key),
                  value, f"Distribusi test {method} {key}", 1e-5)

    predictions = rows(folder / "test_predictions.jsonl", EXPECTED_TEST_CUTOFFS)
    holdouts = rows(folder / "test_holdout_evaluations.jsonl", EXPECTED_TEST_CUTOFFS)
    for index, (pred, result) in enumerate(zip(predictions, holdouts), start=1):
        cutoff = VALIDATION_END - 1 + index - 1
        ensure(pred.get("forecast_id") == result.get("forecast_id") and
               pred.get("cutoff_sequence_index") == cutoff + 1 and
               result.get("cutoff_sequence_index") == cutoff + 1 and
               pred.get("cutoff_timestamp_derived_naive") == stamps[cutoff] and
               pred.get("target_timestamps_derived_naive") == stamps[cutoff + 1:cutoff + 5] and
               pred.get("input_window_sequence_index_inclusive") == [cutoff - 94, cutoff + 1] and
               pred.get("split") == "test" and
               pred.get("method_selected_on_validation") == selection and
               pred.get("source_id") == energy_manifest["source_id"] and
               pred.get("dataset_id") == ENERGY_ID,
               f"Cutoff/holdout/sumber forecast tidak sesuai pada run {index}")
        history = values[cutoff - 95:cutoff + 1]
        expected_pred = [history[-1]] * 4 if selection == "last_observation" else history[:4]
        actual = values[cutoff + 1:cutoff + 5]
        ensure(pred.get("predicted_kwh_next_15_30_45_60_minutes") == expected_pred and
               result.get("actual_kwh_next_15_30_45_60_minutes") == actual,
               f"Prediksi memakai masa depan atau aktual holdout salah: run {index}")
        pred_hour, actual_hour = round(sum(expected_pred), 6), round(sum(actual), 6)
        close(pred.get("predicted_kwh_next_hour_assuming_interval_kwh"), pred_hour,
              f"Jumlah perkiraan run {index}", 1e-5)
        close(result.get("actual_kwh_next_hour_assuming_interval_kwh"), actual_hour,
              f"Jumlah aktual run {index}", 1e-5)
        close(result.get("absolute_one_hour_total_error_kwh"), abs(pred_hour - actual_hour),
              f"Galat jumlah run {index}", 1e-5)
        ensure(not any(key in pred for key in ("tariff_rp_per_kwh_assumption", "cost_scenario_status",
                    "estimated_variable_energy_cost_rp")) and
               not any(key in result for key in ("actual_variable_cost_same_tariff_rp",
                    "absolute_variable_cost_error_same_tariff_rp")),
               f"Artefak forecast masih memuat biaya lama: run {index}")
    return {"selected_baseline": selection, "test_cutoffs": EXPECTED_TEST_CUTOFFS,
            "test_interval_mae_kwh": summary["test_baselines"][selection][
                "mae_kwh_per_interval_all_horizons"],
            "interval_semantics": "assumption_needs_source_confirmation"}


def write_report(path: Path, payload: dict[str, Any], source_dirs: list[Path]) -> None:
    path = path.resolve()
    ensure(all(path != directory and directory not in path.parents for directory in source_dirs),
           "Laporan tidak boleh menimpa hasil sumber pada folder generator")
    if path.exists():
        previous = read_json(path)
        ensure(previous.get("generated_by") == "scripts/validate_data.py",
               "Berkas laporan ada tetapi bukan keluaran validator; tidak ditimpa")
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                     prefix=".validation-", suffix=".json",
                                     delete=False) as stream:
        temporary = Path(stream.name)
        json.dump(payload, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepared-dir", type=Path, default=root / "imports" / "prepared")
    parser.add_argument("--report", type=Path,
                        default=root / "imports" / "prepared" / "validation_report.json")
    args = parser.parse_args()
    prepared = args.prepared_dir.resolve()
    sources = [prepared / name for name in ("case2", "rca", "energy", "energy_forecast")]
    try:
        case_manifest, incident_index, case_info = check_case(sources[0])
        rca_info = check_rca(sources[1], incident_index)
        values, stamps, energy_manifest, energy_info = check_energy(sources[2])
        forecast_info = check_forecast(sources[3], values, stamps, energy_manifest)
        report = {
            "generated_by": "scripts/validate_data.py",
            "checked_at_utc": datetime.now(timezone.utc).isoformat(),
            "technical_integrity_gate": "PASS",
            "supabase_import_executed": False,
            "case2": case_info, "rca": rca_info,
            "external_energy": energy_info, "external_forecast": forecast_info,
            "data_quality_issues_to_preserve": [
                {
                    "issue": "OFF observations are not incident downtime durations",
                    "evidence": "Production Sheet2 RUN_STATUS vs Incident Database rows 4–8",
                    "examples": {
                        "PU-2101B": "18 OFF observations vs 18.5 downtime hours",
                        "HE-3301": "13 OFF observations vs 12 downtime hours",
                    },
                    "status": "open_distinct_measurements",
                },
                {
                    "issue": "KO-3201 vibration source units, spans and alert thresholds differ",
                    "evidence": "Production PI Tag/Sheet2 MM/S; Equipment Info/Condition History micron; RCA2 slides 7 and 10",
                    "status": "open_no_unit_join_or_verified_historical_alert_threshold",
                },
                {
                    "issue": "KO-3201 weekly 22 April reading and RCA chronology 27 April have unverified measurement equivalence",
                    "evidence": "Equipment Condition History row 21; RCA2 slide 3",
                    "status": "open_keep_separate_in_timeline",
                },
                {
                    "issue": "Equipment design life KO-3201 differs between sources",
                    "evidence": "Equipment Info Design Life vs RCA2 slide 6",
                    "status": "open_no_authoritative_setting",
                },
                {
                    "issue": "Full-period Equipment KPI hours are provided, not inferred from 26 weekly observations",
                    "evidence": "Performance Summary Period Hours and Condition History",
                    "status": "open_period_boundaries_unknown",
                },
                {
                    "issue": "HE-3301 production vibration and amp fields do not prove installed instrumentation",
                    "evidence": "Production PI Tag and Equipment Info Equipment Type",
                    "status": "open_instrumentation_unverified",
                },
                {
                    "issue": "RCA publication/availability and visual matrices are not verified",
                    "evidence": "Five RCA presentations; 55 extracted slides",
                    "status": "open_manual_visual_review_pending",
                },
            ],
            "application_gates_not_yet_testable": {
                "replay_as_of_filters": "NOT_TESTED_UNTIL_SERVER_AND_UI_EXIST",
                "user_roles_rls_and_view_permissions": "NOT_TESTED_UNTIL_DATABASE_POLICIES_EXIST",
                "action_owner_isolation": "NOT_TESTED_UNTIL_ACTION_TABLES_EXIST",
                "ai_evidence_access_and_future_leakage": "NOT_TESTED_UNTIL_ASSISTANT_EXISTS",
            },
            "input_metadata_sha256": {
                "case2_manifest": sha256(sources[0] / "manifest.json"),
                "rca_manifest": sha256(sources[1] / "manifest.json"),
                "energy_manifest": sha256(sources[2] / "manifest.json"),
                "energy_forecast_summary": sha256(sources[3] / "forecast_summary.json"),
            },
            "required_follow_up": [
                "Visually inspect relevant RCA slides before calling slide text/matrices verified evidence.",
                "Confirm external Usage_kWh meter interval semantics before claiming exact one-hour energy.",
                "Carry each data_quality_issues_to_preserve entry into database issue records and the relevant UI notes.",
                "Verify replay as-of, RLS, identities, and permissions after implementation before public deployment.",
            ],
            "not_claimed": ["Chandra_Asri_meter_data", "company_energy_cost",
                            "real_world_forecast_accuracy", "RCA_visual_review_complete"],
        }
        write_report(args.report, report, sources)
    except (ValidationError, OSError, ValueError, TypeError, KeyError,
            json.JSONDecodeError, OverflowError) as exc:
        print(f"GAGAL VALIDASI: {exc}", file=sys.stderr)
        print("Tidak ada data dikirim ke Supabase.", file=sys.stderr)
        return 1
    print("LULUS pemeriksaan teknis: 380 insiden, 3600 Production, 130 Condition History;")
    print("  5 kaitan RCA / 55 slide; 35040 energi UCI; 5277 cutoff uji forecast.")
    print("CATATAN: 55 slide RCA masih perlu pemeriksaan visual sebelum dikutip sebagai bukti terverifikasi.")
    print(f"Laporan: {args.report.resolve()}")
    print("Belum mengimpor ke Supabase atau memeriksa keamanan deployment.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
