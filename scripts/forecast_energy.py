"""Backtest the next four UCI electricity readings with chronological holdouts.

Run from project root: python scripts/forecast_energy.py
No external packages, AI API or Supabase credentials are needed. Input is the
output of scripts/prepare_energy.py. Output is a separate generated folder at
imports/prepared/energy_forecast, leaving the prepared source untouched.

This is a historical 2018 external STEEL facility demonstration, NOT a
current forecast, utility bill or Chandra Asri electricity measurement.
Usage_kWh is provisionally interpreted as kWh in each 15-minute observation;
the exact interval boundary and meter semantics need source confirmation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import sys
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


DATASET_ID = "uci_steel_industry_2018_external"
EXPECTED_COUNT = 35040
PER_DAY = 96
HORIZON = 4
TRAIN_END = 255 * PER_DAY
VALIDATION_END = 310 * PER_DAY
BASELINES = ("last_observation", "same_time_previous_day")
MODEL_VERSION = "baseline_15min_four_steps_v1"
SOURCE_FILE = "energy_readings.jsonl"
PREDICTIONS_FILE = "test_predictions.jsonl"
HOLDOUT_FILE = "test_holdout_evaluations.jsonl"
SUMMARY_FILE = "forecast_summary.json"
SENTINEL = "PREPARED_BY_TRACE_MI_FORECAST.txt"


class ForecastError(Exception):
    """The prepared source or requested output is unsafe or invalid."""


def fail(message: str) -> None:
    raise ForecastError(message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def round6(value: float) -> float:
    return round(value, 6)


def percentile(values: list[float], fraction: float) -> float:
    """Linear interpolation at position (n - 1) * fraction, as percentile_cont."""
    if not values:
        fail("Distribusi error tidak berisi cutoff")
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return round6(ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower))


def load_readings(input_dir: Path) -> tuple[list[float], list[str], dict[str, Any]]:
    manifest_path = input_dir / "manifest.json"
    path = input_dir / SOURCE_FILE
    if not manifest_path.is_file() or not path.is_file():
        fail("Data energi belum disiapkan; jalankan scripts/prepare_energy.py dahulu")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or manifest.get("dataset_id") != DATASET_ID:
        fail("Dataset input harus berupa UCI eksternal yang telah dipersiapkan")
    if manifest.get("schema_version") != 1 or manifest.get("readings_count") != EXPECTED_COUNT:
        fail("Versi/jumlah bacaan input tidak cocok dengan baseline yang diaudit")
    if manifest.get("midnight_adjustment_count") != 365:
        fail("Penyesuaian 00:00 belum terverifikasi untuk 365 hari")
    if manifest.get("output_sha256", {}).get(SOURCE_FILE) != sha256_file(path):
        fail("Checksum data energi berbeda dari manifest; siapkan ulang sumbernya")

    values: list[float] = []
    timestamps: list[str] = []
    source_id = manifest.get("source_id")
    previous_time: datetime | None = None
    with path.open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, start=1):
            row = json.loads(line)
            if row.get("dataset_id") != DATASET_ID or row.get("source_id") != source_id:
                fail(f"Identitas dataset/sumber tidak cocok pada bacaan {line_number}")
            if row.get("sequence_index") != line_number or row.get("source_csv_row") != line_number + 1:
                fail(f"Urutan sumber putus pada bacaan {line_number}")
            value = row.get("usage_kwh")
            if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
                fail(f"Usage_kWh tidak valid pada bacaan {line_number}")
            stamp = row.get("timestamp_derived_naive")
            if not isinstance(stamp, str):
                fail(f"Timestamp tidak valid pada bacaan {line_number}")
            try:
                current = datetime.fromisoformat(stamp)
            except ValueError as exc:
                raise ForecastError(f"Timestamp rusak pada bacaan {line_number}") from exc
            if current.tzinfo is not None or (previous_time is not None and
                    current - previous_time != timedelta(minutes=15)):
                fail(f"Jarak waktu bukan 15 menit pada bacaan {line_number}")
            if line_number == 1 and current != datetime(2018, 1, 1, 0, 15):
                fail("Awal seri energi tidak cocok dengan data yang diaudit")
            previous_time = current
            timestamps.append(stamp)
            values.append(float(value))

    if len(values) != EXPECTED_COUNT or previous_time != datetime(2019, 1, 1, 0, 0):
        fail("Jumlah/rentang bacaan energi tidak lengkap")
    return values, timestamps, manifest


def predict(values: list[float], cutoff_index: int, method: str) -> list[float]:
    """Read only a fixed 96-reading window ending at the selected cutoff."""
    if cutoff_index < PER_DAY - 1 or cutoff_index >= len(values):
        fail("Cutoff tidak memiliki riwayat satu hari penuh")
    history = values[cutoff_index - (PER_DAY - 1):cutoff_index + 1]
    if method == "last_observation":
        return [history[-1]] * HORIZON
    if method == "same_time_previous_day":
        # Target c+h is paired with observed c+h-96. For h=1..4,
        # those values are history[0..3] and are known before cutoff c.
        return history[:HORIZON]
    fail(f"Metode tidak dikenali: {method}")


def cutoff_range(start_target: int, end_exclusive: int) -> range:
    """Every four-step target lies wholly inside the named time split."""
    first_cutoff = max(PER_DAY - 1, start_target - 1)
    return range(first_cutoff, end_exclusive - HORIZON)


def evaluate_method(values: list[float], cutoffs: range, method: str) -> dict[str, Any]:
    horizon_absolute = [0.0] * HORIZON
    hour_absolute = 0.0
    hour_errors: list[float] = []
    count = 0
    for cutoff in cutoffs:
        prediction = predict(values, cutoff, method)
        actual = values[cutoff + 1:cutoff + 1 + HORIZON]
        for h in range(HORIZON):
            horizon_absolute[h] += abs(prediction[h] - actual[h])
        error = abs(sum(prediction) - sum(actual))
        hour_absolute += error
        hour_errors.append(error)
        count += 1
    if count == 0:
        fail("Periode evaluasi tidak berisi cutoff yang lengkap")
    per_horizon = [round6(item / count) for item in horizon_absolute]
    return {
        "cutoff_count": count,
        "evaluated_interval_predictions": count * HORIZON,
        "mae_kwh_per_interval_all_horizons": round6(sum(horizon_absolute) / (count * HORIZON)),
        "mae_kwh_by_horizon_15_30_45_60_minutes": per_horizon,
        "mean_absolute_one_hour_total_error_kwh": round6(hour_absolute / count),
        "four_interval_total_absolute_error_distribution_kwh": {
            "median": percentile(hour_errors, 0.5),
            "p90": percentile(hour_errors, 0.9),
            "p95": percentile(hour_errors, 0.95),
            "p99": percentile(hour_errors, 0.99),
            "maximum": round6(max(hour_errors)),
        },
        "overlapping_windows_disclosure": (
            "All eligible 15-minute cutoffs are evaluated; their four target windows overlap. "
            "Each target may contribute to several horizon errors."
        ),
    }


def publish(stage: Path, output_dir: Path) -> None:
    allowed = {PREDICTIONS_FILE, HOLDOUT_FILE, SUMMARY_FILE, SENTINEL}
    backup: Path | None = None
    if output_dir.exists():
        if not output_dir.is_dir() or not (output_dir / SENTINEL).is_file():
            fail(f"Folder hasil sudah ada dan bukan keluaran skrip ini: {output_dir}")
        extra = {entry.name for entry in output_dir.iterdir()} - allowed
        if extra:
            fail(f"Folder hasil memiliki berkas pengguna; tidak ditimpa: {sorted(extra)}")
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


def run(input_dir: Path, output_dir: Path) -> dict[str, Any]:
    input_dir = input_dir.resolve()
    output_dir = output_dir.resolve()
    if input_dir == output_dir or input_dir in output_dir.parents or output_dir in input_dir.parents:
        fail("Folder input dan hasil tidak boleh saling mencakup")
    values, timestamps, source_manifest = load_readings(input_dir)
    validation_cutoffs = cutoff_range(TRAIN_END, VALIDATION_END)
    test_cutoffs = cutoff_range(VALIDATION_END, len(values))

    validation = {method: evaluate_method(values, validation_cutoffs, method)
                  for method in BASELINES}
    selected = min(BASELINES, key=lambda method: (
        validation[method]["mae_kwh_per_interval_all_horizons"], BASELINES.index(method)
    ))
    # Selection occurs on validation only. Test metrics for BOTH baselines
    # are calculated after selection; none influence the choice.
    test = {method: evaluate_method(values, test_cutoffs, method) for method in BASELINES}
    output_dir.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix=".energy-forecast-", dir=output_dir.parent) as tmp:
        stage = Path(tmp) / output_dir.name
        stage.mkdir()
        with (stage / PREDICTIONS_FILE).open("w", encoding="utf-8", newline="\n") as predicted_stream, \
             (stage / HOLDOUT_FILE).open("w", encoding="utf-8", newline="\n") as holdout_stream:
            for cutoff in test_cutoffs:
                forecast = predict(values, cutoff, selected)
                # The holdout is read only after the forecast has been created.
                cutoff_time = timestamps[cutoff]
                forecast_id = "uci_steel_test_" + hashlib.sha256(
                    f"{source_manifest['source_id']}|{MODEL_VERSION}|{selected}|{cutoff}".encode("utf-8")
                ).hexdigest()
                target_times = timestamps[cutoff + 1:cutoff + 1 + HORIZON]
                predicted_hour = round6(sum(forecast))
                prediction = {
                    "forecast_id": forecast_id,
                    "dataset_id": DATASET_ID,
                    "source_id": source_manifest["source_id"],
                    "model_version": MODEL_VERSION,
                    "method_selected_on_validation": selected,
                    "split": "test",
                    "cutoff_sequence_index": cutoff + 1,
                    "cutoff_timestamp_derived_naive": cutoff_time,
                    "input_window_sequence_index_inclusive": [cutoff - PER_DAY + 2, cutoff + 1],
                    "input_window_derived_naive": [timestamps[cutoff - PER_DAY + 1], cutoff_time],
                    "target_timestamps_derived_naive": target_times,
                    "predicted_kwh_next_15_30_45_60_minutes": forecast,
                    "predicted_kwh_next_hour_assuming_interval_kwh": predicted_hour,
                    "source_scope": "external_steel_industry_south_korea_2018",
                }
                predicted_stream.write(json.dumps(prediction, allow_nan=False) + "\n")

                actual = values[cutoff + 1:cutoff + 1 + HORIZON]
                actual_hour = round6(sum(actual))
                evaluation = {
                    "forecast_id": forecast_id,
                    "cutoff_sequence_index": cutoff + 1,
                    "split": "test_holdout_revealed_after_prediction",
                    "actual_kwh_next_15_30_45_60_minutes": actual,
                    "actual_kwh_next_hour_assuming_interval_kwh": actual_hour,
                    "absolute_kwh_error_by_horizon": [round6(abs(forecast[i] - actual[i]))
                                                       for i in range(HORIZON)],
                    "absolute_one_hour_total_error_kwh": round6(abs(predicted_hour - actual_hour)),
                }
                holdout_stream.write(json.dumps(evaluation, allow_nan=False) + "\n")

        summary = {
            "model_version": MODEL_VERSION,
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "dataset_id": DATASET_ID,
            "source_id": source_manifest["source_id"],
            "prepared_energy_sha256": source_manifest["output_sha256"][SOURCE_FILE],
            "source_kind": "external_UCI_South_Korea_steel_2018_not_chemical_plant",
            "time_policy": "source order; shifted 00:00 timestamp is documented inference",
            "interval_usage_assumption": (
                "Usage_kWh treated as kWh for each consecutive 15-minute reading; "
                "measurement interval boundary and meter semantics require source confirmation"
            ),
            "split_policy": "chronological_by_sequence; no shuffle; four targets wholly inside split",
            "split_sequence_index_inclusive": {
                "train_reference_no_parameters_fitted": [1, TRAIN_END],
                "validation_targets": [TRAIN_END + 1, VALIDATION_END],
                "test_targets": [VALIDATION_END + 1, EXPECTED_COUNT],
            },
            "horizon_intervals_minutes": [15, 30, 45, 60],
            "past_usage_window_readings": PER_DAY,
            "allowed_forecast_features": ["past_Usage_kWh_only"],
            "forbidden_target_time_features": ["future_Usage_kWh", "CO2", "power_factors", "Load_Type"],
            "validation_baselines": validation,
            "selection_metric": "validation_mae_kwh_per_interval_all_horizons",
            "selection_tie_break": "last_observation_first",
            "selected_baseline": selected,
            "test_baselines": test,
            "test_cutoff_count": len(test_cutoffs),
            "test_cutoff_sequence_index_inclusive": [test_cutoffs.start + 1, test_cutoffs.stop],
            "result_files": {PREDICTIONS_FILE: sha256_file(stage / PREDICTIONS_FILE),
                             HOLDOUT_FILE: sha256_file(stage / HOLDOUT_FILE)},
        }
        write_json(stage / SUMMARY_FILE, summary)
        (stage / SENTINEL).write_text(
            "Generated by scripts/forecast_energy.py. Do not edit generated records.\n",
            encoding="utf-8",
        )
        publish(stage, output_dir)
        return summary


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path,
                        default=root / "imports" / "prepared" / "energy")
    parser.add_argument("--output-dir", type=Path,
                        default=root / "imports" / "prepared" / "energy_forecast")
    args = parser.parse_args()
    try:
        result = run(args.input_dir, args.output_dir)
    except (ForecastError, OSError, UnicodeError, ValueError, TypeError, KeyError,
            json.JSONDecodeError) as exc:
        print(f"GAGAL: {exc}", file=sys.stderr)
        return 1
    print(f"SUKSES: {result['test_cutoff_count']} cutoff uji, masing-masing 4 interval.")
    print(f"Metode terpilih lewat validasi: {result['selected_baseline']}.")
    for method in BASELINES:
        score = result['test_baselines'][method]
        print(f"  TEST {method}: MAE interval {score['mae_kwh_per_interval_all_horizons']:.4f} kWh; "
              f"MAE total satu jam {score['mean_absolute_one_hour_total_error_kwh']:.4f} kWh.")
    print(f"Hasil: {args.output_dir.resolve()}")
    print("Sumber UCI baja eksternal 2018; bukan perkiraan listrik Chandra Asri.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
