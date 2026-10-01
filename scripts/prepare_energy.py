"""Prepare the external UCI steel electricity CSV without changing source values.

Run from project root: python scripts/prepare_energy.py
Only Python's standard library is needed.

Default input:
  imports/raw/energy/steel+industry+energy+consumption/Steel_industry_data.csv
Output:
  imports/prepared/energy/energy_readings.jsonl
  imports/prepared/energy/source_catalog.json
  imports/prepared/energy/manifest.json

The CSV records 00:00 AFTER 23:45 with the same date label. We retain the
raw label and source order, then derive a separate chronological timestamp
by moving those final 00:00 records to the next calendar day. This script
neither forecasts usage nor treats this external steel facility as Chandra
Asri data. No Supabase or AI credentials are needed.
"""

from __future__ import annotations

import argparse
import calendar
import csv
import hashlib
import json
import math
import shutil
import sys
import tempfile
import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any


DATASET_ID = "uci_steel_industry_2018_external"
SCHEMA_VERSION = 1
EXPECTED_HEADER = (
    "date",
    "Usage_kWh",
    "Lagging_Current_Reactive.Power_kVarh",
    "Leading_Current_Reactive_Power_kVarh",
    "CO2(tCO2)",
    "Lagging_Current_Power_Factor",
    "Leading_Current_Power_Factor",
    "NSM",
    "WeekStatus",
    "Day_of_week",
    "Load_Type",
)
NUMERIC_FIELDS = (
    "Usage_kWh",
    "Lagging_Current_Reactive.Power_kVarh",
    "Leading_Current_Reactive_Power_kVarh",
    "CO2(tCO2)",
    "Lagging_Current_Power_Factor",
    "Leading_Current_Power_Factor",
)
EXPECTED_READINGS = 35040
EXPECTED_SOURCE_DAYS = 365
READINGS_FILE = "energy_readings.jsonl"
SENTINEL = "PREPARED_BY_TRACE_MI_ENERGY.txt"


class EnergyPreparationError(Exception):
    """The energy file does not match the audited 2018 source."""


def fail(message: str) -> None:
    raise EnergyPreparationError(message)


