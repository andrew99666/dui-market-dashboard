# DUI Metrics Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Re-query Google Ads keyword metrics, remove same-city duplicate metric fingerprints, update the dashboard with corrected totals, and commit an audit-ready VPS handoff.

**Architecture:** A Python collector makes one 144-keyword Google Ads historical-metrics request per city and saves raw returned metrics without aggregation. A Node data module fingerprints, de-duplicates, audits, and aggregates those rows into the canonical CSV; the existing Census preparation script then regenerates dashboard JSON. The VPS receives committed data and static assets only, never Google Ads credentials.

**Tech Stack:** Python Google Ads client; Node.js ESM with csv-parse; existing Vite/React dashboard; Vitest and Playwright.

## Global Constraints

- Keep the 144 input variants and all 345 verified Google Ads city geo targets.
- De-duplicate only within one city using exact raw average monthly searches, low bid micros, and high bid micros.
- Treat identical null bid fields as one unknown-CPC fingerprint.
- Do not round a CPC until calculating the final retained-record city average.
- Keep raw, retained, and removed records in the committed audit CSV.
- Do not store Google Ads credentials, OAuth refresh tokens, or developer tokens in the repository or VPS handoff.
- Preserve 345 researched cities and validate every canonical city against Census coordinates.
- Use one sequential request stream with retry/backoff and the existing delay.

---

### Task 1: Create The Tested Deduplication Engine

**Files:**
- Create: scripts/dedupe-city-keyword-metrics.mjs
- Create: tests/dedupe-city-keyword-metrics.test.mjs
- Modify: package.json

**Interfaces:**
- Consumes raw rows with city, state, keyword, avgMonthlySearches, lowBidMicros, and highBidMicros.
- Produces metricFingerprint(row), deduplicateKeywordMetrics(rows), aggregateCityMetrics(auditRows), and a CLI that writes summary, audit, and manifest files.
- Each audit row has fingerprint, retained, and duplicateOfKeyword.

- [ ] **Step 1: Write failing tests**

~~~js
it('retains one same-city metric fingerprint and records the removed keyword', () => {
  const audit = deduplicateKeywordMetrics([
    raw({ keyword: 'dui attorney near me', avgMonthlySearches: 5000, lowBidMicros: 10000000, highBidMicros: 30000000 }),
    raw({ keyword: 'dui lawyer near me', avgMonthlySearches: 5000, lowBidMicros: 10000000, highBidMicros: 30000000 }),
    raw({ keyword: 'dui attorney Phoenix', avgMonthlySearches: 800, lowBidMicros: 8000000, highBidMicros: 20000000 }),
  ]);

  expect(audit.filter((row) => row.retained)).toHaveLength(2);
  expect(audit.find((row) => row.keyword === 'dui lawyer near me')).toMatchObject({
    retained: false,
    duplicateOfKeyword: 'dui attorney near me',
  });
});

it('does not merge identical metrics from different cities and retains one null-CPC fingerprint', () => {
  const audit = deduplicateKeywordMetrics([
    raw({ city: 'Phoenix', keyword: 'a', avgMonthlySearches: 10, lowBidMicros: null, highBidMicros: null }),
    raw({ city: 'Phoenix', keyword: 'b', avgMonthlySearches: 10, lowBidMicros: null, highBidMicros: null }),
    raw({ city: 'Mesa', keyword: 'a', avgMonthlySearches: 10, lowBidMicros: null, highBidMicros: null }),
  ]);

  expect(audit.filter((row) => row.retained)).toHaveLength(2);
});

it('sums retained volume and averages only retained known CPC midpoints', () => {
  const city = aggregateCityMetrics(deduplicateKeywordMetrics([
    raw({ avgMonthlySearches: 10, lowBidMicros: 1000000, highBidMicros: 3000000 }),
    raw({ keyword: 'duplicate', avgMonthlySearches: 10, lowBidMicros: 1000000, highBidMicros: 3000000 }),
    raw({ keyword: 'unknown', avgMonthlySearches: 7, lowBidMicros: null, highBidMicros: null }),
  ]));

  expect(city).toEqual([{ City: 'Phoenix', State: 'Arizona', 'Total Search Volume': 17, 'Average CPC': 2 }]);
});
~~~

- [ ] **Step 2: Run the test to verify it fails**

Run: npm test -- tests/dedupe-city-keyword-metrics.test.mjs

Expected: FAIL because scripts/dedupe-city-keyword-metrics.mjs does not exist.

- [ ] **Step 3: Implement exact fingerprinting and aggregation**

~~~js
export function metricFingerprint(row) {
  return [row.avgMonthlySearches, row.lowBidMicros ?? 'null', row.highBidMicros ?? 'null'].join('|');
}

