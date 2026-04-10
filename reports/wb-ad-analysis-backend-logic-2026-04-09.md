# WB Ad Analysis Backend Logic Map

Date: 2026-04-09  
Scope: `app/routers/sku_economics.py`, `app/services/sku_economics_service.py`, `app/services/wb_advert_repository.py`, `app/services/wb_token_access.py`, `app/schemas/sku_economics.py`, `app/models/sku_economics.py`

Bu hujjat kod bo'yicha "Ad Analysis" modulining to'liq ish oqimini tushuntiradi:
- qaysi internal endpointlar bor
- qaysi external WB endpointlarga request ketadi
- qaysi payload yuboriladi
- response dan qaysi maydonlar olinadi
- qayerda retry/backoff/rate limit bor
- qayerda cache va DB persist ishlaydi
- final API response qanday yig'iladi

## 1) Internal API endpointlar (backend kirish nuqtalari)

Base router: `APIRouter(prefix="/stores/{store_id}/ad-analysis")`

### 1.1 `GET /stores/{store_id}/ad-analysis/overview`
Maqsad:
- foydalanuvchi uchun yakuniy ad analysis overview qaytarish

Query params:
- `days` (default `14`)
- `preset` (`7d|14d|30d|90d|all|custom`)
- `period_start`, `period_end` (ISO date)
- `page`, `page_size`
- `status` (status filter)
- `search`
- `force` (agar `true` bo'lsa WB dan refresh qiladi)

Flow:
1. store access tekshiriladi (`_get_accessible_store`)
2. feature access tekshiriladi (`ensure_store_feature_access(..., "ad_analysis")`)
3. `sku_economics_service.build_overview(...)` chaqiriladi
4. `AdAnalysisOverviewOut` qaytadi

### 1.2 `POST /stores/{store_id}/ad-analysis/bootstrap/start`
Maqsad:
- long-running bootstrap taskni ishga tushirish yoki mavjudini qaytarish

Flow:
1. mavjud task holati tekshiriladi (`_start_or_get_bootstrap_task`)
2. yangi task bo'lsa `asyncio.create_task(_run_ad_analysis_bootstrap(...))`
3. `AdAnalysisBootstrapStatusOut` qaytariladi

### 1.3 `GET /stores/{store_id}/ad-analysis/bootstrap/status`
Maqsad:
- oxirgi bootstrap task statusini olish

Qaytadi:
- `AdAnalysisBootstrapStatusOut`
- stage fieldlar bilan:
  - `queued`
  - `fetching_advert`
  - `fetching_finance`
  - `fetching_funnel`
  - `building_snapshot`
  - `completed_partial`
  - `completed`
  - `failed`

### 1.4 `POST /stores/{store_id}/ad-analysis/costs/upload`
Maqsad:
- manual cost file (CSV/XLSX) yuklash (`SkuEconomicsCost`)

### 1.5 `POST /stores/{store_id}/ad-analysis/manual-spend/upload`
Maqsad:
- manual ad spend file yuklash (`SkuEconomicsManualSpend`)

### 1.6 `POST /stores/{store_id}/ad-analysis/finance/upload`
Maqsad:
- manual finance file yuklash (`SkuEconomicsManualFinance`)


## 2) Bootstrap stage flow (long-running)

Task constants:
- stale timeout: `20 min`
- execution timeout (`asyncio.wait_for`): `900 sec`
- default period: `14d`

Stage transition:
1. `queued`
2. `fetching_advert`
3. `fetching_finance`
4. `fetching_funnel`
5. `building_snapshot`
6. `completed` yoki `completed_partial`
7. xatoda `failed`

`completed_partial` qachon:
- finance yiqilgan yoki manual_required/error bo'lgan, lekin advert/funneldan kamida bittasi ishlagan
- yoki source statuslarda `partial/manual_required/error` bor

`bootstrap status` payload fieldlari:
- `status` (`idle|pending|running|completed|failed`)
- `current_stage`
- `stage_progress` (0..100)
- `source_statuses` (`source_id -> mode`)
- `is_partial`
- `failed_source`
- `step`
- `period_start`, `period_end`


## 3) Build overview asosiy orchestration

Primary entry: `SkuEconomicsService.build_overview(...)`

High-level:
1. Available period DB dan aniqlanadi (`_get_available_period`, source: `sku_economics_daily_metrics`)
2. Requested period resolve qilinadi (`_resolve_requested_period`)
3. Agar `force=true` bo'lsa:
   - `_refresh_history_data(...)` orqali WB dan yangilanadi
4. Persisted overview cache tekshiriladi (`sku_economics_overviews`)
5. Current va previous period aggregate DB dan olinadi (`_load_history_aggregate`)
6. `_build_overview_from_history(...)` bilan final payload yig'iladi
7. Agar mos bo'lsa overview persist qilinadi (`_persist_overview`)

Muhim:
- Hozirgi asosiy production flow history-based (`SkuEconomicsDailyMetric`) modelga tayangan.
- Legacy direct-live builder (`_build_period_overview`) faylda bor, lekin hozirgi `build_overview` ichidan chaqirilmaydi.


## 4) External WB endpointlar: qayerga request ketadi

## 4.1 Advert source (WB Advert API)

Service: `WBAdvertRepository`

### Endpoint A: `GET https://advert-api.wildberries.ru/adv/v1/promotion/count`
Maqsad:
- campaign idlarni olish (`get_campaign_ids`)

Response parse:
- `groups[*].advert_list[*].advertId` yig'iladi

### Endpoint B: `GET https://advert-api.wildberries.ru/adv/v3/fullstats`
Maqsad:
- campaign stats olish (`get_fullstats`)

Params:
- `ids`: comma-separated campaign ids (max 50 per request)
- `beginDate`: `YYYY-MM-DD`
- `endDate`: `YYYY-MM-DD`

Retry/rate-limit:
- min interval slot: `20.5s` (`_acquire_fullstats_slot`)
- cache TTL: `60s` (ids+date range key)
- retries: 429 va 5xx uchun exponential backoff + jitter

Where used:
- history refresh: `_fetch_advert_daily_history` (30 kunlik chunklar + campaign batchlar)
- legacy direct path: `_fetch_advert_metrics`

Data extraction (parser tolerance):
- item listni quyidagi wrapperlardan qidiradi: `data/items/adverts/rows/result`
- per-node campaign total keys: `sum/spend/spent/total/cost`
- nm id keys: `nmId/nm_id/nmid/id`
- views keys: `views/shows/impressions`
- clicks keys: `clicks/click/clickCount/click_count`
- orders keys: `orders/orderCount/orders_count/order_count`
- gmv keys: `sum_price/sumPrice/gmv/sumPriceWithDisc`

Allocation logic:
- exact spend: nm row ichida kelgan spend
- residual spend: `campaign_total - sum(nm_spend)`
- residual weights priority:
  1. orders
  2. clicks
  3. views
  4. fallback `1.0` each
- nm topilmasa `nm_id=0` bucketga tushadi (`unallocated_spend`)


## 4.2 Finance source (WB Statistics API)

Endpoint:
- `GET {WB_STATISTICS_API_URL}/api/v5/supplier/reportDetailByPeriod`
- default base URL configdan: `https://statistics-api.wildberries.ru`

Where used:
- history refresh: `_fetch_finance_daily_history`
- legacy direct path: `_fetch_finance_metrics`

Pagination:
- helper: `_fetch_finance_rows_paginated`
- start: `rrdid=0`
- `limit=100000`
- stop conditions:
  - `204 No Content`
  - payload bo'sh
  - `rrd_id` yo'q/yaroqsiz
  - `rrd_id` oldingidan katta bo'lmasa
  - duplicate `rrd_id`
  - safeguard page limit: `FINANCE_MAX_PAGES_PER_RANGE=500`

Request params:
- `dateFrom`
- `dateTo`
- `limit=100000`
- `rrdid`
- `period=daily`

Retry/throttle:
- minimal interval: `FINANCE_MIN_REQUEST_INTERVAL_SEC=0.25`
- retry attempts: `FINANCE_RETRY_MAX_ATTEMPTS=5`
- retry on:
  - network/request error
  - `429`
  - `5xx` (`500..599`)
- backoff:
  - `Retry-After` bo'lsa shuni ishlatadi
  - bo'lmasa exponential (`base=1s`, max `20s`)
- loglarda retry count, period, rrdid va fail reason yoziladi

Partial-mode hook:
- `_FinanceFetchError(partial_rows=...)`
- agar keyingi page fail bo'lsa, oldin yig'ilgan rows qaytarilib `partial` mode ishlatiladi

Finance rowdan olingan maydonlar:
- `nm_id`
- sana: `date_from` yoki `sale_dt` yoki `rr_dt` yoki `create_dt`
- `quantity`
- `doc_type_name` yoki `supplier_oper_name` (return aniqlash uchun)
- `retail_price_withdisc_rub` yoki `retail_amount` -> revenue
- `ppvz_for_pay` -> payout
- extra wb costs:
  - `delivery_rub`
  - `acquiring_fee`
  - `penalty`
  - `storage_fee`
  - `deduction`
  - `acceptance`
  - `rebill_logistic_cost`
  - `additional_payment`

Sign logic:
- return/negative quantity bo'lsa sign `-1`
- revenue/payout signed qo'llanadi
- orders `max(quantity*sign, 0)`

Normalization:
- final `wb_costs = positive(extra) + max(revenue - payout, 0)`
- `revenue >= 0` qilib clamp
- orders non-negative


## 4.3 Funnel source (WB Analytics API)

History endpoint (active history refresh path):
- `POST {WB_ANALYTICS_API_URL}/api/analytics/v3/sales-funnel/products/history`
- default base URL: `https://seller-analytics-api.wildberries.ru`

Payload:
- `selectedPeriod.start/end`
- `nmIds` (batch 20)
- `skipDeletedNm=false`
- `aggregationLevel=day`

Important behavior:
- service tarixiy kundalik funnelni faqat oxirgi 7 kun oralig'ida refresh qiladi
- eski kunlar uchun partial status qaytaradi

Parsed fields (`history[*]`):
- `openCount`
- `cartCount`
- `orderCount`
- `orderSum`
- `buyoutCount`
- `buyoutSum`

Legacy summary endpoint (faylda bor, lekin asosiy build flowda ishlatilmayapti):
- `POST /api/analytics/v3/sales-funnel/products`


## 5) Token tanlash va access gate

Feature gate:
- har endpoint `ensure_store_feature_access(store, "ad_analysis")` orqali tekshiradi
- required categories: `analytics`, `statistics`, `promotion`

Token resolve (`get_store_feature_api_key`):
1. `ad_analysis` slot tokeni (agar mos bo'lsa)
2. fallback `default` slot
3. service ichida candidate order:
   - feature token
   - `WB_ADVERT_API_KEY` (advert prefer holatda)
   - `store.api_key`
   - `settings.WB_API_KEY`
   - `settings.WB_ADVERT_API_KEY`


## 6) History refresh -> DB persist qatlam

Main refresh function: `_refresh_history_data(...)`

Flow:
1. refresh range:
   - requested period
   - `HISTORY_LOOKBACK_DAYS=365` bilan clamp
   - `today` bilan clamp
2. existing rows o'qiladi (`SkuEconomicsDailyMetric`) -> fallback merge uchun
3. parallel fetch:
   - advert daily history
   - finance daily history
   - funnel daily history
4. source fail bo'lsa mavjud oldingi data o'sha source bo'yicha saqlab qoladi
5. yangi bucketlar bilan merge qiladi
6. refresh range uchun eski `SkuEconomicsDailyMetric` rows delete qiladi
7. `SkuEconomicsOverviewCache` tozalanadi
8. yangi daily rows insert qilinadi

Stored per-day fields (`sku_economics_daily_metrics`):
- advert: views, clicks, orders, gmv, exact_spend, estimated_spend
- finance: revenue, payout, wb_costs, orders
- funnel: open/cart/order counts, sums, buyout stats
- flags: `has_advert`, `has_finance`, `has_funnel`
- `synced_at`


## 7) Snapshot builder: qanday final metrikalar yig'iladi

Builder: `_build_overview_from_history(...)`

Input:
- `current_data` (DB aggregate)
- `previous_data` (trend comparison uchun)
- manual layers:
  - costs
  - manual spend overlap
  - manual finance overlap

Per-SKU combine:
- Orders: `max(finance.orders, funnel.order_count, advert.total_orders)`
- Revenue: finance -> fallback funnel.order_sum -> fallback advert.total_gmv
- WB costs: finance layerdan
- COGS: uploaded unit cost * orders
- Gross before ads: `revenue - wb_costs - cost_price`
- Ad cost: `exact + estimated + manual`
- Net profit: `gross - ad_cost`
- CTR, CR, CPC, DRR hisoblanadi

Ad spend transparency fields (`AdAnalysisMetricsOut`):
- `ad_cost_total`
- `ad_cost_exact`
- `ad_cost_estimated`
- `ad_cost_manual`
- `ad_cost_source_mode` (`exact|estimated|manual|mixed|unallocated`)
- `ad_cost_confidence` (`high|medium|low`)

Confidence rule:
- manual spend bo'lsa `low`
- unallocated spend bo'lsa `low`
- estimated spend bo'lsa `medium`
- aks holda `high`

Source lineage:
- `source_lineage.advert/finance/funnel`:
  - `automatic`
  - `manual`
  - `partial`
  - `failed`

Diagnostics/status:
- diagnosis: `traffic|card|economics|data`
- status: `stop|rescue|control|grow|low_data`
- priority: `critical|high|medium|low`

Alerts:
- unallocated spend warning
- missing cost warning
- finance missing warning
- advert error warning

Trend:
- current vs previous period deltalari orqali `worsening/improving/stable/volatile/new`


## 8) Manual upload fallback logikasi

### 8.1 Costs upload
Kiruvchi fayldan:
- `nm_id` yoki `vendor_code`
- `unit_cost`

Yechim:
- `vendor_code -> nm_id` map orqali resolve
- unresolved rows preview qaytaradi

### 8.2 Manual spend upload
Kerakli:
- `nm_id` yoki `vendor_code`
- `spend`
Ixtiyoriy:
- `views`, `clicks`, `orders`, `gmv`, `title`

### 8.3 Manual finance upload
2 rejim:
1. Raw WB report mode (`nm_id`, `retail_price_withdisc_rub`, `ppvz_for_pay`, ...)
2. Custom mapped mode (`revenue`, optional `wb_costs`, `payout`, `orders`)

Har uploaddan keyin:
- `invalidate_saved_overviews(...)` chaqiriladi
- persisted overview cache tozalanadi


## 9) Caching va persistence

In-memory cache:
- key: `(store_id, period_start, period_end)`
- TTL: `300s`

Persisted overview cache:
- table: `sku_economics_overviews`
- payload: full `AdAnalysisOverviewOut` JSON
- `build_overview` force bo'lmasa shu cached payloaddan qaytarishi mumkin

Daily history table:
- `sku_economics_daily_metrics`
- bu table hozir asosiy source-of-truth hisoblanadi period filtering uchun

Snapshot table:
- `sku_economics_snapshots` uchun `_persist_snapshots(...)` helper bor
- lekin hozirgi asosiy build flowda bu helper chaqirilmayapti


## 10) Error handling va partial behavior

Advert:
- tokenlar bo'yicha ketma-ket urinish
- fail bo'lsa `source_status=error`
- partial holat: unallocated spend > epsilon

Finance:
- retry/backoff/throttle + pagination
- partial rows saqlanadi (`_FinanceFetchError.partial_rows`)
- qayta ishlashda `mode=partial` ga tushishi mumkin
- butunlay fail bo'lsa `manual_required`

Funnel:
- 7 kunlik tarix cheklovi sabab partial bo'lishi mumkin
- xatoda `mode=error`

Bootstrap:
- source statuslardan `completed_partial` ni ajratadi
- fail bo'lsa `failed_source` set qiladi


## 11) Real request payload namunalar

### 11.1 Fullstats (advert)
```http
GET /adv/v3/fullstats?ids=123,456&beginDate=2026-04-01&endDate=2026-04-09
Authorization: <token>
Accept: application/json
```

### 11.2 Finance report
```http
GET /api/v5/supplier/reportDetailByPeriod?dateFrom=2026-04-01&dateTo=2026-04-09&limit=100000&rrdid=0&period=daily
Authorization: <token>
Accept: application/json
```

### 11.3 Funnel history
```json
POST /api/analytics/v3/sales-funnel/products/history
{
  "selectedPeriod": { "start": "2026-04-03", "end": "2026-04-09" },
  "nmIds": [111, 222, 333],
  "skipDeletedNm": false,
  "aggregationLevel": "day"
}
```


## 12) Endpointlar bo'yicha "qanday ma'lumot olinadi" qisqa map

`adv/v1/promotion/count`:
- campaign id list

`adv/v3/fullstats`:
- per campaign/per nm views, clicks, orders, gmv, spend
- campaign total spend ham olinadi
- exact/estimated/unallocated taqsimot qilinadi

`statistics/reportDetailByPeriod`:
- moliyaviy satrlar (realizatsiya, payout, extra cost komponentlari, quantity, doc type)
- signed revenue/payout
- wb_costs normalization

`sales-funnel/products/history`:
- product-level daily funnel (open/cart/order/buyout stats)


## 13) Amaldagi asosiy ishlash ssenariysi (production path)

1. Frontend `bootstrap/start` chaqiradi (yoki `overview?force=true`)
2. Backend WB source layerlarini yuklaydi:
   - advert -> fullstats
   - finance -> reportDetailByPeriod (paginated)
   - funnel -> sales-funnel history (last 7 days)
3. Natija `SkuEconomicsDailyMetric`ga yoziladi
4. `build_overview` shu tarixiy qatlamdan period bo'yicha snapshot yig'adi
5. `source_statuses`, `source_lineage`, `ad_cost_confidence`, alerts bilan response qaytariladi


## 14) Muhim eslatma (real "qanday ishlaydi" bo'yicha)

Kod bo'yicha aktiv asosiy yo'l history-based path:
- `build_overview -> _refresh_history_data -> _load_history_aggregate -> _build_overview_from_history`

Faylda legacy direct WB builder ham bor (`_build_period_overview`), u quyidagi endpointlarni ham ishlatadi:
- `sales-funnel/products`
- direct period finance/advert combine

Lekin hozirgi `build_overview` oqimida bu helperga call yo'q.

