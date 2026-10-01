"""Independent acceptance checks against prepared source rows, no database writes.

Run after `python scripts/validate_data.py`. This verifies the demo narrative
and scope boundaries while live Auth/RLS tests remain a separate deployment gate.
"""
from __future__ import annotations

import json
from collections import Counter
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def rows(name: str):
    path = ROOT / "imports/prepared" / name
    with path.open(encoding="utf-8") as file:
        for line in file:
            yield json.loads(line)


def decimal(value):
    return Decimal(str(value))


def main():
    incidents = list(rows("case2/incidents.jsonl"))
    assert len(incidents) == 380
    assert len({(i["source_id"], i["source_row"]) for i in incidents}) == 380
    assert len({i["plant"] for i in incidents}) == 12
    assert sum(decimal(i["downtime_hours"]) for i in incidents) == Decimal("2261.1")
    assert sum(decimal(i["actual_loss_kusd"]) for i in incidents) == Decimal("61886.46")
    assert sum(decimal(i["potential_loss_kusd"]) for i in incidents) == Decimal("5307.97")

    ko = [i for i in incidents if i["asset_tag"] == "KO-3201" and i["occurred_date"] == "2026-04-29"]
    assert len(ko) == 1 and decimal(ko[0]["downtime_hours"]) == 32
    assert decimal(ko[0]["actual_loss_kusd"]) == 1584
    observations = [x for x in rows("case2/equipment_conditions.jsonl") if x["asset_tag"] == "KO-3201"]
    prior = [x for x in observations if x["observed_date"] <= "2026-04-22"]
    assert prior
    latest = max(prior, key=lambda x: x["observed_date"])
    assert latest["observed_date"] == "2026-04-22" and latest["health_status_as_provided"] == "ALARM"
    measured = {x["parameter_name"]: (decimal(x["value"]), x["unit_as_provided"]) for x in latest["measurements"]}
    assert measured["DE Radial Vibration"] == (Decimal("71.674"), "micron")
    assert measured["Lube Oil Water Content"] == (Decimal("1372.791"), "ppm")
    assert all(x["observed_date"] <= "2026-04-22" for x in prior)

    production = list(rows("case2/production_readings.jsonl"))
    assert len(production) == 3600
    he_off = sum(x["raw"].get("RUN_STATUS") == "OFF" for x in production if x["asset_tag"] == "HE-3301")
    assert he_off == 13, "OFF observation count must remain distinct from 12 incident downtime hours"

    pred = {x["cutoff_sequence_index"]: x for x in rows("energy_forecast/test_predictions.jsonl")}
    evaluations = {x["cutoff_sequence_index"]: x for x in rows("energy_forecast/test_holdout_evaluations.jsonl")}
    assert len(pred) == len(evaluations) == 5277
    assert set(pred) == set(evaluations)
    samples = {29760: (13.96, 14.47, 0.51), 32100: (20.88, 115.80, 94.92), 35036: (15.40, 14.97, 0.43)}
    for cutoff, expected in samples.items():
        p, e = pred[cutoff], evaluations[cutoff]
        assert p["forecast_id"] == e["forecast_id"]
        forecast = decimal(p["predicted_kwh_next_hour_assuming_interval_kwh"])
        actual = decimal(e["actual_kwh_next_hour_assuming_interval_kwh"])
        assert abs(forecast - actual) == decimal(e["absolute_one_hour_total_error_kwh"])
        assert (forecast, actual, decimal(e["absolute_one_hour_total_error_kwh"])) == tuple(map(decimal, expected))
    assert len({pred[c]["forecast_id"] for c in samples}) == 3

    docs = list(rows("rca/rca_documents.jsonl"))
    assert len(docs) == 5
    slides = list(rows("rca/rca_slides.jsonl"))
    assert len(slides) == 55
    assert sorted(Counter(x["source_id"] for x in slides).values()) == [11] * 5
    assert all(x["visual_review_status"] == "pending" for x in slides)

    report = json.loads((ROOT / "imports/prepared/validation_report.json").read_text(encoding="utf-8"))
    assert report["technical_integrity_gate"] == "PASS"
    print("PASS: source totals, KO replay cutoff, HE OFF distinction, 3 independent forecast cutoffs, 55 RCA visual flags.")
    print("Live judge login, RLS, API/provider, migration application, and pixel-level rendering require deployment access.")


if __name__ == "__main__":
    main()