export function deduplicateKeywordMetrics(rows) {
  const retainedByCityAndFingerprint = new Map();
  return [...rows].sort(byCityAndKeyword).map((row) => {
    const fingerprint = metricFingerprint(row);
    const key = [row.city, row.state, fingerprint].join('|');
    const retained = retainedByCityAndFingerprint.get(key);
    if (retained) return { ...row, fingerprint, retained: false, duplicateOfKeyword: retained.keyword };
    const auditRow = { ...row, fingerprint, retained: true, duplicateOfKeyword: '' };
    retainedByCityAndFingerprint.set(key, auditRow);
    return auditRow;
  });
}
~~~

Implement CSV parsing/writing and CLI options --raw, --summary, --audit, --manifest, and --refreshed-at. Add data:dedupe to package.json.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: npm test -- tests/dedupe-city-keyword-metrics.test.mjs

Expected: PASS with all fingerprint, null-CPC, city-boundary, and aggregation tests green.

- [ ] **Step 5: Commit**

~~~bash
git add scripts/dedupe-city-keyword-metrics.mjs tests/dedupe-city-keyword-metrics.test.mjs package.json
git commit -m "feat: add keyword metric deduplication engine"
~~~

### Task 2: Add Reproducible Google Ads Raw Collection

**Files:**
- Create: scripts/fetch_google_ads_keyword_metrics.py
- Create: tests/fetch_google_ads_keyword_metrics.test.py
- Create: data/source/city-geo-targets.csv
- Modify: docs/deployment.md

**Interfaces:**
- Consumes data/source/city-geo-targets.csv, the existing 144 keyword templates, and an external google-ads.yaml path.
- Produces raw CSV rows with City, State, State Code, Google Ads Code, Keyword, Average Monthly Searches, Low Top Of Page Bid Micros, and High Top Of Page Bid Micros.
- CLI: python scripts/fetch_google_ads_keyword_metrics.py --config PATH --input data/source/city-geo-targets.csv --output data/source/dui-expanded-keyword-metrics-raw.csv --limit N.

- [ ] **Step 1: Write a failing collector utility test**

~~~python
def test_raw_metric_row_preserves_exact_google_values():
    row = raw_metric_row(
        city={"City": "Phoenix", "State": "Arizona", "ST": "AZ", "GAds Code": "1014048"},
        keyword_text="dui attorney near me",
        avg_monthly_searches=5000,
        low_bid_micros=10000000,
        high_bid_micros=30000000,
    )
    assert row == {
        "City": "Phoenix", "State": "Arizona", "State Code": "AZ", "Google Ads Code": "1014048",
        "Keyword": "dui attorney near me", "Average Monthly Searches": 5000,
        "Low Top Of Page Bid Micros": 10000000, "High Top Of Page Bid Micros": 30000000,
    }
~~~

- [ ] **Step 2: Run the test to verify it fails**

Run: python -m pytest tests/fetch_google_ads_keyword_metrics.test.py -q

Expected: FAIL because raw_metric_row does not exist.

- [ ] **Step 3: Implement sequential collection**

~~~python
for city in city_rows[:limit]:
    response = fetch_with_retry(lambda: service.generate_keyword_historical_metrics(request_for(city)))
    for result in response.results:
        rows.append(raw_metric_row(
            city, result.text, result.keyword_metrics.avg_monthly_searches,
            result.keyword_metrics.low_top_of_page_bid_micros,
            result.keyword_metrics.high_top_of_page_bid_micros,
        ))
    time.sleep(request_delay_seconds)
~~~

Copy the verified 345-city target mapping into data/source/city-geo-targets.csv. Keep credentials external and document that this collector is never run on the VPS.

- [ ] **Step 4: Run collector tests to verify they pass**

Run: python -m pytest tests/fetch_google_ads_keyword_metrics.test.py -q

Expected: PASS without a network call.

- [ ] **Step 5: Commit**

~~~bash
git add scripts/fetch_google_ads_keyword_metrics.py tests/fetch_google_ads_keyword_metrics.test.py data/source/city-geo-targets.csv docs/deployment.md
git commit -m "feat: add raw Google Ads keyword metric collector"
~~~

### Task 3: Validate Phoenix, Then Refresh All Cities

**Files:**
- Create: data/source/dui-expanded-keyword-metrics-raw.csv
- Create: data/handoff/dui-expanded-keyword-metrics-audit.csv
- Create: data/handoff/dui-expanded-deduplicated-city-metrics.csv
- Create: data/handoff/dui-expanded-deduplication-manifest.json
- Modify: data/source/city-metrics.csv

**Interfaces:**
- Consumes Task 2 raw CSV.
- Produces exactly 345 canonical city/state totals plus audit and manifest files.

- [ ] **Step 1: Run the one-city Phoenix collection**

~~~powershell
python scripts/fetch_google_ads_keyword_metrics.py --config $HOME\google-ads.yaml --input data/source/city-geo-targets.csv --output data/source/phoenix-keyword-metrics-raw.csv --limit 1
node scripts/dedupe-city-keyword-metrics.mjs --raw data/source/phoenix-keyword-metrics-raw.csv --summary data/handoff/phoenix-deduplicated-city-metrics.csv --audit data/handoff/phoenix-keyword-metrics-audit.csv --manifest data/handoff/phoenix-deduplication-manifest.json --refreshed-at 2026-07-10
~~~

