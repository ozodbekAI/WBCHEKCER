from __future__ import annotations

import argparse
import asyncio
import csv
import json
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable, Sequence

import httpx
from sqlalchemy import select
from sqlalchemy.orm import selectinload

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models import (
    Card,
    SkuEconomicsCost,
    SkuEconomicsDailyMetric,
    SkuEconomicsManualFinance,
    SkuEconomicsManualSpend,
    Store,
)
from app.schemas.sku_economics import AdAnalysisOverviewOut
from app.services.sku_economics_service import (
    _FinanceMetrics,
    _chunks,
    _safe_positive,
    _to_float,
    _to_int,
    sku_economics_service,
)
from app.services.wb_advert_repository import WBAdvertRepository


REPORTS_DIR = PROJECT_ROOT / "reports"


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    return date.fromisoformat(str(value).strip())


def _default_period(days: int) -> tuple[date, date]:
    safe_days = max(int(days or 14), 1)
    period_end = date.today()
    period_start = period_end - timedelta(days=safe_days - 1)
    return period_start, period_end


def _round2(value: Any) -> float:
    return round(float(value or 0.0), 2)


def _join_text(parts: Iterable[Any]) -> str:
    out: list[str] = []
    for part in parts:
        text = str(part or "").strip()
        if text:
            out.append(text)
    return " | ".join(out)


def _json_cell(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    except TypeError:
        return json.dumps(str(value), ensure_ascii=False)


def _csv_cell(value: Any) -> str | int | float:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, (list, tuple, set)):
        return _join_text(value)
    if isinstance(value, dict):
        return _json_cell(value)
    return str(value)