def sha256_file(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def parse_number(raw: str, name: str, csv_row: int) -> float:
    try:
        value = Decimal(raw)
    except (InvalidOperation, TypeError) as exc:
        raise EnergyPreparationError(
            f"Angka {name} tidak valid pada baris CSV {csv_row}: {raw!r}"
        ) from exc
    if not value.is_finite():
        fail(f"Nilai {name} bukan bilangan hingga pada baris CSV {csv_row}")
    result = float(value)
    if not math.isfinite(result):
        fail(f"Nilai {name} di luar jangkauan angka pada baris CSV {csv_row}")
    return result


def prepare(csv_path: Path, output_dir: Path) -> dict[str, Any]:
    csv_path = csv_path.resolve()
    output_dir = output_dir.resolve()
    if not csv_path.is_file():
        fail(
            f"CSV belum ada: {csv_path}. Ekstrak ZIP UCI ke folder "
            "imports/raw/energy/steel+industry+energy+consumption/ terlebih dahulu."
        )
    if csv_path in output_dir.parents or output_dir in csv_path.parents:
        fail("Input CSV dan folder output tidak boleh saling mencakup")

    file_hash = sha256_file(csv_path)
    source_id = "uci_steel_source_" + hashlib.sha256(
        f"{DATASET_ID}|{csv_path.name}|{file_hash}".encode("utf-8")
    ).hexdigest()
    output_dir.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix=".energy-prepare-", dir=output_dir.parent) as temp:
        stage = Path(temp) / output_dir.name
        stage.mkdir()
        output_path = stage / READINGS_FILE
        source_day_counts: Counter[str] = Counter()
        midnight_per_source_day: Counter[str] = Counter()
        row_count = 0
        midnight_count = 0
        co2_zero_count = 0
        source_calendar_mismatch_count = 0
        first_derived: datetime | None = None
        previous_derived: datetime | None = None
        midnight_seen_for_day: set[str] = set()

        with csv_path.open("r", encoding="utf-8-sig", newline="") as source_stream, \
             output_path.open("w", encoding="utf-8", newline="\n") as target_stream:
            reader = csv.DictReader(source_stream)
            if tuple(reader.fieldnames or ()) != EXPECTED_HEADER:
                fail(
                    "Header energi berbeda dari dataset yang diaudit. "
                    f"Ditemukan: {reader.fieldnames!r}"
                )
            for csv_row, row in enumerate(reader, start=2):
                if None in row or any(row[name] is None or row[name].strip() == ""
                                      for name in EXPECTED_HEADER):
                    fail(f"Kolom kosong atau kolom ekstra pada baris CSV {csv_row}")

                raw_label = row["date"]
                try:
                    source_time = datetime.strptime(raw_label, "%d/%m/%Y %H:%M")
                except ValueError as exc:
                    raise EnergyPreparationError(
                        f"Tanggal/jam tidak valid pada baris CSV {csv_row}: {raw_label!r}"
                    ) from exc
                if source_time.year != 2018:
                    fail(f"Label tahun di luar 2018 pada baris CSV {csv_row}")
                day_key = source_time.date().isoformat()
                is_last_midnight = source_time.hour == 0 and source_time.minute == 0
                if day_key in midnight_seen_for_day and not is_last_midnight:
                    fail(f"Ada bacaan setelah 00:00 penutup pada {day_key}")
                if is_last_midnight:
                    midnight_count += 1
                    midnight_per_source_day[day_key] += 1
                    midnight_seen_for_day.add(day_key)
                source_day_counts[day_key] += 1

                # Source 00:00 appears at the END of its labelled day.
                derived_time = source_time + timedelta(days=1) if is_last_midnight else source_time
                if previous_derived is not None and derived_time - previous_derived != timedelta(minutes=15):
                    fail(
                        f"Urutan 15 menit putus/duplikat pada baris CSV {csv_row}: "
                        f"{previous_derived.isoformat()} -> {derived_time.isoformat()}"
                    )
                if first_derived is None:
                    first_derived = derived_time
                previous_derived = derived_time

                expected_nsm = source_time.hour * 3600 + source_time.minute * 60
                try:
                    nsm = int(row["NSM"])
                except ValueError as exc:
                    raise EnergyPreparationError(
                        f"NSM tidak valid pada baris CSV {csv_row}: {row['NSM']!r}"
                    ) from exc
                if nsm != expected_nsm:
                    fail(f"NSM tidak sesuai label waktu pada baris CSV {csv_row}")

                numbers = {
                    name: parse_number(row[name], name, csv_row)
                    for name in NUMERIC_FIELDS
                }
                if numbers["Usage_kWh"] < 0:
                    fail(f"Usage_kWh negatif pada baris CSV {csv_row}")
                if numbers["CO2(tCO2)"] == 0:
                    co2_zero_count += 1

                derived_weekday = calendar.day_name[derived_time.weekday()]
                derived_weekstatus = "Weekend" if derived_time.weekday() >= 5 else "Weekday"
                if row["Day_of_week"] != derived_weekday or row["WeekStatus"] != derived_weekstatus:
                    source_calendar_mismatch_count += 1

                row_count += 1
                identity = f"{source_id}|csv_row|{csv_row}"
                record = {
                    "record_id": "uci_steel_record_" + hashlib.sha256(
                        identity.encode("utf-8")
                    ).hexdigest(),
                    "dataset_id": DATASET_ID,
                    "source_id": source_id,
                    "source_file": csv_path.name,
                    "source_sha256": file_hash,
                    "source_csv_row": csv_row,  # Header = row 1; first record = row 2.
                    "sequence_index": row_count,  # One-based original row order.
                    "source_time_label_raw": raw_label,
                    "source_date_label": day_key,
                    "timestamp_derived_naive": derived_time.isoformat(timespec="minutes"),
                    "time_derivation": (
                        "source_00_00_at_end_of_day_shifted_to_next_day"
                        if is_last_midnight else "source_label_unchanged"
                    ),
                    "timestamp_derivation_is_inference": is_last_midnight,
                    "time_grain_as_provided": "15_minute_record",
                    "unit_usage": "kWh",
                    "usage_kwh": numbers["Usage_kWh"],
                    "numeric_fields_for_historical_inspection": {
                        **numbers, "NSM": nsm,
                    },
                    "source_fields_raw": row,
                    "calendar_features_derived": {
                        "day_of_week": derived_weekday,
                        "week_status": derived_weekstatus,
                        "hour": derived_time.hour,
                        "minute": derived_time.minute,
                    },
                    "future_target_feature_policy": (
                        "Use past Usage_kWh and known derived calendar only; "
                        "do not use future CO2, factors or Load_Type"
                    ),
                    "source_scope": "external_steel_industry_south_korea_2018",
                }
                target_stream.write(
                    json.dumps(record, ensure_ascii=False, allow_nan=False) + "\n"
                )

        if row_count != EXPECTED_READINGS:
            fail(f"Harus {EXPECTED_READINGS} baris energi; ditemukan {row_count}")
        if len(source_day_counts) != EXPECTED_SOURCE_DAYS:
            fail(f"Harus {EXPECTED_SOURCE_DAYS} label tanggal; ditemukan {len(source_day_counts)}")
        if any(count != 96 for count in source_day_counts.values()):
            fail("Setiap label tanggal sumber harus mempunyai 96 bacaan")
        if midnight_count != EXPECTED_SOURCE_DAYS or any(
            midnight_per_source_day[day] != 1 for day in source_day_counts
        ):
            fail("Setiap tanggal sumber harus berakhir dengan satu baris 00:00")
        if first_derived != datetime(2018, 1, 1, 0, 15) or \
                previous_derived != datetime(2019, 1, 1, 0, 0):
            fail("Rentang timestamp turunan tidak cocok dengan baseline UCI 2018")
        if co2_zero_count != 20990:
            fail("Jumlah nol CO2 berbeda dari audit; periksa versi CSV")

        write_json(stage / "source_catalog.json", {
            "dataset_id": DATASET_ID,
            "schema_version": SCHEMA_VERSION,
            "category": "external_electricity_history",
            "source_name": csv_path.name,
            "source_id": source_id,
            "source_sha256": file_hash,
            "source_size_bytes": csv_path.stat().st_size,
            "source_columns_in_order": EXPECTED_HEADER,
            "source_csv_header_row": 1,
            "facility_context": "steel_industry_south_korea_2018_external",
            "company_meter_data_available": False,
            "raw_time_policy": "Retain original CSV label, NSM, day labels, and row order",
            "derived_time_policy": "End-of-source-day 00:00 shifted to next date for chronology; inference",
            "measurement_interval_boundary": "start_or_end_not_verified",
        })
        manifest = {
            "dataset_id": DATASET_ID,
            "schema_version": SCHEMA_VERSION,
            "prepared_at_utc": datetime.now(timezone.utc).isoformat(),
            "source_name": csv_path.name,
            "source_id": source_id,
            "source_sha256": file_hash,
            "readings_count": row_count,
            "source_day_count": len(source_day_counts),
            "readings_per_source_day": 96,
            "midnight_adjustment_count": midnight_count,
            "co2_zero_count_as_provided": co2_zero_count,
            "source_calendar_vs_derived_mismatch_count": source_calendar_mismatch_count,
            "first_timestamp_derived_naive": first_derived.isoformat(timespec="minutes"),
            "last_timestamp_derived_naive": previous_derived.isoformat(timespec="minutes"),
            "output_sha256": {
                READINGS_FILE: sha256_file(output_path),
                "source_catalog.json": sha256_file(stage / "source_catalog.json"),
            },
            "not_included": ["forecast", "company_energy", "Supabase_import"],
        }
        write_json(stage / "manifest.json", manifest)
        (stage / SENTINEL).write_text(
            "Generated by scripts/prepare_energy.py. Do not edit generated records.\n",
            encoding="utf-8",
        )
        publish(stage, output_dir)
        return manifest


