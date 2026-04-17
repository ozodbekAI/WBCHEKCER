import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, CircleDollarSign, ClipboardList, Info, Loader2, RefreshCcw, XCircle } from 'lucide-react';

import api from '../api/client';
import { useStore } from '../contexts/StoreContext';
import type { AdAnalysisBootstrapStatus, AdAnalysisSourceStatus, BootstrapStage } from '../types';
import { Button } from './ui/button';

const POLL_INTERVAL_MS = 2500;

const STAGE_LABELS: Record<BootstrapStage, string> = {
  queued: 'Ставим задачу в очередь',
  fetching_advert: 'Загружаем рекламу',
  fetching_finance: 'Загружаем финансы',
  fetching_funnel: 'Загружаем воронку',
  building_snapshot: 'Собираем итоговый снимок',
  completed_partial: 'Готово частично',
  completed: 'Готово',
  failed: 'Ошибка',
};

const SOURCE_MODE_LABELS: Record<string, string> = {
  automatic: 'Загружено',
  ok: 'Загружено',
  manual: 'Ручной файл',
  partial: 'Частично',
  manual_required: 'Нужен файл',
  failed: 'Ошибка',
  pending: 'Ожидание',
  running: 'Загрузка...',
  missing: 'Отсутствует',
  error: 'Ошибка',
  empty: 'Не загружали',
};

const SOURCE_MODE_COLORS: Record<string, string> = {
  automatic: 'bg-emerald-100 text-emerald-700',
  ok: 'bg-emerald-100 text-emerald-700',
  manual: 'bg-sky-100 text-sky-700',
  partial: 'bg-amber-100 text-amber-700',
  manual_required: 'bg-rose-100 text-rose-700',
  failed: 'bg-rose-100 text-rose-700',
  pending: 'bg-slate-100 text-slate-600',
  running: 'bg-sky-100 text-sky-700',
  missing: 'bg-slate-100 text-slate-600',
  error: 'bg-rose-100 text-rose-700',
  empty: 'bg-slate-100 text-slate-600',
};

const FAILED_SOURCE_LABELS: Record<string, string> = {
  advert: 'Реклама',
  finance: 'Финансы',
  funnel: 'Воронка',
  snapshot: 'Снимок',
  unknown: 'Неизвестный',
};

function statusLabel(status: AdAnalysisBootstrapStatus | null): string {
  if (!status) return 'Готовим данные для анализа рекламы...';
  if (status.current_stage && STAGE_LABELS[status.current_stage]) {
    return STAGE_LABELS[status.current_stage];
  }
  return status.step || 'Готовим данные для анализа рекламы...';
}

