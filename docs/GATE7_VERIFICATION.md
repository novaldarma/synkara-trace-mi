# Gate 7 — RCA viewing and local verification (30 September 2026)

## Outcome
This is a **ready-for-user-test candidate**, continuing the supplied Gate 6 ZIP. It is not a certification of a deployed, signed-in judge session. No competition ranking or finalist result is implied.

The RCA page now shows five team-prepared PDF renditions, with a direct-open fallback and an explicit missing-file state. Each PDF is bound to the source PPTX SHA-256, asset tag, and AR number. These PDFs are viewing aids; the supplied PPTX is the source of record and the extracted slide blocks are a separate inspection/search layer. Four PDFs condense 11 source slides into 3–4 pages, so the slide URL parameter points to the original slide extract, not an assumed PDF page.

## Source and fidelity checks
| Asset | PPTX SHA-256 prefix | PDF pages | Result |
| --- | --- | ---: | --- |
| PU-2101B | 2f800b7a | 3 | Source hash matches prepared catalog; numeric content retained |
| KO-3201 | 7db64c0b | 3 | Source hash matches prepared catalog; numeric content retained |
| PM-4405B | a980f954 | 4 | Source hash matches prepared catalog; numeric content retained |
| HE-3301 | 43b49807 | 4 | Source hash matches prepared catalog; numeric content retained |
| BL-5702 | 260f106b | 11 | Source hash matches prepared catalog; numeric content retained |

All five copied PDFs are byte-for-byte identical to the team files supplied locally. Text extraction compared the 55 source slides with all 25 PDF pages: every unique source numeric token appears in its matching PDF, apart from slide-number labels 02/11–10/11 omitted by condensed renditions and a line-broken 12-month label in the BL PDF. Token vocabulary overlap is approximately 89–100%; this is an audit signal, not a proof of visual equivalence. The original slide 8 matrix code positions were inspected for all five cases: X codes occupy the medium-control/high-impact area and P codes the high-control/high-impact area. No source slide or prepared dataset was edited.

The five original 11-slide decks have **not** all been visually certified page by page in this session. The prepared dataset and dev database therefore correctly retain visual_review_status=pending; no historical RCA action rows are promoted. Source identity and PDF fidelity checks must not be presented as complete visual certification of every original layout.

## Checks completed
- npm run build: pass (TypeScript and Vite).
- node --check api/assistant.js: pass.
- scripts/validate_data.py with a temporary report path: pass; 380 incidents, 3,600 hourly Production records, 130 weekly Equipment Condition History rows, 5 RCA documents/55 slides, 35,040 external UCI energy readings, 5,277 test cutoffs.
- scripts/verify_prototype.py: pass for source totals, replay cutoff, HE OFF distinction, three energy cutoffs, and pending RCA flags.
- Importer dry runs for case2, rca, and energy: pass; no remote import.
- Local HTTP check: RCA route 200; KO PDF HEAD 200, application/pdf, expected byte length.
- Dev Supabase read-only count: 5 RCA documents, 55 slides, 5 incident links, 0 reviewed slides, 0 historical action rows.
- Assistant code still excludes RCA slide conclusions from its model context and excludes RCA entirely from pre-event replay. No database mutation or migration was run.

## User acceptance test before Gate 8
1. Configure .env.local from .env.example with the correct development Supabase Project URL and publishable key. The ZIP contains **no** .env.local, provider key, or node_modules. Keep GEMINI_API_KEY server-side only.
2. Start the app and sign in with the shared demo account. Inspect /data/rca for each of the five assets, embedded PDF, direct-open link, case identity, and slide deep links.
3. On the intended Vercel deployment, verify the authenticated flow, normal and narrow layouts, PDF delivery, a deliberately missing rendition, Back/Forward navigation, Energy Reveal while switching cutoffs, assistant evidence links, and saved Actions after refresh.
4. Keep RCA conclusions labeled pending until all 55 original slides have an explicit visual-review ledger and any database review-status update is separately checked. Never give a pre-event replay post-event RCA conclusions.
5. PDF rendition files are under public/rca/ and are directly fetchable by URL on a static deployment. Confirm that this exposure is acceptable for the competition dataset before sharing the deployed link; otherwise place them behind an authenticated file endpoint.

The supplied ZIP initially contained .env.local with an invalid Project URL. It was used only in the local working copy for diagnosis and then configured against the known development project for local format checks; it is excluded from this delivery. The user's own signed-in deployment test remains necessary, as agreed.

## PDF identity correction after local screenshot
A signed-in local screenshot showed the first viewer candidate rejecting HE-3301 because the database asset_id is an opaque case2_asset identifier, not the human equipment tag. The viewer now binds by the original PPTX SHA-256 and AR number, and confirms that the source filename contains the expected equipment tag. It displays the tag in the heading. All five prepared RCA records were checked against this mapping and the five PDF files; TypeScript/Vite build passed again. The earlier Gate 7 ZIP must be replaced with this corrected package.
