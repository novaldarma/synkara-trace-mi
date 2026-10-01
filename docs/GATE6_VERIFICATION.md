# Gate 6 · implementation and evidence handoff · 30 September 2026

## Scope and source protection

This package is based on the uploaded `SYNKARA_TRACE_MI_Case2_Reference_Ready_2026-09-29.zip`. The original archive, raw Case 2 workbooks/PPTX, prepared Case 2 source rows, and the `synkara-case2-reference` database were not modified. No SQL migration or import was executed in either remote database during Gate 6. Dev project `bwozyfxcdtouihrnugpe` was queried read-only to compare the model identity and three examples. A verified demo action is workflow history and does not change the recorded KO-3201 `ALARM`/`TRIP` observations.

## Changes

1. `scripts/forecast_energy.py` emits only kWh forecast and holdout facts. It no longer embeds the previous Rp 1,500 assumption or its cost results in those generated records. The national US$ interpretation remains a distinct, cited calculation in `src/services/energyBenchmark.ts` and `EnergyDashboardPage.tsx`.
2. The forecast summary now describes the distribution of **absolute four-interval total error** across all test cutoffs: median **2.43**, p90 **108.634**, p95 **156.916**, p99 **253.6376**, maximum **485.53 kWh** for `last_observation`. The independently calculated mean is **30.715914 kWh**, and the per-interval MAE is **8.34096 kWh**. Windows overlap; these descriptive percentiles are not calibrated prediction intervals.
3. The Energy UI ties the selected cutoff to the URL, ignores late reveal responses, and displays actuals only when forecast ID **and** cutoff match the current visible prediction. The guarded `reveal_energy_forecast` RPC is the sole reveal path. Missing or invalid responses withhold actuals. The static error-distribution summary appears only if the database model's source ID, prepared-readings SHA-256, version, selected baseline, sample count, and error means match the validated prepared summary.
4. Source links for all four revealed intervals target exact `Steel_industry_data.csv` sequences and the `Usage_kWh` column. The original-record page highlights the selected field. The UI cites the Korean Energy Agency/KEPCO 2018 industrial price **106.46 KRW/kWh** and Federal Reserve G.5A annual **1,099.2926 KRW/US$**; `106.46/1099.2926` is approximately **US$0.0968441/kWh**, an *indicative national benchmark*, not a facility tariff, contract bill, chemical-plant meter, or realized saving.
5. Demo instructions now use cutoffs actually stored in the chronological test period. The old October example at sequence 27,648 was outside that period and cannot drive the forecast page. Its midnight-order lesson can still be inspected in the read-only source table.

## Independent checks actually run

| Check | Result |
| --- | --- |
| `python scripts/validate_data.py` | Pass: 380 incidents, 3,600 Production records, 130 Condition History rows, five RCA documents/55 slides, 35,040 UCI readings, 5,277 test cutoffs. Recalculates distributions from prepared source readings for both baselines and both chronological splits. |
| `python scripts/verify_prototype.py` | Pass: replay cutoff, HE OFF vs incident duration, exact values at three energy cutoffs, and RCA pending flags. |
| `python scripts/import_to_supabase.py --dry-run --dataset case2`, `rca`, `energy` | All preflights pass. A dry run neither connects to nor modifies a remote database. |
| `npm run build`, `node --check api/assistant.js`, `python -m compileall -q scripts` | Pass. This verifies compilation/syntax, not signed-in behavior. |
| All 5,277 old/new generated rows | Forecast IDs, predicted kWh, observed kWh and errors identical; only superseded cost keys were removed. Prepared source SHA-256 unchanged (`c9f41024903ce52f089c2b07e006bd4820bb3a5e255e43a658d6967a38fe0b0a`). |
| Dev database model read | Source ID, SHA-256, version, baseline, count and means match the prepared summary. Three stored forecasts/evaluations match the local records: 29,760 **13.96 / 14.47 / 0.51**, 32,100 **20.88 / 115.80 / 94.92**, 35,036 **15.40 / 14.97 / 0.43** (prediction / observed / absolute error, kWh). |

## Limits and next gate

Build and SQL read access cannot prove that an authorized user can sign in, invoke the reveal RPC, follow every source link, or observe correct state under slow network requests. Gate 7 should run these on the actual Vercel URL with the shared demo account, including switching cutoff while Reveal is pending and browser Back/Forward. Test `/api/assistant` with a server-only provider key and check the returned evidence links; never disclose that key in frontend variables. Recheck RLS as an authenticated user and refresh Actions to confirm persistence. Visually inspect the relevant RCA slides before claiming an extracted conclusion is verified. Check normal zoom and narrow layouts.

The dev database has objects from migrations 009–012 but a migration ledger with a reconciliation entry rather than separate matching rows; its Energy view comment still mentions the old IDR scenario. Preserve the reference database. Compare the specific target's live schema and migration history before a reviewed migration for the stale comment or any future object change. Do not replay 009–012 or fabricate ledger rows. Regeneration changes stored model metadata; do not rerun the importer against an already populated model just to add display statistics. The website may proceed to a Gate 7 deployed verification, but this document does not certify it as deployed or competition-final.

Competition claims must remain bounded by the Case Book's supplied data and the Booklet's submitted prototype/video/PDF requirements. Neither the score nor a finalist position can be guaranteed from these checks.
