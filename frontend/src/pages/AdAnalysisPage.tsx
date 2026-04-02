import React, { useDeferredValue, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  Camera,
  CircleAlert,
  CircleDollarSign,
  ClipboardList,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Link2,
  Package2,
  RefreshCcw,
  Search,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

import api from '@/api/client';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStore } from '@/contexts/StoreContext';
import { cn } from '@/lib/utils';
import type {
  AdAnalysisCampaign,
  AdAnalysisItem,
  AdAnalysisItemStatus,
  AdAnalysisOverview,
  AdAnalysisPriority,
  AdAnalysisSourceStatus,
  AdAnalysisTrendSignal,
  AdAnalysisUploadResult,
} from '@/types';

type PeriodPreset = '7d' | '14d' | '30d' | '90d' | 'all' | 'custom';
const PERIOD_OPTIONS: Array<{ id: PeriodPreset; label: string }> = [
  { id: '7d', label: '7 дней' },
  { id: '14d', label: '14 дней' },
  { id: '30d', label: '30 дней' },
  { id: '90d', label: '90 дней' },
  { id: 'all', label: 'Весь период' },
];
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
type UploadKind = 'costs' | 'spend' | 'finance';
type ViewMode = 'simple' | 'explanation' | 'analytics';
type DrawerTab = 'action' | 'why' | 'analytics';
type SchedulerStatus = {
  is_running: boolean;
  interval_sec: number;
  last_tick_at: string | null;
  next_tick_at: string | null;
  next_tick_in_sec: number | null;
};

const STATUS_META: Record<AdAnalysisItemStatus, { label: string; tileClass: string; chipClass: string; dotClass: string }> = {
  stop: {
    label: 'Остановить',
    tileClass: 'border-rose-200 bg-rose-50 text-rose-700',
    chipClass: 'border-rose-200 bg-rose-50 text-rose-700',
    dotClass: 'bg-rose-500',
  },
  rescue: {
    label: 'Спасти',
    tileClass: 'border-amber-200 bg-amber-50 text-amber-700',
    chipClass: 'border-amber-200 bg-amber-50 text-amber-700',
    dotClass: 'bg-amber-500',
  },
  control: {
    label: 'Контролировать',
    tileClass: 'border-yellow-200 bg-yellow-50 text-yellow-700',
    chipClass: 'border-yellow-200 bg-yellow-50 text-yellow-700',
    dotClass: 'bg-yellow-500',
  },
  grow: {
    label: 'Растить',
    tileClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    chipClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    dotClass: 'bg-emerald-500',
  },
  low_data: {
    label: 'Нужно добрать',
    tileClass: 'border-slate-200 bg-slate-50 text-slate-700',
    chipClass: 'border-slate-200 bg-slate-50 text-slate-700',
    dotClass: 'bg-slate-500',
  },
};

const SOURCE_MODE_META: Record<AdAnalysisSourceStatus['mode'], string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  partial: 'border-amber-200 bg-amber-50 text-amber-700',
  manual: 'border-sky-200 bg-sky-50 text-sky-700',
  manual_required: 'border-rose-200 bg-rose-50 text-rose-700',
  error: 'border-rose-200 bg-rose-50 text-rose-700',
  empty: 'border-slate-200 bg-slate-50 text-slate-600',
};

