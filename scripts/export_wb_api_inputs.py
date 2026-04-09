from __future__ import annotations

import argparse
import asyncio
import csv
import json
import sys
from datetime import date, timedelta
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
from app.models import Store
from app.services.sku_economics_service import _chunks, _safe_positive, _to_float, _to_int, sku_economics_service
from app.services.wb_advert_repository import WBAdvertRepository


REPORTS_DIR = PROJECT_ROOT / "reports"

UNIFIED_CSV_HEADERS = [
    "source",
    "period_start",
    "period_end",
    "metric_date",
    "advert_id",
    "campaign_title",
    "campaign_total_spend",
    "nm_id",
    "nm_title",
    "views",
    "clicks",
    "ad_orders",
    "ad_gmv",
    "ad_spend",
    "open_count",
    "cart_count",
    "order_count",
    "order_sum",
    "buyout_count",
    "buyout_sum",
    "quantity",
    "doc_type",
    "revenue",
    "payout",
    "wb_extra_costs",
    "is_return",
    "raw_json",
]

PROMOTION_HEADERS = [
    "source",
    "period_start",
    "period_end",
    "advert_id",
    "campaign_title",
    "raw_json",
]

FULLSTATS_HEADERS = [
    "source",
    "period_start",
    "period_end",
    "metric_date",
    "advert_id",
    "campaign_title",
    "campaign_total_spend",
    "nm_id",
    "nm_title",
    "views",
    "clicks",
    "ad_orders",
    "ad_gmv",
    "ad_spend",
    "raw_json",
]

FUNNEL_HEADERS = [
    "source",
    "period_start",
    "period_end",
    "nm_id",
    "nm_title",
    "open_count",
    "cart_count",
    "order_count",
    "order_sum",
    "buyout_count",
    "buyout_sum",
    "raw_json",
]

FINANCE_HEADERS = [
    "source",
    "period_start",
    "period_end",
    "metric_date",
    "nm_id",
    "doc_type",
    "quantity",
    "revenue",
    "payout",
    "wb_extra_costs",
    "is_return",
    "raw_json",
]


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    return date.fromisoformat(str(value).strip())


def _default_period(days: int) -> tuple[date, date]:
    safe_days = max(int(days or 14), 1)
    period_end = date.today()
    period_start = period_end - timedelta(days=safe_days - 1)
    return period_start, period_end


def _json_cell(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    except TypeError:
        return json.dumps(str(value), ensure_ascii=False)


def _csv_value(value: Any) -> str | int | float:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (list, dict)):
        return _json_cell(value)
    return str(value)


def _base_row(source: str, *, period_start: date, period_end: date) -> dict[str, Any]:
    row = {header: "" for header in UNIFIED_CSV_HEADERS}
    row["source"] = source
    row["period_start"] = period_start.isoformat()
    row["period_end"] = period_end.isoformat()
    return row


def _write_csv(path: Path, rows: Sequence[dict[str, Any]], *, fieldnames: Sequence[str], delimiter: str = ";") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(fieldnames), delimiter=delimiter)
        writer.writeheader()
        for row in rows:
            writer.writerow({header: _csv_value(row.get(header, "")) for header in fieldnames})


def _campaign_title(payload: dict[str, Any]) -> str:
    return str(
        payload.get("advertName")
        or payload.get("advert_name")
        or payload.get("name")
        or payload.get("advertTitle")
        or ""
    ).strip()


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


async def _fetch_promotion_count_raw(store: Store) -> tuple[list[dict[str, Any]], str]:
    tokens = sku_economics_service._candidate_tokens(store, prefer_advert=True)
    last_error = "No advert token available"
    url = f"{settings.WB_ADVERT_API_URL}/adv/v1/promotion/count"
    for token in tokens:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as client:
                response = await client.get(
                    url,
                    headers={
                        "Authorization": token,
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                    },
                )
            if response.status_code >= 400:
                raise RuntimeError(f"promotion/count {response.status_code}: {response.text[:300]}")
            payload = response.json() if response.text else []
            groups = payload if isinstance(payload, list) else (payload.get("adverts") or [])
            rows: list[dict[str, Any]] = []
            for group in groups:
                advert_list = group.get("advert_list") or group.get("advertList") or []
                for advert in advert_list:
                    if isinstance(advert, dict):
                        rows.append(advert)
            return rows, token
        except Exception as exc:
            last_error = str(exc)
    raise RuntimeError(f"WB promotion/count export failed: {last_error}")


