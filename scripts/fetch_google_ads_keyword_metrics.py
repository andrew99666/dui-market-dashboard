from __future__ import annotations

import argparse
import csv
import re
import sys
import time
from pathlib import Path
from typing import Callable


DEFAULT_CONFIG_PATH = Path.home() / "google-ads.yaml"
DEFAULT_INPUT_PATH = Path("data/source/city-geo-targets.csv")
DEFAULT_OUTPUT_PATH = Path("data/source/dui-expanded-keyword-metrics-raw.csv")
DEFAULT_REQUEST_DELAY_SECONDS = 1.1
DEFAULT_MAX_ATTEMPTS = 5
ENGLISH_LANGUAGE_CONSTANT = "languageConstants/1000"
OUTPUT_FIELDNAMES = [
    "City",
    "State",
    "State Code",
    "Google Ads Code",
    "Keyword",
    "Average Monthly Searches",
    "Low Top Of Page Bid Micros",
    "High Top Of Page Bid Micros",
]

DUI_EXPANDED_BASE_PHRASES = [
    "dui attorney",
    "dui lawyer",
    "dui defense attorney",
    "drunk driving lawyer",
    "drunk driving defense attorney",
    "dwi attorney",
    "owi lawyer",
    "ovi attorney",
    "dwai lawyer",
    "dmv hearing lawyer",
    "dui license hearing attorney",
    "24 hour dui lawyer",
    "emergency dui attorney",
    "weekend dui lawyer",
    "dui court date lawyer",
    "dui arraignment lawyer",
    "just got a dui need a lawyer",
    "first offense dui lawyer",
    "first time dui attorney",
    "second dui lawyer",
    "3rd dui attorney",
    "felony dui lawyer",
    "aggravated dui attorney",
    "dui accident lawyer",
    "dui with injury attorney",
    "breathalyzer refusal lawyer",
    "dui refusal attorney",
    "underage dui lawyer",
    "cdl dui lawyer",
    "out of state dui lawyer",
    "affordable dui lawyer",
    "best dui lawyer",
    "top rated dui attorney",
    "fight dui charge lawyer",
    "dui dismissal lawyer",
    "wet reckless lawyer",
]
DUI_EXPANDED_KEYWORD_TEMPLATES = [
    template
    for base_phrase in DUI_EXPANDED_BASE_PHRASES
    for template in (
        f"{base_phrase} near me",
        f"{base_phrase} {{city}}",
        f"{base_phrase} {{city_state}}",
        f"{base_phrase} {{city_state_full}}",
    )
]


def build_keywords(city: dict[str, str]) -> list[str]:
    city_name = city["City"].strip()
    state_code = city["ST"].strip()
    state_name = city["State"].strip()
    return [
        template.format(
            city=city_name,
            city_state=f"{city_name} {state_code}",
            city_state_full=f"{city_name} {state_name}",
        )
        for template in DUI_EXPANDED_KEYWORD_TEMPLATES
    ]


def raw_metric_row(
    city: dict[str, str],
    keyword_text: str,
    avg_monthly_searches: int | None,
    low_bid_micros: int | None,
    high_bid_micros: int | None,
) -> dict[str, str | int | None]:
    return {
        "City": city["City"],
        "State": city["State"],
        "State Code": city["ST"],
        "Google Ads Code": city["GAds Code"],
        "Keyword": keyword_text,
        "Average Monthly Searches": avg_monthly_searches,
        "Low Top Of Page Bid Micros": low_bid_micros,
        "High Top Of Page Bid Micros": high_bid_micros,
    }


def read_city_rows(
    input_path: Path,
    city: str | None = None,
    state: str | None = None,
    limit: int | None = None,
) -> list[dict[str, str]]:
    if (city is None) != (state is None):
        raise ValueError("--city and --state must be supplied together")

    with input_path.open(newline="", encoding="utf-8-sig") as csv_file:
        rows = list(csv.DictReader(csv_file))

    if city is not None and state is not None:
        expected_city = city.strip().casefold()
        expected_state = state.strip().casefold()
        rows = [
            row
            for row in rows
            if row["City"].strip().casefold() == expected_city
            and row["State"].strip().casefold() == expected_state
        ]

    return rows if limit is None else rows[:limit]


