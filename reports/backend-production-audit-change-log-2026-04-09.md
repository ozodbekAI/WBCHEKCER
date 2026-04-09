# Backend Production Audit Implementation Changelog

**Project:** `wb-optimizer`  
**Audit baseline date:** `2026-04-09`  
**Document type:** Full backend change log from staged production-audit implementation prompts  
**Source scope:** local backend code only (no real WB tokens / no end-to-end production execution in this session)

---

## 0) Context and constraints

This document captures what was actually implemented in backend code across the staged requests.

Important boundary:
- This is a code-level implementation report.
- External integration (real WB finance/advert/funnel/media behavior under production load) still needs real-environment validation.

---

## 1) Executive status

### Fully implemented (backend core)
1. Finance pagination integrity (`reportDetailByPeriod` with `rrdid` loop).
2. Finance retry/backoff/throttle behavior.
3. Stage-based ad-analysis bootstrap status model and transitions.
4. Source lineage + ad cost precision/confidence layer.
5. Photo-test decision semantics (`winner_found/no_clear_winner/insufficient_data/test_interrupted`).
6. Winner weighted scoring with confidence + conversion proxy fallback.
7. Product-level photo error mapping layer.
8. WB media apply verification summary.
9. Rollback foundation snapshot history in card `raw_data`.

### Partially implemented
1. Analytics terminology cleanup is only partial (explicit source-separated business fields are not fully introduced yet).
2. Media verification/snapshot persistence is strongest in card sync flow; not fully uniform across all promotion/media paths.
3. Rollback endpoint/action is not implemented yet (only foundation/snapshots exist).

---

## 2) Backend impact map

## 2.1 Changed files

### Ad analytics / SKU economics
- `app/services/sku_economics_service.py`
- `app/schemas/sku_economics.py`
- `app/routers/sku_economics.py`

### Promotion / sequential photo-test
- `app/services/promotion_service.py`
- `app/services/promotion_repository.py`
- `app/schemas/promotion.py`

### Photo studio error handling
- `app/services/photo_error_mapper.py` (new)
- `app/controllers/photo_chat_controller.py`
- `app/routers/photo_chat.py`
- `app/routers/photo_assets.py`
- `app/routers/cards.py`

### WB media apply verification / rollback foundation
- `app/services/wb_api.py`
- `app/services/wb_repository.py`
- `app/routers/cards.py`

## 2.2 High-impact functions (exact)

### `app/services/sku_economics_service.py`
- `_throttle_finance_request(...)`
- `_finance_backoff_delay(...)`
- `_request_finance_page_with_retry(...)`
- `_fetch_finance_rows_paginated(...)`
- `_fetch_finance_daily_history(...)`
- `_fetch_finance_metrics(...)`
- `_extract_fullstats_items(...)`
- `_extract_campaign_total(...)`
- `_extract_nm_id(...)`
- `_extract_nm_metric_float(...)`
- `_extract_nm_title(...)`
- `_build_residual_weights(...)`
- `_parse_fullstats_daily(...)`
- `_parse_fullstats(...)`
- `_resolve_precision(...)`
- `_resolve_ad_cost_confidence(...)`
- `_lineage_mode_from_source_status(...)`
- `_build_source_lineage(...)`

### `app/routers/sku_economics.py`
- `_failed_source_from_stage(...)`
- `_serialize_bootstrap_task(...)`
- `_run_ad_analysis_bootstrap(...)`
- `_start_or_get_bootstrap_task(...)`

### `app/schemas/sku_economics.py`
- `AdAnalysisSourceLineageOut`
- `AdAnalysisMetricsOut` (new ad-cost transparency fields)
- `AdAnalysisBootstrapStatusOut` (stage fields)

### `app/services/promotion_service.py`
- `_normalize_promotion_card_identity(...)`
- `_extract_orders_signal(...)`
- `_build_variant_scores(...)`
- `_winner_decision_from_company(...)`
- `finalize_winner(...)`

### `app/schemas/promotion.py`
- `PromotionPhotoOut` (winner scoring explanation fields)
- `PromotionCompanyOut` (decision + estimated spend fields)

### `app/services/photo_error_mapper.py`
- `map_photo_error(...)`
- `map_photo_error_message(...)`

### `app/services/wb_api.py`
- `_build_media_verification_summary(...)`
- `save_card_media_state(...)`

### `app/services/wb_repository.py`
- `_build_media_verification_summary(...)`
- `save_media_state(...)`

