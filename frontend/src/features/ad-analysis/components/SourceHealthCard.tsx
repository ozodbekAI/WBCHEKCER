import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AdAnalysisOverview, AdAnalysisSourceStatus } from '@/types';

import type { SchedulerStatus } from '../hooks/useAdAnalysisOverview';

type ViewMode = 'simple' | 'explanation' | 'analytics';

const SOURCE_MODE_META: Record<AdAnalysisSourceStatus['mode'], string> = {
  automatic: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  partial: 'border-amber-200 bg-amber-50 text-amber-700',
  manual: 'border-sky-200 bg-sky-50 text-sky-700',
  manual_required: 'border-rose-200 bg-rose-50 text-rose-700',
  failed: 'border-rose-200 bg-rose-50 text-rose-700',
  pending: 'border-slate-200 bg-slate-50 text-slate-600',
  running: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  missing: 'border-slate-200 bg-slate-50 text-slate-600',
};

function getSourceModeLabel(mode: AdAnalysisSourceStatus['mode']) {
  switch (mode) {
    case 'automatic':
      return 'Загружено';
    case 'partial':
      return 'Частично';
    case 'manual':
      return 'Есть файл';
    case 'manual_required':
      return 'Нужен файл';
    case 'failed':
      return 'Ошибка';
    case 'pending':
      return 'В очереди';
    case 'running':
      return 'Загрузка';
    case 'missing':
    default:
      return 'Не загружали';
  }
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

export function SourceHealthCard({
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
                  <p>{source.detail || '—'}</p>
                  <div className="mt-2 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
                    <div className="rounded-xl border border-black/5 bg-white px-2.5 py-1.5">
                      <span className="font-medium text-foreground">Синхронизация:</span>{' '}
                      {formatDateTime(source.synced_at || null)}
                    </div>
                    <div className="rounded-xl border border-black/5 bg-white px-2.5 py-1.5">
                      <span className="font-medium text-foreground">Покрытие периода:</span>{' '}
                      {typeof source.coverage_ratio === 'number' ? `${Math.round(source.coverage_ratio * 100)}%` : '—'}
                    </div>
                  </div>
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