async def _fetch_fullstats_raw(
    token: str,
    campaign_ids: Sequence[int],
    *,
    period_start: date,
    period_end: date,
) -> list[dict[str, Any]]:
    if not campaign_ids:
        return []
    repo = WBAdvertRepository(token=token)
    out: list[dict[str, Any]] = []
    for batch in _chunks(list(campaign_ids), 50):
        batch_data = await asyncio.to_thread(
            repo.get_fullstats,
            batch,
            begin_date=period_start.isoformat(),
            end_date=period_end.isoformat(),
        )
        if isinstance(batch_data, list):
            out.extend(item for item in batch_data if isinstance(item, dict))
    return out


def _collect_fullstats_leaf_rows(
    node: dict[str, Any],
    *,
    campaign_item: dict[str, Any],
    period_start: date,
    period_end: date,
    out: list[dict[str, Any]],
    day_node: dict[str, Any] | None = None,
    app_node: dict[str, Any] | None = None,
) -> None:
    day_values = node.get("days")
    if isinstance(day_values, list) and day_values:
        for child in day_values:
            if isinstance(child, dict):
                _collect_fullstats_leaf_rows(
                    child,
                    campaign_item=campaign_item,
                    period_start=period_start,
                    period_end=period_end,
                    out=out,
                    day_node=child,
                    app_node=None,
                )
        return

    app_values = node.get("apps")
    if isinstance(app_values, list) and app_values:
        for child in app_values:
            if isinstance(child, dict):
                _collect_fullstats_leaf_rows(
                    child,
                    campaign_item=campaign_item,
                    period_start=period_start,
                    period_end=period_end,
                    out=out,
                    day_node=day_node,
                    app_node=child,
                )
        return

    nms = node.get("nms")
    if not isinstance(nms, list):
        return

    metric_date = sku_economics_service._parse_generic_date(
        (day_node or {}).get("date")
        or (day_node or {}).get("day")
        or (day_node or {}).get("dt")
        or (day_node or {}).get("begin")
        or (day_node or {}).get("beginDate")
    )
    advert_id = _to_int(campaign_item.get("advertId") or campaign_item.get("advert_id") or campaign_item.get("id"))
    campaign_title = _campaign_title(campaign_item)
    campaign_total_spend = _to_float(campaign_item.get("sum"))

    for nm_row in nms:
        if not isinstance(nm_row, dict):
            continue
        row = _base_row("fullstats", period_start=period_start, period_end=period_end)
        row.update(
            {
                "metric_date": metric_date,
                "advert_id": advert_id or "",
                "campaign_title": campaign_title,
                "campaign_total_spend": round(campaign_total_spend, 2),
                "nm_id": _to_int(nm_row.get("nmId") or nm_row.get("nm_id")),
                "nm_title": str(nm_row.get("name") or "").strip(),
                "views": _to_int(nm_row.get("views")),
                "clicks": _to_int(nm_row.get("clicks")),
                "ad_orders": _to_int(nm_row.get("orders")),
                "ad_gmv": round(_to_float(nm_row.get("sum_price")), 2),
                "ad_spend": round(_to_float(nm_row.get("sum")), 2),
                "raw_json": _json_cell(
                    {
                        "campaign": campaign_item,
                        "day": day_node,
                        "app": app_node,
                        "nm": nm_row,
                    }
                ),
            }
        )
        out.append(row)


