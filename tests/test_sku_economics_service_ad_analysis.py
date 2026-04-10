from __future__ import annotations

from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.schemas.sku_economics import AdAnalysisMetricsOut
from app.schemas.sku_economics import AdAnalysisOverviewOut
from app.services.sku_economics_service import SkuEconomicsService, _AdvertMetrics, _FinanceMetrics, _FunnelMetrics


class _FakeResponse:
    def __init__(self, status_code: int, payload=None, text: str = "") -> None:
        self.status_code = int(status_code)
        self._payload = payload
        self.text = text

    def json(self):
        return self._payload


@pytest.mark.asyncio
async def test_fetch_finance_rows_paginated_uses_rrdid_pagination(monkeypatch):
    service = SkuEconomicsService()
    responses = [
        _FakeResponse(200, [{"rrd_id": 1}, {"rrd_id": 2}]),
        _FakeResponse(200, [{"rrd_id": 3}]),
        _FakeResponse(204, None),
    ]
    seen_rrdids: list[int] = []

    async def _fake_request_page_with_retry(**kwargs):
        seen_rrdids.append(int(kwargs["rrdid"]))
        return responses.pop(0), 0.0

    monkeypatch.setattr(service, "_request_finance_page_with_retry", _fake_request_page_with_retry)

    rows = await service._fetch_finance_rows_paginated(
        client=SimpleNamespace(),
        url="https://wb.example.test/report",
        token="token",
        date_from=date(2026, 4, 1),
        date_to=date(2026, 4, 9),
    )

    assert len(rows) == 3
    assert seen_rrdids == [0, 2, 3]


@pytest.mark.asyncio
async def test_fetch_finance_rows_paginated_stops_on_non_increasing_rrdid(monkeypatch):
    service = SkuEconomicsService()
    responses = [
        _FakeResponse(200, [{"rrd_id": 1}]),
        _FakeResponse(200, [{"rrd_id": 1}]),
    ]
    calls = 0

    async def _fake_request_page_with_retry(**kwargs):
        nonlocal calls
        calls += 1
        return responses.pop(0), 0.0

    monkeypatch.setattr(service, "_request_finance_page_with_retry", _fake_request_page_with_retry)

    rows = await service._fetch_finance_rows_paginated(
        client=SimpleNamespace(),
        url="https://wb.example.test/report",
        token="token",
        date_from=date(2026, 4, 1),
        date_to=date(2026, 4, 9),
    )

    assert calls == 2
    assert len(rows) == 2


def test_orders_for_decision_respects_lineage_precedence():
    service = SkuEconomicsService()
    metrics = AdAnalysisMetricsOut(
        finance_realized_orders=6,
        funnel_orders=10,
        advert_attributed_orders=4,
        order_count=10,
        ad_orders=4,
    )

    assert service._orders_for_decision(metrics=metrics, orders_lineage="finance") == 6
    assert service._orders_for_decision(metrics=metrics, orders_lineage="manual_finance") == 6
    assert service._orders_for_decision(metrics=metrics, orders_lineage="funnel") == 10
    assert service._orders_for_decision(metrics=metrics, orders_lineage="advert") == 4
    assert service._orders_for_decision(metrics=metrics, orders_lineage=None) == 6


def test_resolve_decision_ready_downgrades_for_medium_and_low_confidence():
    service = SkuEconomicsService()

    assert service._resolve_decision_ready(
        missing_cost=False,
        finance_ready=True,
        ad_cost_confidence="medium",
        source_statuses=None,
    ) == (False, "preliminary")

    assert service._resolve_decision_ready(
        missing_cost=False,
        finance_ready=True,
        ad_cost_confidence="low",
        source_statuses=None,
    ) == (False, "preliminary")