def _write_csv(path: Path, rows: Sequence[dict[str, Any]], fieldnames: Sequence[str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    normalized_rows = [{key: _csv_cell(value) for key, value in row.items()} for row in rows]
    ordered_fields: list[str] = []

    if fieldnames is not None:
        ordered_fields = list(fieldnames)
    else:
        seen: set[str] = set()
        for row in normalized_rows:
            for key in row.keys():
                if key in seen:
                    continue
                seen.add(key)
                ordered_fields.append(key)

    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        if not ordered_fields:
            handle.write("")
            return
        writer = csv.DictWriter(handle, fieldnames=ordered_fields, extrasaction="ignore")
        writer.writeheader()
        for row in normalized_rows:
            writer.writerow({field: row.get(field, "") for field in ordered_fields})


def _overview_item_rows(overview: AdAnalysisOverviewOut) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in overview.items:
        rows.append(
            {
                "nm_id": int(item.nm_id),
                "card_id": item.card_id,
                "title": item.title or "",
                "vendor_code": item.vendor_code or "",
                "status": item.status,
                "status_label": item.status_label,
                "diagnosis": item.diagnosis,
                "diagnosis_label": item.diagnosis_label,
                "priority": item.priority,
                "priority_label": item.priority_label,
                "precision": item.precision,
                "precision_label": item.precision_label,
                "trend_signal": item.trend.signal,
                "trend_label": item.trend.label,
                "revenue": _round2(item.metrics.revenue),
                "wb_costs": _round2(item.metrics.wb_costs),
                "cost_price": _round2(item.metrics.cost_price),
                "gross_profit_before_ads": _round2(item.metrics.gross_profit_before_ads),
                "ad_cost": _round2(item.metrics.ad_cost),
                "net_profit": _round2(item.metrics.net_profit),
                "profit_per_order": _round2(item.metrics.profit_per_order),
                "max_cpo": _round2(item.metrics.max_cpo),
                "actual_cpo": _round2(item.metrics.actual_cpo),
                "profit_delta": _round2(item.metrics.profit_delta),
                "views": int(item.metrics.views or 0),
                "clicks": int(item.metrics.clicks or 0),
                "ad_orders": int(item.metrics.ad_orders or 0),
                "ad_gmv": _round2(item.metrics.ad_gmv),
                "ctr": _round2(item.metrics.ctr),
                "cr": _round2(item.metrics.cr),
                "open_count": int(item.metrics.open_count or 0),
                "cart_count": int(item.metrics.cart_count or 0),
                "order_count": int(item.metrics.order_count or 0),
                "buyout_count": int(item.metrics.buyout_count or 0),
                "add_to_cart_percent": _round2(item.metrics.add_to_cart_percent),
                "cart_to_order_percent": _round2(item.metrics.cart_to_order_percent),
                "cpc": _round2(item.metrics.cpc),
                "drr": _round2(item.metrics.drr),
                "spend_exact": _round2(item.spend_sources.get("exact")),
                "spend_estimated": _round2(item.spend_sources.get("estimated")),
                "spend_manual": _round2(item.spend_sources.get("manual")),
                "status_reason": item.status_reason,
                "status_hint": item.status_hint,
                "action_title": item.action_title,
                "action_description": item.action_description,
                "insights": _join_text(item.insights),
                "steps": _join_text(item.steps),
                "risk_flags": _join_text(item.risk_flags),
                "issue_total": int(item.issue_summary.total or 0),
                "issue_critical": int(item.issue_summary.critical or 0),
                "issue_warnings": int(item.issue_summary.warnings or 0),
                "issue_photos": int(item.issue_summary.photos or 0),
                "issue_price": int(item.issue_summary.price or 0),
                "issue_text": int(item.issue_summary.text or 0),
                "issue_docs": int(item.issue_summary.docs or 0),
                "issue_top_titles": _join_text(item.issue_summary.top_titles),
            }
        )
    return rows


def _source_status_rows(overview: AdAnalysisOverviewOut) -> list[dict[str, Any]]:
    return [
        {
            "id": status.id,
            "label": status.label,
            "mode": status.mode,
            "detail": status.detail or "",
            "records": int(status.records or 0),
            "automatic": bool(status.automatic),
        }
        for status in overview.source_statuses
    ]


def _alert_rows(overview: AdAnalysisOverviewOut) -> list[dict[str, Any]]:
    return [
        {
            "level": alert.level,
            "title": alert.title,
            "description": alert.description,
            "action": alert.action or "",
        }
        for alert in overview.alerts
    ]


def _budget_move_rows(overview: AdAnalysisOverviewOut) -> list[dict[str, Any]]:
    return [
        {
            "from_nm_id": move.from_nm_id,
            "from_title": move.from_title,
            "from_amount": _round2(move.from_amount),
            "to_nm_id": move.to_nm_id,
            "to_title": move.to_title,
            "uplift_percent": move.uplift_percent,
        }
        for move in overview.budget_moves
    ]


def _campaign_summary_rows(campaigns: Sequence[Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for campaign in campaigns:
        rows.append(
            {
                "advert_id": campaign.advert_id,
                "title": campaign.title,
                "ad_cost": _round2(campaign.ad_cost),
                "ad_gmv": _round2(campaign.ad_gmv),
                "drr": _round2(campaign.drr),
                "linked_skus": int(campaign.linked_skus or 0),
                "precision": campaign.precision,
                "precision_label": campaign.precision_label,
            }
        )
    return rows


async def _load_store(store_id: int) -> Store:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Store)
            .where(Store.id == int(store_id))
            .options(selectinload(Store.feature_api_keys))
        )
        store = result.scalar_one_or_none()
        if store is None:
            raise SystemExit(f"Store {store_id} not found")
        return store


async def _load_full_overview(
    store: Store,
    *,
    period_start: date,
    period_end: date,
    force: bool,
) -> AdAnalysisOverviewOut:
    async with AsyncSessionLocal() as db:
        first_page = await sku_economics_service.build_overview(
            db,
            store,
            period_start=period_start,
            period_end=period_end,
            preset="custom",
            page=1,
            page_size=100,
            force=force,
        )

        if first_page.total_pages <= 1:
            return first_page

        all_items = list(first_page.items)
        for page in range(2, first_page.total_pages + 1):
            chunk = await sku_economics_service.build_overview(
                db,
                store,
                period_start=period_start,
                period_end=period_end,
                preset="custom",
                page=page,
                page_size=100,
                force=False,
            )
            all_items.extend(chunk.items)

        first_page.items = all_items
        first_page.total_items = len(all_items)
        return first_page


async def _load_cards(store_id: int) -> tuple[list[dict[str, Any]], list[int]]:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Card).where(Card.store_id == int(store_id)).order_by(Card.nm_id.asc(), Card.id.asc())
        )
        cards = result.scalars().all()
        rows: list[dict[str, Any]] = []
        nm_ids: list[int] = []
        for card in cards:
            nm_id = int(card.nm_id or 0)
            if nm_id > 0:
                nm_ids.append(nm_id)
            rows.append(
                {
                    "card_id": int(card.id),
                    "nm_id": nm_id,
                    "title": card.title or "",
                    "vendor_code": card.vendor_code or "",
                    "price": _round2(getattr(card, "price", 0.0)),
                    "score": getattr(card, "score", None),
                    "created_at": getattr(card, "created_at", None),
                    "updated_at": getattr(card, "updated_at", None),
                }
            )
        return rows, sorted({nm_id for nm_id in nm_ids if nm_id > 0})