Expected: Phoenix audit shows retained and removed records, and its summary is less than or equal to the current Phoenix total.

- [ ] **Step 2: Inspect the Phoenix audit before the all-city run**

~~~powershell
Import-Csv data/handoff/phoenix-keyword-metrics-audit.csv | Group-Object Retained | Select-Object Name,Count
Get-Content data/handoff/phoenix-deduplication-manifest.json
~~~

Expected: Every removed row names its retained keyword and every retained fingerprint appears once.

- [ ] **Step 3: Run all city requests and generate artifacts**

~~~powershell
python scripts/fetch_google_ads_keyword_metrics.py --config $HOME\google-ads.yaml --input data/source/city-geo-targets.csv --output data/source/dui-expanded-keyword-metrics-raw.csv
node scripts/dedupe-city-keyword-metrics.mjs --raw data/source/dui-expanded-keyword-metrics-raw.csv --summary data/source/city-metrics.csv --audit data/handoff/dui-expanded-keyword-metrics-audit.csv --manifest data/handoff/dui-expanded-deduplication-manifest.json --refreshed-at 2026-07-10
Copy-Item data/source/city-metrics.csv data/handoff/dui-expanded-deduplicated-city-metrics.csv
~~~

- [ ] **Step 4: Reconcile city coverage and audit invariants**

~~~powershell
(Import-Csv data/source/city-metrics.csv).Count
Import-Csv data/handoff/dui-expanded-keyword-metrics-audit.csv | Group-Object City,State,Fingerprint | Where-Object { ($_.Group | Where-Object Retained).Count -ne 1 }
~~~

Expected: 345; the invariant command returns no groups.

- [ ] **Step 5: Commit**

~~~bash
git add data/source/city-metrics.csv data/source/dui-expanded-keyword-metrics-raw.csv data/handoff
git commit -m "data: deduplicate DUI keyword metrics"
~~~

### Task 4: Regenerate Dashboard Data And Create VPS Handoff

**Files:**
- Modify: scripts/prepare-data.mjs
- Modify: src/data/datasetMetadata.json
- Modify: tests/prepare-data.test.mjs
- Modify: tests/dashboard-domain.test.ts
- Modify: tests/app-shell.test.tsx
- Modify: e2e/dashboard.spec.ts
- Create: VPS_UPDATE.md

**Interfaces:**
- Consumes Task 3 canonical cleaned CSV and manifest.
- Produces bundled metric JSON with corrected city totals, metadata that states the dedupe method, and VPS instructions that build static assets only.

- [ ] **Step 1: Write a failing reconciliation test**

~~~js
it('reconciles cleaned city totals to the handoff summary and declares the dedupe method', async () => {
  const summary = parseMetricCsv(await readFile(new URL('../data/handoff/dui-expanded-deduplicated-city-metrics.csv', import.meta.url), 'utf8'));
  const generated = JSON.parse(await readFile(new URL('../src/data/cityMetrics.json', import.meta.url), 'utf8'));
  const metadata = JSON.parse(await readFile(new URL('../src/data/datasetMetadata.json', import.meta.url), 'utf8'));

  expect(summary).toHaveLength(345);
  expect(generated.map(({ city, state, totalSearchVolume, averageCpcUsd }) => ({ city, state, totalSearchVolume, averageCpcUsd }))).toEqual(summary);
  expect(metadata.methodology).toContain('exact raw Google Ads metric fingerprints');
});
~~~

- [ ] **Step 2: Run the test to verify it fails**

Run: npm test -- tests/prepare-data.test.mjs

Expected: FAIL because the summary and revised metadata do not exist.

- [ ] **Step 3: Update metadata and UI expectations**

Update prepare-data.mjs to read the manifest when present and write methodology that names exact raw Google Ads metric fingerprints. Regenerate data with:

~~~powershell
npm run data:prepare -- --refreshed-at 2026-07-10
~~~

Replace old hard-coded status totals and median expectations in dashboard and browser tests with values from the refreshed data and manifest. Keep classification-boundary tests unchanged.

- [ ] **Step 4: Create VPS_UPDATE.md**

~~~markdown
# VPS Dashboard Update

git pull origin main
npm ci
npm run build

# Deploy the contents of dist/ to /var/www/data.thecallblueprint.com.
# Do not copy Google Ads credentials to the VPS.
~~~

Include the manifest path and a reminder to deploy every dist/assets file, including the hashed place-index JSON.

- [ ] **Step 5: Verify, commit, and push**

~~~powershell
npm test
npm run lint
npm run build
npm run test:e2e
git add scripts/prepare-data.mjs src/data tests data/handoff VPS_UPDATE.md
git commit -m "feat: publish deduplicated dashboard data"
git push origin main
~~~

Expected: 345 cleaned city records, no test failures, clean working tree, and GitHub main includes all handoff files.
