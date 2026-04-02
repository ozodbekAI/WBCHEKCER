# SKU Economics audit for store 4

- Period: `2026-03-27 — 2026-04-02`
- Store: `string`
- SKU checked: `28`
- Verified OK: `3`
- Verified FAIL: `25`
- Max absolute diff across key metrics: `40911.13`

## Sources
- WB Advert: `ok` — Расходы, клики и заказы подтянуты из WB Advert
- WB Finance: `manual_required` — WB finance error 429: {
    "title": "too many requests",
    "detail": "Limited by global limiter, per seller 7d328b09-6112-495c-9163-bd5db7775a2f; See https://dev.wildberries.ru/openapi/api-information",
    "code": "461a0b83d6bd 2950e93b5fda",
    "requestId": "0d59176d9193043db3aca70d99541ae9",
    "origin": "s2s-api
- WB Funnel: `ok` — Открытия карточки, корзина и заказы подтянуты из WB Analytics

## Manual formula mirror
- `total_orders = max(finance.orders, funnel.order_count, advert.ad_orders)`
- `cost_price = unit_cost * total_orders`
- `gross_profit = revenue - wb_costs - cost_price`
- `net_profit = gross_profit - ad_cost`
- `max_cpo = gross_profit / total_orders` if orders > 0
- `actual_cpo = ad_cost / ad_orders` if ad_orders > 0
- `profit_delta = max_cpo - actual_cpo`

Workbook: `reports/sku_economics_audit_store4_2026-03-27_2026-04-02.xlsx`

## Failed rows
- nmID `463461955`: net `233.93`, max_cpo `233.93`, actual_cpo `0.0`, delta `233.93`
- nmID `463481025`: net `180.43`, max_cpo `60.6`, actual_cpo `0.69`, delta `59.91`
- nmID `463481033`: net `352.19`, max_cpo `352.19`, actual_cpo `0.0`, delta `352.19`
- nmID `463481034`: net `560.39`, max_cpo `560.39`, actual_cpo `0.0`, delta `560.39`
- nmID `463481035`: net `1220.17`, max_cpo `305.04`, actual_cpo `0.0`, delta `305.04`
- nmID `463481037`: net `627.19`, max_cpo `313.59`, actual_cpo `0.0`, delta `313.59`
- nmID `464791224`: net `376.0`, max_cpo `376.0`, actual_cpo `0.0`, delta `376.0`
- nmID `465154530`: net `192.34`, max_cpo `64.37`, actual_cpo `0.8`, delta `63.58`
- nmID `477202839`: net `1244.13`, max_cpo `311.03`, actual_cpo `0.0`, delta `311.03`
- nmID `497837405`: net `1510.17`, max_cpo `503.39`, actual_cpo `0.0`, delta `503.39`
- nmID `497837406`: net `558.15`, max_cpo `279.08`, actual_cpo `0.0`, delta `279.08`
- nmID `501621156`: net `348.82`, max_cpo `348.82`, actual_cpo `0.0`, delta `348.82`
- nmID `524658407`: net `510.89`, max_cpo `255.44`, actual_cpo `0.0`, delta `255.44`
- nmID `527435893`: net `685.48`, max_cpo `342.74`, actual_cpo `0.0`, delta `342.74`
- nmID `530986994`: net `846.68`, max_cpo `282.22`, actual_cpo `0.0`, delta `282.22`
- nmID `552233223`: net `31989.64`, max_cpo `7996.59`, actual_cpo `-1.1`, delta `7997.68`
- nmID `609637964`: net `414.06`, max_cpo `414.07`, actual_cpo `0.01`, delta `414.06`
- nmID `609675234`: net `1467.38`, max_cpo `293.48`, actual_cpo `0.0`, delta `293.48`
- nmID `609675241`: net `1841.86`, max_cpo `920.93`, actual_cpo `0.0`, delta `920.93`
- nmID `618589192`: net `2271.5`, max_cpo `1135.75`, actual_cpo `0.0`, delta `1135.75`