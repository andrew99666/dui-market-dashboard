import csv
from pathlib import Path
from types import SimpleNamespace

import grpc
import pytest

import scripts.fetch_google_ads_keyword_metrics as collector
from scripts.fetch_google_ads_keyword_metrics import (
    DUI_EXPANDED_KEYWORD_TEMPLATES,
    build_keywords,
    collect_raw_metrics,
    fetch_with_retry,
    parse_args,
    raw_metric_row,
    read_city_rows,
)


def test_raw_metric_row_preserves_exact_google_values():
    row = raw_metric_row(
        city={"City": "Phoenix", "State": "Arizona", "ST": "AZ", "GAds Code": "1014048"},
        keyword_text="dui attorney near me",
        avg_monthly_searches=5000,
        low_bid_micros=10000000,
        high_bid_micros=30000000,
    )

    assert row == {
        "City": "Phoenix",
        "State": "Arizona",
        "State Code": "AZ",
        "Google Ads Code": "1014048",
        "Keyword": "dui attorney near me",
        "Average Monthly Searches": 5000,
        "Low Top Of Page Bid Micros": 10000000,
        "High Top Of Page Bid Micros": 30000000,
    }


def test_expanded_keywords_use_all_144_templates():
    keywords = build_keywords({"City": "Phoenix", "State": "Arizona", "ST": "AZ"})

    assert len(DUI_EXPANDED_KEYWORD_TEMPLATES) == 144
    assert len(keywords) == 144
    assert keywords[:4] == [
        "dui attorney near me",
        "dui attorney Phoenix",
        "dui attorney Phoenix AZ",
        "dui attorney Phoenix Arizona",
    ]


def test_city_state_filter_is_case_insensitive_and_precedes_limit(tmp_path: Path):
    input_path = tmp_path / "cities.csv"
    with input_path.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=["City", "ST", "State", "GAds Code"])
        writer.writeheader()
        writer.writerows(
            [
                {"City": "Mesa", "ST": "AZ", "State": "Arizona", "GAds Code": "1"},
                {"City": "Phoenix", "ST": "AZ", "State": "Arizona", "GAds Code": "2"},
                {"City": "Phoenix", "ST": "IL", "State": "Illinois", "GAds Code": "3"},
            ]
        )

    assert read_city_rows(input_path, city="phoenix", state="ARIZONA", limit=1) == [
        {"City": "Phoenix", "ST": "AZ", "State": "Arizona", "GAds Code": "2"}
    ]


@pytest.mark.parametrize("arguments", [["--city", "Phoenix"], ["--state", "Arizona"]])
def test_parse_args_requires_city_and_state_together(arguments: list[str]):
    with pytest.raises(SystemExit):
        parse_args(arguments)


def test_customer_id_argument_is_normalized_and_overrides_yaml_login_customer_id(
    tmp_path: Path,
):
    config_path = tmp_path / "google-ads.yaml"
    config_path.write_text("login_customer_id: '111-222-3333'\n", encoding="utf-8")

    args = parse_args(
        ["--config", str(config_path), "--customer-id", "999-888-7777"]
    )

    assert collector.resolve_customer_id(args.customer_id, args.config) == "9998887777"


def test_collector_preserves_returned_metrics_and_uses_google_search_sequentially():
    class Request:
        def __init__(self):
            self.keywords = []
            self.geo_target_constants = []

    class KeywordPlanIdeaService:
        def __init__(self):
            self.requests = []

        def generate_keyword_historical_metrics(self, request):
            self.requests.append(request)
            return SimpleNamespace(
                results=[
                    SimpleNamespace(
                        text="DUI Attorney Near Me",
                        keyword_metrics=SimpleNamespace(
                            avg_monthly_searches=5000,
                            low_top_of_page_bid_micros=10000000,
                            high_top_of_page_bid_micros=30000000,
                        ),
                    )
                ]
            )

    class GoogleAdsService:
        @staticmethod
        def geo_target_constant_path(code):
            return f"geoTargetConstants/{code}"

    keyword_service = KeywordPlanIdeaService()
    client = SimpleNamespace(
        enums=SimpleNamespace(
            KeywordPlanNetworkEnum=SimpleNamespace(GOOGLE_SEARCH="GOOGLE_SEARCH")
        ),
        get_service=lambda name: {
            "KeywordPlanIdeaService": keyword_service,
            "GoogleAdsService": GoogleAdsService(),
        }[name],
        get_type=lambda name: Request(),
    )
    delays = []

    rows = collect_raw_metrics(
        client,
        "1234567890",
        [
            {"City": "Phoenix", "State": "Arizona", "ST": "AZ", "GAds Code": "1014048"},
            {"City": "Mesa", "State": "Arizona", "ST": "AZ", "GAds Code": "1013413"},
        ],
        request_delay_seconds=1.1,
        sleeper=delays.append,
        fetch_with_retry_fn=lambda fetcher: fetcher(),
    )

    assert rows[0]["Keyword"] == "DUI Attorney Near Me"
    assert rows[0]["Average Monthly Searches"] == 5000
    assert rows[0]["Low Top Of Page Bid Micros"] == 10000000
    assert rows[0]["High Top Of Page Bid Micros"] == 30000000
    assert len(keyword_service.requests) == 2
    assert keyword_service.requests[0].language == "languageConstants/1000"
    assert keyword_service.requests[0].keyword_plan_network == "GOOGLE_SEARCH"
    assert keyword_service.requests[0].geo_target_constants == ["geoTargetConstants/1014048"]
    assert len(keyword_service.requests[0].keywords) == 144
    assert delays == [1.1]


def test_retry_waits_after_resource_exhausted_without_google_client_import():
    class ResourceExhausted(Exception):
        pass

    attempts = 0
    waits = []

    def fetcher():
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise ResourceExhausted("Retry in 7 seconds")
        return "metrics"

    assert fetch_with_retry(
        fetcher,
        sleeper=waits.append,
        resource_exhausted_type=ResourceExhausted,
    ) == "metrics"
    assert attempts == 2
    assert waits == [7]


def test_retry_waits_after_grpc_resource_exhausted():
    class ResourceExhausted(Exception):
        pass

    class QuotaRpcError(grpc.RpcError):
        def code(self):
            return grpc.StatusCode.RESOURCE_EXHAUSTED

    attempts = 0
    waits = []

    def fetcher():
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise QuotaRpcError("Retry in 11 seconds")
        return "metrics"

    assert fetch_with_retry(
        fetcher,
        sleeper=waits.append,
        resource_exhausted_type=ResourceExhausted,
    ) == "metrics"
    assert attempts == 2
    assert waits == [11]