async def _load_manual_layers(
    store_id: int,
    *,
    period_start: date,
    period_end: date,
) -> dict[str, list[dict[str, Any]]]:
    async with AsyncSessionLocal() as db:
        cost_rows = (
            await db.execute(
                select(SkuEconomicsCost)
                .where(SkuEconomicsCost.store_id == int(store_id))
                .order_by(SkuEconomicsCost.nm_id.asc())
            )
        ).scalars().all()
        manual_spend_rows = (
            await db.execute(
                select(SkuEconomicsManualSpend)
                .where(
                    SkuEconomicsManualSpend.store_id == int(store_id),
                    SkuEconomicsManualSpend.period_start <= period_end,
                    SkuEconomicsManualSpend.period_end >= period_start,
                )
                .order_by(
                    SkuEconomicsManualSpend.period_start.asc(),
                    SkuEconomicsManualSpend.period_end.asc(),
                    SkuEconomicsManualSpend.nm_id.asc(),
                )
            )
        ).scalars().all()
        manual_finance_rows = (
            await db.execute(
                select(SkuEconomicsManualFinance)
                .where(
                    SkuEconomicsManualFinance.store_id == int(store_id),
                    SkuEconomicsManualFinance.period_start <= period_end,
                    SkuEconomicsManualFinance.period_end >= period_start,
                )
                .order_by(
                    SkuEconomicsManualFinance.period_start.asc(),
                    SkuEconomicsManualFinance.period_end.asc(),
                    SkuEconomicsManualFinance.nm_id.asc(),
                )
            )
        ).scalars().all()

        effective_spend = await sku_economics_service._load_manual_spend_overlap(
            db,
            int(store_id),
            period_start,
            period_end,
        )
        effective_finance = await sku_economics_service._load_manual_finance_overlap(
            db,
            int(store_id),
            period_start,
            period_end,
        )

    return {
        "manual_costs": [
            {
                "id": int(row.id),
                "store_id": int(row.store_id),
                "nm_id": int(row.nm_id),
                "title": row.title or "",
                "vendor_code": row.vendor_code or "",
                "unit_cost": _round2(row.unit_cost),
                "created_at": row.created_at,
                "updated_at": row.updated_at,
            }
            for row in cost_rows
        ],
        "manual_spend_rows": [
            {
                "id": int(row.id),
                "store_id": int(row.store_id),
                "nm_id": int(row.nm_id),
                "period_start": row.period_start,
                "period_end": row.period_end,
                "title": row.title or "",
                "spend": _round2(row.spend),
                "views": int(row.views or 0),
                "clicks": int(row.clicks or 0),
                "orders": int(row.orders or 0),
                "gmv": _round2(row.gmv),
                "source_file_name": row.source_file_name or "",
                "created_at": row.created_at,
                "updated_at": row.updated_at,
            }
            for row in manual_spend_rows
        ],
        "manual_finance_rows": [
            {
                "id": int(row.id),
                "store_id": int(row.store_id),
                "nm_id": int(row.nm_id),
                "period_start": row.period_start,
                "period_end": row.period_end,
                "title": row.title or "",
                "revenue": _round2(row.revenue),
                "wb_costs": _round2(row.wb_costs),
                "payout": _round2(row.payout),
                "orders": int(row.orders or 0),
                "source_file_name": row.source_file_name or "",
                "created_at": row.created_at,
                "updated_at": row.updated_at,
            }
            for row in manual_finance_rows
        ],
        "manual_spend_effective": [
            {
                "nm_id": int(nm_id),
                "manual_spend": _round2(metric.manual_spend),
                "manual_views": int(metric.manual_views or 0),
                "manual_clicks": int(metric.manual_clicks or 0),
                "manual_orders": int(metric.manual_orders or 0),
                "manual_gmv": _round2(metric.manual_gmv),
            }
            for nm_id, metric in sorted(effective_spend.items())
        ],
        "manual_finance_effective": [
            {
                "nm_id": int(nm_id),
                "revenue": _round2(metric.revenue),
                "wb_costs": _round2(metric.wb_costs),
                "payout": _round2(metric.payout),
                "orders": int(metric.orders or 0),
            }
            for nm_id, metric in sorted(effective_finance.items())
        ],
    }


