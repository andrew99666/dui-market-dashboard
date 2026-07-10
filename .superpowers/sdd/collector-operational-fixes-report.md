# Collector Operational Fixes Report

## Scope

Implemented the approved future-local-refresh hardening only. No Google Ads request was made, no credential file was read, and no committed raw, audit, or dashboard data was modified.

## Implementation

- Added optional `--customer-id` to the Google Ads collector. When supplied, it removes hyphens and is used as the operating request customer ID. When omitted, the collector retains the existing `login_customer_id` YAML fallback.
- Expanded quota retry recognition to include both `google.api_core.exceptions.ResourceExhausted` and `grpc.RpcError` instances whose `code()` is `grpc.StatusCode.RESOURCE_EXHAUSTED`. Other exceptions continue to propagate immediately.
- Added `requirements-research.txt` with `google-ads==31.1.0` and `PyYAML==6.0.3`.
- Updated the deployment runbook with research-workstation dependency installation, operating-customer guidance, the complete dedupe command and paths, dashboard preparation, validation, deployment, and the requirement that collector code and Google Ads credentials stay off the VPS.

## Test-Driven Development Evidence

The two focused tests were added before implementation. The red run produced the expected failures:

- `--customer-id` was an unrecognized argument.
- A `grpc.RpcError` with `RESOURCE_EXHAUSTED` propagated instead of retrying.

After the minimal implementation:

| Command | Result |
| --- | --- |
| `python -m pytest tests/fetch_google_ads_keyword_metrics.test.py -q -k "customer_id_argument or grpc_resource_exhausted"` | 2 passed, 7 deselected |
| `python -m pytest tests/fetch_google_ads_keyword_metrics.test.py -q` | 9 passed |
| `npm test -- tests/dedupe-city-keyword-metrics.test.mjs` | 1 file passed; 4 tests passed |

## Commit

Committed with message `fix: harden Google Ads refresh workflow`.