function SourceStatusBadge({ source }: { source: AdAnalysisSourceStatus }) {
  const statusText = SOURCE_MODE_LABELS[source.mode] || source.mode;
  const colorClass = SOURCE_MODE_COLORS[source.mode] || 'bg-slate-100 text-slate-600';
  const icon = ['automatic', 'ok'].includes(source.mode) ? (
    <CheckCircle2 size={12} />
  ) : ['failed', 'manual_required', 'error'].includes(source.mode) ? (
    <XCircle size={12} />
  ) : source.mode === 'running' ? (
    <Loader2 size={12} className="animate-spin" />
  ) : null;

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground font-medium">{source.label}:</span>
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${colorClass}`}>
        {icon}
        {statusText}
      </span>
      {source.detail && (
        <span className="text-muted-foreground text-[10px]">{source.detail}</span>
      )}
    </div>
  );
}

export default function AdAnalysisBootstrapGate({ children }: { children: React.ReactNode }) {
  const { activeStore } = useStore();
  const [status, setStatus] = useState<AdAnalysisBootstrapStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  useEffect(() => {
    let cancelled = false;
    stopPolling();

    if (!activeStore) {
      setStatus(null);
      setLoading(false);
      setError('');
      return;
    }

    const isTerminal = (s: AdAnalysisBootstrapStatus) =>
      s.status === 'completed' || s.status === 'completed_partial' || s.status === 'failed';

    const handleStatus = (nextStatus: AdAnalysisBootstrapStatus) => {
      if (cancelled) return;
      setStatus(nextStatus);
      if (nextStatus.status === 'completed' || nextStatus.status === 'completed_partial') {
        stopPolling();
        setError('');
        setLoading(false);
        return;
      }
      if (nextStatus.status === 'failed') {
        stopPolling();
        setError(nextStatus.error || nextStatus.step || 'Не удалось подготовить анализ рекламы');
        setLoading(false);
        return;
      }
      setLoading(true);
    };

    const poll = async () => {
      if (!activeStore) return;
      try {
        const nextStatus = await api.getAdAnalysisBootstrapStatus(activeStore.id);
        handleStatus(nextStatus);
      } catch (err) {
        if (cancelled) return;
        stopPolling();
        setError(err instanceof Error ? err.message : 'Не удалось проверить статус загрузки');
        setLoading(false);
      }
    };

    const start = async () => {
      setLoading(true);
      setError('');
      try {
        const initialStatus = await api.startAdAnalysisBootstrap(activeStore.id);
        handleStatus(initialStatus);
        if (!isTerminal(initialStatus)) {
          pollRef.current = setInterval(() => {
            void poll();
          }, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Не удалось запустить подготовку анализа рекламы');
        setLoading(false);
      }
    };

    void start();

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [activeStore?.id]);

  const progress = useMemo(() => {
    if (!status) return 8;
    if (status.status === 'completed' || status.status === 'completed_partial') return 100;
    if (status.stage_progress !== undefined) {
      return Math.max(8, Math.min(status.stage_progress, 96));
    }
    return Math.max(8, Math.min(status.progress || 0, 96));
  }, [status]);

  const sources: AdAnalysisSourceStatus[] = status?.source_statuses || [];

  if (!activeStore) {
    return (
      <div className="loading-page">
        <div className="loading-center">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  // Allow through if completed or completed_partial — no residual banner
  // Page-level readiness is handled by DataReadinessCard inside AdAnalysisPage
  if (!loading && !error && (status?.status === 'completed' || status?.status === 'completed_partial')) {
    return <>{children}</>;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="w-full max-w-xl rounded-3xl border border-border bg-card p-8 shadow-sm text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            <AlertTriangle size={24} />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">
            Анализ рекламы пока не готов
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{error}</p>

          {sources.length > 0 && (
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              {sources.map((source) => (
                <SourceStatusBadge key={source.id} source={source} />
              ))}
            </div>
          )}

          {status?.failed_source && (
            <p className="mt-2 text-xs text-muted-foreground">
              Проблемный источник: <span className="font-medium">{FAILED_SOURCE_LABELS[status.failed_source] || status.failed_source}</span>
            </p>
          )}

          <div className="mt-6 flex justify-center gap-3">
            <Button onClick={() => window.location.reload()}>
              <RefreshCcw size={14} className="mr-2" />
              Повторить
            </Button>
            <Button variant="outline" onClick={() => window.history.back()}>
              Назад
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-10">
      <section className="w-full max-w-3xl rounded-[28px] border border-black/5 bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.08)]">
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Анализ рекламы</p>
          <h1 className="mt-2 text-[1.55rem] font-semibold tracking-tight">Загружаем данные из WB</h1>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Раздел откроется автоматически, когда мы сохраним рекламу, финансы и воронку в backend.
          </p>
        </div>

        <div className="mt-6 rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-[#7c6cf2] shadow-sm">
              <Loader2 size={18} className="animate-spin" />
            </div>
            <div className="min-w-0 text-left">
              <p className="text-sm font-semibold text-foreground">Подготовка уже запущена</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{statusLabel(status)}</p>
            </div>
            <div className="ml-auto text-right">
              <div className="text-lg font-semibold text-foreground">{progress}%</div>
            </div>
          </div>

          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#6d5cf6_0%,#4f46e5_100%)] transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>

          {sources.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-3">
              {sources.map((source) => (
                <SourceStatusBadge key={source.id} source={source} />
              ))}
            </div>
          )}
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <DataSourceCard
            icon={BarChart3}
            title="Реклама WB"
            description="Кампании, расходы, клики и заказы."
            source={sources.find((s) => s.id === 'advert')}
          />
          <DataSourceCard
            icon={CircleDollarSign}
            title="Финансы WB"
            description="Выручка, выплаты, комиссии и логистика."
            source={sources.find((s) => s.id === 'finance')}
          />
          <DataSourceCard
            icon={ClipboardList}
            title="Воронка"
            description="Открытия, корзина, заказы и конверсия."
            source={sources.find((s) => s.id === 'funnel')}
          />
        </div>
      </section>
    </div>
  );
}

function DataSourceCard({
  icon: Icon,
  title,
  description,
  source,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  source?: AdAnalysisSourceStatus;
}) {
  const mode = source?.mode;
  const statusColor = ['automatic', 'ok'].includes(mode || '')
    ? 'border-emerald-200 bg-emerald-50'
    : ['failed', 'manual_required', 'error'].includes(mode || '')
      ? 'border-rose-200 bg-rose-50'
      : 'border-black/5 bg-slate-50';

  return (
    <div className={`rounded-[22px] border px-4 py-4 text-left ${statusColor}`}>
      <div className="flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-foreground shadow-sm">
          <Icon size={18} />
        </div>
        {['automatic', 'ok'].includes(mode || '') && <CheckCircle2 size={16} className="text-emerald-600 ml-auto" />}
        {['failed', 'manual_required', 'error'].includes(mode || '') && <XCircle size={16} className="text-rose-500 ml-auto" />}
        {mode === 'running' && <Loader2 size={16} className="text-sky-600 ml-auto animate-spin" />}
      </div>
      <p className="mt-3 text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{source?.detail || description}</p>
      {source && (
        <div className="mt-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${SOURCE_MODE_COLORS[source.mode] || 'bg-slate-100 text-slate-600'}`}>
            {SOURCE_MODE_LABELS[source.mode] || source.mode}
          </span>
        </div>
      )}
    </div>
  );
}