const PRIORITY_META: Record<AdAnalysisPriority, { label: string; className: string }> = {
  critical: { label: 'Критично', className: 'border-rose-200 bg-rose-50 text-rose-700' },
  high: { label: 'Высокий', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  medium: { label: 'Средний', className: 'border-yellow-200 bg-yellow-50 text-yellow-700' },
  low: { label: 'Низкий', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
};

const TREND_META: Record<AdAnalysisTrendSignal, { label: string; className: string }> = {
  worsening: { label: 'Ухудшается', className: 'border-rose-200 bg-rose-50 text-rose-700' },
  improving: { label: 'Улучшается', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  stable: { label: 'Стабильно', className: 'border-slate-200 bg-slate-50 text-slate-700' },
  volatile: { label: 'Нестабильно', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  new: { label: 'Новый SKU', className: 'border-sky-200 bg-sky-50 text-sky-700' },
  no_history: { label: 'Без истории', className: 'border-slate-200 bg-slate-50 text-slate-700' },
};

type FileGuide = {
  key: UploadKind;
  title: string;
  shortLabel: string;
  autoFallback: string;
  description: string;
  sourceFrom: string;
  sourceRoutes: string[];
  sourceSteps: string[];
  minimumColumns: string[];
  acceptedHeaders: string[];
  acceptedFormats: string[];
  acceptAsIs: string;
  extraNote: string;
  templateFileName: string;
  templateRows: string[][];
};

const FILE_GUIDES: FileGuide[] = [
  {
    key: 'costs',
    title: 'Себестоимость',
    shortLabel: 'Внутренний файл',
    autoFallback: 'WB не отдает себестоимость, поэтому этот файл нужен почти всегда.',
    description: 'Нужна для реального Net Profit, Max CPO и Profit Delta без приблизительных оценок.',
    sourceFrom: 'Берите из закупки, 1C, Excel закупщика, Google Sheets поставок или любой вашей внутренней таблицы себестоимости.',
    sourceRoutes: [
      'Внутренняя закупка или таблица поставщика',
      '1C / МойСклад / ERP / Excel закупщика',
      'Google Sheets с актуальной ценой за 1 единицу',
    ],
    sourceSteps: [
      'Откройте внутреннюю таблицу закупки или себестоимости.',
      'Оставьте по одной строке на каждый SKU, который продается.',
      'Проверьте, что цена указана за 1 единицу товара, а не за партию.',
      'Заполните Excel-файл и загрузите его сюда.',
    ],
    minimumColumns: ['Артикул ВБ', 'Себестоимость, руб'],
    acceptedHeaders: ['Артикул Поставщика', 'Артикул ВБ', 'себестоимость, руб', 'nm_id', 'vendor_code', 'себестоимость', 'cost', 'unit_cost'],
    acceptedFormats: ['Артикул ВБ + Себестоимость, руб', 'Артикул Поставщика + Себестоимость, руб', 'лучше всего: Артикул Поставщика + Артикул ВБ + Себестоимость, руб'],
    acceptAsIs: 'Лучший шаблон: Артикул Поставщика, Артикул ВБ и Себестоимость, руб. Достаточно одного из идентификаторов SKU плюс себестоимость.',
    extraNote: 'Если себестоимость изменилась после новой поставки, обновите файл, иначе Max CPO будет искажен.',
    templateFileName: 'sku-cost-template.xlsx',
    templateRows: [
      ['Артикул Поставщика', 'Артикул ВБ', 'Себестоимость, руб'],
      ['ART-001', '123456789', '15800'],
    ],
  },
  {
    key: 'spend',
    title: 'Ручное распределение рекламы',
    shortLabel: 'WB реклама / медиаплан',
    autoFallback: 'Нужно только если часть расходов WB не смог привязать к nmID.',
    description: 'Закрывает хвост нераспределенных расходов, когда WB отдал общий spend по кампании, но без точного SKU.',
    sourceFrom: 'Берите из выгрузки рекламы WB, своего медиаплана или вручную распределяйте кампании по nm_id.',
    sourceRoutes: [
      'WB кабинет рекламы -> кампании / статистика -> экспорт',
      'Внутренний медиаплан или таблица маркетолога',
      'Ручная раскладка расходов по SKU, если WB не вернул nmID',
    ],
    sourceSteps: [
      'Откройте статистику рекламы в кабинете WB и выгрузите данные по кампаниям.',
      'Если в выгрузке расход общий, распределите его вручную по SKU.',
      'На одну строку ставьте только один nm_id.',
      'Если знаете, добавьте views, clicks, orders и gmv для более точной аналитики.',
    ],
    minimumColumns: ['nm_id', 'spend'],
    acceptedHeaders: ['nm_id', 'артикул WB', 'spend', 'расход', 'затраты', 'views', 'clicks', 'orders', 'gmv'],
    acceptedFormats: ['nm_id + spend', 'опционально: views, clicks, orders, gmv, title'],
    acceptAsIs: 'Если в вашем экспорте уже есть nm_id и расход, файл можно грузить почти без правок. Остальные метрики опциональны.',
    extraNote: 'Этот файл не заменяет WB рекламу, а только дополняет те расходы, которые API не смог разложить по SKU.',
    templateFileName: 'manual-ad-spend-template.xlsx',
    templateRows: [
      ['nm_id', 'spend', 'views', 'clicks', 'orders', 'gmv', 'title'],
      ['123456789', '5200', '12000', '280', '7', '48600', 'Костюм двойка'],
    ],
  },
  {
    key: 'finance',
    title: 'Финансовый отчет',
    shortLabel: 'WB отчет / fallback',
    autoFallback: 'Нужен, если WB Statistics API недоступен или если хотите сверить цифры вручную.',
    description: 'Помогает получить реальную выручку, выплаты и расходы WB, если автоматический финансовый источник не сработал.',
    sourceFrom: 'Лучший вариант: выгрузка отчета реализации/финансов из кабинета WB. Второй вариант: ваша агрегированная таблица по nm_id.',
    sourceRoutes: [
      'WB кабинет -> Финансы / Отчеты / отчет реализации',
      'Скачайте raw выгрузку за тот же период, что сверху на странице',
      'Если raw отчета нет, соберите свой агрегат по nm_id',
    ],
    sourceSteps: [
      'В кабинете WB откройте раздел финансов или отчетов.',
      'Скачайте отчет реализации за тот же период, который стоит сверху на странице.',
      'Raw выгрузку WB можно загружать как есть: система поймет ключевые поля.',
      'Если raw отчета нет, соберите свой файл с revenue, wb_costs, payout и orders по nm_id.',
    ],
    minimumColumns: ['nm_id', 'revenue'],
    acceptedHeaders: ['nm_id', 'retail_price_withdisc_rub', 'ppvz_for_pay', 'quantity', 'revenue', 'wb_costs', 'payout'],
    acceptedFormats: ['raw WB reportDetailByPeriod export', 'или nm_id + revenue + wb_costs + payout + orders'],
    acceptAsIs: 'Raw отчет реализации WB поддерживается как есть. Если используете свой файл, достаточно nm_id и revenue.',
    extraNote: 'Период финансового файла должен совпадать с периодом анализа, иначе прибыль будет считаться некорректно.',
    templateFileName: 'finance-fallback-template.xlsx',
    templateRows: [
      ['nm_id', 'revenue', 'wb_costs', 'payout', 'orders', 'title'],
      ['123456789', '68400', '21850', '46550', '9', 'Костюм двойка'],
    ],
  },
];

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

function formatPct(value: number) {
  return `${Number.isFinite(value) ? value.toFixed(1) : '0.0'}%`;
}

function formatSignedMoney(value: number) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatMoney(value)}`;
}

function formatSignedPct(value: number) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatPct(value)}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function trendIcon(signal: AdAnalysisTrendSignal) {
  if (signal === 'worsening') return <ArrowUpRight size={14} className="rotate-45" />;
  if (signal === 'improving') return <ArrowDownRight size={14} className="-rotate-45" />;
  return <ArrowRight size={14} />;
}

function fallbackPeriod(days: number) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - (days - 1));
  return {
    period_start: start.toISOString().slice(0, 10),
    period_end: end.toISOString().slice(0, 10),
  };
}

function periodPresetToDays(preset: PeriodPreset) {
  if (preset === '7d') return 7;
  if (preset === '14d') return 14;
  if (preset === '30d') return 30;
  if (preset === '90d') return 90;
  return 14;
}

function defaultCustomRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 29);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function detailMetricLabel(key: keyof AdAnalysisItem['metrics']) {
  switch (key) {
    case 'revenue':
      return 'Выручка';
    case 'wb_costs':
      return 'Расходы WB';
    case 'cost_price':
      return 'Себестоимость';
    case 'gross_profit_before_ads':
      return 'Прибыль до рекламы';
    case 'ad_cost':
      return 'Расход на рекламу';
    case 'net_profit':
      return 'Net Profit';
    case 'profit_per_order':
      return 'Прибыль на заказ';
    case 'max_cpo':
      return 'Max CPO';
    case 'actual_cpo':
      return 'Actual CPO';
    case 'profit_delta':
      return 'Profit Delta';
    case 'views':
      return 'Показы';
    case 'clicks':
      return 'Клики';
    case 'ad_orders':
      return 'Заказы с рекламы';
    case 'ad_gmv':
      return 'GMV рекламы';
    case 'ctr':
      return 'CTR';
    case 'cr':
      return 'CR';
    case 'open_count':
      return 'Открытия карточки';
    case 'cart_count':
      return 'Добавления в корзину';
    case 'order_count':
      return 'Заказы по воронке';
    case 'buyout_count':
      return 'Выкупы';
    case 'add_to_cart_percent':
      return 'Конверсия в корзину';
    case 'cart_to_order_percent':
      return 'Корзина → заказ';
    case 'cpc':
      return 'CPC';
    case 'drr':
      return 'DRR';
    default:
      return key;
  }
}

function renderMetricValue(key: keyof AdAnalysisItem['metrics'], value: number) {
  if (['ctr', 'cr', 'add_to_cart_percent', 'cart_to_order_percent', 'drr'].includes(key)) {
    return formatPct(value);
  }
  if (['views', 'clicks', 'ad_orders', 'open_count', 'cart_count', 'order_count', 'buyout_count'].includes(key)) {
    return Math.round(value).toLocaleString('ru-RU');
  }
  return formatMoney(value);
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function downloadTemplate(fileName: string, rows: string[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet['!cols'] = rows[0]?.map((value, index) => ({
    wch: Math.max(
      String(value || '').length + 4,
      ...rows.slice(1).map((row) => String(row[index] || '').length + 2),
      18,
    ),
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Шаблон');
  const output = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([output], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, fileName);
}

function downloadSkuExport(items: AdAnalysisItem[]) {
  const rows = items.map((item) => ({
    'Артикул ВБ': item.nm_id,
    'Артикул поставщика': item.vendor_code || '',
    'Название': item.title || '',
    'Статус': displayStatusLabel(item),
    'Причина': item.status_reason,
    'Действие': item.action_title,
    'Чистая прибыль, руб': Math.round(item.metrics.net_profit),
    'Факт. CPO, руб': Math.round(item.metrics.actual_cpo),
    'Лимит CPO, руб': Math.round(item.metrics.max_cpo),
    'Запас, руб': Math.round(item.metrics.profit_delta),
    'Выручка, руб': Math.round(item.metrics.revenue),
    'Расходы WB, руб': Math.round(item.metrics.wb_costs),
    'Себестоимость, руб': Math.round(item.metrics.cost_price),
    'Прибыль до рекламы, руб': Math.round(item.metrics.gross_profit_before_ads),
    'Реклама, руб': Math.round(item.metrics.ad_cost),
  }));
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = Object.keys(rows[0] || {
    'Артикул ВБ': '',
    'Артикул поставщика': '',
    'Название': '',
    'Статус': '',
    'Причина': '',
    'Действие': '',
    'Чистая прибыль, руб': '',
    'Факт. CPO, руб': '',
    'Лимит CPO, руб': '',
    'Запас, руб': '',
    'Выручка, руб': '',
    'Расходы WB, руб': '',
    'Себестоимость, руб': '',
    'Прибыль до рекламы, руб': '',
    'Реклама, руб': '',
  }).map((key) => ({
    wch: Math.max(key.length + 3, ...rows.map((row) => String(row[key as keyof typeof row] ?? '').length + 2), 16),
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'SKU');
  const output = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  triggerDownload(
    new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `sku-economics-${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}

function getGuideNeedText(kind: UploadKind, overview: AdAnalysisOverview | null) {
  if (!overview) return 'Можно подготовить файл заранее и загрузить его сразу после появления данных.';
  if (kind === 'costs') {
    return overview.upload_needs.missing_costs_count
      ? `Сейчас не хватает для ${overview.upload_needs.missing_costs_count} SKU. Без него прибыль и Max CPO будут приблизительными.`
      : 'Себестоимость уже можно обновлять или догружать для новых SKU.';
  }
  if (kind === 'spend') {
    return overview.upload_needs.needs_manual_spend
      ? 'Сейчас нужен для хвоста, который WB не смог привязать к nmID.'
      : 'Пока необязательно: WB уже отдал точную или оценочную разбивку расходов.';
  }
  return overview.upload_needs.needs_manual_finance
    ? 'Сейчас нужен, потому что финансовый источник WB недоступен или неполный.'
    : 'Можно использовать как fallback или для ручной сверки с цифрами WB API.';
}

function getGuideState(kind: UploadKind, overview: AdAnalysisOverview | null): 'required' | 'optional' | 'ready' {
  if (!overview) return 'optional';
  if (kind === 'costs') return overview.upload_needs.missing_costs_count > 0 ? 'required' : 'ready';
  if (kind === 'spend') return overview.upload_needs.needs_manual_spend ? 'required' : 'optional';
  return overview.upload_needs.needs_manual_finance ? 'required' : 'optional';
}

function getGuideStateMeta(kind: UploadKind, overview: AdAnalysisOverview | null) {
  const state = getGuideState(kind, overview);
  if (state === 'required') {
    return {
      label: 'Нужно сейчас',
      className: 'border-rose-200 bg-rose-50 text-rose-700',
    };
  }
  if (state === 'ready') {
    return {
      label: 'Закрыто',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    };
  }
  return {
    label: 'Опционально',
    className: 'border-slate-200 bg-slate-50 text-slate-700',
  };
}

function getGuideLiveHint(kind: UploadKind, overview: AdAnalysisOverview | null) {
  if (!overview) return 'Снимок появится после первой загрузки данных.';
  if (kind === 'costs') {
    if (overview.upload_needs.missing_costs_count <= 0) {
      return 'По текущему периоду себестоимость уже закрыта. Можно только обновить новые SKU.';
    }
    const preview = overview.upload_needs.missing_cost_nm_ids.slice(0, 5).join(', ');
    return preview
      ? `Не хватает для ${overview.upload_needs.missing_costs_count} SKU. Например: ${preview}.`
      : `Не хватает для ${overview.upload_needs.missing_costs_count} SKU.`
  }
  if (kind === 'spend') {
    return overview.upload_needs.needs_manual_spend
      ? `Сейчас нераспределено ${formatMoney(overview.unallocated_spend)}. Этот файл закроет хвост расходов без nmID.`
      : 'WB уже разложил расходы по SKU достаточно хорошо, ручной файл не обязателен.';
  }
  return overview.upload_needs.needs_manual_finance
    ? `За период ${overview.period_start} - ${overview.period_end} автоматический финансовый слой неполный.`
    : 'Финансы WB доступны. Этот файл нужен только как резервный сценарий или сверка.';
}

function getSourceModeLabel(mode: AdAnalysisSourceStatus['mode']) {
  switch (mode) {
    case 'ok':
      return 'Загружено';
    case 'partial':
      return 'Частично';
    case 'manual':
      return 'Есть файл';
    case 'manual_required':
      return 'Нужен файл';
    case 'error':
      return 'Ошибка';
    case 'empty':
    default:
      return 'Не загружали';
  }
}

function getViewModeCopy(mode: ViewMode) {
  if (mode === 'simple') {
    return {
      title: 'Обзор',
      description: 'Сначала действие, потом ключевые SKU.',
    };
  }
  if (mode === 'explanation') {
    return {
      title: 'Источники',
      description: 'Что уже есть в backend и какой файл еще нужен.',
    };
  }
  return {
    title: 'Excel',
    description: 'Только таблица, фильтры и экспорт.',
  };
}

function priorityWeight(priority: AdAnalysisPriority) {
  switch (priority) {
    case 'critical':
      return 4;
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
    default:
      return 1;
  }
}

function statusWeight(status: AdAnalysisItemStatus) {
  switch (status) {
    case 'stop':
      return 5;
    case 'rescue':
      return 4;
    case 'control':
      return 3;
    case 'grow':
      return 2;
    case 'low_data':
    default:
      return 1;
  }
}

function formatSchedulerHint(status: SchedulerStatus | null) {
  if (!status) return 'Статус фоновой синхронизации не получен.';
  if (!status.is_running) return 'Фоновый сбор сейчас остановлен.';
  if (status.next_tick_in_sec == null) return 'Фоновый сбор активен.';
  const mins = Math.max(Math.round(status.next_tick_in_sec / 60), 0);
  return mins > 0 ? `Следующий фоновый цикл примерно через ${mins} мин.` : 'Следующий фоновый цикл ожидается скоро.';
}

function expectedResultText(status: AdAnalysisItemStatus) {
  if (status === 'stop') return 'Прекращение прямых потерь';
  if (status === 'rescue') return 'Снижение CPO и возврат в безопасную зону';
  if (status === 'grow') return 'Рост оборота без потери прибыли';
  if (status === 'control') return 'Стабильный контроль и сохранение маржи';
  return 'Появление достоверной статистики для решения';
}

function lowDataKind(item: AdAnalysisItem) {
  if (item.status !== 'low_data') return 'ready';
  const text = `${item.action_title} ${item.status_reason} ${item.status_hint} ${item.diagnosis}`.toLowerCase();
  if (item.diagnosis === 'data' || /себестоим|финанс|недостающ|загруз/.test(text)) return 'inputs';
  if (/тест|реклам/.test(text) && /нет|пока/.test(text)) return 'test';
  return 'stats';
}

function displayStatusLabel(item: AdAnalysisItem) {
  if (item.status !== 'low_data') return item.status_label;
  const kind = lowDataKind(item);
  if (kind === 'inputs') return 'Не хватает данных';
  if (kind === 'test') return 'Нет рекламного теста';
  return 'Мало статистики';
}

function drawerStatusHeading(item: AdAnalysisItem) {
  return displayStatusLabel(item);
}

function drawerActionHeading(item: AdAnalysisItem) {
  if (item.status === 'low_data') {
    const kind = lowDataKind(item);
    if (kind === 'inputs') return 'Сначала загрузите недостающие данные';
    if (kind === 'test') return 'Сначала дайте SKU рекламный тест';
    return 'Нужно еще немного статистики';
  }
  return item.action_title;
}

function drawerActionHint(item: AdAnalysisItem) {
  return item.action_description;
}

function drawerProblemHeading(item: AdAnalysisItem) {
  const label = item.diagnosis_label.trim();
  if (!label) return 'Причина';
  if (/^проблем/i.test(label)) return label;
  if (/^данн/i.test(label)) return 'Проблема в данных';
  return `Проблема в ${label.toLowerCase()}`;
}

function drawerProblemReason(item: AdAnalysisItem) {
  return item.status_reason;
}

function drawerProblemHint(item: AdAnalysisItem) {
  return item.status_hint;
}

export default function AdAnalysisPage() {
  const navigate = useNavigate();
  const { activeStore } = useStore();
  const initialCustomRange = defaultCustomRange();

  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all');
  const [customPeriodStart, setCustomPeriodStart] = useState<string>(initialCustomRange.start);
  const [customPeriodEnd, setCustomPeriodEnd] = useState<string>(initialCustomRange.end);
  const [viewMode, setViewMode] = useState<ViewMode>('simple');
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [overview, setOverview] = useState<AdAnalysisOverview | null>(null);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<AdAnalysisItemStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [selectedItem, setSelectedItem] = useState<AdAnalysisItem | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('action');
  const [uploading, setUploading] = useState<UploadKind | null>(null);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [lastUploadResult, setLastUploadResult] = useState<{ kind: UploadKind; result: AdAnalysisUploadResult } | null>(null);
  const [showTableDetails, setShowTableDetails] = useState(false);

  const deferredSearch = useDeferredValue(search);
  const costsInputRef = useRef<HTMLInputElement>(null);
  const spendInputRef = useRef<HTMLInputElement>(null);
  const financeInputRef = useRef<HTMLInputElement>(null);
  const autoBootstrapStoreRef = useRef<number | null>(null);

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const loadOverview = async (force = false) => {
    if (!activeStore) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.getAdAnalysisOverview(activeStore.id, {
        days: periodPreset === 'custom' ? undefined : periodPresetToDays(periodPreset),
        preset: periodPreset,
        period_start: periodPreset === 'custom' ? customPeriodStart : undefined,
        period_end: periodPreset === 'custom' ? customPeriodEnd : undefined,
        page,
        page_size: pageSize,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        search: deferredSearch.trim() || undefined,
        force,
      });
      setOverview(data);
      if (selectedItem) {
        const pooledItems = [...data.items, ...data.critical_preview, ...data.growth_preview];
        const fresh = pooledItems.find((item) => item.nm_id === selectedItem.nm_id) || null;
        setSelectedItem(fresh);
      }
      if (force) {
        try {
          const freshSchedulerStatus = await api.getSchedulerStatus();
          setSchedulerStatus(freshSchedulerStatus);
        } catch {
          // scheduler hint is optional here
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось загрузить SKU economics';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!activeStore) return;
    void loadOverview(false);
  }, [
    activeStore?.id,
    periodPreset,
    customPeriodStart,
    customPeriodEnd,
    page,
    pageSize,
    statusFilter,
    deferredSearch,
  ]);

  useEffect(() => {
    autoBootstrapStoreRef.current = null;
  }, [activeStore?.id]);

  useEffect(() => {
    let cancelled = false;
    if (!activeStore) return;
    void api.getSchedulerStatus()
      .then((status) => {
        if (!cancelled) setSchedulerStatus(status);
      })
      .catch(() => {
        if (!cancelled) setSchedulerStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeStore?.id]);

  useEffect(() => {
    if (!activeStore || !overview || loading || bootstrapping) return;
    const hasArchive = Boolean(overview.available_period_start && overview.available_period_end);
    if (overview.snapshot_ready || hasArchive) return;
    if (autoBootstrapStoreRef.current === activeStore.id) return;
    autoBootstrapStoreRef.current = activeStore.id;
    setBootstrapping(true);
    void loadOverview(true).finally(() => setBootstrapping(false));
  }, [activeStore, overview, loading, bootstrapping]);

  useEffect(() => {
    setPage(1);
  }, [periodPreset, customPeriodStart, customPeriodEnd, statusFilter, deferredSearch, pageSize]);

  const currentPeriod = overview
    ? { period_start: overview.period_start, period_end: overview.period_end }
    : periodPreset === 'custom'
      ? { period_start: customPeriodStart, period_end: customPeriodEnd }
      : fallbackPeriod(periodPresetToDays(periodPreset));

  const items = overview?.items || [];
  const snapshotReady = Boolean(overview?.snapshot_ready);
  const hasOverviewData = snapshotReady && Boolean((overview?.total_skus || 0) > 0);
  const filteredItems = items;
  const criticalList = overview?.critical_preview || [];
  const growthList = overview?.growth_preview || [];
  const costGuide = FILE_GUIDES.find((guide) => guide.key === 'costs')!;
  const worseningList = filteredItems.filter((item) => item.trend.signal === 'worsening').slice(0, 5);
  const improvingList = filteredItems.filter((item) => item.trend.signal === 'improving').slice(0, 5);
  const topProblemItems = (criticalList.length ? criticalList : filteredItems)
    .filter((item) => item.status !== 'grow')
    .slice(0, 5);
  const requiredUploadKinds: UploadKind[] = overview
    ? [
        ...(overview.upload_needs.missing_costs_count > 0 ? (['costs'] as const) : []),
        ...(overview.upload_needs.needs_manual_spend ? (['spend'] as const) : []),
        ...(overview.upload_needs.needs_manual_finance ? (['finance'] as const) : []),
      ]
    : [];
  const isSimpleMode = viewMode === 'simple';
  const isExplanationMode = viewMode === 'explanation';
  const isAnalyticsMode = viewMode === 'analytics';
  const shouldShowManualFiles = Boolean(lastUploadResult || requiredUploadKinds.length > 0 || isAnalyticsMode);
  const readySourceCount = overview?.source_statuses.filter((source) => source.mode === 'ok' || source.mode === 'manual' || source.mode === 'partial').length || 0;
  const attentionSourceCount = overview?.source_statuses.filter((source) => source.mode === 'error' || source.mode === 'manual_required').length || 0;
  const nextAction = (() => {
    if (!overview) return null;
    if (overview.upload_needs.missing_costs_count > 0) {
      return {
        tone: 'border-amber-200 bg-amber-50 text-amber-900',
        eyebrow: 'Шаг 1',
        title: `Сначала загрузите себестоимость для ${overview.upload_needs.missing_costs_count} SKU`,
        description: 'Без себестоимости система будет показывать приблизительный Net Profit и Max CPO. Это первый обязательный шаг.',
        actionLabel: 'Загрузить себестоимость',
        action: () => triggerUpload('costs'),
        sectionId: 'step-files',
      };
    }
    if (overview.upload_needs.needs_manual_finance) {
      return {
        tone: 'border-sky-200 bg-sky-50 text-sky-900',
        eyebrow: 'Шаг 1',
        title: 'Добавьте финансовый файл за выбранный период',
        description: 'WB не отдал достаточный финансовый слой. Без него итоговая прибыль будет недостоверной.',
        actionLabel: 'Загрузить финансы',
        action: () => triggerUpload('finance'),
        sectionId: 'step-files',
      };
    }
    if (overview.upload_needs.needs_manual_spend) {
      return {
        tone: 'border-amber-200 bg-amber-50 text-amber-900',
        eyebrow: 'Шаг 2',
        title: `Разнесите остаток расходов: ${formatMoney(overview.unallocated_spend)}`,
        description: 'WB не привязал часть spend к nmID. Если загрузить ручное распределение, вывод станет точнее.',
        actionLabel: 'Загрузить распределение',
        action: () => triggerUpload('spend'),
        sectionId: 'step-files',
      };
    }
    if (topProblemItems[0]) {
      return {
        tone: 'border-rose-200 bg-rose-50 text-rose-900',
        eyebrow: 'Шаг 3',
        title: `Разберите самый срочный SKU: ${topProblemItems[0].title || `nmID ${topProblemItems[0].nm_id}`}`,
        description: topProblemItems[0].action_title,
        actionLabel: 'Открыть SKU',
        action: () => {
          setDrawerTab('action');
          setSelectedItem(topProblemItems[0]);
        },
        sectionId: 'step-actions',
      };
    }
    return {
      tone: 'border-emerald-200 bg-emerald-50 text-emerald-900',
      eyebrow: 'Готово',
      title: 'Данные собраны. Можно переходить к решениям по SKU.',
      description: 'Откройте список SKU ниже и идите по статусам: остановить, спасти, контролировать или растить.',
      actionLabel: 'Перейти к SKU',
      action: () => scrollToSection('step-skus'),
      sectionId: 'step-skus',
    };
  })();
  const modeCopy = getViewModeCopy(viewMode);
  const headlineAlert = overview?.alerts.find((alert) => alert.level === 'warning' || alert.level === 'error') || overview?.alerts[0] || null;
  const summarySubtitle = overview
    ? `${overview.total_skus} SKU · ${attentionSourceCount > 0 ? 'смешанные источники' : 'все источники'} · период ${overview.period_start} — ${overview.period_end}${overview.available_period_start && overview.available_period_end ? ` · архив ${overview.available_period_start} — ${overview.available_period_end}` : ''} · снимок ${formatDateTime(overview.generated_at)}`
    : '';

  const triggerUpload = (kind: UploadKind) => {
    if (kind === 'costs') costsInputRef.current?.click();
    if (kind === 'spend') spendInputRef.current?.click();
    if (kind === 'finance') financeInputRef.current?.click();
  };

  const handleUpload = async (kind: UploadKind, file?: File | null) => {
    if (!activeStore || !file) return;
    setUploading(kind);
    try {
      const result =
        kind === 'costs'
          ? await api.uploadAdAnalysisCosts(activeStore.id, file)
          : kind === 'spend'
            ? await api.uploadAdAnalysisManualSpend(activeStore.id, file, currentPeriod.period_start, currentPeriod.period_end)
            : await api.uploadAdAnalysisFinance(activeStore.id, file, currentPeriod.period_start, currentPeriod.period_end);
      setLastUploadResult({ kind, result });
      toast(`${result.imported + result.updated} строк обработано.`);
      (result.notes || []).forEach((note) => {
        if (note) toast(note);
      });
      if (result.unresolved_count > 0) {
        toast.error(`Осталось ${result.unresolved_count} несопоставленных строк. Ниже показан превью проблемных строк.`);
      }
      await loadOverview(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#fafaf8]">
      <input
        ref={costsInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          void handleUpload('costs', e.target.files?.[0]);
          e.currentTarget.value = '';
        }}
      />
      <input
        ref={spendInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          void handleUpload('spend', e.target.files?.[0]);
          e.currentTarget.value = '';
        }}
      />
      <input
        ref={financeInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          void handleUpload('finance', e.target.files?.[0]);
          e.currentTarget.value = '';
        }}
      />

      <header className="sticky top-0 z-40 border-b border-black/5 bg-white/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/workspace')}>
              <ArrowLeft size={20} />
            </Button>
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <BarChart3 size={18} />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">SKU Economics</p>
              <h1 className="text-base font-semibold text-foreground">Анализ рекламных кампаний WB</h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-2xl border border-black/5 bg-white px-3 py-2 lg:flex">
              <span className="text-xs text-muted-foreground">Период</span>
              <select
                value={periodPreset}
                onChange={(e) => setPeriodPreset(e.target.value as PeriodPreset)}
                className="h-8 rounded-xl border border-black/10 bg-white px-2.5 text-sm"
              >
                {PERIOD_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
                <option value="custom">Свой период</option>
              </select>
            </div>
            {periodPreset === 'custom' && (
              <div className="hidden items-center gap-2 rounded-2xl border border-black/5 bg-white px-3 py-2 lg:flex">
                <Input
                  type="date"
                  value={customPeriodStart}
                  onChange={(e) => setCustomPeriodStart(e.target.value)}
                  className="h-8 w-[138px] rounded-xl border-black/10 px-3 text-xs"
                />
                <span className="text-xs text-muted-foreground">—</span>
                <Input
                  type="date"
                  value={customPeriodEnd}
                  onChange={(e) => setCustomPeriodEnd(e.target.value)}
                  className="h-8 w-[138px] rounded-xl border-black/10 px-3 text-xs"
                />
              </div>
            )}
            <Button variant="outline" className="gap-2 text-sm" onClick={() => void loadOverview(true)} disabled={loading}>
              <RefreshCcw size={14} className={cn(loading && 'animate-spin')} />
              Обновить данные
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
        {!activeStore && (
          <div className="rounded-[28px] border border-black/5 bg-white p-8 text-center shadow-[0_20px_60px_rgba(15,23,42,0.05)]">
            <p className="text-lg font-semibold">Магазин не выбран</p>
            <p className="mt-2 text-sm text-muted-foreground">Выберите магазин в рабочем пространстве, чтобы увидеть экономику SKU.</p>
          </div>
        )}

        {activeStore && (
          <div className="space-y-6">
            {error && (
              <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
                {error}
              </div>
            )}

            {!hasOverviewData && overview?.snapshot_ready && overview.alerts.length > 0 && (
              <div className="space-y-3">
                {overview.alerts.map((alert, index) => (
                  <div
                    key={`${alert.title}-${index}`}
                    className={cn(
                      'rounded-[24px] border px-5 py-4 shadow-sm',
                      alert.level === 'error' && 'border-rose-200 bg-rose-50',
                      alert.level === 'warning' && 'border-amber-200 bg-amber-50',
                      alert.level === 'success' && 'border-emerald-200 bg-emerald-50',
                      alert.level === 'info' && 'border-sky-200 bg-sky-50',
                    )}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold">{alert.title}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{alert.description}</p>
                      </div>
                      {alert.action && (
                        <Button
                          variant="outline"
                          className="gap-2 rounded-2xl"
                          onClick={() => {
                            const action = alert.action.toLowerCase();
                            if (action.includes('обнов')) void loadOverview(true);
                            else if (action.includes('себестоимость')) triggerUpload('costs');
                            else if (action.includes('финансов')) triggerUpload('finance');
                            else triggerUpload('spend');
                          }}
                        >
                          <Upload size={14} />
                          {alert.action}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!hasOverviewData ? (
              <EmptyAnalysisState
                overview={overview}
                loading={loading}
                bootstrapping={bootstrapping}
                uploading={uploading}
                lastUploadResult={lastUploadResult}
                onReload={() => void loadOverview(true)}
                onUpload={triggerUpload}
              />
            ) : (
              <>
                <section className="rounded-[20px] border border-black/5 bg-white px-4 py-4 shadow-[0_8px_24px_rgba(15,23,42,0.03)]">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold leading-tight text-foreground">Что делать сейчас</h2>
                      <p className="mt-1 text-xs text-muted-foreground">{summarySubtitle}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="ghost" className="h-9 gap-2 rounded-xl text-sm" onClick={() => downloadSkuExport(filteredItems.length ? filteredItems : items)}>
                        <Download size={15} />
                        Скачать Excel
                      </Button>
                      <Button variant="ghost" className="h-9 gap-2 rounded-xl text-sm" onClick={() => void loadOverview(true)}>
                        <RefreshCcw size={15} className={cn(loading && 'animate-spin')} />
                        Обновить данные
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-7">
                    <OverviewMetricCard label="SKU всего" value={String(overview.total_skus)} />
                    <OverviewMetricCard label="Прибыльные" value={String(overview.profitable_count)} accent="text-emerald-600" />
                    <OverviewMetricCard label="Проблемные" value={String(overview.problematic_count)} accent="text-amber-600" />
                    <OverviewMetricCard label="Убыточные" value={String(overview.loss_count)} accent="text-rose-600" />
                    <OverviewMetricCard label="Выручка" value={formatMoney(overview.total_revenue)} large />
                    <OverviewMetricCard label="Реклама" value={formatMoney(overview.total_ad_spend)} large />
                    <OverviewMetricCard label="Чистая прибыль" value={formatMoney(overview.total_net_profit)} accent={overview.total_net_profit >= 0 ? 'text-emerald-600' : 'text-rose-600'} large />
                  </div>

                  <div className="mt-3 flex flex-col gap-3 rounded-[16px] border border-black/5 bg-slate-50/70 px-3 py-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Режим экрана</p>
                      <p className="mt-1 text-xs text-muted-foreground">{modeCopy.description}</p>
                    </div>
                    <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as ViewMode)} className="w-full xl:w-auto">
                      <TabsList className="grid h-auto w-full grid-cols-3 rounded-xl bg-white p-1 xl:w-[300px]">
                        <TabsTrigger value="simple" className="rounded-lg px-2.5 py-1.5 text-xs data-[state=active]:bg-foreground data-[state=active]:text-background">Обзор</TabsTrigger>
                        <TabsTrigger value="explanation" className="rounded-lg px-2.5 py-1.5 text-xs data-[state=active]:bg-foreground data-[state=active]:text-background">Источники</TabsTrigger>
                        <TabsTrigger value="analytics" className="rounded-lg px-2.5 py-1.5 text-xs data-[state=active]:bg-foreground data-[state=active]:text-background">Excel</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>

                  {overview.main_takeaway && (
                    <div className="mt-3 rounded-[16px] border border-black/5 bg-slate-50/60 px-4 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Главный вывод</p>
                      <p className="mt-1.5 text-[13px] leading-5 text-foreground">{overview.main_takeaway}</p>
                    </div>
                  )}

                  {headlineAlert && (
                    <div className="mt-3 rounded-[16px] border border-amber-200 bg-amber-50/75 px-4 py-3 text-amber-900">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex items-start gap-3">
                          <CircleAlert size={18} className="mt-0.5 text-amber-500" />
                          <div>
                            <p className="text-sm font-semibold">{headlineAlert.title}</p>
                            <p className="mt-1 text-[13px] leading-5">{headlineAlert.description}</p>
                            {overview.upload_needs.missing_costs_count > 0 && (
                              <p className="mt-2 text-xs leading-5 text-amber-800/80">
                                Подготовьте Excel с тремя колонками: Артикул поставщика, Артикул ВБ и Себестоимость, руб.
                              </p>
                            )}
                          </div>
                        </div>
                        {overview.upload_needs.missing_costs_count > 0 && (
                          <div className="flex flex-col gap-2 sm:min-w-[230px]">
                            <Button
                              variant="outline"
                              className="gap-2 rounded-2xl border-amber-300 bg-white/80 text-amber-900 hover:bg-white"
                              onClick={() => downloadTemplate(costGuide.templateFileName, costGuide.templateRows)}
                            >
                              <Download size={14} />
                              Скачать шаблон Excel
                            </Button>
                            <Button
                              className="gap-2 rounded-2xl bg-amber-900 text-white hover:bg-amber-950"
                              onClick={() => triggerUpload('costs')}
                              disabled={uploading === 'costs'}
                            >
                              {uploading === 'costs' ? <RefreshCcw size={14} className="animate-spin" /> : <Upload size={14} />}
                              {uploading === 'costs' ? 'Загружаем...' : 'Загрузить себестоимость'}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                    <StatusTile status="stop" count={overview.status_counts.stop || 0} active={statusFilter === 'stop'} onClick={() => setStatusFilter('stop')} />
                    <StatusTile status="rescue" count={overview.status_counts.rescue || 0} active={statusFilter === 'rescue'} onClick={() => setStatusFilter('rescue')} />
                    <StatusTile status="control" count={overview.status_counts.control || 0} active={statusFilter === 'control'} onClick={() => setStatusFilter('control')} />
                    <StatusTile status="grow" count={overview.status_counts.grow || 0} active={statusFilter === 'grow'} onClick={() => setStatusFilter('grow')} />
                    <StatusTile status="low_data" count={overview.status_counts.low_data || 0} active={statusFilter === 'low_data'} onClick={() => setStatusFilter('low_data')} />
                  </div>

                  {overview.budget_moves.length > 0 && (
                    <div className="mt-4 rounded-[16px] border border-black/5 bg-slate-50/55 px-4 py-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                          <Link2 size={15} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">Перераспределение бюджета</p>
                          <p className="mt-1 text-[13px] text-muted-foreground">
                            Остановив убыточные SKU, можно освободить {formatMoney(overview.budget_moves.reduce((sum, move) => sum + move.from_amount, 0))} и направить на рост:
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {overview.budget_moves.slice(0, 6).map((move, index) => (
                              <span key={`${move.from_nm_id}-${move.to_nm_id}-${index}`} className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">
                                {move.to_title} → +{move.uplift_percent || 10}%
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </section>

                {isSimpleMode && (
                  <section id="step-next">
                    <NextActionCard
                      nextAction={nextAction}
                      schedulerStatus={schedulerStatus}
                      generatedAt={overview.generated_at}
                      onOpenSection={scrollToSection}
                    />
                  </section>
                )}

                {isExplanationMode && (
                  <section id="step-sources" className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                    <SourceHealthCard overview={overview} schedulerStatus={schedulerStatus} viewMode={viewMode} />
                    <div className="grid gap-4">
                      <NextActionCard
                        nextAction={nextAction}
                        schedulerStatus={schedulerStatus}
                        generatedAt={overview.generated_at}
                        onOpenSection={scrollToSection}
                      />
                    </div>
                  </section>
                )}

                {isExplanationMode && (
                  <section className="grid gap-4 xl:grid-cols-2">
                    <TrendColumn
                      title="Что ухудшается прямо сейчас"
                      subtitle="Ранние сигналы до перехода в убыток"
                      items={worseningList}
                      emptyText="Сейчас нет SKU с явным ухудшением."
                      onOpen={(item) => setSelectedItem(item)}
                      tone="rose"
                    />
                    <TrendColumn
                      title="Что начинает расти"
                      subtitle="SKU с положительной динамикой и запасом"
                      items={improvingList}
                      emptyText="Пока нет SKU с заметным позитивным трендом."
                      onOpen={(item) => setSelectedItem(item)}
                      tone="emerald"
                    />
                  </section>
                )}

                {isSimpleMode && (
                  <section id="step-actions" className="grid gap-4 xl:grid-cols-2">
                    <SummaryColumn
                      title="Критичные проблемы"
                      subtitle="Где товар уходит в минус или близок к нему"
                      icon={<TrendingDown size={18} />}
                      items={criticalList.length ? criticalList : topProblemItems.slice(0, 4)}
                      emptyText="Сейчас нет критичных SKU."
                      onOpen={(item) => {
                        setSelectedItem(item);
                      }}
                    />
                    <SummaryColumn
                      title="Возможности роста"
                      subtitle="Где можно аккуратно увеличивать бюджет"
                      icon={<TrendingUp size={18} />}
                      items={growthList}
                      emptyText="Пока нет явных SKU для роста."
                      onOpen={(item) => {
                        setSelectedItem(item);
                      }}
                    />
                  </section>
                )}

                {isAnalyticsMode && overview.campaigns.length > 0 && (
                  <section className="rounded-[28px] border border-black/5 bg-white p-5 shadow-[0_24px_64px_rgba(15,23,42,0.06)]">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Кампании</p>
                        <h3 className="mt-2 text-xl font-semibold">Как реклама связана со SKU</h3>
                        <p className="mt-1 text-sm text-muted-foreground">Здесь видно advert_id, расход, GMV, DRR и точность привязки к SKU.</p>
                      </div>
                      <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
                        кампаний: {overview.campaigns.length}
                      </Badge>
                    </div>
                    <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                      {overview.campaigns.slice(0, 9).map((campaign) => (
                        <CampaignCard key={`${campaign.advert_id || campaign.title}`} campaign={campaign} />
                      ))}
                    </div>
                  </section>
                )}

                {isAnalyticsMode && (
                <section id="step-skus" className="rounded-[20px] border border-black/5 bg-white px-4 py-4 shadow-[0_8px_24px_rgba(15,23,42,0.03)]">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                      <div className="relative w-full max-w-[280px]">
                        <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Поиск по nmID, артикулу, названию"
                          className="h-9 rounded-xl border-black/10 pl-10 text-sm"
                        />
                      </div>
                      <div className="flex items-center gap-2 rounded-xl border border-black/5 bg-slate-50 px-3 py-2 text-[11px]">
                        <span className="text-muted-foreground">Период:</span>
                        <span className="font-medium">
                          {overview.period_start} — {overview.period_end}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 rounded-xl border border-black/5 bg-slate-50 px-3 py-2 text-[11px]">
                        <span className="text-muted-foreground">Записей:</span>
                        <span className="font-medium">{overview.total_items}</span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 xl:items-end">
                      <div className="flex flex-wrap gap-2">
                        <FilterChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>Все</FilterChip>
                        <FilterChip active={statusFilter === 'stop'} onClick={() => setStatusFilter('stop')}>Остановить</FilterChip>
                        <FilterChip active={statusFilter === 'rescue'} onClick={() => setStatusFilter('rescue')}>Спасти</FilterChip>
                        <FilterChip active={statusFilter === 'control'} onClick={() => setStatusFilter('control')}>Контролировать</FilterChip>
                        <FilterChip active={statusFilter === 'grow'} onClick={() => setStatusFilter('grow')}>Растить</FilterChip>
                        <FilterChip active={statusFilter === 'low_data'} onClick={() => setStatusFilter('low_data')}>Нужно добрать</FilterChip>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">На странице</span>
                        <select
                          value={String(pageSize)}
                          onChange={(e) => setPageSize(Number(e.target.value))}
                          className="h-9 rounded-xl border border-black/10 bg-white px-3 text-xs"
                        >
                          {PAGE_SIZE_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {filteredItems.length === 0 ? (
                    <div className="mt-4 rounded-[24px] border border-dashed border-black/10 bg-slate-50 px-6 py-10 text-center">
                      <p className="text-lg font-semibold">SKU не найдены</p>
                      <p className="mt-2 text-sm text-muted-foreground">Попробуйте снять фильтр или изменить поисковый запрос.</p>
                    </div>
                  ) : isAnalyticsMode ? (
                    <SkuTable
                      items={filteredItems}
                      showDetails={showTableDetails}
                      onOpen={(item) => {
                        setSelectedItem(item);
                      }}
                    />
                  ) : (
                    <div className="mt-4 grid gap-4">
                      {filteredItems.map((item) => (
                        <SkuCard
                          key={`sku-card-${item.nm_id}`}
                          item={item}
                          mode={viewMode}
                          onOpen={() => {
                            setDrawerTab('action');
                            setSelectedItem(item);
                          }}
                          onOpenWhy={() => {
                            setDrawerTab('why');
                            setSelectedItem(item);
                          }}
                          onOpenAnalytics={() => {
                            setDrawerTab('analytics');
                            setSelectedItem(item);
                          }}
                        />
                      ))}
                    </div>
                  )}

                  <div className="mt-4 flex justify-center">
                    <Button variant="ghost" className="rounded-xl text-xs" onClick={() => setShowTableDetails((prev) => !prev)}>
                      {showTableDetails ? 'Скрыть детали' : 'Показать детали'}
                    </Button>
                  </div>

                  {overview.total_pages > 1 && (
                    <div className="mt-5 flex flex-col gap-3 border-t border-black/5 pt-5 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-muted-foreground">
                        Страница {overview.page} из {overview.total_pages}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-xl"
                          disabled={overview.page <= 1 || loading}
                          onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                        >
                          Назад
                        </Button>
                        <div className="rounded-xl border border-black/10 bg-slate-50 px-3 py-2 text-sm">
                          {overview.page}/{overview.total_pages}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-xl"
                          disabled={overview.page >= overview.total_pages || loading}
                          onClick={() => setPage((prev) => prev + 1)}
                        >
                          Дальше
                        </Button>
                      </div>
                    </div>
                  )}
                </section>
                )}

                {isAnalyticsMode && <MetricsHelpCard />}

                {isExplanationMode && shouldShowManualFiles && (
                  <section id="step-files" className="space-y-4 rounded-[28px] border border-black/5 bg-white p-5 shadow-[0_20px_60px_rgba(15,23,42,0.05)]">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Ручные файлы</p>
                      <h3 className="mt-2 text-lg font-semibold">Файлы, которые могут понадобиться</h3>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-3">
                      {FILE_GUIDES.map((guide) => (
                        <UploadGuideCard
                          key={`guide-${guide.key}`}
                          guide={guide}
                          overview={overview}
                          active={uploading === guide.key}
                          neededText={getGuideNeedText(guide.key, overview)}
                          onUpload={() => triggerUpload(guide.key)}
                          onTemplate={() => downloadTemplate(guide.templateFileName, guide.templateRows)}
                        />
                      ))}
                    </div>
                    {lastUploadResult && (
                      <UploadResultPanel kind={lastUploadResult.kind} result={lastUploadResult.result} />
                    )}
                  </section>
                )}
              </>
            )}
          </div>
        )}
      </main>

      <Sheet open={!!selectedItem} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto border-l border-black/5 p-0 sm:max-w-[540px]">
          {selectedItem && (
            <div className="min-h-full bg-[linear-gradient(180deg,#fffdf7_0%,#ffffff_45%)]">
              <SheetHeader className="border-b border-black/5 px-6 py-6">
                <div className="flex items-start gap-4">
                  <div className="h-20 w-20 overflow-hidden rounded-[20px] bg-slate-100">
                    {selectedItem.photo_url ? (
                      <img src={selectedItem.photo_url} alt={selectedItem.title || String(selectedItem.nm_id)} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-slate-400">
                        <Package2 size={28} />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <SheetTitle className="text-left text-lg leading-snug">{selectedItem.title || `nmID ${selectedItem.nm_id}`}</SheetTitle>
                    <SheetDescription className="mt-1 text-left text-[13px]">
                      nmID: {selectedItem.nm_id}
                      {selectedItem.vendor_code ? ` · ${selectedItem.vendor_code}` : ''}
                    </SheetDescription>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge className={cn('rounded-full px-2.5 py-1 text-[11px]', PRIORITY_META[selectedItem.priority].className)}>
                        {selectedItem.priority_label}
                      </Badge>
                      <Badge className={cn('rounded-full px-2.5 py-1 text-[11px]', STATUS_META[selectedItem.status].chipClass)}>
                        {displayStatusLabel(selectedItem)}
                      </Badge>
                      <Badge variant="outline" className="rounded-full px-2.5 py-1 text-[11px]">
                        {selectedItem.diagnosis_label}
                      </Badge>
                      <Badge className={cn('rounded-full px-2.5 py-1 text-[11px]', TREND_META[selectedItem.trend.signal].className)}>
                        {selectedItem.trend.label}
                      </Badge>
                      {selectedItem.status !== 'low_data' && (
                        <Badge variant="outline" className="rounded-full px-2.5 py-1 text-[11px]">
                          {selectedItem.precision_label}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </SheetHeader>

              <div className="space-y-5 px-6 py-6">
                <div className={cn('rounded-[24px] border px-5 py-5', STATUS_META[selectedItem.status].tileClass)}>
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-2xl bg-white/60 text-xl',
                      selectedItem.status === 'stop' && 'text-rose-500',
                      selectedItem.status === 'rescue' && 'text-amber-500',
                      selectedItem.status === 'control' && 'text-yellow-500',
                      selectedItem.status === 'grow' && 'text-emerald-500',
                      selectedItem.status === 'low_data' && 'text-slate-400',
                      )}>
                      {selectedItem.status === 'stop' ? '✕' : selectedItem.status === 'rescue' ? '⚠' : selectedItem.status === 'grow' ? '●' : selectedItem.status === 'control' ? '●' : '○'}
                    </div>
                    <div>
                      <p className="text-lg font-semibold">{drawerStatusHeading(selectedItem)}</p>
                      <p className="mt-1.5 text-sm font-semibold">{drawerActionHeading(selectedItem)}</p>
                      <p className="mt-2 text-[13px] leading-5">{drawerActionHint(selectedItem)}</p>
                    </div>
                  </div>
                </div>

                <div className="overflow-hidden rounded-[24px] border border-black/10 bg-white">
                  <div className="flex items-start gap-3 px-5 py-4">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                      <CircleAlert size={16} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{drawerProblemHeading(selectedItem)}</p>
                      <p className="mt-2 text-[13px] font-semibold leading-5">{drawerProblemReason(selectedItem)}</p>
                      <p className="mt-2 text-[13px] leading-5 text-muted-foreground">{drawerProblemHint(selectedItem)}</p>
                    </div>
                  </div>
                  <div className="border-t border-black/5 px-5 py-4">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      {selectedItem.status === 'low_data' ? 'Ключевые показатели (предварительно)' : 'Ключевые показатели'}
                    </p>
                    <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5">
                      <DrawerMetric label="Чистая прибыль" value={formatMoney(selectedItem.metrics.net_profit)} accent={selectedItem.metrics.net_profit >= 0 ? 'text-emerald-700' : 'text-rose-700'} />
                      <DrawerMetric label="Факт. CPO" value={formatMoney(selectedItem.metrics.actual_cpo)} accent={selectedItem.metrics.actual_cpo <= selectedItem.metrics.max_cpo ? 'text-emerald-700' : 'text-rose-700'} />
                      <DrawerMetric label="Лимит CPO" value={formatMoney(selectedItem.metrics.max_cpo)} />
                      <DrawerMetric label="Запас" value={formatMoney(selectedItem.metrics.profit_delta)} accent={selectedItem.metrics.profit_delta >= 0 ? 'text-emerald-700' : 'text-rose-700'} />
                      <DrawerMetric label="CR" value={formatPct(selectedItem.metrics.cr)} accent={selectedItem.metrics.cr < 2 ? 'text-rose-700' : undefined} />
                      <DrawerMetric label="CTR" value={formatPct(selectedItem.metrics.ctr)} />
                    </div>
                  </div>
                </div>

                <Accordion
                  key={`${selectedItem.nm_id}-${drawerTab}`}
                  type="multiple"
                  defaultValue={drawerTab === 'analytics' ? ['analytics'] : ['steps']}
                  className="space-y-5"
                >
                  <AccordionItem value="steps" className="overflow-hidden rounded-[24px] border border-black/10 bg-white">
                    <AccordionTrigger className="px-5 py-4 text-left hover:no-underline">
                      <div>
                        <p className="text-base font-semibold">Показать шаги</p>
                        <p className="mt-1 text-[13px] text-muted-foreground">{selectedItem.status_label} SKU</p>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-5 pb-5">
                      <div className="space-y-4">
                        {selectedItem.steps.map((step, index) => (
                          <div key={`${step}-${index}`} className="flex gap-4 text-left">
                            <div className="mt-0.5 text-sm font-semibold text-[#7c6cf2]">{index + 1}</div>
                            <p className="text-[13px] leading-6 text-foreground">{step}</p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-5 rounded-[16px] bg-emerald-50 px-4 py-3 text-[13px] font-medium text-emerald-700">
                        Ожидаемый результат: {expectedResultText(selectedItem.status)}
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="analytics" className="overflow-hidden rounded-[24px] border border-black/10 bg-white">
                    <AccordionTrigger className="px-5 py-4 text-left hover:no-underline">
                      <div>
                        <p className="text-base font-semibold">Полная аналитика</p>
                        <p className="mt-1 text-[13px] text-muted-foreground">Финансы, реклама, воронка и покрытие данных</p>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-5 pb-5">
                      <div className="space-y-6">
                        <DrawerSection
                          title="Финансы"
                          rows={[
                            ['Выручка', formatMoney(selectedItem.metrics.revenue)],
                            ['Расходы WB', formatMoney(selectedItem.metrics.wb_costs)],
                            ['Себестоимость', formatMoney(selectedItem.metrics.cost_price)],
                            ['Прибыль до рекламы', formatMoney(selectedItem.metrics.gross_profit_before_ads)],
                            ['Расход на рекламу', formatMoney(selectedItem.metrics.ad_cost)],
                            ['Чистая прибыль', formatMoney(selectedItem.metrics.net_profit)],
                          ]}
                        />
                        <DrawerSection
                          title="Реклама"
                          rows={[
                            ['Расход', formatMoney(selectedItem.metrics.ad_cost)],
                            ['Клики', Math.round(selectedItem.metrics.clicks).toLocaleString('ru-RU')],
                            ['Показы', Math.round(selectedItem.metrics.views).toLocaleString('ru-RU')],
                            ['Заказы с рекламы', Math.round(selectedItem.metrics.ad_orders).toLocaleString('ru-RU')],
                            ['GMV с рекламы', formatMoney(selectedItem.metrics.ad_gmv)],
                          ]}
                        />
                        <DrawerSection
                          title="Воронка"
                          rows={[
                            ['Просмотры', Math.round(selectedItem.metrics.open_count).toLocaleString('ru-RU')],
                            ['В корзину', Math.round(selectedItem.metrics.cart_count).toLocaleString('ru-RU')],
                            ['Заказы', Math.round(selectedItem.metrics.order_count).toLocaleString('ru-RU')],
                            ['CTR карточки', formatPct(selectedItem.metrics.ctr)],
                            ['CR', formatPct(selectedItem.metrics.cr)],
                          ]}
                        />
                        <div>
                          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Покрытие данных</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Badge className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">Доходы/Расходы</Badge>
                            <Badge className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">Воронка</Badge>
                            <Badge className={cn(
                              'rounded-full border px-3 py-1',
                              selectedItem.metrics.cost_price > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700',
                            )}>
                              Себестоимость
                            </Badge>
                            {Object.entries(selectedItem.spend_sources).filter(([, value]) => value > 0).map(([key]) => (
                              <Badge key={key} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700">
                                {key}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>

                <DetailFooterActions item={selectedItem} navigate={navigate} />
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function HeroStat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: string }) {
  return (
    <div className={cn('rounded-[24px] border border-white/10 p-4', tone)}>
      <p className="text-[11px] uppercase tracking-[0.18em] text-white/55">{label}</p>
      <p className="mt-3 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-sm text-white/60">{hint}</p>
    </div>
  );
}

function OverviewMetricCard({
  label,
  value,
  accent,
  large = false,
}: {
  label: string;
  value: string;
  accent?: string;
  large?: boolean;
}) {
  return (
    <div className="rounded-[14px] border border-black/5 bg-slate-50/65 px-3.5 py-3 text-left">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className={cn('mt-1.5 font-semibold tracking-tight', large ? 'text-[1.1rem]' : 'text-[0.98rem]', accent)}>{value}</p>
    </div>
  );
}

function EmptyAnalysisState({
  overview,
  loading,
  bootstrapping,
  uploading,
  lastUploadResult,
  onReload,
  onUpload,
}: {
  overview: AdAnalysisOverview | null;
  loading: boolean;
  bootstrapping: boolean;
  uploading: UploadKind | null;
  lastUploadResult: { kind: UploadKind; result: AdAnalysisUploadResult } | null;
  onReload: () => void;
  onUpload: (kind: UploadKind) => void;
}) {
  const sourceMap = new Map((overview?.source_statuses || []).map((source) => [source.id, source]));
  const setupSources = [
    {
      id: 'advert',
      title: 'Реклама WB',
      description: 'Расходы, клики и заказы подтягиваются из WB Advert API',
      required: true,
      automatic: true,
      icon: <BarChart3 size={18} />,
    },
    {
      id: 'finance',
      title: 'Доходы и расходы',
      description: 'Финансовый слой WB: выручка, комиссии, логистика и выплаты',
      required: true,
      automatic: true,
      icon: <CircleDollarSign size={18} />,
    },
    {
      id: 'funnel',
      title: 'Воронка продаж',
      description: 'Открытия карточки, корзина, заказы и конверсия из WB Analytics',
      required: false,
      automatic: true,
      icon: <ClipboardList size={18} />,
    },
    {
      id: 'costs',
      title: 'Себестоимость',
      description: 'Ручной файл с закупочной ценой по nmID для точной прибыли',
      required: false,
      automatic: false,
      icon: <FileSpreadsheet size={18} />,
      uploadKind: 'costs' as UploadKind,
    },
  ];
  const automaticSources = setupSources.filter((source) => source.automatic);
  const readyCount = setupSources.filter((source) => {
    const status = sourceMap.get(source.id);
    return status && ['ok', 'manual', 'partial'].includes(status.mode);
  }).length;
  const snapshotReady = Boolean(overview?.snapshot_ready);
  const automaticReadyCount = automaticSources.filter((source) => {
    const status = sourceMap.get(source.id);
    return status && ['ok', 'partial'].includes(status.mode);
  }).length;
  const showBootstrapStage = !snapshotReady && automaticReadyCount === 0;
  const isLoadingStage = showBootstrapStage && (loading || bootstrapping || !overview);
  const activeManualGuide = (() => {
    if (!overview) return null;
    if (overview.upload_needs.missing_costs_count > 0) {
      return FILE_GUIDES.find((guide) => guide.key === 'costs') || null;
    }
    if (overview.upload_needs.needs_manual_finance) {
      return FILE_GUIDES.find((guide) => guide.key === 'finance') || null;
    }
    if (overview.upload_needs.needs_manual_spend) {
      return FILE_GUIDES.find((guide) => guide.key === 'spend') || null;
    }
    return null;
  })();
  const costGuide = FILE_GUIDES.find((guide) => guide.key === 'costs')!;
  const activeGuideSteps = activeManualGuide?.key === 'costs'
    ? [
        'Скачайте готовый шаблон Excel.',
        'Заполните три колонки: Артикул поставщика, Артикул ВБ и Себестоимость, руб.',
        'Сохраните файл и загрузите его сюда. После этого snapshot пересчитается автоматически.',
      ]
    : activeManualGuide?.key === 'finance'
      ? [
          'Скачайте raw отчет WB или возьмите свой агрегат по nm_id.',
          'Проверьте, что период файла совпадает с периодом анализа.',
          'Загрузите файл, и система автоматически пересчитает snapshot.',
        ]
      : activeManualGuide?.key === 'spend'
        ? [
            'Возьмите выгрузку WB рекламы или свою таблицу маркетолога.',
            'Разнесите неподвязанный расход по nm_id.',
            'Загрузите файл, и система автоматически обновит экономику SKU.',
          ]
        : [];
  const activeGuideStatus = activeManualGuide ? sourceMap.get(activeManualGuide.key) : null;
  const activeGuideNeedText = activeManualGuide ? getGuideNeedText(activeManualGuide.key, overview) : '';

  if (showBootstrapStage) {
    return (
      <section className="mx-auto max-w-3xl rounded-[28px] border border-black/5 bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.08)]">
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Шаг 1 из 2</p>
          <h2 className="mt-2 text-[1.45rem] font-semibold tracking-tight">Загружаем данные из WB</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Сейчас автоматически сохраняем рекламу, финансы и воронку в backend. Это делается один раз, потом экран будет открываться уже с сохраненными данными.
          </p>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {automaticSources.map((source) => (
            <div key={source.id} className="rounded-[22px] border border-black/5 bg-slate-50 px-4 py-4 text-left">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-foreground shadow-sm">
                {source.icon}
              </div>
              <p className="mt-3 text-sm font-semibold">{source.title}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{source.description}</p>
              <div className="mt-4 flex items-center gap-2 text-sm font-medium text-[#7c6cf2]">
                <RefreshCcw size={14} className={cn(isLoadingStage && 'animate-spin')} />
                {isLoadingStage ? 'Загружаем...' : 'Готово к обновлению'}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-[22px] border border-sky-200 bg-sky-50 px-4 py-4 text-left">
          <p className="text-sm font-semibold text-sky-900">Следующий шаг откроется автоматически</p>
          <p className="mt-1.5 text-sm leading-6 text-sky-900">
            Как только WB-слои сохранятся, экран сразу переключится на шаг с `Себестоимостью` и покажет готовый Excel-шаблон для загрузки.
          </p>
        </div>

        <div className="mt-6 flex justify-center">
          <Button className="gap-2 rounded-2xl px-6" onClick={onReload} disabled={isLoadingStage}>
            <RefreshCcw size={15} className={cn(isLoadingStage && 'animate-spin')} />
            {isLoadingStage ? 'Загружаем данные из WB...' : 'Повторить обновление'}
          </Button>
        </div>
      </section>
    );
  }

  if (snapshotReady && activeManualGuide) {
    return (
      <section className="mx-auto max-w-4xl rounded-[28px] border border-black/5 bg-white p-5 shadow-[0_30px_80px_rgba(15,23,42,0.08)]">
        <div className="rounded-[22px] border border-emerald-200 bg-emerald-50 px-4 py-4 text-left">
          <p className="text-sm font-semibold text-emerald-900">Шаг 1 выполнен</p>
          <p className="mt-1.5 text-sm leading-6 text-emerald-900">
            Реклама, финансы и воронка уже сохранены в backend. Теперь нужен только следующий шаг, чтобы расчет стал точным и понятным.
          </p>
        </div>

        <div className="mt-5 rounded-[26px] border border-black/5 bg-[linear-gradient(180deg,#ffffff_0%,#faf9f5_100%)] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 text-left">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Шаг 2 из 2</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h2 className="text-[1.4rem] font-semibold tracking-tight">{activeManualGuide.title}</h2>
                <Badge className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-medium text-amber-700">
                  {activeGuideStatus ? getSourceModeLabel(activeGuideStatus.mode) : 'Нужен файл'}
                </Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{activeManualGuide.description}</p>
              <p className="mt-3 text-sm leading-6 text-foreground">{activeGuideNeedText}</p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="gap-2 rounded-2xl"
                onClick={() => downloadTemplate(activeManualGuide.templateFileName, activeManualGuide.templateRows)}
              >
                <Download size={14} />
                Скачать Excel-шаблон
              </Button>
              <Button
                className="gap-2 rounded-2xl"
                onClick={() => onUpload(activeManualGuide.key)}
                disabled={uploading === activeManualGuide.key}
              >
                {uploading === activeManualGuide.key ? <RefreshCcw size={14} className="animate-spin" /> : <Upload size={14} />}
                {uploading === activeManualGuide.key ? 'Загружаем...' : 'Загрузить файл'}
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-[20px] border border-black/5 bg-white px-4 py-4 text-left">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Что должно быть в Excel</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(activeManualGuide.templateRows[0] || []).map((column) => (
                  <span key={column} className="rounded-full bg-slate-50 px-3 py-1 text-xs text-slate-700">
                    {column}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Лучше заполнять и Артикул поставщика, и Артикул ВБ. Тогда система точнее сопоставит SKU и загрузка пройдет без ручной правки.
              </p>
            </div>

            <div className="rounded-[20px] border border-black/5 bg-white px-4 py-4 text-left">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Как пройти шаг</p>
              <div className="mt-3 space-y-3">
                {activeGuideSteps.map((step, index) => (
                  <div key={step} className="flex gap-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#8b7cf6]/10 text-xs font-semibold text-[#6d5cf6]">
                      {index + 1}
                    </div>
                    <p className="text-sm leading-6 text-slate-700">{step}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {lastUploadResult && (
          <div className="mt-5 text-left">
            <UploadResultPanel kind={lastUploadResult.kind} result={lastUploadResult.result} />
          </div>
        )}

        <Accordion type="single" collapsible className="mt-6 text-left">
          <AccordionItem value="loaded-sources" className="border-b border-black/5">
            <AccordionTrigger className="text-sm font-semibold hover:no-underline">
              Что уже собрано из WB
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid gap-3">
                {automaticSources.map((source) => {
                  const status = sourceMap.get(source.id);
                  return (
                    <div key={source.id} className="rounded-[18px] border border-black/5 bg-slate-50 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{source.title}</p>
                        {status && (
                          <Badge className={cn('rounded-full border px-3 py-1 text-[11px] font-medium', SOURCE_MODE_META[status.mode])}>
                            {getSourceModeLabel(status.mode)}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {status?.detail || source.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="cost-template" className="border-b border-black/5">
            <AccordionTrigger className="text-sm font-semibold hover:no-underline">
              Где взять и как заполнить файл себестоимости
            </AccordionTrigger>
            <AccordionContent>
              <div className="rounded-[20px] border border-black/5 bg-slate-50 px-4 py-4">
                <p className="text-sm leading-6 text-slate-700">{costGuide.sourceFrom}</p>
                <div className="mt-3 space-y-2">
                  {costGuide.sourceSteps.map((step) => (
                    <div key={step} className="rounded-2xl bg-white px-3 py-2 text-sm text-slate-700">
                      {step}
                    </div>
                  ))}
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-3xl rounded-[28px] border border-black/5 bg-white p-5 shadow-[0_30px_80px_rgba(15,23,42,0.08)]">
      <div className="text-left">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Подготовка завершена</p>
        <h2 className="mt-2 text-[1.35rem] font-semibold tracking-tight">Данные уже сохранены</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Снимок готов. Если нужен более свежий период или новые данные из WB, нажмите `Обновить данные`.
        </p>
      </div>

      <div className="mt-5 rounded-[22px] border border-black/5 bg-slate-50 px-4 py-4">
        <p className="text-sm text-muted-foreground">
          Готово источников: <span className="font-semibold text-foreground">{readyCount}</span> из {setupSources.length}
        </p>
        <Progress value={Math.round((readyCount / setupSources.length) * 100)} className="mt-3 h-2 w-72 max-w-full bg-slate-200" />
      </div>

      <div className="mt-5 flex justify-start">
        <Button className="gap-2 rounded-2xl px-6" onClick={onReload}>
          <RefreshCcw size={15} />
          Обновить данные из WB
        </Button>
      </div>

      {lastUploadResult && (
        <div className="mt-5 text-left">
          <UploadResultPanel kind={lastUploadResult.kind} result={lastUploadResult.result} />
        </div>
      )}
    </section>
  );
}

function GuidedStepCard({
  index,
  title,
  description,
  state,
  onClick,
}: {
  index: string;
  title: string;
  description: string;
  state: 'done' | 'attention' | 'idle';
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-[24px] border p-4 text-left transition-transform hover:-translate-y-0.5',
        state === 'done' && 'border-emerald-200 bg-emerald-50',
        state === 'attention' && 'border-amber-200 bg-amber-50',
        state === 'idle' && 'border-black/5 bg-slate-50',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={cn(
          'flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-semibold',
          state === 'done' && 'bg-emerald-100 text-emerald-700',
          state === 'attention' && 'bg-amber-100 text-amber-700',
          state === 'idle' && 'bg-white text-foreground',
        )}>
          {index}
        </div>
        <Badge className={cn(
          'rounded-full border px-3 py-1 text-[11px] font-medium',
          state === 'done' && 'border-emerald-200 bg-white text-emerald-700',
          state === 'attention' && 'border-amber-200 bg-white text-amber-700',
          state === 'idle' && 'border-black/10 bg-white text-slate-700',
        )}>
          {state === 'done' ? 'Готово' : state === 'attention' ? 'Нужно пройти' : 'Далее'}
        </Badge>
      </div>
      <p className="mt-4 text-base font-semibold">{title}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    </button>
  );
}

function NextActionCard({
  nextAction,
  schedulerStatus,
  generatedAt,
  onOpenSection,
}: {
  nextAction: {
    tone: string;
    eyebrow: string;
    title: string;
    description: string;
    actionLabel: string;
    action: () => void;
    sectionId: string;
  } | null;
  schedulerStatus: SchedulerStatus | null;
  generatedAt: string | null;
  onOpenSection: (id: string) => void;
}) {
  return (
    <div className="rounded-[20px] border border-black/5 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Первый шаг</p>
      {nextAction ? (
        <div className={cn('mt-3 rounded-[18px] border p-4', nextAction.tone)}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em]">{nextAction.eyebrow}</p>
          <h3 className="mt-1.5 text-base font-semibold leading-6">{nextAction.title}</h3>
          <p className="mt-2 text-[13px] leading-5 opacity-90">{nextAction.description}</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button className="h-9 gap-2 rounded-xl text-sm" onClick={nextAction.action}>
              <ArrowRight size={15} />
              {nextAction.actionLabel}
            </Button>
            <Button variant="outline" className="h-9 gap-2 rounded-xl text-sm" onClick={() => onOpenSection(nextAction.sectionId)}>
              <ExternalLink size={15} />
              Открыть нужный блок
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-[18px] border border-black/5 bg-slate-50 p-4">
          <p className="text-sm font-semibold">Ждем данные для первого шага</p>
          <p className="mt-1.5 text-[13px] text-muted-foreground">Как только snapshot будет готов, здесь появится рекомендуемое действие.</p>
        </div>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[16px] border border-black/5 bg-slate-50 p-3.5">
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Снимок</p>
          <p className="mt-1.5 text-sm font-semibold">{formatDateTime(generatedAt)}</p>
          <p className="mt-1.5 text-xs text-muted-foreground">Время сохраненного snapshot.</p>
        </div>
        <div className="rounded-[16px] border border-black/5 bg-slate-50 p-3.5">
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Фоновая синхронизация</p>
          <p className="mt-1.5 text-sm font-semibold">{schedulerStatus?.is_running ? 'Активна' : 'Не активна'}</p>
          <p className="mt-1.5 text-xs text-muted-foreground">{formatSchedulerHint(schedulerStatus)}</p>
        </div>
      </div>
    </div>
  );
}

function SourceHealthCard({
  overview,
  schedulerStatus,
  viewMode,
}: {
  overview: AdAnalysisOverview | null;
  schedulerStatus: SchedulerStatus | null;
  viewMode: ViewMode;
}) {
  const sources = overview?.source_statuses || [];

  return (
    <div className="rounded-[20px] border border-black/5 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Источники</p>
          <h3 className="mt-1.5 text-base font-semibold">Что уже сохранено</h3>
        </div>
        <Badge variant="outline" className="rounded-full px-3 py-1 text-[11px]">
          {schedulerStatus?.last_tick_at ? `Фон. цикл: ${formatDateTime(schedulerStatus.last_tick_at)}` : 'Без данных о фоновом цикле'}
        </Badge>
      </div>

      <div className="mt-3">
        {sources.length === 0 && (
          <div className="rounded-[16px] border border-dashed border-black/10 bg-slate-50 px-4 py-6 text-sm text-muted-foreground">
            Источники появятся после первого успешного запроса overview.
          </div>
        )}

        {sources.length > 0 && (
          <Accordion type="single" collapsible className="space-y-2">
            {sources.map((source) => (
              <AccordionItem key={source.id} value={source.id} className="overflow-hidden rounded-[16px] border border-black/5 bg-slate-50 px-0">
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <div className="flex w-full items-center justify-between gap-3 pr-3 text-left">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{source.label}</p>
                        <Badge className={cn('rounded-full border px-2.5 py-0.5 text-[10px] font-medium', SOURCE_MODE_META[source.mode])}>
                          {getSourceModeLabel(source.mode)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{source.automatic ? 'WB API' : 'Ручной файл'}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Записей</div>
                      <div className="mt-1 text-sm font-semibold">{source.records}</div>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="border-t border-black/5 px-4 py-3 text-[13px] leading-5 text-muted-foreground">
                  {source.detail || '—'}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>

      {viewMode !== 'simple' && (
        <div className="mt-3 rounded-[16px] border border-black/5 bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] p-3.5">
          <p className="text-sm font-semibold">Как читать блок</p>
          <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
            Если здесь все зеленое или частично закрыто ручным слоем, можно переходить к решениям по SKU. Если есть `Нужен файл` или `Ошибка`,
            система покажет ниже ровно тот файл, которого не хватает.
          </p>
        </div>
      )}
    </div>
  );
}

function UploadResultPanel({
  kind,
  result,
}: {
  kind: UploadKind;
  result: AdAnalysisUploadResult;
}) {
  const guide = FILE_GUIDES.find((item) => item.key === kind);

  return (
    <div className="rounded-[24px] border border-black/5 bg-[linear-gradient(180deg,#fffdf7_0%,#ffffff_100%)] p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Последняя загрузка</p>
          <h4 className="mt-2 text-lg font-semibold">{guide?.title || result.file_name}</h4>
          <p className="mt-2 text-sm text-muted-foreground">
            Обработано: {result.imported + result.updated} строк · добавлено {result.imported} · обновлено {result.updated}
          </p>
        </div>
        <Badge className={cn(
          'rounded-full border px-3 py-1 text-[11px] font-medium',
          result.unresolved_count > 0 ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700',
        )}>
          {result.unresolved_count > 0 ? `Нужно сопоставить: ${result.unresolved_count}` : 'Сопоставление прошло успешно'}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-[20px] border border-black/5 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Система поняла колонки</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(result.matched_fields || {}).map(([field, header]) => (
              <span key={`${field}-${header}`} className="rounded-full bg-white px-3 py-1 text-xs text-slate-700 shadow-sm">
                {field}: {header}
              </span>
            ))}
            {Object.keys(result.matched_fields || {}).length === 0 && (
              <span className="text-sm text-muted-foreground">Подробная карта колонок отсутствует для этого формата.</span>
            )}
          </div>
          {result.resolved_by_vendor_code > 0 && (
            <p className="mt-3 text-sm text-emerald-700">
              {result.resolved_by_vendor_code} строк удалось привязать автоматически по vendor_code.
            </p>
          )}
        </div>

        <div className="rounded-[20px] border border-black/5 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Что проверить после upload</p>
          <div className="mt-3 space-y-2">
            {(result.notes || []).map((note) => (
              <div key={note} className="rounded-2xl bg-white px-3 py-2 text-sm text-slate-700">{note}</div>
            ))}
            {!result.notes.length && (
              <div className="rounded-2xl bg-white px-3 py-2 text-sm text-slate-700">Дополнительных замечаний нет.</div>
            )}
          </div>
        </div>
      </div>

      {result.unresolved_preview.length > 0 && (
        <div className="mt-4 rounded-[20px] border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Превью строк, которые не удалось сопоставить</p>
          <div className="mt-3 space-y-2">
            {result.unresolved_preview.map((row) => (
              <div key={`${row.row_number}-${row.raw_vendor_code || row.raw_nm_id || row.raw_title}`} className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700">
                <span className="font-medium">Строка {row.row_number}</span>
                <span className="mx-2 text-slate-400">·</span>
                <span>nmID: {row.raw_nm_id || '—'}</span>
                <span className="mx-2 text-slate-400">·</span>
                <span>vendor_code: {row.raw_vendor_code || '—'}</span>
                {row.raw_title && (
                  <>
                    <span className="mx-2 text-slate-400">·</span>
                    <span>{row.raw_title}</span>
                  </>
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm leading-6 text-amber-900">
            Исправьте для этих строк `nm_id` или `vendor_code`, затем загрузите файл повторно. Если SKU новый, сначала убедитесь, что карточка уже есть в магазине.
          </p>
        </div>
      )}
    </div>
  );
}

function TopProblemsBoard({
  items,
  onOpen,
}: {
  items: AdAnalysisItem[];
  onOpen: (item: AdAnalysisItem) => void;
}) {
  return (
    <div className="rounded-[28px] border border-black/5 bg-white p-5 shadow-[0_24px_64px_rgba(15,23,42,0.06)]">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Топ проблем</p>
      <h3 className="mt-2 text-xl font-semibold">Что требует внимания прямо сейчас</h3>
      <div className="mt-4 space-y-3">
        {items.length === 0 && (
          <div className="rounded-[22px] border border-dashed border-black/10 bg-slate-50 px-4 py-6 text-sm text-muted-foreground">
            Сейчас нет выраженных проблемных SKU для быстрого списка.
          </div>
        )}
        {items.map((item) => (
          <button
            key={`problem-${item.nm_id}`}
            onClick={() => onOpen(item)}
            className="w-full rounded-[22px] border border-black/5 bg-slate-50 px-4 py-4 text-left transition-transform hover:-translate-y-0.5"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{item.title || `nmID ${item.nm_id}`}</p>
                  <Badge className={cn('rounded-full px-2 py-0.5 text-[11px]', PRIORITY_META[item.priority].className)}>
                    {item.priority_label}
                  </Badge>
                  <Badge className={cn('rounded-full px-2 py-0.5 text-[11px]', STATUS_META[item.status].chipClass)}>
                    {item.status_label}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{item.status_reason}</p>
                <p className="mt-2 text-sm text-foreground/80">{item.action_title}</p>
              </div>
              <div className="rounded-2xl bg-white px-4 py-3 text-right">
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Net Profit</div>
                <div className={cn('mt-1 text-lg font-semibold', item.metrics.net_profit >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                  {formatMoney(item.metrics.net_profit)}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function SkuTable({
  items,
  showDetails,
  onOpen,
}: {
  items: AdAnalysisItem[];
  showDetails: boolean;
  onOpen: (item: AdAnalysisItem, tab: DrawerTab) => void;
}) {
  return (
    <div className="mt-4 overflow-hidden rounded-[16px] border border-black/10 bg-white">
      <div className="max-h-[68vh] overflow-auto">
        <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-[11px]">
          <thead className="sticky top-0 z-10 bg-[#f7f8fb] text-[#61708f]">
            <tr>
              <th className="border-b border-r border-black/5 px-3 py-2.5 text-left font-medium">nmID</th>
              <th className="border-b border-r border-black/5 px-3 py-2.5 text-left font-medium">Название</th>
              <th className="border-b border-r border-black/5 px-3 py-2.5 text-left font-medium">Статус</th>
              <th className="border-b border-r border-black/5 px-3 py-2.5 text-left font-medium">Что делать</th>
              <th className="border-b border-r border-black/5 px-3 py-2.5 text-right font-medium">Чистая прибыль</th>
              <th className="border-b border-r border-black/5 px-3 py-2.5 text-right font-medium">Факт. CPO</th>
              <th className="border-b border-r border-black/5 px-3 py-2.5 text-right font-medium">Лимит CPO</th>
              <th className="border-b border-r border-black/5 px-3 py-2.5 text-right font-medium">Запас</th>
              {showDetails && (
                <>
                  <th className="border-b border-r border-black/5 px-3 py-2.5 text-right font-medium">Выручка</th>
                  <th className="border-b border-r border-black/5 px-3 py-2.5 text-right font-medium">WB costs</th>
                  <th className="border-b border-r border-black/5 px-3 py-2.5 text-right font-medium">Себест.</th>
                  <th className="border-b border-r border-black/5 px-3 py-2.5 text-right font-medium">До рекламы</th>
                  <th className="border-b px-3 py-2.5 text-right font-medium">Реклама</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="bg-white">
            {items.map((item, index) => (
              <tr
                key={`table-${item.nm_id}`}
                className={cn(
                  'cursor-pointer transition-colors hover:bg-[#f8faff]',
                  index % 2 === 1 && 'bg-[#fcfcfd]',
                )}
                onClick={() => onOpen(item, 'action')}
              >
                <td className="border-b border-r border-black/5 px-3 py-2.5 align-top font-medium">{item.nm_id}</td>
                <td className="border-b border-r border-black/5 px-3 py-2.5 align-top">
                  <div className="max-w-[260px]">
                    <p className="font-medium leading-5 text-foreground">{item.title || `nmID ${item.nm_id}`}</p>
                    {item.vendor_code && <p className="mt-1 text-xs text-muted-foreground">{item.vendor_code}</p>}
                  </div>
                </td>
                <td className="border-b border-r border-black/5 px-3 py-2.5 align-top">
                  <Badge className={cn('rounded-full px-3 py-1 text-xs', STATUS_META[item.status].chipClass)}>
                    {displayStatusLabel(item)}
                  </Badge>
                </td>
                <td className="border-b border-r border-black/5 px-3 py-2.5 align-top">
                  <div className="max-w-[200px] leading-5 text-slate-700">{item.action_title}</div>
                </td>
                <td className={cn('border-b border-r border-black/5 px-3 py-2.5 text-right align-top font-semibold', item.metrics.net_profit >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                  {formatMoney(item.metrics.net_profit)}
                </td>
                <td className="border-b border-r border-black/5 px-3 py-2.5 text-right align-top">{formatMoney(item.metrics.actual_cpo)}</td>
                <td className="border-b border-r border-black/5 px-3 py-2.5 text-right align-top">{formatMoney(item.metrics.max_cpo)}</td>
                <td className={cn('border-b border-r border-black/5 px-3 py-2.5 text-right align-top font-semibold', item.metrics.profit_delta >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                  {formatMoney(item.metrics.profit_delta)}
                </td>
                {showDetails && (
                  <>
                    <td className="border-b border-r border-black/5 px-3 py-2.5 text-right align-top">{formatMoney(item.metrics.revenue)}</td>
                    <td className="border-b border-r border-black/5 px-3 py-2.5 text-right align-top">{formatMoney(item.metrics.wb_costs)}</td>
                    <td className="border-b border-r border-black/5 px-3 py-2.5 text-right align-top">{formatMoney(item.metrics.cost_price)}</td>
                    <td className="border-b border-r border-black/5 px-3 py-2.5 text-right align-top">{formatMoney(item.metrics.gross_profit_before_ads)}</td>
                    <td className="border-b px-3 py-2.5 text-right align-top">{formatMoney(item.metrics.ad_cost)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricsHelpCard() {
  const rows = [
    {
      title: 'Revenue',
      formula: 'Выручка',
      description: 'Сумма, полученная за проданные товары.',
    },
    {
      title: 'WB Costs',
      formula: 'комиссия + логистика + хранение + штрафы',
      description: 'Затраты WB по заказам за выбранный период.',
    },
    {
      title: 'Gross Profit',
      formula: 'Revenue - WB Costs - Себестоимость',
      description: 'Валовая прибыль до рекламы. Показывает, есть ли маржа.',
    },
    {
      title: 'Net Profit',
      formula: 'Gross Profit - Ad Cost',
      description: 'Чистая прибыль после рекламы. Главный показатель.',
    },
    {
      title: 'Max CPO',
      formula: 'Gross Profit / Orders',
      description: 'Максимально допустимая стоимость заказа с рекламы.',
    },
    {
      title: 'Actual CPO',
      formula: 'Ad Cost / Orders from ads',
      description: 'Фактическая стоимость заказа с рекламы.',
    },
    {
      title: 'Profit Delta',
      formula: 'Max CPO - Actual CPO',
      description: 'Запас по рекламе. Положительный = есть запас. Отрицательный = убыток.',
    },
  ];

  return (
    <div className="mt-6 rounded-[28px] border border-black/5 bg-white p-5 shadow-[0_24px_64px_rgba(15,23,42,0.06)]">
      <Accordion type="single" collapsible defaultValue="metrics">
        <AccordionItem value="metrics" className="border-b-0">
          <AccordionTrigger className="py-0 hover:no-underline">
            <div className="text-left">
              <p className="text-base font-semibold">Что означают метрики</p>
              <p className="mt-1 text-sm text-muted-foreground">Формулы и краткое объяснение основных показателей.</p>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {rows.map((row) => (
                <div key={row.title} className="rounded-[22px] border border-black/5 bg-slate-50 px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-semibold">{row.title}</p>
                    <span className="text-xs text-muted-foreground">{row.formula}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{row.description}</p>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function StatusTile({
  status,
  count,
  active = false,
  onClick,
}: {
  status: AdAnalysisItemStatus;
  count: number;
  active?: boolean;
  onClick?: () => void;
}) {
  const meta = STATUS_META[status];
  const icon =
    status === 'stop' ? '✕'
    : status === 'rescue' ? '⚠'
    : status === 'control' ? '●'
    : status === 'grow' ? '●'
    : '○';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-[14px] border bg-white px-3.5 py-3 text-left transition-colors hover:bg-slate-50',
        active ? 'border-foreground bg-slate-100' : 'border-black/5',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn(
              'inline-flex h-5 w-5 items-center justify-center rounded-full text-xs',
              status === 'stop' && 'bg-rose-50 text-rose-500',
              status === 'rescue' && 'bg-amber-50 text-amber-500',
              status === 'control' && 'bg-yellow-50 text-yellow-500',
              status === 'grow' && 'bg-emerald-50 text-emerald-500',
              status === 'low_data' && 'bg-slate-100 text-slate-400',
            )}>
              {icon}
            </span>
            <p className="text-[13px] font-medium">{meta.label}</p>
          </div>
        </div>
        <p className="text-lg font-semibold">{count}</p>
      </div>
    </button>
  );
}

function WorkflowStep({
  index,
  title,
  description,
  accent,
}: {
  index: string;
  title: string;
  description: string;
  accent: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-[22px] border border-black/5 bg-slate-50 px-4 py-4">
      <div className={cn('flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl text-sm font-semibold', accent)}>
        {index}
      </div>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function ManualNeedCard({
  guide,
  overview,
  active,
  onUpload,
}: {
  guide: FileGuide;
  overview: AdAnalysisOverview | null;
  active: boolean;
  onUpload: () => void;
}) {
  const stateMeta = getGuideStateMeta(guide.key, overview);

  return (
    <div className="rounded-[24px] border border-black/5 bg-[linear-gradient(180deg,#ffffff_0%,#faf8f2_100%)] p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{guide.title}</p>
            <Badge className={cn('rounded-full border px-3 py-1 text-[11px] font-medium', stateMeta.className)}>
              {stateMeta.label}
            </Badge>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{getGuideLiveHint(guide.key, overview)}</p>
        </div>
      </div>

      <div className="mt-4 rounded-[18px] bg-slate-50 px-4 py-3">
        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Где брать файл</p>
        <p className="mt-2 text-sm leading-5 text-foreground">{guide.sourceRoutes[0] || guide.sourceFrom}</p>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          Минимум: {guide.minimumColumns.join(' + ')}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="rounded-2xl text-xs"
            size="sm"
            onClick={() => downloadTemplate(guide.templateFileName, guide.templateRows)}
          >
            Excel
          </Button>
          <Button className="gap-2 rounded-2xl text-xs" size="sm" onClick={onUpload} disabled={active}>
            {active ? <RefreshCcw size={14} className="animate-spin" /> : <Upload size={14} />}
            {active ? 'Загрузка...' : 'Загрузить'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function UploadGuideCard({
  guide,
  overview,
  active,
  neededText,
  onUpload,
  onTemplate,
}: {
  guide: FileGuide;
  overview: AdAnalysisOverview | null;
  active: boolean;
  neededText: string;
  onUpload: () => void;
  onTemplate: () => void;
}) {
  const stateMeta = getGuideStateMeta(guide.key, overview);

  return (
    <div className="rounded-[24px] border border-black/5 bg-[linear-gradient(180deg,#ffffff_0%,#fbfbfa_100%)] p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <div className={cn('flex h-12 w-12 items-center justify-center rounded-2xl', active ? 'bg-foreground text-background' : 'bg-slate-100 text-foreground')}>
            {active ? <RefreshCcw size={18} className="animate-spin" /> : <FileSpreadsheet size={18} />}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-lg font-semibold">{guide.title}</p>
              <Badge variant="outline" className="rounded-full px-3 py-1 text-[11px]">
                {guide.shortLabel}
              </Badge>
              <Badge className={cn('rounded-full border px-3 py-1 text-[11px] font-medium', stateMeta.className)}>
                {stateMeta.label}
              </Badge>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{guide.description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {guide.minimumColumns.map((column) => (
                <span key={column} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                  {column}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
          <Button variant="outline" className="gap-2 rounded-2xl" onClick={onTemplate}>
            <Download size={14} />
            Шаблон Excel
          </Button>
          <Button className="gap-2 rounded-2xl" onClick={onUpload}>
            <Upload size={14} />
            Загрузить
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
        <div className="rounded-[20px] bg-slate-50 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Когда нужен</p>
          <p className="mt-2 text-sm leading-6 text-foreground">{neededText}</p>
          <p className="mt-3 text-sm text-muted-foreground">{guide.autoFallback}</p>
        </div>
        <div className="rounded-[20px] border border-black/5 bg-white px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Где взять</p>
          <p className="mt-2 text-sm leading-6 text-foreground">{guide.sourceFrom}</p>
          <div className="mt-3 space-y-2">
            {guide.sourceRoutes.map((route) => (
              <div key={route} className="rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {route}
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[20px] border border-black/5 bg-white px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Система примет</p>
          <p className="mt-2 text-sm leading-6 text-foreground">{guide.acceptAsIs}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {guide.acceptedHeaders.map((header) => (
              <span key={header} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                {header}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function InsightStatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className={cn('rounded-[22px] border p-4', tone)}>
      <p className="text-[11px] uppercase tracking-[0.16em] opacity-80">{label}</p>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
      <p className="mt-1 text-sm opacity-80">SKU</p>
    </div>
  );
}

function TrendStatCard({
  label,
  value,
  description,
  tone,
}: {
  label: string;
  value: number;
  description: string;
  tone: string;
}) {
  return (
    <div className={cn('rounded-[22px] border p-4', tone)}>
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
      <p className="mt-2 text-sm opacity-80">{description}</p>
    </div>
  );
}

function TrendColumn({
  title,
  subtitle,
  items,
  emptyText,
  onOpen,
  tone,
}: {
  title: string;
  subtitle: string;
  items: AdAnalysisItem[];
  emptyText: string;
  onOpen: (item: AdAnalysisItem) => void;
  tone: 'rose' | 'emerald';
}) {
  const toneClass =
    tone === 'rose'
      ? 'bg-rose-50 text-rose-700'
      : 'bg-emerald-50 text-emerald-700';

  return (
    <div className="rounded-[28px] border border-black/5 bg-white p-5 shadow-[0_24px_64px_rgba(15,23,42,0.06)]">
      <div className="flex items-center gap-3">
        <div className={cn('flex h-11 w-11 items-center justify-center rounded-2xl', toneClass)}>
          {tone === 'rose' ? <ArrowUpRight size={18} className="rotate-45" /> : <ArrowDownRight size={18} className="-rotate-45" />}
        </div>
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {items.length === 0 && (
          <div className="rounded-[22px] border border-dashed border-black/10 bg-slate-50 px-4 py-6 text-sm text-muted-foreground">
            {emptyText}
          </div>
        )}
        {items.map((item) => (
          <button
            key={`${title}-${item.nm_id}`}
            onClick={() => onOpen(item)}
            className="flex w-full items-start gap-3 rounded-[22px] border border-black/5 bg-slate-50 px-4 py-4 text-left transition-transform hover:-translate-y-0.5"
          >
            <div className="h-14 w-14 overflow-hidden rounded-2xl bg-white">
              {item.photo_url ? (
                <img src={item.photo_url} alt={item.title || String(item.nm_id)} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-slate-400">
                  <Package2 size={18} />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-medium">{item.title || `nmID ${item.nm_id}`}</p>
                <Badge className={cn('rounded-full px-2 py-0.5 text-[11px]', TREND_META[item.trend.signal].className)}>
                  {item.trend.label}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{item.trend.summary}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function CampaignCard({ campaign }: { campaign: AdAnalysisCampaign }) {
  return (
    <div className="rounded-[24px] border border-black/5 bg-[linear-gradient(180deg,#ffffff_0%,#fbfbfa_100%)] p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-base font-semibold">{campaign.title}</p>
        <Badge variant="outline" className="rounded-full px-3 py-1 text-[11px]">
          {campaign.advert_id ? `ID ${campaign.advert_id}` : 'Без ID'}
        </Badge>
        <Badge className={cn('rounded-full px-3 py-1 text-[11px]', TREND_META[campaign.precision === 'unallocated' ? 'volatile' : campaign.precision === 'exact' ? 'stable' : 'new'].className)}>
          {campaign.precision_label}
        </Badge>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <MiniMetric icon={<CircleDollarSign size={15} />} label="Расход" value={formatMoney(campaign.ad_cost)} />
        <MiniMetric icon={<BarChart3 size={15} />} label="DRR" value={formatPct(campaign.drr)} />
        <MiniMetric icon={<CircleDollarSign size={15} />} label="GMV" value={formatMoney(campaign.ad_gmv)} />
        <MiniMetric icon={<Link2 size={15} />} label="SKU" value={String(campaign.linked_skus)} />
      </div>
    </div>
  );
}

function SummaryColumn({
  title,
  subtitle,
  icon,
  items,
  emptyText,
  onOpen,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  items: AdAnalysisItem[];
  emptyText: string;
  onOpen: (item: AdAnalysisItem) => void;
}) {
  const isCritical = title.toLowerCase().includes('крит');
  return (
    <div className="overflow-hidden rounded-[16px] border border-black/5 bg-white shadow-[0_8px_20px_rgba(15,23,42,0.025)]">
      <div className={cn(
        'flex items-center gap-3 border-b border-black/5 px-4 py-3',
        isCritical ? 'bg-white' : 'bg-white',
      )}>
        <div className={cn('h-2.5 w-2.5 rounded-full', isCritical ? 'bg-rose-500' : 'bg-emerald-500')} />
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-0">
        {items.length === 0 && (
          <div className="px-5 py-6 text-sm text-muted-foreground">
            {emptyText}
          </div>
        )}
        {items.map((item) => (
          <button
            key={item.nm_id}
            onClick={() => onOpen(item)}
            className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-black/5 px-4 py-3 text-left transition-colors hover:bg-slate-50/70 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold">{item.title || `nmID ${item.nm_id}`}</p>
              <p className="mt-1 text-xs text-slate-700">{item.action_title}</p>
              <p className="mt-1 line-clamp-2 text-[11px] leading-[18px] text-muted-foreground">
                {isCritical ? item.status_reason : item.status_hint}
              </p>
            </div>
            <div className="w-[112px] text-right">
              <p className={cn('text-sm font-semibold', item.metrics.net_profit >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                {isCritical ? formatMoney(item.metrics.net_profit) : `${item.metrics.profit_delta >= 0 ? '+' : ''}${Math.round(item.metrics.profit_delta).toLocaleString('ru-RU')} ₽/заказ`}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">{isCritical ? 'чистая прибыль' : 'запас'}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-lg px-3 py-2 text-xs font-medium transition-colors',
        active ? 'bg-foreground text-background' : 'text-foreground hover:bg-slate-100',
      )}
    >
      {children}
    </button>
  );
}

function SkuCard({
  item,
  mode,
  onOpen,
  onOpenWhy,
  onOpenAnalytics,
}: {
  item: AdAnalysisItem;
  mode: ViewMode;
  onOpen: () => void;
  onOpenWhy: () => void;
  onOpenAnalytics: () => void;
}) {
  const statusMeta = STATUS_META[item.status];
  const metricsToShow = mode === 'simple'
    ? ([
        { icon: <CircleDollarSign size={14} />, label: 'Чистая прибыль', value: formatMoney(item.metrics.net_profit), accent: item.metrics.net_profit >= 0 ? 'text-emerald-700' : 'text-rose-700' },
        { icon: <ShieldCheck size={14} />, label: 'Лимит CPO', value: formatMoney(item.metrics.max_cpo) },
        { icon: <CircleDollarSign size={14} />, label: 'Факт. CPO', value: formatMoney(item.metrics.actual_cpo), accent: item.metrics.actual_cpo <= item.metrics.max_cpo ? 'text-emerald-700' : 'text-rose-700' },
      ] as const)
    : ([
        { icon: <CircleDollarSign size={14} />, label: 'Чистая прибыль', value: formatMoney(item.metrics.net_profit), accent: item.metrics.net_profit >= 0 ? 'text-emerald-700' : 'text-rose-700' },
        { icon: <ShieldCheck size={14} />, label: 'Лимит CPO', value: formatMoney(item.metrics.max_cpo) },
        { icon: <CircleDollarSign size={14} />, label: 'Факт. CPO', value: formatMoney(item.metrics.actual_cpo), accent: item.metrics.actual_cpo <= item.metrics.max_cpo ? 'text-emerald-700' : 'text-rose-700' },
        { icon: <BarChart3 size={14} />, label: 'CTR', value: formatPct(item.metrics.ctr) },
        { icon: <ClipboardList size={14} />, label: 'CR', value: formatPct(item.metrics.cr) },
      ] as const);
  const showPriorityBadge = mode !== 'simple';
  const showDiagnosisBadge = mode !== 'simple';
  const showTrendBadge = mode === 'analytics' || mode === 'explanation';
  const showPrecisionBadge = mode === 'analytics';

  return (
    <div className="rounded-[18px] border border-black/5 bg-white p-4 shadow-[0_8px_20px_rgba(15,23,42,0.025)]">
      <button
        onClick={onOpen}
        className="w-full text-left"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="flex items-start gap-4">
            <div className="h-[72px] w-[72px] overflow-hidden rounded-[18px] bg-slate-100">
              {item.photo_url ? (
                <img src={item.photo_url} alt={item.title || String(item.nm_id)} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-slate-400">
                  <Package2 size={28} />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {showPriorityBadge && <Badge className={cn('rounded-full px-2.5 py-1 text-[11px]', PRIORITY_META[item.priority].className)}>{item.priority_label}</Badge>}
                <Badge className={cn('rounded-full px-2.5 py-1 text-[11px]', statusMeta.chipClass)}>{displayStatusLabel(item)}</Badge>
                {showDiagnosisBadge && <Badge variant="outline" className="rounded-full px-2.5 py-1 text-[11px]">{item.diagnosis_label}</Badge>}
                {showTrendBadge && (
                  <Badge className={cn('rounded-full px-2.5 py-1 text-[11px]', TREND_META[item.trend.signal].className)}>
                    <span className="mr-1 inline-flex">{trendIcon(item.trend.signal)}</span>
                    {item.trend.label}
                  </Badge>
                )}
                {showPrecisionBadge && <Badge variant="outline" className="rounded-full px-2.5 py-1 text-[11px]">{item.precision_label}</Badge>}
              </div>
              <h4 className="mt-2 max-w-2xl text-base font-semibold leading-snug">{item.title || `nmID ${item.nm_id}`}</h4>
              <p className="mt-1 text-[13px] text-muted-foreground">
                nmID: {item.nm_id}
                {item.vendor_code ? ` · ${item.vendor_code}` : ''}
              </p>
              <p className="mt-2 max-w-3xl text-[13px] leading-6 text-muted-foreground">{mode === 'simple' ? item.action_title : item.status_reason}</p>
              {mode !== 'simple' && (
                <p className="mt-1 max-w-3xl text-[13px] leading-6 text-foreground/80">{item.action_title}</p>
              )}
            </div>
          </div>

          <div className={cn('grid flex-1 grid-cols-2 gap-3', mode === 'simple' ? 'lg:grid-cols-3' : 'lg:grid-cols-5')}>
            {metricsToShow.map((metric) => (
              <MiniMetric key={metric.label} icon={metric.icon} label={metric.label} value={metric.value} accent={metric.accent} />
            ))}
          </div>
        </div>
      </button>

      {mode !== 'simple' && (
        <div className="mt-4 flex flex-col gap-3 border-t border-black/5 pt-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {item.issue_summary.top_titles.slice(0, 3).map((issue) => (
              <span key={issue} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                {issue}
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-2 xl:items-end">
            <div className="rounded-full bg-slate-100 px-3 py-2 text-xs text-slate-700">
              проблем {item.issue_summary.total} · фото {item.issue_summary.photos} · текст {item.issue_summary.text}
            </div>
            <div className="max-w-md text-xs text-muted-foreground xl:text-right">{item.trend.summary}</div>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="rounded-lg text-xs" onClick={onOpen}>
          Что делать
        </Button>
        <Button variant="outline" size="sm" className="rounded-lg text-xs" onClick={onOpenWhy}>
          Почему
        </Button>
        <Button variant="outline" size="sm" className="rounded-lg text-xs" onClick={onOpenAnalytics}>
          Аналитика
        </Button>
      </div>
    </div>
  );
}

function DetailFooterActions({
  item,
  navigate,
}: {
  item: AdAnalysisItem;
  navigate: ReturnType<typeof useNavigate>;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {item.workspace_link && (
        <Button className="flex-1 gap-2 rounded-2xl" onClick={() => navigate(item.workspace_link || '/workspace/cards')}>
          <Camera size={16} />
          Открыть карточку
        </Button>
      )}
      {item.wb_link && (
        <Button variant="outline" className="flex-1 gap-2 rounded-2xl" asChild>
          <a href={item.wb_link} target="_blank" rel="noreferrer">
            <ExternalLink size={16} />
            Открыть WB
          </a>
        </Button>
      )}
    </div>
  );
}

function MiniMetric({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-[14px] border border-black/5 bg-slate-50/75 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className={cn('mt-2 text-base font-semibold', accent)}>{value}</p>
    </div>
  );
}

function DetailMetric({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-black/5 bg-slate-50 px-4 py-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className={cn('mt-3 text-xl font-semibold', accent)}>{value}</p>
    </div>
  );
}

function DrawerMetric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-lg font-semibold', accent)}>{value}</p>
    </div>
  );
}

function DrawerSection({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, string]>;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</p>
      <div className="mt-3 space-y-2">
        {rows.map(([label, value]) => (
          <div key={`${title}-${label}`} className="flex items-center justify-between gap-4 text-[13px]">
            <span className="text-slate-600">{label}</span>
            <span className="font-semibold text-foreground">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