### `app/routers/cards.py`
- `_photo_http_exception(...)`
- `_build_media_apply_snapshot_record(...)`
- `_append_media_apply_history(...)`
- `sync_card_photos_endpoint(...)`

---

## 3) Detailed changelog by requested direction

## 3.1 Finance data integrity (pagination)

### Problem before
- Finance report fetch could stop on first chunk.
- Large stores could get truncated rows.

### What changed
- Introduced paginated fetch loop with `rrdid` continuation:
  - start `rrdid=0`
  - request `limit=100000`
  - continue with last row `rrd_id`
  - stop on `204`, empty payload, non-increasing/invalid `rrd_id`, or page safeguard
- Added loop guard:
  - `FINANCE_MAX_PAGES_PER_RANGE = 500`
  - seen `rrd_id` protection to avoid cycle

### Core implementation
- `SkuEconomicsService._fetch_finance_rows_paginated(...)`
- Called from both:
  - `_fetch_finance_daily_history(...)`
  - `_fetch_finance_metrics(...)`

### Old flow vs new flow
- Old: one (or insufficient) request per range.
- New: deterministic multi-page pull until terminal condition.

### Contract impact
- Public endpoint contract unchanged.
- Internal row completeness significantly improved.

---

## 3.2 Finance rate-limit resilience (retry/backoff/throttle)

### Problem before
- Pagination increases request count and 429/5xx exposure.

### What changed
- Finance-specific retry wrapper added (not global HTTP client mutation):
  - `_request_finance_page_with_retry(...)`
- Request pacing added:
  - `_throttle_finance_request(...)`
  - `FINANCE_MIN_REQUEST_INTERVAL_SEC = 0.25`
- Backoff policy:
  - `Retry-After` aware for `429`
  - bounded exponential for `5xx`
- Constants introduced:
  - `FINANCE_RETRY_MAX_ATTEMPTS = 5`
  - `FINANCE_RETRY_BASE_DELAY_SEC = 1.0`
  - `FINANCE_RETRY_MAX_DELAY_SEC = 20.0`
  - `FINANCE_RATE_LIMIT_STATUS = 429`
  - server error bounds `500..599`

### Partial failure hook
- `_FinanceFetchError` includes:
  - `retry_count`
  - `status_code`
  - `partial_rows`
- If retries exhaust after some pages, partial rows are preserved and can surface as partial source status.

### Logging improvements
- Retry count, status, period range, `rrdid`, and terminal reason are logged.

---

## 3.3 Bootstrap status: stage-based lifecycle

### Problem before
- Coarse `queued/running/done/failed` visibility made long-running finance steps opaque.

### What changed
- Added explicit stage model:
  - `queued`
  - `fetching_advert`
  - `fetching_finance`
  - `fetching_funnel`
  - `building_snapshot`
  - `completed_partial`
  - `completed`
  - `failed`
- Extended status payload fields:
  - `current_stage`
  - `stage_progress`
  - `source_statuses`
  - `is_partial`
  - `failed_source`

### Implementation points
- Router stage transitions in `_run_ad_analysis_bootstrap(...)`.
- Serialization/backward bridge in `_serialize_bootstrap_task(...)`.
- Failure source derivation in `_failed_source_from_stage(...)`.
- Stale/timeout tuning:
  - `AD_ANALYSIS_BOOTSTRAP_STALE_AFTER = 20 minutes`
  - `AD_ANALYSIS_BOOTSTRAP_TIMEOUT_SEC = 900`

### Partial completion behavior
- If finance fails but advert/funnel are usable, task can end in `completed_partial` with `is_partial=true`.

### Backward compatibility
- Legacy fields remain:
  - `status`, `progress`, `step`, `ready`, `error`
- New fields are additive.

### Sample payload (new fields)
```json
{
  "status": "completed",
  "progress": 100,
  "step": "Данные собраны частично: можно работать и дозагрузить недостающие источники вручную.",
  "current_stage": "completed_partial",
  "stage_progress": 100,
  "is_partial": true,
  "source_statuses": {
    "advert": "ok",
    "finance": "manual_required",
    "funnel": "ok"
  },
  "failed_source": null
}
```

---

## 3.4 Source transparency and confidence (analytics)

### Problem before
- Exact vs estimated spend transparency was weak in payload.

### What changed
- `AdAnalysisMetricsOut` expanded with ad-cost lineage fields:
  - `ad_cost_total`
  - `ad_cost_exact`
  - `ad_cost_estimated`
  - `ad_cost_manual`
  - `ad_cost_source_mode`
  - `ad_cost_confidence`