def retry_seconds_from_error(error: Exception) -> int:
    match = re.search(r"Retry in (\d+) seconds", str(error))
    return int(match.group(1)) if match else 5


def fetch_with_retry(
    fetcher: Callable[[], object],
    *,
    sleeper: Callable[[float], None] = time.sleep,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    resource_exhausted_type: type[Exception] | None = None,
) -> object:
    if resource_exhausted_type is None:
        from google.api_core.exceptions import ResourceExhausted

        resource_exhausted_type = ResourceExhausted

    for attempt in range(1, max_attempts + 1):
        try:
            return fetcher()
        except resource_exhausted_type as error:
            if attempt == max_attempts:
                raise
            delay_seconds = retry_seconds_from_error(error)
            print(
                f"Quota hit; retrying in {delay_seconds} seconds "
                f"(attempt {attempt + 1}/{max_attempts})",
                file=sys.stderr,
                flush=True,
            )
            sleeper(delay_seconds)

    raise RuntimeError("retry loop exited unexpectedly")


def request_for(client, customer_id: str, city: dict[str, str], google_ads_service):
    request = client.get_type("GenerateKeywordHistoricalMetricsRequest")
    request.customer_id = customer_id
    request.keywords.extend(build_keywords(city))
    request.language = ENGLISH_LANGUAGE_CONSTANT
    request.geo_target_constants.append(
        google_ads_service.geo_target_constant_path(city["GAds Code"])
    )
    request.keyword_plan_network = client.enums.KeywordPlanNetworkEnum.GOOGLE_SEARCH
    return request


def collect_raw_metrics(
    client,
    customer_id: str,
    city_rows: list[dict[str, str]],
    request_delay_seconds: float = DEFAULT_REQUEST_DELAY_SECONDS,
    *,
    sleeper: Callable[[float], None] = time.sleep,
    fetch_with_retry_fn: Callable[[Callable[[], object]], object] = fetch_with_retry,
) -> list[dict[str, str | int | None]]:
    service = client.get_service("KeywordPlanIdeaService")
    google_ads_service = client.get_service("GoogleAdsService")
    rows = []

    for index, city in enumerate(city_rows, start=1):
        print(
            f"Fetching {index}/{len(city_rows)}: {city['City']}, {city['State']}",
            file=sys.stderr,
            flush=True,
        )
        response = fetch_with_retry_fn(
            lambda: service.generate_keyword_historical_metrics(
                request=request_for(client, customer_id, city, google_ads_service)
            )
        )
        for result in response.results:
            metrics = result.keyword_metrics
            rows.append(
                raw_metric_row(
                    city,
                    result.text,
                    metrics.avg_monthly_searches,
                    metrics.low_top_of_page_bid_micros,
                    metrics.high_top_of_page_bid_micros,
                )
            )
        if request_delay_seconds and index < len(city_rows):
            sleeper(request_delay_seconds)

    return rows


def load_default_customer_id(config_path: Path) -> str:
    import yaml

    config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    customer_id = str(config.get("login_customer_id", "")).replace("-", "").strip()
    if not customer_id:
        raise ValueError(f"No login_customer_id found in {config_path}")
    return customer_id


def load_google_ads_client(config_path: Path):
    from google.ads.googleads.client import GoogleAdsClient

    return GoogleAdsClient.load_from_storage(str(config_path))


def write_raw_metrics_csv(
    output_path: Path, rows: list[dict[str, str | int | None]]
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=OUTPUT_FIELDNAMES, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def parse_args(arguments: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Collect raw Google Ads historical metrics for the 144 DUI keyword variants."
    )
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT_PATH)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--city", default=None)
    parser.add_argument("--state", default=None)
    args = parser.parse_args(arguments)
    if (args.city is None) != (args.state is None):
        parser.error("--city and --state must be supplied together")
    return args


def main() -> None:
    args = parse_args()
    city_rows = read_city_rows(args.input, args.city, args.state, args.limit)
    customer_id = load_default_customer_id(args.config)
    client = load_google_ads_client(args.config)
    rows = collect_raw_metrics(client, customer_id, city_rows)
    write_raw_metrics_csv(args.output, rows)
    print(f"Wrote {len(rows)} rows to {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
