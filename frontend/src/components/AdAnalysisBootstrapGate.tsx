import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BarChart3, CircleDollarSign, ClipboardList, Loader2, RefreshCcw } from 'lucide-react';

import api from '../api/client';
import { useStore } from '../contexts/StoreContext';
import type { AdAnalysisBootstrapStatus } from '../types';
import { Button } from './ui/button';

const POLL_INTERVAL_MS = 2500;

function statusLabel(status: AdAnalysisBootstrapStatus | null): string {
  if (!status) return 'Готовим данные для анализа рекламы...';
  return status.step || 'Готовим данные для анализа рекламы...';
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
        if (initialStatus.status === 'pending' || initialStatus.status === 'running') {
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
    const stageProgress = Number(status.stage_progress || status.progress || 0);
    return Math.max(8, Math.min(stageProgress, 96));
  }, [status]);

  if (!activeStore) {
    return (
      <div className="loading-page">
        <div className="loading-center">
          <div className="spinner" />
        </div>
      </div>
    );
  }

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
          <h1 className="text-2xl font-semibold text-foreground">Анализ рекламы пока не готов</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {error}
          </p>
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
          <h1 className="mt-2 text-[1.55rem] font-semibold tracking-tight">Собираем данные магазина из WB</h1>
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
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-[22px] border border-black/5 bg-slate-50 px-4 py-4 text-left">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-foreground shadow-sm">
              <BarChart3 size={18} />
            </div>
            <p className="mt-3 text-sm font-semibold">Реклама WB</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Кампании, расходы, клики и заказы.</p>
          </div>
          <div className="rounded-[22px] border border-black/5 bg-slate-50 px-4 py-4 text-left">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-foreground shadow-sm">
              <CircleDollarSign size={18} />
            </div>
            <p className="mt-3 text-sm font-semibold">Финансы WB</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Выручка, выплаты, комиссии и логистика.</p>
          </div>
          <div className="rounded-[22px] border border-black/5 bg-slate-50 px-4 py-4 text-left">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-foreground shadow-sm">
              <ClipboardList size={18} />
            </div>
            <p className="mt-3 text-sm font-semibold">Воронка</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Открытия, корзина, заказы и конверсия.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
