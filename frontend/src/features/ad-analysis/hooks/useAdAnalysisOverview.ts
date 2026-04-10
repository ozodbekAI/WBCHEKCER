import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import api from '@/api/client';
import type {
  AdAnalysisItem,
  AdAnalysisItemStatus,
  AdAnalysisOverview,
  AdAnalysisUploadResult,
} from '@/types';

export type AdAnalysisUploadKind = 'costs' | 'spend' | 'finance';

export type SchedulerStatus = {
  is_running: boolean;
  interval_sec: number;
  last_tick_at: string | null;
  next_tick_at: string | null;
  next_tick_in_sec: number | null;
};

export type AdAnalysisCurrentPeriod = {
  period_start: string;
  period_end: string;
};

type UseAdAnalysisOverviewParams = {
  storeId?: number;
  days?: number;
  periodPreset: string;
  periodStart?: string;
  periodEnd?: string;
  page: number;
  pageSize: number;
  statusFilter: AdAnalysisItemStatus | 'all';
  search: string;
  selectedItemNmId?: number | null;
  onSelectedItemRefresh?: (item: AdAnalysisItem | null) => void;
};

export function useAdAnalysisOverview({
  storeId,
  days,
  periodPreset,
  periodStart,
  periodEnd,
  page,
  pageSize,
  statusFilter,
  search,
  selectedItemNmId,
  onSelectedItemRefresh,
}: UseAdAnalysisOverviewParams) {
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [overview, setOverview] = useState<AdAnalysisOverview | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState<AdAnalysisUploadKind | null>(null);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [lastUploadResult, setLastUploadResult] = useState<{
    kind: AdAnalysisUploadKind;
    result: AdAnalysisUploadResult;
  } | null>(null);
  const autoBootstrapStoreRef = useRef<number | null>(null);

  const loadOverview = useCallback(async (force: boolean = false) => {
    if (!storeId) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.getAdAnalysisOverview(storeId, {
        days,
        preset: periodPreset,
        period_start: periodPreset === 'custom' ? periodStart : undefined,
        period_end: periodPreset === 'custom' ? periodEnd : undefined,
        page,
        page_size: pageSize,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        search: search.trim() || undefined,
        force,
      });
      setOverview(data);
      if (selectedItemNmId && onSelectedItemRefresh) {
        const pooledItems = [...data.items, ...data.critical_preview, ...data.growth_preview];
        const fresh = pooledItems.find((item) => item.nm_id === selectedItemNmId) || null;
        onSelectedItemRefresh(fresh);
      }
      if (force) {
        try {
          const freshSchedulerStatus = await api.getSchedulerStatus();
          setSchedulerStatus(freshSchedulerStatus);
        } catch {
          // scheduler hint is optional
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось загрузить SKU economics';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [
    storeId,
    days,
    periodPreset,
    periodStart,
    periodEnd,
    page,
    pageSize,
    statusFilter,
    search,
    selectedItemNmId,
    onSelectedItemRefresh,
  ]);

  useEffect(() => {
    if (!storeId) return;
    void loadOverview(false);
  }, [storeId, loadOverview]);

  useEffect(() => {
    autoBootstrapStoreRef.current = null;
  }, [storeId]);

  useEffect(() => {
    let cancelled = false;
    if (!storeId) return;
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
  }, [storeId]);

  useEffect(() => {
    if (!storeId || !overview || loading || bootstrapping) return;
    const hasArchive = Boolean(overview.available_period_start && overview.available_period_end);
    if (overview.snapshot_ready || hasArchive) return;
    if (autoBootstrapStoreRef.current === storeId) return;
    autoBootstrapStoreRef.current = storeId;
    setBootstrapping(true);
    void loadOverview(true).finally(() => setBootstrapping(false));
  }, [storeId, overview, loading, bootstrapping, loadOverview]);

  const handleUpload = useCallback(async (
    kind: AdAnalysisUploadKind,
    file: File | null | undefined,
    currentPeriod: AdAnalysisCurrentPeriod,
  ) => {
    if (!storeId || !file) return;
    setUploading(kind);
    try {
      const result =
        kind === 'costs'
          ? await api.uploadAdAnalysisCosts(storeId, file)
          : kind === 'spend'
            ? await api.uploadAdAnalysisManualSpend(storeId, file, currentPeriod.period_start, currentPeriod.period_end)
            : await api.uploadAdAnalysisFinance(storeId, file, currentPeriod.period_start, currentPeriod.period_end);
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
  }, [storeId, loadOverview]);

  return {
    loading,
    bootstrapping,
    overview,
    error,
    uploading,
    schedulerStatus,
    lastUploadResult,
    setLastUploadResult,
    loadOverview,
    handleUpload,
  };
}
