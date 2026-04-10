import { describe, expect, it } from 'vitest';

import type { AdAnalysisItem } from '@/types';

import { buildSkuExportRows } from './export';

function makeItem(overrides: Partial<AdAnalysisItem> = {}): AdAnalysisItem {
  return {
    nm_id: 123456,
    card_id: 11,
    title: 'Test SKU',
    vendor_code: 'V-1',
    photo_url: null,
    wb_link: null,
    workspace_link: null,
    price: 1000,
    card_score: 90,
    status: 'rescue',
    status_label: 'Спасти',
    diagnosis: 'economics',
    diagnosis_label: 'Проблема в экономике',
    status_reason: 'Reason',
    status_hint: 'Hint',
    action_title: 'Action',
    action_description: 'Action desc',
    priority: 'high',
    priority_label: 'Высокий',
    precision: 'mixed',
    precision_label: 'Смешанный',
    revenue_lineage: 'finance',
    orders_lineage: 'funnel',
    decision_ready: false,
    decision_label: 'preliminary',
    source_lineage: {
      advert: 'partial',
      finance: 'automatic',
      funnel: 'partial',
    },
    trend: {
      signal: 'stable',
      label: 'Стабильно',
      summary: 'summary',
      actual_cpo_change: 0,
      net_profit_change: 0,
      profit_delta_change: 0,
      orders_change: 0,
      ctr_change: 0,
      cr_change: 0,
    },
    issue_summary: {
      total: 0,
      critical: 0,
      warnings: 0,
      photos: 0,
      price: 0,
      text: 0,
      docs: 0,
      top_titles: [],
    },
    metrics: {
      revenue: 5010,
      revenue_net: 4980,
      wb_costs: 1200,
      cost_price: 2000,
      gross_profit_before_ads: 1780,
      ad_cost: 900,
      ad_cost_total: 900,
      ad_cost_exact: 600,
      ad_cost_estimated: 300,
      ad_cost_manual: 0,
      ad_cost_source_mode: 'mixed',
      ad_cost_confidence: 'medium',
      net_profit: 880,
      profit_per_order: 176,
      max_cpo: 350,
      actual_cpo: 300,
      profit_delta: 50,
      views: 10000,
      clicks: 200,
      ad_orders: 9,
      ad_gmv: 6000,
      ctr: 2,
      cr: 4.5,
      open_count: 700,
      cart_count: 120,
      order_count: 40,
      buyout_count: 30,
      add_to_cart_percent: 17,
      cart_to_order_percent: 33,
      cpc: 12,
      drr: 18,
      funnel_orders: 40,
      advert_attributed_orders: 9,
      finance_realized_orders: 8,
      payout_realized: 3900,
    },
    spend_sources: {
      exact: 600,
      estimated: 300,
      manual: 0,
    },
    insights: [],
    steps: [],
    risk_flags: [],
    ...overrides,
  };
}

describe('buildSkuExportRows', () => {
  it('includes lineage, confidence and decision fields', () => {
    const row = buildSkuExportRows([makeItem()])[0];

    expect(row['Артикул ВБ']).toBe(123456);
    expect(row['Решение готово']).toBe('Нет');
    expect(row['Decision label']).toBe('preliminary');
    expect(row['Lineage revenue']).toBe('finance');
    expect(row['Lineage orders']).toBe('funnel');
    expect(row['Реклама confidence']).toBe('medium');
    expect(row['Реклама exact, руб']).toBe(600);
    expect(row['Реклама estimated, руб']).toBe(300);
    expect(row['Finance realized orders']).toBe(8);
  });

  it('uses custom status label resolver', () => {
    const row = buildSkuExportRows([makeItem()], () => 'CUSTOM')[0];
    expect(row['Статус']).toBe('CUSTOM');
  });
});