async def _load_backend_daily_history(
    store_id: int,
    *,
    period_start: date,
    period_end: date,
) -> list[dict[str, Any]]:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(SkuEconomicsDailyMetric)
            .where(
                SkuEconomicsDailyMetric.store_id == int(store_id),
                SkuEconomicsDailyMetric.metric_date >= period_start,
                SkuEconomicsDailyMetric.metric_date <= period_end,
            )
            .order_by(SkuEconomicsDailyMetric.metric_date.asc(), SkuEconomicsDailyMetric.nm_id.asc())
        )
        rows = result.scalars().all()

    out: list[dict[str, Any]] = []
    for row in rows:
        out.append(
            {
                "id": int(row.id),
                "store_id": int(row.store_id),
                "nm_id": int(row.nm_id or 0),
                "metric_date": row.metric_date,
                "title": row.title or "",
                "vendor_code": row.vendor_code or "",
                "advert_views": int(row.advert_views or 0),
                "advert_clicks": int(row.advert_clicks or 0),
                "advert_orders": int(row.advert_orders or 0),
                "advert_gmv": _round2(row.advert_gmv),
                "advert_exact_spend": _round2(row.advert_exact_spend),
                "advert_estimated_spend": _round2(row.advert_estimated_spend),
                "finance_revenue": _round2(row.finance_revenue),
                "finance_payout": _round2(row.finance_payout),
                "finance_wb_costs": _round2(row.finance_wb_costs),
                "finance_orders": int(row.finance_orders or 0),
                "funnel_open_count": int(row.funnel_open_count or 0),
                "funnel_cart_count": int(row.funnel_cart_count or 0),
                "funnel_order_count": int(row.funnel_order_count or 0),
                "funnel_order_sum": _round2(row.funnel_order_sum),
                "funnel_buyout_count": int(row.funnel_buyout_count or 0),
                "funnel_buyout_sum": _round2(row.funnel_buyout_sum),
                "has_advert": bool(row.has_advert),
                "has_finance": bool(row.has_finance),
                "has_funnel": bool(row.has_funnel),
                "synced_at": row.synced_at,
                "created_at": row.created_at,
                "updated_at": row.updated_at,
            }
        )
    return out


async def _fetch_advert_raw(
    store: Store,
    *,
    period_start: date,
    period_end: date,
) -> tuple[list[int], list[dict[str, Any]]]:
    tokens = sku_economics_service._candidate_tokens(store, prefer_advert=True)
    last_error = "No advert token available"
    for token in tokens:
        try:
            repo = WBAdvertRepository(token=token)
            campaign_ids = await repo.get_campaign_ids()
            if not campaign_ids:
                return [], []
            raw_items: list[dict[str, Any]] = []
            for batch in _chunks(campaign_ids, 50):
                batch_data = await asyncio.to_thread(
                    repo.get_fullstats,
                    batch,
                    begin_date=period_start.isoformat(),
                    end_date=period_end.isoformat(),
                )
                if isinstance(batch_data, list):
                    raw_items.extend(item for item in batch_data if isinstance(item, dict))
            return campaign_ids, raw_items
        except Exception as exc:
            last_error = str(exc)
    raise RuntimeError(f"WB advert export failed: {last_error}")


def _campaign_meta(item: dict[str, Any]) -> dict[str, Any]:
    advert_id = _to_int(item.get("advertId") or item.get("advert_id") or item.get("id"))
    title = (
        str(item.get("advertName") or item.get("advert_name") or item.get("name") or item.get("advertTitle") or "").strip()
        or (f"RK {advert_id}" if advert_id > 0 else "Campaign")
    )
    return {
        "advert_id": advert_id or None,
        "campaign_title": title,
        "campaign_sum": _round2(item.get("sum")),
    }