- Source lineage model added:
  - `AdAnalysisSourceLineageOut`:
    - `advert: automatic|manual|partial|failed`
    - `finance: automatic|manual|partial|failed`
    - `funnel: automatic|manual|partial|failed`

### Builder logic
- `_resolve_precision(...)`
- `_resolve_ad_cost_confidence(...)`
- `_lineage_mode_from_source_status(...)`
- `_build_source_lineage(...)`

### Result
- Consumer now gets precision/confidence metadata instead of a single opaque ad-cost number.

---

## 3.5 Advert parser hardening and spend allocation

### Problem before
- Fullstats format drift/null/missing fields could break or skew parsing.

### What changed
- Added robust extraction and normalization helpers:
  - `_extract_fullstats_items(...)`
  - `_extract_campaign_total(...)`
  - `_extract_nm_id(...)`
  - `_extract_nm_metric_float(...)`
  - `_extract_nm_title(...)`
- Hardened recursive parser:
  - `_collect_leaf_nms(...)`
- Daily + aggregate parsing strengthened:
  - `_parse_fullstats_daily(...)`
  - `_parse_fullstats(...)`
- Residual allocation strategy (`_build_residual_weights(...)`):
  - priority: orders -> clicks -> views -> equal split

### Allocation semantics now
- Exact per-SKU spend -> `exact` bucket (`advert_exact_spend`).
- Residual spend distributed by weights -> `estimated` bucket (`advert_estimated_spend`).
- Residual without linkable nm rows -> `unallocated_spend`.

### Added resilience behavior
- Skipped malformed items.
- Counted invalid NM rows.
- Logged zero-total drift anomalies.

---

## 3.6 Analytics terminology cleanup (source semantics)

### Current state
- **Partially done**.

### Done
- Precision and lineage added (`ad_cost_*`, `source_lineage`, source statuses).

### Still missing for full completion
Requested explicit source-separated fields are not fully introduced yet:
- `funnel_orders`
- `advert_attributed_orders`
- `finance_realized_sales`
- `buyouts`
- `returns`
- `payout_realized`

Current payload still uses mixed generic fields (`order_count`, `ad_orders`, `revenue`, `wb_costs`, etc.).

---

## 3.7 Photo-test semantics (sequential, not strict parallel AB)

### Problem before
- End state could force winner semantics even when evidence was weak.

### What changed
- Decision semantics formalized in backend:
  - `winner_found`
  - `no_clear_winner`
  - `insufficient_data`
  - `test_interrupted`
- Decision surfaced by `_winner_decision_from_company(...)` and response schema.

### Repository/service behavior
- `finish_with_winner(...)` and `finish_without_winner(...)` are used intentionally based on decision path.

### Response additions
- `winner_decision`
- `estimated_spend_rub` (keeps legacy `spend_rub` too)

---

## 3.8 Winner scoring upgrade (multi-factor, minimal-safe)

### Old behavior (conceptually)
- Winner selection was primarily simple ranking around CTR/shows.

### New behavior
- Weighted score introduced via `_build_variant_scores(...)`:
  - CTR signal
  - conversion signal (orders if present, otherwise clicks proxy)
  - confidence from impression sufficiency
- Threshold guards in `finalize_winner(...)`:
  - min variants
  - min impressions
  - min CTR delta
  - min score delta
- No clear winner / insufficient data pathways now explicit.

### Constants
- `WINNER_MIN_VARIANTS = 2`
- `WINNER_MIN_IMPRESSIONS = 300`
- `WINNER_MIN_CTR_DELTA = 0.35`
- `WINNER_MIN_SCORE_DELTA = 0.06`
- `WINNER_WEIGHT_CTR = 0.55`
- `WINNER_WEIGHT_CONVERSION = 0.25`
- `WINNER_WEIGHT_CONFIDENCE = 0.20`
- `WINNER_PROXY_CLICKS_SHARE = 0.03`

### Response enrichment
Per-photo output includes:
- `winner_score`
- `winner_score_confidence`
- `winner_score_conversion_source`
- `winner_score_reason`

---

## 3.9 `card_id` vs `nm_id` normalization

### Problem
- Legacy clients may send `nm_id` in `card_id`.

### What changed
- Added explicit normalization/validation in `_normalize_promotion_card_identity(...)`:
  - validates integer/positive IDs
  - checks scoped card ownership/access
  - verifies `card_id` belongs to payload `nm_id`
  - controlled error on true mismatch

### Backward compatibility
- Legacy fallback retained for old clients:
  - when no local card mapping exists, fallback `card_id = nm_id` with warning log.

