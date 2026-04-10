import type { AdAnalysisItem } from '@/types';

export type SkuExportRow = Record<string, string | number>;

export function buildSkuExportRows(
  items: AdAnalysisItem[],
  getStatusLabel: (item: AdAnalysisItem) => string = (item) => item.status_label,
): SkuExportRow[] {
  return items.map((item) => ({
    'Артикул ВБ': item.nm_id,
    'Артикул поставщика': item.vendor_code || '',
    'Название': item.title || '',
    'Статус': getStatusLabel(item),
    'Решение готово': item.decision_ready ? 'Да' : 'Нет',
    'Decision label': item.decision_label,
    'Lineage revenue': item.revenue_lineage,
    'Lineage orders': item.orders_lineage,
    'Причина': item.status_reason,
    'Действие': item.action_title,
    'Чистая прибыль, руб': Math.round(item.metrics.net_profit),
    'Факт. CPO, руб': Math.round(item.metrics.actual_cpo),
    'Лимит CPO, руб': Math.round(item.metrics.max_cpo),
    'Запас, руб': Math.round(item.metrics.profit_delta),
    'Выручка net, руб': Math.round(item.metrics.revenue_net ?? item.metrics.revenue),
    'Выручка (legacy), руб': Math.round(item.metrics.revenue),
    'Расходы WB, руб': Math.round(item.metrics.wb_costs),
    'Себестоимость, руб': Math.round(item.metrics.cost_price),
    'Прибыль до рекламы, руб': Math.round(item.metrics.gross_profit_before_ads),
    'Реклама total, руб': Math.round(item.metrics.ad_cost),
    'Реклама exact, руб': Math.round(item.metrics.ad_cost_exact ?? 0),
    'Реклама estimated, руб': Math.round(item.metrics.ad_cost_estimated ?? 0),
    'Реклама confidence': item.metrics.ad_cost_confidence,
    'Funnel orders': item.metrics.funnel_orders,
    'Advert attributed orders': item.metrics.advert_attributed_orders,
    'Finance realized orders': item.metrics.finance_realized_orders,
    'Payout realized, руб': Math.round(item.metrics.payout_realized),
  }));
}
