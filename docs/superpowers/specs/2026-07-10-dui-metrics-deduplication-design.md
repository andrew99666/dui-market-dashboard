# DUI Metrics Deduplication Design

## Goal

Replace the dashboard's current city totals with totals calculated from unique Google Ads keyword-metric records. The dashboard must not add the same Google Ads search-volume and bid data more than once for a city when multiple keyword variants receive identical metrics.

## Source Constraint

The committed dashboard source is already aggregated by city and does not retain keyword-level metrics. Accurate cleanup therefore requires a new Google Ads historical-metrics collection for all 345 researched cities and 144 input keyword variants.

## Chosen Approach

1. Run one Google Ads historical-metrics request per city using the existing 144-keyword batch and the existing city Google Ads geo target.
2. Save every returned keyword metric before aggregation. Each raw row includes city, state, returned keyword text, average monthly searches, low/high top-of-page bid micros, and calculated CPC midpoint.
3. Within each city, de-duplicate returned rows by the exact raw fingerprint:
   `avg_monthly_searches | low_top_of_page_bid_micros | high_top_of_page_bid_micros`.
   Null bid values are part of the fingerprint, so identical unknown-CPC rows are also counted once.
4. Retain the first row in deterministic keyword-text order for each fingerprint. Mark every additional row as removed and record the retained keyword it matched.
5. Recalculate each city total search volume as the sum of retained monthly-search values. Recalculate average CPC from retained rows with a known bid midpoint, rounding only the final city average to two decimals.
6. Replace `data/source/city-metrics.csv`, regenerate the bundled JSON, and update methodology metadata to state that duplicate Google Ads metric fingerprints are counted once.

## Alternatives Rejected

- Infer duplicate values from the existing 345 city totals: impossible because keyword-level records are no longer present.
- Dedupe only rounded displayed CPC values: can collapse distinct low/high bid ranges that happen to have the same rounded midpoint.
- Dedupe globally across cities: invalid because each city is a separate geographic market.

## Audit And VPS Handoff

Commit these deployable artifacts with the updated dashboard:

- `data/handoff/dui-expanded-deduplicated-city-metrics.csv`: city totals used by the dashboard.
- `data/handoff/dui-expanded-keyword-metrics-audit.csv`: every raw returned record, fingerprint, retained flag, and duplicate-of keyword.
- `data/handoff/dui-expanded-deduplication-manifest.json`: input/output record counts, duplicate counts, methodology, and refresh date.
- `VPS_UPDATE.md`: exact pull, install, build, and static deployment steps. It must not require Google Ads credentials on the VPS.

The raw Google Ads collector runs only on the research workstation. The VPS receives the committed cleaned data and static `dist/` output.

## Validation

- Unit-test fingerprint creation, same-city duplicate removal, null-CPC handling, deterministic retained-row selection, volume totals, and known-CPC averaging.
- Probe Phoenix first and compare raw, retained, and removed records before the all-city run.
- Reconcile the 345 cleaned city rows against the audit manifest.
- Run the existing dashboard data preparation, unit tests, lint, production build, and browser suite.
- Confirm the final GitHub handoff contains all required data and VPS instructions.