### Risk that remains
- Fallback can still mask poor client mapping in edge cases.

---

## 3.10 Photo error mapping (product-level payload)

### What changed
- New normalized error mapper:
  - `app/services/photo_error_mapper.py`
  - `map_photo_error(raw_error, context=...)`

### Standard error shape
```json
{
  "code": "photo_generation_empty_result",
  "message": "Генерация не вернула изображение. Измените запрос и попробуйте снова.",
  "retryable": true,
  "category": "generation",
  "http_status": 502,
  "context": "chat_stream:generation"
}
```

### Mapped categories include
- asset not found
- source image missing / invalid URL / host / image type
- duplicate photo sources
- generation empty result
- no video in result
- WB apply failed
- upstream timeout
- auth / credits / prompt/input issues

### Integration points
- `app/routers/photo_chat.py`
- `app/routers/photo_assets.py`
- `app/routers/cards.py`
- `app/controllers/photo_chat_controller.py` (SSE error events)

### Logging policy
- Technical detail remains in server logs.
- Client receives stable product-level payload.

---

## 3.11 WB media apply verification

### Problem
- `media/save` success response does not guarantee actual final media order equals requested order.

### What changed
- Added verification summary helper in both API layers:
  - `WildberriesAPI._build_media_verification_summary(...)`
  - `WBRepository._build_media_verification_summary(...)`
- `save_card_media_state(...)` and `save_media_state(...)` now return:
  - `before_order` / `before_snapshot`
  - `requested_order` / `requested_after_snapshot`
  - `actual_order` / `actual_after_snapshot`
  - `matched`
  - `missing_urls`
  - `unexpected_urls`
  - `verification`
  - `stabilized`

### Integration in card photo sync
- `sync_card_photos_endpoint(...)` now consumes verification and persists summary into `card.raw_data["media_apply_result"]`.

### Safety fix applied
- In `wb_api.save_card_media_state(...)`, `last_urls` no longer defaults to requested URLs before polling; this prevents false-positive `matched=true` when actual WB state was not observed.

### Verification payload example
```json
{
  "requested_order": ["https://.../1.jpg", "https://.../2.jpg"],
  "actual_order": ["https://.../1.jpg", "https://.../3.jpg"],
  "matched": false,
  "missing_urls": ["https://.../2.jpg"],
  "unexpected_urls": ["https://.../3.jpg"],
  "stabilized": true
}
```

---

## 3.12 Rollback foundation (snapshot history)

### Goal
- Prepare backend state for future rollback endpoint/button.

### What changed
- Added snapshot builder and history append helpers in `cards.py`:
  - `_build_media_apply_snapshot_record(...)`
  - `_append_media_apply_history(...)`
  - `MEDIA_APPLY_HISTORY_LIMIT = 20`

### Stored fields in `card.raw_data`
- `media_apply_result`
- `media_apply_snapshot` (latest)
- `media_apply_history` (bounded)
- `media_apply_last_operation_id`

### Snapshot structure
```json
{
  "operation_id": "uuid",
  "source": "wb_sync_photos",
  "card_id": 123,
  "nm_id": 999999,
  "created_at": "2026-04-09T12:34:56Z",
  "before_snapshot": ["..."],
  "requested_after_snapshot": ["..."],
  "actual_after_snapshot": ["..."],
  "matched": true,
  "stabilized": true,
  "verification": {
    "requested_order": ["..."],
    "actual_order": ["..."],
    "matched": true,
    "missing_urls": [],
    "unexpected_urls": []
  }
}
```

### What is still needed for full rollback
1. Dedicated rollback endpoint (by `operation_id` or latest snapshot).
2. Permission + conflict handling policy (parallel media edits).
3. Retry and post-rollback verification flow.
4. Frontend action contract for selecting snapshot and confirming rollback.

---

## 4) Contract compatibility notes

### Preserved / additive
- Bootstrap old fields preserved; stage fields are additive.
- Promotion `spend_rub` kept; `estimated_spend_rub` added.
- Winner-related fields are additive.
- Media apply return payload enriched; existing success/error keys remain.

### Potential contract-sensitive areas
1. Frontend should start reading new `detail` as object in mapped photo errors.
2. Consumers depending on old implicit winner behavior may need to handle `winner_decision` states.
3. Legacy `card_id=nm_id` fallback remains for compatibility but should be phased out later.

---

## 5) Completed vs partial vs frontend-waiting