@pytest.mark.asyncio
async def test_build_overview_from_history_includes_finance_only_items_and_uses_per_sku_finance_preference(monkeypatch):
    service = SkuEconomicsService()

    async def _fake_load_costs(*args, **kwargs):
        return {1001: 10.0, 1002: 12.0}

    async def _fake_load_manual_spend_overlap(*args, **kwargs):
        return {}

    async def _fake_load_manual_finance_overlap(*args, **kwargs):
        return {}

    async def _fake_get_source_coverage(*args, **kwargs):
        return {
            "start": date(2026, 4, 1),
            "end": date(2026, 4, 7),
            "records": 7,
            "synced_at": None,
            "period_days": 7,
            "covered_days": 7,
            "coverage_ratio": 1.0,
        }

    async def _fake_load_cards_and_issues(*args, **kwargs):
        return {}, {}

    async def _fake_load_persisted_overview(*args, **kwargs):
        return None

    monkeypatch.setattr(service, "_load_costs", _fake_load_costs)
    monkeypatch.setattr(service, "_load_manual_spend_overlap", _fake_load_manual_spend_overlap)
    monkeypatch.setattr(service, "_load_manual_finance_overlap", _fake_load_manual_finance_overlap)
    monkeypatch.setattr(service, "_get_source_coverage", _fake_get_source_coverage)
    monkeypatch.setattr(service, "_load_cards_and_issues", _fake_load_cards_and_issues)
    monkeypatch.setattr(service, "_load_persisted_overview", _fake_load_persisted_overview)
    monkeypatch.setattr(service, "_build_alerts", lambda **kwargs: [])
    monkeypatch.setattr(service, "_build_budget_moves", lambda items: [])
    monkeypatch.setattr(service, "_apply_trends", lambda overview, previous: None)

    current_data = {
        "per_nm": {
            1001: {
                "title": "Advert-only sku",
                "vendor_code": "ADV-1",
                "advert": _AdvertMetrics(views=100, clicks=10, orders=2, gmv=200.0, exact_spend=20.0),
                "finance": _FinanceMetrics(),
                "funnel": _FunnelMetrics(),
                "has_advert": True,
                "has_finance": False,
                "has_funnel": False,
            },
            1002: {
                "title": "Finance-only sku",
                "vendor_code": "FIN-1",
                "advert": _AdvertMetrics(),
                "finance": _FinanceMetrics(revenue=150.0, payout=120.0, wb_costs=15.0, orders=3),
                "funnel": _FunnelMetrics(),
                "has_advert": False,
                "has_finance": True,
                "has_funnel": False,
            },
        },
        "advert_nm_ids": [1001],
        "exact_spend": 20.0,
        "estimated_spend": 0.0,
        "unallocated_spend": 0.0,
        "advert_records": 1,
        "finance_records": 1,
        "funnel_records": 0,
        "generated_at": None,
    }
    previous_data = {
        "per_nm": {},
        "advert_nm_ids": [],
        "exact_spend": 0.0,
        "estimated_spend": 0.0,
        "unallocated_spend": 0.0,
        "advert_records": 0,
        "finance_records": 0,
        "funnel_records": 0,
        "generated_at": None,
    }

    overview = await service._build_overview_from_history(
        db=SimpleNamespace(),
        store=SimpleNamespace(id=7),
        period_start=date(2026, 4, 1),
        period_end=date(2026, 4, 7),
        previous_period_start=date(2026, 3, 25),
        previous_period_end=date(2026, 3, 31),
        current_data=current_data,
        previous_data=previous_data,
        selected_preset="7d",
        page=1,
        page_size=25,
        status_filter=None,
        search=None,
        available_period_start=date(2026, 4, 1),
        available_period_end=date(2026, 4, 7),
    )

    items_by_nm = {item.nm_id: item for item in overview.items}
    assert set(items_by_nm) == {1001, 1002}
    assert items_by_nm[1001].orders_lineage == "advert"
    assert items_by_nm[1001].revenue_lineage == "advert"
    assert service._orders_for_decision(metrics=items_by_nm[1001].metrics, orders_lineage=items_by_nm[1001].orders_lineage) == 2
    assert items_by_nm[1001].metrics.revenue == 200.0
    assert items_by_nm[1002].orders_lineage == "finance"
    assert items_by_nm[1002].revenue_lineage == "finance"
    assert service._orders_for_decision(metrics=items_by_nm[1002].metrics, orders_lineage=items_by_nm[1002].orders_lineage) == 3
    assert items_by_nm[1002].metrics.revenue == 150.0


@pytest.mark.asyncio
async def test_build_overview_skips_persisted_snapshot_for_non_default_page_size(monkeypatch):
    service = SkuEconomicsService()
    persisted = AdAnalysisOverviewOut(
        store_id=7,
        generated_at=datetime(2026, 4, 9, 12, 0, 0),
        snapshot_ready=True,
        period_start=date(2026, 4, 1),
        period_end=date(2026, 4, 7),
        upload_needs={
            "period_start": date(2026, 4, 1),
            "period_end": date(2026, 4, 7),
        },
        page=1,
        page_size=service.DEFAULT_PAGE_SIZE,
        items=[],
    )

    async def _fake_get_available_period(*args, **kwargs):
        return date(2026, 4, 1), date(2026, 4, 7)

    def _fake_resolve_requested_period(**kwargs):
        return date(2026, 4, 1), date(2026, 4, 7), "7d"

    async def _fake_load_persisted_overview(*args, **kwargs):
        return persisted

    async def _fake_load_history_aggregate(*args, **kwargs):
        return {
            "per_nm": {},
            "advert_nm_ids": [],
            "exact_spend": 0.0,
            "estimated_spend": 0.0,
            "unallocated_spend": 0.0,
            "advert_records": 0,
            "finance_records": 0,
            "funnel_records": 0,
            "generated_at": None,
        }

    async def _fake_build_overview_from_history(*args, **kwargs):
        return AdAnalysisOverviewOut(
            store_id=7,
            generated_at=datetime(2026, 4, 9, 12, 0, 0),
            snapshot_ready=True,
            period_start=date(2026, 4, 1),
            period_end=date(2026, 4, 7),
            upload_needs={
                "period_start": date(2026, 4, 1),
                "period_end": date(2026, 4, 7),
            },
            page=1,
            page_size=50,
            items=[],
        )

    async def _fake_persist_overview(*args, **kwargs):
        return None

    monkeypatch.setattr(service, "_get_available_period", _fake_get_available_period)
    monkeypatch.setattr(service, "_resolve_requested_period", _fake_resolve_requested_period)
    monkeypatch.setattr(service, "_load_persisted_overview", _fake_load_persisted_overview)
    monkeypatch.setattr(service, "_load_history_aggregate", _fake_load_history_aggregate)
    monkeypatch.setattr(service, "_build_overview_from_history", _fake_build_overview_from_history)
    monkeypatch.setattr(service, "_persist_overview", _fake_persist_overview)

    result = await service.build_overview(
        db=SimpleNamespace(),
        store=SimpleNamespace(id=7),
        days=7,
        page=1,
        page_size=50,
        force=False,
    )

    assert result is not persisted
    assert result.page_size == 50
