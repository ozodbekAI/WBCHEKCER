import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, CircleAlert, XCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AdAnalysisOverview, AdAnalysisSourceStatus } from '@/types';

// Spec §3.3 — user-friendly source labels
const SOURCE_USER_LABELS: Record<string, string> = {
  automatic: 'Полностью загружено',
  ok: 'Полностью загружено',
  manual: 'Загружено вручную',
  partial: 'Частично загружено',
  manual_required: 'Нужен файл',
  failed: 'Ошибка загрузки',
  error: 'Ошибка загрузки',
  pending: 'В очереди',
  running: 'Обновляется',
  missing: 'Нет данных',
  empty: 'Нет данных',
};

const SOURCE_COLORS: Record<string, { border: string; bg: string; text: string; dot: string }> = {
  automatic: { border: 'border-emerald-200', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  ok: { border: 'border-emerald-200', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  manual: { border: 'border-sky-200', bg: 'bg-sky-50', text: 'text-sky-700', dot: 'bg-sky-500' },
  partial: { border: 'border-amber-200', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  manual_required: { border: 'border-rose-200', bg: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-500' },
  failed: { border: 'border-rose-200', bg: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-500' },
  error: { border: 'border-rose-200', bg: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-500' },
  pending: { border: 'border-slate-200', bg: 'bg-slate-50', text: 'text-slate-600', dot: 'bg-slate-400' },
  running: { border: 'border-sky-200', bg: 'bg-sky-50', text: 'text-sky-700', dot: 'bg-sky-500' },
  missing: { border: 'border-slate-200', bg: 'bg-slate-50', text: 'text-slate-600', dot: 'bg-slate-400' },
  empty: { border: 'border-slate-200', bg: 'bg-slate-50', text: 'text-slate-600', dot: 'bg-slate-400' },
};

const SOURCE_NAMES: Record<string, string> = {
  advert: 'Реклама WB',
  finance: 'Финансы WB',
  funnel: 'Воронка продаж',
};

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getReadinessLevel(overview: AdAnalysisOverview) {
  const dq = overview.data_quality;
  if (!dq) return 'high';
  if (dq.decision_ready && dq.confidence === 'high') return 'high';
  if (dq.decision_ready) return 'medium';
  return 'low';
}

function getReadinessConfig(level: 'high' | 'medium' | 'low') {
  if (level === 'high') return {
    icon: CheckCircle2,
    title: 'Данные готовы',
    text: 'Источники загружены и покрывают выбранный период.',
    cardClass: 'border-emerald-200 bg-emerald-50/50',
    iconClass: 'text-emerald-600',
    titleClass: 'text-emerald-900',
    textClass: 'text-emerald-700',
  };
  if (level === 'medium') return {
    icon: CircleAlert,
    title: 'Данные частично готовы',
    text: 'Часть источников покрывает период не полностью.',
    cardClass: 'border-amber-200 bg-amber-50/50',
    iconClass: 'text-amber-600',
    titleClass: 'text-amber-900',
    textClass: 'text-amber-700',
  };
  return {
    icon: AlertTriangle,
    title: 'Недостаточно данных',
    text: 'Закройте недостающие источники для точных рекомендаций.',
    cardClass: 'border-rose-200 bg-rose-50/50',
    iconClass: 'text-rose-600',
    titleClass: 'text-rose-900',
    textClass: 'text-rose-700',
  };
}

function SourceChip({ source, blocked }: { source: AdAnalysisSourceStatus; blocked: boolean }) {
  const colors = SOURCE_COLORS[source.mode] || SOURCE_COLORS.missing;
  const name = SOURCE_NAMES[source.id] || source.label;

  const adjustedColors = (source.coverage_ratio != null && source.coverage_ratio < 1 && ['automatic', 'ok'].includes(source.mode))
    ? SOURCE_COLORS.partial
    : colors;

  const coveragePct = source.coverage_ratio != null ? Math.round(source.coverage_ratio * 100) : null;

  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
      adjustedColors.border, adjustedColors.bg, adjustedColors.text,
      blocked && 'ring-1 ring-rose-300',
    )}>
      <span className={cn('h-1.5 w-1.5 rounded-full', adjustedColors.dot)} />
      {name}
      {coveragePct != null && coveragePct < 100 && <span className="opacity-70">{coveragePct}%</span>}
      {blocked && <span className="text-rose-600">⚠</span>}
    </span>
  );
}

function SourceCard({ source, blocked }: { source: AdAnalysisSourceStatus; blocked: boolean }) {
  const colors = SOURCE_COLORS[source.mode] || SOURCE_COLORS.missing;
  const userLabel = SOURCE_USER_LABELS[source.mode] || source.mode;
  const name = SOURCE_NAMES[source.id] || source.label;

  const adjustedLabel = (source.coverage_ratio != null && source.coverage_ratio < 1 && ['automatic', 'ok'].includes(source.mode))
    ? 'Частично загружено'
    : userLabel;
  const adjustedColors = (source.coverage_ratio != null && source.coverage_ratio < 1 && ['automatic', 'ok'].includes(source.mode))
    ? SOURCE_COLORS.partial
    : colors;

  const coveragePct = source.coverage_ratio != null ? Math.round(source.coverage_ratio * 100) : null;
  const coverageText = source.coverage_start && source.coverage_end
    ? `${source.coverage_start} — ${source.coverage_end}`
    : null;

  return (
    <div className={cn('rounded-xl border p-3', adjustedColors.border, adjustedColors.bg)}>
      <div className="flex items-center gap-2">
        <span className={cn('h-2 w-2 rounded-full', adjustedColors.dot)} />
        <p className={cn('text-sm font-semibold', adjustedColors.text)}>{name}</p>
      </div>
      <p className={cn('mt-0.5 text-xs', adjustedColors.text)}>{adjustedLabel}</p>
      {coveragePct != null && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Покрытие: {coveragePct}%{coverageText ? ` · ${coverageText}` : ''}
        </p>
      )}
      {source.synced_at && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Обновлено {formatDateTime(source.synced_at)}
        </p>
      )}
      {blocked && (
        <p className="mt-1 text-[11px] font-medium text-rose-600">⚠ Заблокирован</p>
      )}
      {source.detail && (
        <p className="mt-1 text-[11px] text-muted-foreground">{source.detail}</p>
      )}
    </div>
  );
}

// Spec §3.4 — deterministic primary CTA
export function getPrimaryCTA(overview: AdAnalysisOverview, callbacks: {
  onGoToData: () => void;
  onUploadCosts: () => void;
  onUploadFinance: () => void;
  onUploadSpend: () => void;
  onOpenCriticalSKU: () => void;
  onOpenGrowth: () => void;
  onOpenProducts: () => void;
}) {
  const blocked = overview.data_quality?.blocked_sources || [];
  if (blocked.length > 0) {
    return {
      label: 'Перейти к данным',
      subtitle: `Заблокировано: ${blocked.join(', ')}`,
      action: callbacks.onGoToData,
    };
  }
  if (overview.upload_needs.missing_costs_count > 0) {
    return {
      label: 'Загрузить себестоимость',
      subtitle: `Не хватает для ${overview.upload_needs.missing_costs_count} SKU`,
      action: callbacks.onUploadCosts,
    };
  }
  if (overview.upload_needs.needs_manual_finance) {
    return {
      label: 'Добавить финансовый файл',
      subtitle: 'Финансовый источник неполный',
      action: callbacks.onUploadFinance,
    };
  }
  if (overview.upload_needs.needs_manual_spend) {
    return {
      label: 'Разнести остаток расходов',
      subtitle: `Нераспределённые расходы`,
      action: callbacks.onUploadSpend,
    };
  }
  if (overview.data_quality?.decision_ready && overview.critical_preview.length > 0) {
    return {
      label: 'Открыть самый срочный SKU',
      subtitle: overview.critical_preview[0]?.title || '',
      action: callbacks.onOpenCriticalSKU,
    };
  }
  if (overview.data_quality?.decision_ready && overview.growth_preview.length > 0) {
    return {
      label: 'Посмотреть точки роста',
      subtitle: `${overview.growth_preview.length} SKU с потенциалом`,
      action: callbacks.onOpenGrowth,
    };
  }
  return {
    label: 'Посмотреть товары',
    subtitle: '',
    action: callbacks.onOpenProducts,
  };
}

interface DataReadinessCardProps {
  overview: AdAnalysisOverview;
  primaryCTA: { label: string; subtitle: string; action: () => void } | null;
}

export default function DataReadinessCard({ overview, primaryCTA }: DataReadinessCardProps) {
  const level = getReadinessLevel(overview);
  const config = getReadinessConfig(level);
  const Icon = config.icon;
  const sources = overview.source_statuses || [];
  const blockedSet = new Set(overview.data_quality?.blocked_sources || []);
  const [expanded, setExpanded] = useState(false);

  // Auto-expand if data is not ready
  const shouldShowDetails = level === 'low';

  return (
    <div className={cn('rounded-2xl border p-3', config.cardClass)}>
      {/* Compact header — always visible */}
      <div className="flex items-center gap-3">
        <Icon size={18} className={config.iconClass} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className={cn('text-sm font-semibold', config.titleClass)}>{config.title}</h3>
            <span className={cn('text-xs', config.textClass)}>{config.text}</span>
          </div>
        </div>

        {/* Source chips — compact inline preview */}
        <div className="hidden items-center gap-1.5 md:flex">
          {sources.map((source) => (
            <SourceChip key={source.id} source={source} blocked={blockedSet.has(source.id)} />
          ))}
        </div>

        {primaryCTA && (
          <Button
            size="sm"
            className="shrink-0 gap-1.5 rounded-xl text-xs"
            onClick={primaryCTA.action}
          >
            {primaryCTA.label}
          </Button>
        )}

        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-black/5"
        >
          {(expanded || shouldShowDetails) ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {/* Expanded details */}
      {(expanded || shouldShowDetails) && sources.length > 0 && (
        <div className="mt-3 grid gap-2 border-t border-black/5 pt-3 md:grid-cols-3 lg:grid-cols-5">
          {sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              blocked={blockedSet.has(source.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