def _build_promotion_count_rows(
    payload_rows: Sequence[dict[str, Any]],
    *,
    period_start: date,
    period_end: date,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for advert in payload_rows:
        row = _base_row("promotion_count", period_start=period_start, period_end=period_end)
        row.update(
            {
                "advert_id": _to_int(advert.get("advertId") or advert.get("advert_id") or advert.get("id")) or "",
                "campaign_title": str(advert.get("name") or advert.get("advertName") or "").strip(),
                "raw_json": _json_cell(advert),
            }
        )
        rows.append(row)
    return rows


def _build_fullstats_rows(
    payload_rows: Sequence[dict[str, Any]],
    *,
    period_start: date,
    period_end: date,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in payload_rows:
        leaf_before = len(rows)
        _collect_fullstats_leaf_rows(
            item,
            campaign_item=item,
            period_start=period_start,
            period_end=period_end,
            out=rows,
        )
        if len(rows) == leaf_before:
            row = _base_row("fullstats", period_start=period_start, period_end=period_end)
            row.update(
                {
                    "advert_id": _to_int(item.get("advertId") or item.get("advert_id") or item.get("id")) or "",
                    "campaign_title": _campaign_title(item),
                    "campaign_total_spend": round(_to_float(item.get("sum")), 2),
                    "raw_json": _json_cell(item),
                }
            )
            rows.append(row)
    return rows


async def _fetch_funnel_products_rows(
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
            out: list[dict[str, Any]] = []
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
                    response = await sku_economics_service._request_with_retry(
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
                    if response.status_code >= 400:
                        raise RuntimeError(f"sales-funnel/products {response.status_code}: {response.text[:300]}")
                    data = response.json() or {}
                    products = ((data.get("data") or {}).get("products") or [])
                    for product_row in products:
                        product = product_row.get("product") or {}
                        stats = ((product_row.get("statistic") or {}).get("selected") or {})
                        row = _base_row("sales_funnel_products", period_start=period_start, period_end=period_end)
                        row.update(
                            {
                                "nm_id": _to_int(product.get("nmId")) or "",
                                "nm_title": str(product.get("title") or "").strip(),
                                "open_count": _to_int(stats.get("openCount")),
                                "cart_count": _to_int(stats.get("cartCount")),
                                "order_count": _to_int(stats.get("orderCount")),
                                "order_sum": round(_to_float(stats.get("orderSum")), 2),
                                "buyout_count": _to_int(stats.get("buyoutCount")),
                                "buyout_sum": round(_to_float(stats.get("buyoutSum")), 2),
                                "raw_json": _json_cell(product_row),
                            }
                        )
                        out.append(row)
            return out
        except Exception as exc:
            last_error = str(exc)
    raise RuntimeError(f"WB sales-funnel/products export failed: {last_error}")


async def _fetch_finance_rows(
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
                response = await sku_economics_service._request_with_retry(
                    client,
                    "GET",
                    url,
                    headers={"Authorization": token, "Accept": "application/json"},
                    params=params,
                )
            if response.status_code == 204:
                return []
            if response.status_code >= 400:
                raise RuntimeError(f"reportDetailByPeriod {response.status_code}: {response.text[:300]}")
            payload = response.json() or []
            out: list[dict[str, Any]] = []
            for item in payload:
                if not isinstance(item, dict):
                    continue
                quantity = _to_int(item.get("quantity"))
                doc_type = str(item.get("doc_type_name") or item.get("supplier_oper_name") or "").strip()
                is_return = ("возврат" in doc_type.lower()) or ("return" in doc_type.lower()) or quantity < 0
                extra_costs = sum(
                    _to_float(item.get(field))
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
                row = _base_row("report_detail_by_period", period_start=period_start, period_end=period_end)
                row.update(
                    {
                        "metric_date": sku_economics_service._parse_generic_date(
                            item.get("date_from")
                            or item.get("sale_dt")
                            or item.get("rr_dt")
                            or item.get("create_dt")
                        ),
                        "nm_id": _to_int(item.get("nm_id")) or "",
                        "quantity": quantity,
                        "doc_type": doc_type,
                        "revenue": round(_to_float(item.get("retail_price_withdisc_rub") or item.get("retail_amount")), 2),
                        "payout": round(_to_float(item.get("ppvz_for_pay")), 2),
                        "wb_extra_costs": round(_safe_positive(extra_costs), 2),
                        "is_return": is_return,
                        "raw_json": _json_cell(item),
                    }
                )
                out.append(row)
            return out
        except Exception as exc:
            last_error = str(exc)
    raise RuntimeError(f"WB reportDetailByPeriod export failed: {last_error}")


def _extract_campaign_ids(rows: Sequence[dict[str, Any]]) -> list[int]:
    ids: list[int] = []
    for row in rows:
        advert_id = _to_int(row.get("advertId") or row.get("advert_id") or row.get("id"))
        if advert_id > 0:
            ids.append(advert_id)
    return sorted(set(ids))


def _extract_nm_ids_from_fullstats(rows: Sequence[dict[str, Any]]) -> list[int]:
    ids: set[int] = set()
    for row in rows:
        nm_id = _to_int(row.get("nm_id"))
        if nm_id > 0:
            ids.add(nm_id)
    return sorted(ids)


def _write_formulas_txt(path: Path) -> None:
    text = """КАК ЧИТАТЬ ЭТИ ФАЙЛЫ И КАК ИЗ НИХ СОБИРАЕТСЯ ЭКРАН НА САЙТЕ

Главная мысль:
сайт считает рекламу не из одного файла, а собирает 4 слоя данных вместе.
Плюс есть еще себестоимость, но ее в этом простом export нет, потому что WB API ее не отдает.

ЧТО ДЕЛАЕТ КАЖДЫЙ ФАЙЛ

1. 01_promotion_count.csv
Это технический файл.
Он нужен только для того, чтобы получить список advert_id.
Дальше по этим advert_id мы уже запрашиваем 02_fullstats.csv.
На сайте этот файл почти не виден напрямую.

2. 02_fullstats.csv
Это главный рекламный файл.
Из него сайт берет:
- advert_id
- название кампании
- общий расход кампании
- nm_id
- показы
- клики
- рекламные заказы
- рекламный GMV
- расход по SKU

Что из него показывается на сайте:
- блок «Кампании»
- расход по рекламе
- показы / клики
- заказы из рекламы
- рекламный GMV
- CTR
- CR
- CPC

Как считается из 02_fullstats.csv:
- exact_spend по SKU = сумма ad_spend по одному nm_id
- если у кампании общий расход больше, чем сумма расходов по SKU, появляется остаток residual
- этот residual распределяется между SKU
- сначала по ad_orders
- если заказов нет, по clicks
- если кликов нет, по views
- если и этого нет, поровну
- этот распределенный остаток и есть estimated_spend

Итог по рекламе:
- ad_cost = exact_spend + estimated_spend

3. 03_sales_funnel_products.csv
Это файл воронки.
Из него сайт берет:
- открытия карточки
- добавления в корзину
- заказы
- сумму заказов
- выкупы
- сумму выкупов

Что из него показывается на сайте:
- Open count
- Cart count
- Order count
- Buyout count
- конверсии воронки

Что из него считается:
- add_to_cart_percent = cart_count / open_count * 100
- cart_to_order_percent = order_count / cart_count * 100

Этот файл еще важен как запасной источник заказов и выручки, если финансовый слой пустой.

4. 04_report_detail_by_period.csv
Это финансовый файл.
Из него сайт берет:
- nm_id
- quantity
- тип документа
- revenue
- payout
- дополнительные расходы WB

Что из него показывается на сайте:
- Revenue
- WB costs
- часть Orders

Как считается финансовая часть:
- если строка является возвратом, знак = минус
- revenue_signed = revenue * sign
- payout_signed = payout * sign
- orders_signed = max(quantity * sign, 0)
- revenue_total = сумма revenue_signed по SKU
- payout_total = сумма payout_signed по SKU
- wb_extra_total = сумма wb_extra_costs по SKU
- wb_costs = max(wb_extra_total, 0) + max(revenue_total - payout_total, 0)

ГДЕ ЗДЕСЬ СЕБЕСТОИМОСТЬ

Себестоимость на сайте есть, но в этих 4 файлах ее нет.
Она берется из отдельного Excel-файла.
WB API себестоимость не возвращает.

Если в Excel есть колонки:
- Артикул Поставщика
- Артикул ВБ
- Себестоимость, руб

то сайт использует их так:
- Артикул ВБ = nm_id
- Себестоимость, руб = unit_cost

После этого сайт считает:
- cost_price = unit_cost * total_orders

Если себестоимости нет, тогда:
- cost_price считается неточно
- gross profit и net profit тоже будут неточными
- max_cpo и profit_delta тоже будут неточными

КАК САЙТ СОБИРАЕТ ИТОГ ПО SKU

1. Сначала собирается реклама из 02_fullstats.csv
- ad_cost
- views
- clicks
- ad_orders
- ad_gmv

2. Потом добавляется воронка из 03_sales_funnel_products.csv
- open_count
- cart_count
- order_count
- order_sum
- buyout_count

3. Потом добавляется финансовый слой из 04_report_detail_by_period.csv
- revenue
- wb_costs
- finance.orders

4. Потом добавляется себестоимость из отдельного файла
- unit_cost
- cost_price

ИТОГОВЫЕ ФОРМУЛЫ, КОТОРЫЕ ВЫ ВИДИТЕ НА САЙТЕ

1. total_orders = max(finance.orders, funnel.order_count, advert.ad_orders)
Это итоговое число заказов для SKU.
Сайт берет максимум из трех источников, чтобы не занизить расчет.

2. revenue_final
Сайт берет выручку в таком порядке:
- сначала finance.revenue
- если его нет, тогда funnel.order_sum
- если и его нет, тогда advert.ad_gmv

3. ad_cost = exact_spend + estimated_spend
Это расход на рекламу по SKU.

4. cost_price = unit_cost * total_orders
Это себестоимость проданных единиц.

5. gross_profit_before_ads = revenue_final - wb_costs - cost_price
Это прибыль до вычета рекламы.

6. net_profit = gross_profit_before_ads - ad_cost
Это уже чистая прибыль после рекламы.

7. max_cpo
Если total_orders > 0:
- max_cpo = gross_profit_before_ads / total_orders
Если total_orders = 0:
- max_cpo = gross_profit_before_ads

Это максимально допустимая стоимость заказа.

8. actual_cpo
Если advert.ad_orders > 0:
- actual_cpo = ad_cost / advert.ad_orders
Если advert.ad_orders = 0:
- actual_cpo = ad_cost

Это фактическая стоимость заказа из рекламы.

9. profit_delta = max_cpo - actual_cpo
Если число положительное, у SKU есть запас.
Если число отрицательное, реклама уже слишком дорогая.

КАК ПРОВЕРЯТЬ РУКАМИ

1. Найдите нужный nm_id в Excel с себестоимостью
2. Найдите этот же nm_id в 02_fullstats.csv
3. Найдите этот же nm_id в 03_sales_funnel_products.csv
4. Найдите этот же nm_id в 04_report_detail_by_period.csv
5. Подставьте числа в формулы выше

Так вы получите ту же математику, которую показывает сайт.

КАКИЕ БЛОКИ САЙТА ИЗ ЧЕГО СЧИТАЮТСЯ

Блок «Кампании»
- почти полностью из 02_fullstats.csv
- advert_id
- название кампании
- расход
- GMV
- DRR
- число связанных SKU

Метрики рекламы в строке SKU
- из 02_fullstats.csv
- views
- clicks
- ad_orders
- ad_gmv
- ad_cost
- CTR
- CR
- CPC

Метрики воронки
- из 03_sales_funnel_products.csv
- open_count
- cart_count
- order_count
- buyout_count
- конверсии

Финансовые метрики
- из 04_report_detail_by_period.csv
- revenue
- wb_costs
- finance.orders

Экономика SKU
- из 02 + 03 + 04 + файла себестоимости
- cost_price
- gross_profit_before_ads
- net_profit
- max_cpo
- actual_cpo
- profit_delta

DRR
- DRR = ad_cost / revenue_final * 100
- значит он считается сразу из рекламного слоя и слоя выручки

Статусы типа «Остановить / Спасти / Растить»
- считаются уже не из одного файла
- они строятся из итоговых метрик:
  net_profit, max_cpo, actual_cpo, profit_delta, CTR, CR и достаточности данных

ВАЖНО

- Этот export сохраняет только входные данные из WB API.
- Себестоимость сюда не входит автоматически.
- Для полной проверки математики нужно использовать еще Excel-файл себестоимости.
- Колонка raw_json хранит исходную строку WB, чтобы можно было сверять руками.
"""
    path.write_text(text, encoding="utf-8")


async def run_export(
    store_id: int,
    *,
    period_start: date,
    period_end: date,
    output_dir: Path,
) -> Path:
    print(f"Загружаем магазин {store_id}...", flush=True)
    store = await _load_store(store_id)

    print("Получаем promotion/count...", flush=True)
    promotion_payload_rows, advert_token = await _fetch_promotion_count_raw(store)
    promotion_rows = _build_promotion_count_rows(
        promotion_payload_rows,
        period_start=period_start,
        period_end=period_end,
    )
    campaign_ids = _extract_campaign_ids(promotion_payload_rows)

    print("Получаем fullstats...", flush=True)
    fullstats_payload_rows = await _fetch_fullstats_raw(
        advert_token,
        campaign_ids,
        period_start=period_start,
        period_end=period_end,
    )
    fullstats_rows = _build_fullstats_rows(
        fullstats_payload_rows,
        period_start=period_start,
        period_end=period_end,
    )
    nm_ids = _extract_nm_ids_from_fullstats(fullstats_rows)

    print("Получаем sales-funnel/products...", flush=True)
    funnel_rows = await _fetch_funnel_products_rows(
        store,
        period_start=period_start,
        period_end=period_end,
        nm_ids=nm_ids,
    )

    print("Получаем reportDetailByPeriod...", flush=True)
    finance_rows = await _fetch_finance_rows(
        store,
        period_start=period_start,
        period_end=period_end,
    )

    all_rows = [
        *promotion_rows,
        *fullstats_rows,
        *funnel_rows,
        *finance_rows,
    ]

    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"Сохраняем файлы в {output_dir}...", flush=True)
    _write_csv(output_dir / "01_promotion_count.csv", promotion_rows, fieldnames=PROMOTION_HEADERS)
    _write_csv(output_dir / "02_fullstats.csv", fullstats_rows, fieldnames=FULLSTATS_HEADERS)
    _write_csv(output_dir / "03_sales_funnel_products.csv", funnel_rows, fieldnames=FUNNEL_HEADERS)
    _write_csv(output_dir / "04_report_detail_by_period.csv", finance_rows, fieldnames=FINANCE_HEADERS)
    _write_csv(output_dir / "00_all_sources.csv", all_rows, fieldnames=UNIFIED_CSV_HEADERS)
    _write_formulas_txt(output_dir / "formulas.txt")

    return output_dir


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Экспортирует только входные данные WB API, используемые в ad analysis, в CSV единого формата и formulas.txt.",
    )
    parser.add_argument("--store-id", type=int, required=True, help="ID магазина из локальной БД.")
    parser.add_argument("--period-start", type=str, default=None, help="Дата начала в формате YYYY-MM-DD.")
    parser.add_argument("--period-end", type=str, default=None, help="Дата конца в формате YYYY-MM-DD.")
    parser.add_argument("--days", type=int, default=14, help="Запасной rolling window, если даты не переданы.")
    parser.add_argument(
        "--output-dir",
        type=str,
        default=None,
        help="Пользовательская папка вывода. По умолчанию: reports/wb_api_inputs_store{store_id}_{start}_{end}",
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
        raise SystemExit("period-end должен быть больше или равен period-start")

    output_dir = (
        Path(args.output_dir).expanduser().resolve()
        if args.output_dir
        else REPORTS_DIR / f"wb_api_inputs_store{int(args.store_id)}_{period_start.isoformat()}_{period_end.isoformat()}"
    )

    export_dir = asyncio.run(
        run_export(
            int(args.store_id),
            period_start=period_start,
            period_end=period_end,
            output_dir=output_dir,
        )
    )
    print(f"Готово: {export_dir}", flush=True)


if __name__ == "__main__":
    main()