### Fully completed backend pieces
1. Finance pagination/retry/throttle.
2. Bootstrap stage model + transitions.
3. Ad cost precision/confidence + lineage fields.
4. Promotion decision semantics + scoring.
5. Photo error mapper integration.
6. Media verification summary + snapshot foundation in card sync flow.

### Partially completed
1. Terminology split of source-specific metrics.
2. Media verification/snapshot usage consistency across all media paths.
3. Rollback operation endpoint.

### Frontend integration expected
1. Render bootstrap `current_stage`, `source_statuses`, `is_partial`.
2. Render ad-cost precision/confidence and lineage.
3. Render `winner_decision` and variant score explanations.
4. Show media verification result and snapshot history.
5. Add rollback trigger UI once endpoint exists.

---

## 6) Current production risks still open

1. Promotion/media paths are not yet uniformly writing/using verification snapshots.
2. Semantic ambiguity in analytics fields can still confuse users for order/sales/payout interpretation.
3. Legacy card-id normalization fallback may hide client-side domain mistakes.
4. Finance pulls are robust now, but there is no persisted checkpoint/resume model for very large jobs.
5. Rollback is not yet executable (foundation only).

---

## 7) Recommended implementation order (next steps)

1. Add explicit source-semantic analytics fields (`funnel_orders`, `advert_attributed_orders`, `finance_realized_sales`, `payout_realized`, `returns`, `buyouts`) while keeping old fields.
2. Propagate media verification + snapshot persistence into all promotion/media apply paths.
3. Implement rollback endpoint on top of `media_apply_history` snapshot model.
4. Add stricter telemetry and audit-trail storage for bootstrap/source retries.
5. Gradually deprecate `card_id=nm_id` fallback after frontend contract migration.

---

## 8) P1 / P2 refactor backlog

## P1
1. Dedicated `photo_apply_service` for one canonical apply/verify/snapshot flow.
2. Explicit analytics semantic field split with aliases.
3. Bootstrap source-level progress metrics (records fetched, retries, ETA hints).
4. Rollback endpoint + guarded apply policy.

## P2
1. Extract dedicated `wb_finance_client` with persisted checkpoint/resume.
2. Move media apply history from `raw_data` JSON into dedicated table.
3. Config-driven winner thresholds and weights (per category/store optional overrides).
4. Deeper integration tests against WB sandbox/real staging credentials.

---

## 9) Test plan matrix (backend)

## 9.1 Finance
1. Simulate multi-page finance payload with increasing `rrd_id` and verify full aggregation.
2. Simulate `204` and empty list terminal behaviors.
3. Simulate non-increasing/invalid `rrd_id` and verify safe stop.
4. Simulate `429` and `5xx` with retry exhaustion and verify `_FinanceFetchError.partial_rows` path.
5. Validate source status mode transitions (`ok`, `partial`, `manual_required`).

## 9.2 Bootstrap
1. Verify stage transitions in task `result` payload.
2. Verify `completed_partial` when finance fails but advert/funnel available.
3. Verify stale-task marking and restart logic.
4. Verify backward payload consumers still receive old fields.

## 9.3 Advert parsing / lineage
1. Parse fullstats variants (list/dict/nested) with null/missing fields.
2. Validate exact vs estimated vs unallocated spend split.
3. Validate anomaly logging for invalid NM rows and zero-total drift.
4. Validate `ad_cost_confidence` and source lineage mapping rules.

## 9.4 Promotion semantics
1. Validate `winner_found` with clear score/CTR delta.
2. Validate `insufficient_data` with low impressions or low variant count.
3. Validate `no_clear_winner` with small score/CTR delta.
4. Validate `test_interrupted` mapping from stopped/failed states.
5. Validate `card_id/nm_id` mismatch errors and legacy fallback behavior.

## 9.5 Photo errors
1. Feed mapper with each known technical pattern and verify normalized payload.
2. Verify router/controller returns mapped detail payload and proper HTTP code.
3. Verify logs still include raw technical cause.

## 9.6 Media verify and rollback foundation
1. Verify `requested_order` vs `actual_order` summary correctness.
2. Verify `matched/missing/unexpected` behavior on partial apply.
3. Verify snapshot record creation in `media_apply_history` with cap limit.
4. Verify `operation_id` generation and latest snapshot replacement semantics.

---

## 10) Final note

Backend has moved from demo-grade behavior to significantly more production-safe behavior in the audited areas. Remaining work is mostly contract clarity (semantics), consistency across all media apply entry points, and operational hardening (rollback endpoint + checkpointed long-running pulls).