def _flatten_fullstats_items(items: Sequence[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    campaign_rows: list[dict[str, Any]] = []
    leaf_rows: list[dict[str, Any]] = []

    def walk(
        node: dict[str, Any],
        *,
        campaign_item: dict[str, Any],
        day_node: dict[str, Any] | None = None,
        app_node: dict[str, Any] | None = None,
    ) -> None:
        day_values = node.get("days")
        if isinstance(day_values, list) and day_values:
            for child in day_values:
                if isinstance(child, dict):
                    walk(child, campaign_item=campaign_item, day_node=child, app_node=None)
            return

        app_values = node.get("apps")
        if isinstance(app_values, list) and app_values:
            for child in app_values:
                if isinstance(child, dict):
                    walk(child, campaign_item=campaign_item, day_node=day_node, app_node=child)
            return

        nms = node.get("nms")
        if not isinstance(nms, list):
            return

        campaign_meta = _campaign_meta(campaign_item)
        day_date = sku_economics_service._parse_generic_date(
            (day_node or {}).get("date")
            or (day_node or {}).get("day")
            or (day_node or {}).get("dt")
            or (day_node or {}).get("begin")
            or (day_node or {}).get("beginDate")
            or node.get("date")
            or node.get("day")
        )
        app_name = str((app_node or {}).get("appType") or (app_node or {}).get("name") or "").strip()
        for nm_row in nms:
            if not isinstance(nm_row, dict):
                continue
            leaf_rows.append(
                {
                    **campaign_meta,
                    "day_date": day_date,
                    "app_name": app_name,
                    "nm_id": _to_int(nm_row.get("nmId") or nm_row.get("nm_id")),
                    "nm_title": str(nm_row.get("name") or "").strip(),
                    "views": _to_int(nm_row.get("views")),
                    "clicks": _to_int(nm_row.get("clicks")),
                    "orders": _to_int(nm_row.get("orders")),
                    "sum_price": _round2(nm_row.get("sum_price")),
                    "spend_sum": _round2(nm_row.get("sum")),
                    "raw_nm_json": _json_cell(nm_row),
                }
            )

    for item in items:
        campaign_rows.append(
            {
                **_campaign_meta(item),
                "days_count": len(item.get("days") or []) if isinstance(item.get("days"), list) else 0,
                "apps_count": len(item.get("apps") or []) if isinstance(item.get("apps"), list) else 0,
                "raw_campaign_json": _json_cell(item),
            }
        )
        walk(item, campaign_item=item)

    return campaign_rows, leaf_rows


def _parsed_advert_rows(parsed: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    per_nm = parsed.get("per_nm") or {}
    titles = parsed.get("titles") or {}
    for nm_id, metric in sorted(per_nm.items()):
        rows.append(
            {
                "nm_id": int(nm_id),
                "title": str(titles.get(int(nm_id)) or "").strip(),
                "exact_spend": _round2(metric.exact_spend),
                "estimated_spend": _round2(metric.estimated_spend),
                "manual_spend": _round2(metric.manual_spend),
                "total_spend": _round2(metric.total_spend),
                "views": int(metric.total_views or 0),
                "clicks": int(metric.total_clicks or 0),
                "orders": int(metric.total_orders or 0),
                "gmv": _round2(metric.total_gmv),
            }
        )
    return rows


async def _fetch_funnel_products_raw(
    store: Store,
    *,
    period_start: date,
    period_end: date,
    nm_ids: Sequence[int],
) -> list[dict[str, Any]]:
    if not nm_ids:
        return []

    tokens = sku_economics_service._candidate_tokens(store, prefer_advert=False)
    last_error = "No analytics token available"
    url = f"{settings.WB_ANALYTICS_API_URL}/api/analytics/v3/sales-funnel/products"
    for token in tokens:
        try:
            rows: list[dict[str, Any]] = []
            async with httpx.AsyncClient(timeout=httpx.Timeout(45.0)) as client:
                for batch in _chunks(list(nm_ids), 500):
                    payload = {
                        "selectedPeriod": {
                            "start": period_start.isoformat(),
                            "end": period_end.isoformat(),
                        },
                        "nmIds": batch,
                        "limit": len(batch),
                        "offset": 0,
                        "skipDeletedNm": False,
                        "orderBy": {"field": "openCard", "mode": "desc"},
                    }
                    resp = await sku_economics_service._request_with_retry(
                        client,
                        "POST",
                        url,
                        headers={
                            "Authorization": token,
                            "Content-Type": "application/json",
                            "Accept": "application/json",
                        },
                        json=payload,
                    )
                    if resp.status_code >= 400:
                        raise RuntimeError(f"WB funnel products error {resp.status_code}: {resp.text[:300]}")
                    data = resp.json() or {}
                    products = ((data.get("data") or {}).get("products") or [])
                    for row in products:
                        product = row.get("product") or {}
                        stats = ((row.get("statistic") or {}).get("selected") or {})
                        conversions = stats.get("conversions") or {}
                        rows.append(
                            {
                                "nm_id": _to_int(product.get("nmId")),
                                "title": str(product.get("title") or "").strip(),
                                "vendor_code": str(product.get("vendorCode") or "").strip(),
                                "open_count": _to_int(stats.get("openCount")),
                                "cart_count": _to_int(stats.get("cartCount")),
                                "order_count": _to_int(stats.get("orderCount")),
                                "order_sum": _round2(stats.get("orderSum")),
                                "buyout_count": _to_int(stats.get("buyoutCount")),
                                "buyout_sum": _round2(stats.get("buyoutSum")),
                                "add_to_cart_percent": _round2(conversions.get("addToCartPercent")),
                                "cart_to_order_percent": _round2(conversions.get("cartToOrderPercent")),
                                "raw_json": _json_cell(row),
                            }
                        )
            return rows
        except Exception as exc:
            last_error = str(exc)
    raise RuntimeError(f"WB funnel products export failed: {last_error}")


async def _fetch_funnel_history_raw(
    store: Store,
    *,
    period_start: date,
    period_end: date,
    nm_ids: Sequence[int],
) -> list[dict[str, Any]]:
    if not nm_ids:
        return []

    recent_floor = date.today() - timedelta(days=6)
    effective_start = max(period_start, recent_floor)
    effective_end = min(period_end, date.today())
    if effective_end < effective_start:
        return []

    tokens = sku_economics_service._candidate_tokens(store, prefer_advert=False)
    last_error = "No analytics token available"
    url = f"{settings.WB_ANALYTICS_API_URL}/api/analytics/v3/sales-funnel/products/history"
    for token in tokens:
        try:
            rows: list[dict[str, Any]] = []
            async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
                for batch in _chunks(list(nm_ids), 20):
                    payload = {
                        "selectedPeriod": {
                            "start": effective_start.isoformat(),
                            "end": effective_end.isoformat(),
                        },
                        "nmIds": batch,
                        "skipDeletedNm": False,
                        "aggregationLevel": "day",
                    }
                    resp = await sku_economics_service._request_with_retry(
                        client,
                        "POST",
                        url,
                        headers={
                            "Authorization": token,
                            "Content-Type": "application/json",
                            "Accept": "application/json",
                        },
                        json=payload,
                    )
                    if resp.status_code >= 400:
                        raise RuntimeError(f"WB funnel history error {resp.status_code}: {resp.text[:300]}")
                    data = resp.json() or []
                    if isinstance(data, dict):
                        data = data.get("data") or data.get("products") or []
                    if not isinstance(data, list):
                        data = []
                    for row in data:
                        product = row.get("product") or {}
                        nm_id = _to_int(product.get("nmId"))
                        if nm_id <= 0:
                            continue
                        title = str(product.get("title") or "").strip()
                        vendor_code = str(product.get("vendorCode") or "").strip()
                        for history_row in row.get("history") or []:
                            if not isinstance(history_row, dict):
                                continue
                            rows.append(
                                {
                                    "nm_id": nm_id,
                                    "title": title,
                                    "vendor_code": vendor_code,
                                    "metric_date": sku_economics_service._parse_generic_date(history_row.get("date")),
                                    "open_count": _to_int(history_row.get("openCount")),
                                    "cart_count": _to_int(history_row.get("cartCount")),
                                    "order_count": _to_int(history_row.get("orderCount")),
                                    "order_sum": _round2(history_row.get("orderSum")),
                                    "buyout_count": _to_int(history_row.get("buyoutCount")),
                                    "buyout_sum": _round2(history_row.get("buyoutSum")),
                                    "raw_json": _json_cell(history_row),
                                }
                            )
            return rows
        except Exception as exc:
            last_error = str(exc)
    raise RuntimeError(f"WB funnel history export failed: {last_error}")


async def _fetch_finance_raw_rows(
    store: Store,
    *,
    period_start: date,
    period_end: date,
) -> list[dict[str, Any]]:
    tokens = sku_economics_service._candidate_tokens(store, prefer_advert=False)
    last_error = "No statistics token available"
    url = f"{settings.WB_STATISTICS_API_URL}/api/v5/supplier/reportDetailByPeriod"
    for token in tokens:
        try:
            params = {
                "dateFrom": period_start.isoformat(),
                "dateTo": period_end.isoformat(),
                "limit": 100000,
                "rrdid": 0,
                "period": "daily",
            }
            async with httpx.AsyncClient(timeout=httpx.Timeout(90.0)) as client:
                resp = await sku_economics_service._request_with_retry(
                    client,
                    "GET",
                    url,
                    headers={"Authorization": token, "Accept": "application/json"},
                    params=params,
                )
            if resp.status_code == 204:
                return []
            if resp.status_code >= 400:
                raise RuntimeError(f"WB finance error {resp.status_code}: {resp.text[:300]}")
            data = resp.json() or []
            return [row for row in data if isinstance(row, dict)]
        except Exception as exc:
            last_error = str(exc)
    raise RuntimeError(f"WB finance export failed: {last_error}")


def _aggregate_finance_rows(rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    per_nm: dict[int, _FinanceMetrics] = defaultdict(_FinanceMetrics)
    for row in rows:
        nm_id = _to_int(row.get("nm_id"))
        if nm_id <= 0:
            continue
        quantity = _to_int(row.get("quantity"))
        doc_type = str(row.get("doc_type_name") or row.get("supplier_oper_name") or "").lower()
        negative = "возврат" in doc_type or "return" in doc_type or quantity < 0
        sign = -1.0 if negative else 1.0
        revenue = _to_float(row.get("retail_price_withdisc_rub") or row.get("retail_amount"))
        payout = _to_float(row.get("ppvz_for_pay"))
        extra = sum(
            _to_float(row.get(field))
            for field in (
                "delivery_rub",
                "acquiring_fee",
                "penalty",
                "storage_fee",
                "deduction",
                "acceptance",
                "rebill_logistic_cost",
                "additional_payment",
            )
        )
        metric = per_nm[nm_id]
        metric.revenue += revenue * sign if revenue >= 0 else revenue
        metric.payout += payout * sign if payout >= 0 else payout
        metric.wb_costs += _safe_positive(extra)
        metric.orders += max(quantity * int(sign), 0)

    out: list[dict[str, Any]] = []
    for nm_id, metric in sorted(per_nm.items()):
        wb_costs = round(max(metric.wb_costs, 0.0) + max(metric.revenue - metric.payout, 0.0), 2)
        revenue = round(max(metric.revenue, 0.0), 2)
        payout = round(metric.payout, 2)
        out.append(
            {
                "nm_id": int(nm_id),
                "revenue": revenue,
                "payout": payout,
                "wb_costs": wb_costs,
                "orders": max(int(metric.orders or 0), 0),
            }
        )
    return out


async def run_export(
    store_id: int,
    *,
    period_start: date,
    period_end: date,
    output_dir: Path,
    force_overview: bool,
) -> Path:
    print(f"Loading store {store_id}...", flush=True)
    store = await _load_store(store_id)

    print("Loading full overview...", flush=True)
    overview = await _load_full_overview(
        store,
        period_start=period_start,
        period_end=period_end,
        force=force_overview,
    )

    print("Loading cards and backend layers...", flush=True)
    card_rows, card_nm_ids = await _load_cards(store_id)
    manual_layers = await _load_manual_layers(
        store_id,
        period_start=period_start,
        period_end=period_end,
    )
    backend_daily_history = await _load_backend_daily_history(
        store_id,
        period_start=period_start,
        period_end=period_end,
    )

    print("Fetching advert raw data...", flush=True)
    campaign_ids, fullstats_raw_items = await _fetch_advert_raw(
        store,
        period_start=period_start,
        period_end=period_end,
    )
    advert_campaign_rows, advert_leaf_rows = _flatten_fullstats_items(fullstats_raw_items)
    advert_parsed = sku_economics_service._parse_fullstats(fullstats_raw_items)
    advert_parsed_rows = _parsed_advert_rows(advert_parsed)

    current_manual_spend = {
        int(row["nm_id"]): row for row in manual_layers["manual_spend_rows"]
        if row.get("period_start") == period_start and row.get("period_end") == period_end
    }
    current_manual_finance = {
        int(row["nm_id"]): row for row in manual_layers["manual_finance_rows"]
        if row.get("period_start") == period_start and row.get("period_end") == period_end
    }
    current_nm_ids = sorted(
        set(int(nm_id) for nm_id in advert_parsed.get("per_nm", {}).keys())
        | set(current_manual_spend.keys())
        | set(current_manual_finance.keys())
    )

    print("Fetching funnel raw data...", flush=True)
    funnel_products_raw = await _fetch_funnel_products_raw(
        store,
        period_start=period_start,
        period_end=period_end,
        nm_ids=current_nm_ids,
    )
    funnel_products_aggregated, _ = await sku_economics_service._fetch_funnel_metrics(
        store,
        period_start,
        period_end,
        current_nm_ids,
    )
    funnel_products_rows = [
        {
            "nm_id": int(nm_id),
            "open_count": int(metric.open_count or 0),
            "cart_count": int(metric.cart_count or 0),
            "order_count": int(metric.order_count or 0),
            "order_sum": _round2(metric.order_sum),
            "buyout_count": int(metric.buyout_count or 0),
            "buyout_sum": _round2(metric.buyout_sum),
            "add_to_cart_percent": _round2(metric.add_to_cart_percent),
            "cart_to_order_percent": _round2(metric.cart_to_order_percent),
        }
        for nm_id, metric in sorted(funnel_products_aggregated.items())
    ]

    print("Fetching funnel history raw data...", flush=True)
    funnel_history_raw = await _fetch_funnel_history_raw(
        store,
        period_start=period_start,
        period_end=period_end,
        nm_ids=card_nm_ids,
    )

    print("Fetching finance raw data...", flush=True)
    finance_raw_rows = await _fetch_finance_raw_rows(
        store,
        period_start=period_start,
        period_end=period_end,
    )
    finance_aggregated_rows = _aggregate_finance_rows(finance_raw_rows)

    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Writing CSV files to {output_dir}...", flush=True)
    _write_csv(
        output_dir / "manifest.csv",
        [
            {"key": "store_id", "value": int(store.id)},
            {"key": "store_name", "value": store.name},
            {"key": "period_start", "value": period_start.isoformat()},
            {"key": "period_end", "value": period_end.isoformat()},
            {"key": "force_overview", "value": force_overview},
            {"key": "generated_at", "value": datetime.utcnow().isoformat()},
            {"key": "overview_total_items", "value": int(overview.total_items or 0)},
            {"key": "overview_total_skus", "value": int(overview.total_skus or 0)},
            {"key": "campaign_ids_count", "value": len(campaign_ids)},
            {"key": "fullstats_raw_items_count", "value": len(fullstats_raw_items)},
            {"key": "advert_leaf_rows_count", "value": len(advert_leaf_rows)},
            {"key": "funnel_products_raw_count", "value": len(funnel_products_raw)},
            {"key": "funnel_history_raw_count", "value": len(funnel_history_raw)},
            {"key": "finance_raw_rows_count", "value": len(finance_raw_rows)},
            {"key": "backend_daily_history_count", "value": len(backend_daily_history)},
        ],
        fieldnames=["key", "value"],
    )
    _write_csv(output_dir / "campaign_ids.csv", [{"advert_id": advert_id} for advert_id in campaign_ids], fieldnames=["advert_id"])
    _write_csv(output_dir / "cards_lookup.csv", card_rows)
    _write_csv(output_dir / "overview_items.csv", _overview_item_rows(overview))
    _write_csv(output_dir / "overview_source_statuses.csv", _source_status_rows(overview))
    _write_csv(output_dir / "overview_alerts.csv", _alert_rows(overview))
    _write_csv(output_dir / "overview_budget_moves.csv", _budget_move_rows(overview))
    _write_csv(output_dir / "overview_campaigns.csv", _campaign_summary_rows(overview.campaigns))
    _write_csv(output_dir / "advert_campaigns_raw.csv", advert_campaign_rows)
    _write_csv(output_dir / "advert_leaf_rows_raw.csv", advert_leaf_rows)
    _write_csv(output_dir / "advert_per_nm_parsed.csv", advert_parsed_rows)
    _write_csv(output_dir / "funnel_products_raw.csv", funnel_products_raw)
    _write_csv(output_dir / "funnel_products_aggregated.csv", funnel_products_rows)
    _write_csv(output_dir / "funnel_history_raw.csv", funnel_history_raw)
    _write_csv(output_dir / "finance_raw.csv", finance_raw_rows)
    _write_csv(output_dir / "finance_aggregated.csv", finance_aggregated_rows)
    _write_csv(output_dir / "manual_costs.csv", manual_layers["manual_costs"])
    _write_csv(output_dir / "manual_spend_rows.csv", manual_layers["manual_spend_rows"])
    _write_csv(output_dir / "manual_spend_effective.csv", manual_layers["manual_spend_effective"])
    _write_csv(output_dir / "manual_finance_rows.csv", manual_layers["manual_finance_rows"])
    _write_csv(output_dir / "manual_finance_effective.csv", manual_layers["manual_finance_effective"])
    _write_csv(output_dir / "backend_daily_history.csv", backend_daily_history)

    return output_dir


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export WB ad analysis raw sources and backend-calculated layers to CSV files.",
    )
    parser.add_argument("--store-id", type=int, required=True, help="Store ID from the local database.")
    parser.add_argument("--period-start", type=str, default=None, help="Period start in YYYY-MM-DD.")
    parser.add_argument("--period-end", type=str, default=None, help="Period end in YYYY-MM-DD.")
    parser.add_argument("--days", type=int, default=14, help="Fallback rolling window if dates are omitted.")
    parser.add_argument(
        "--output-dir",
        type=str,
        default=None,
        help="Custom output directory. Defaults to reports/ad_analysis_export_store{store_id}_{start}_{end}.",
    )
    parser.add_argument(
        "--force-overview",
        action="store_true",
        help="Refresh backend history from WB before exporting overview and history CSV files.",
    )
    args = parser.parse_args()

    period_start = _parse_date(args.period_start)
    period_end = _parse_date(args.period_end)
    if period_start and not period_end:
        period_end = period_start
    if period_end and not period_start:
        period_start = period_end
    if period_start is None or period_end is None:
        period_start, period_end = _default_period(args.days)
    if period_end < period_start:
        raise SystemExit("period-end must be greater than or equal to period-start")

    default_output_dir = REPORTS_DIR / (
        f"ad_analysis_export_store{int(args.store_id)}_{period_start.isoformat()}_{period_end.isoformat()}"
    )
    output_dir = Path(args.output_dir).expanduser().resolve() if args.output_dir else default_output_dir

    export_dir = asyncio.run(
        run_export(
            int(args.store_id),
            period_start=period_start,
            period_end=period_end,
            output_dir=output_dir,
            force_overview=bool(args.force_overview),
        )
    )
    print(f"CSV export saved to: {export_dir}", flush=True)


if __name__ == "__main__":
    main()