def publish(stage: Path, output_dir: Path) -> None:
    """Replace only a previously generated folder with no unrecognized files."""
    backup: Path | None = None
    allowed = {READINGS_FILE, "source_catalog.json", "manifest.json", SENTINEL}
    if output_dir.exists():
        if not output_dir.is_dir() or not (output_dir / SENTINEL).is_file():
            fail(f"Folder output ada tetapi bukan keluaran skrip ini: {output_dir}")
        unexpected = {entry.name for entry in output_dir.iterdir()} - allowed
        if unexpected:
            fail(f"Folder output memuat berkas pengguna; tidak ditimpa: {sorted(unexpected)}")
        backup = output_dir.with_name(output_dir.name + ".backup-" + uuid.uuid4().hex)
        output_dir.rename(backup)
    try:
        stage.rename(output_dir)
    except OSError:
        if backup is not None:
            backup.rename(output_dir)
        raise
    if backup is not None:
        shutil.rmtree(backup)


def main() -> int:
    project_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--csv", type=Path, default=project_root / "imports" / "raw" / "energy"
        / "steel+industry+energy+consumption" / "Steel_industry_data.csv",
        help="CSV UCI yang telah diekstrak dari ZIP",
    )
    parser.add_argument(
        "--output-dir", type=Path,
        default=project_root / "imports" / "prepared" / "energy",
        help="Keluaran energi eksternal terpisah dari Case 2/RCA",
    )
    args = parser.parse_args()
    try:
        manifest = prepare(args.csv, args.output_dir)
    except (EnergyPreparationError, OSError, UnicodeError, csv.Error) as exc:
        print(f"GAGAL: {exc}", file=sys.stderr)
        return 1
    print(
        f"SUKSES: {manifest['readings_count']} bacaan, "
        f"{manifest['source_day_count']} label hari."
    )
    print(f"Penyesuaian 00:00 untuk urutan waktu: {manifest['midnight_adjustment_count']}.")
    print(f"Hasil: {args.output_dir.resolve()}")
    print("Sumber UCI eksternal; belum dibuat forecast atau diimpor ke Supabase.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
