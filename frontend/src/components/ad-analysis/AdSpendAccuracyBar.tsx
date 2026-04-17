import React from 'react';
import { CircleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { AdAnalysisOverview } from '@/types';

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

interface AdSpendAccuracyBarProps {
  overview: AdAnalysisOverview;
}

export default function AdSpendAccuracyBar({ overview }: AdSpendAccuracyBarProps) {
  const total = overview.exact_spend + overview.estimated_spend + overview.manual_spend;
  if (total <= 0 && overview.unallocated_spend <= 0) return null;

  const pctExact = total > 0 ? (overview.exact_spend / total) * 100 : 0;
  const pctEstimated = total > 0 ? (overview.estimated_spend / total) * 100 : 0;
  const pctManual = total > 0 ? (overview.manual_spend / total) * 100 : 0;

  return (
    <div className="rounded-[16px] border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Насколько точно мы знаем расходы на рекламу
        </p>
        <span
          title="Точно привязано = расход привязан к конкретному SKU. Распределено расчётно = пропорциональная оценка. Загружено вручную = из вашего файла."
          className="cursor-help text-muted-foreground"
        >
          <CircleAlert size={12} />
        </span>
      </div>

      {/* Stacked bar */}
      {total > 0 && (
        <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-200">
          {pctExact > 0 && (
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${pctExact}%` }}
              title={`Точно привязано: ${formatMoney(overview.exact_spend)}`}
            />
          )}
          {pctEstimated > 0 && (
            <div
              className="h-full bg-amber-400 transition-all"
              style={{ width: `${pctEstimated}%` }}
              title={`Распределено расчётно: ${formatMoney(overview.estimated_spend)}`}
            />
          )}
          {pctManual > 0 && (
            <div
              className="h-full bg-sky-400 transition-all"
              style={{ width: `${pctManual}%` }}
              title={`Загружено вручную: ${formatMoney(overview.manual_spend)}`}
            />
          )}
        </div>
      )}

      {/* Labels */}
      <div className="mt-2 flex flex-wrap gap-4">
        {overview.exact_spend > 0 && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">Точно привязано:</span>
            <span className="font-medium text-foreground">{formatMoney(overview.exact_spend)}</span>
          </div>
        )}
        {overview.estimated_spend > 0 && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            <span className="text-muted-foreground">Распределено расчётно:</span>
            <span className="font-medium text-foreground">{formatMoney(overview.estimated_spend)}</span>
          </div>
        )}
        {overview.manual_spend > 0 && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="h-2 w-2 rounded-full bg-sky-400" />
            <span className="text-muted-foreground">Загружено вручную:</span>
            <span className="font-medium text-foreground">{formatMoney(overview.manual_spend)}</span>
          </div>
        )}
      </div>

      {overview.unallocated_spend > 0 && (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
          Остались неразнесённые расходы: {formatMoney(overview.unallocated_spend)}
        </div>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        Если доля расчётных расходов высокая, рекомендации ниже считаются предварительными.
      </p>
    </div>
  );
}
