import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import api from '../api/client';
import { saveSyncTask } from '../components/SyncProgressBanner';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Camera,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  Copy,
  ExternalLink,
  FlaskConical,
  Loader2,
  MessageSquare,
  MoreVertical,
  Package,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Video,
  X,
} from 'lucide-react';
import type { Card, CardListResponse } from '../types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type SeverityFilter = 'all' | 'has_issues' | 'no_issues' | 'postponed' | 'unconfirmed';
type SortFilter = 'issues' | 'score';

interface SyncPreview {
  total_wb: number;
  changed_count: number;
  unchanged_count: number;
  changed: Array<{
    nm_id: number;
    title?: string | null;
    vendor_code?: string | null;
    status: 'new' | 'changed' | 'ok';
    subject?: string | null;
  }>;
}

interface QualityMetric {
  label: string;
  key: string;
  max: number;
}

const METRICS: QualityMetric[] = [
  { label: 'Хар-ки', key: 'characteristics_score', max: 20 },
  { label: 'Title', key: 'title_score', max: 20 },
  { label: 'Desc', key: 'description_score', max: 20 },
  { label: 'Фото', key: 'photos_score', max: 20 },
  { label: 'Видео', key: 'video_score', max: 10 },
  { label: 'Ракурс', key: 'angles_score', max: 10 },
  { label: 'Cons', key: 'seo_score', max: 10 },
];

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function metricColor(score: number, max: number): string {
  const ratio = max > 0 ? score / max : 0;
  if (ratio >= 0.75) return 'bg-zone-green';
  if (ratio >= 0.45) return 'bg-zone-yellow';
  if (ratio > 0) return 'bg-zone-red';
  return 'bg-muted';
}


function metricScore(card: Card, metric: QualityMetric): number {
  const breakdown = (card.score_breakdown || {}) as Record<string, unknown>;
  if (metric.key === 'angles_score') {
    const photos = toNumber(breakdown.photos_score);
    return clamp(Math.round(photos / 2), 0, metric.max);
  }
  return clamp(toNumber(breakdown[metric.key]), 0, metric.max);
}

function pluralErrors(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ошибка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} ошибки`;
  return `${n} ошибок`;
}

const DEFAULT_CONFIRMATION_TOTAL = 7;

function getCardConfirmation(card: Card) {
  const summary = card.confirmation_summary;
  return {
    confirmed: summary?.confirmed_count ?? 0,
    total: summary?.total_sections ?? DEFAULT_CONFIRMATION_TOTAL,
    reviewer: summary?.last_confirmed_by_name || null,
    date: summary?.last_confirmed_at
      ? new Date(summary.last_confirmed_at).toLocaleString('ru-RU', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null,
  };
}

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase();
}

function statusForCard(card: Card): {
  mode: 'critical' | 'warning' | 'success';
  label: string;
} {
  if ((card.critical_issues_count ?? 0) > 0) {
    return { mode: 'critical', label: 'Требует исправления' };
  }
  if ((card.warnings_count ?? 0) > 0 || (card.improvements_count ?? 0) > 0) {
    return { mode: 'warning', label: 'Есть отложенные' };
  }
  return { mode: 'success', label: 'Карточка корректна' };
}

function scoreColor(score: number | null): string {
  if (!score) return 'text-muted-foreground';
  if (score >= 75) return 'text-zone-green';
  if (score >= 55) return 'text-zone-yellow';
  return 'text-zone-red';
}

const STATUS_STYLES = {
  critical: {
    badge: 'bg-zone-red/10 text-zone-red',
    icon: CircleDot,
  },
  warning: {
    badge: 'bg-zone-yellow/10 text-zone-yellow',
    icon: Clock3,
  },
  success: {
    badge: 'bg-zone-green/10 text-zone-green',
    icon: CheckCircle2,
  },
} as const;

export default function CardListPage() {
  const navigate = useNavigate();
  const { activeStore } = useStore();
  const [searchParams, setSearchParams] = useSearchParams();

  const [cards, setCards] = useState<Card[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [sortBy, setSortBy] = useState<SortFilter>('issues');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [analysisTask, setAnalysisTask] = useState<{ taskId: string; step: string; progress: number; status: string } | null>(null);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncPreview, setSyncPreview] = useState<SyncPreview | null>(null);
  const [syncPreviewLoading, setSyncPreviewLoading] = useState(false);
  const [syncSubmitting, setSyncSubmitting] = useState(false);
  const [syncPreviewError, setSyncPreviewError] = useState('');
  const analysisPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [schedulerStatus, setSchedulerStatus] = useState<{ last_tick_at: string | null; next_tick_in_sec: number | null; is_running: boolean } | null>(null);

  const loadSchedulerStatus = async () => {
    try {
      const s = await api.getSchedulerStatus();
      setSchedulerStatus(s);
    } catch { /* ignore */ }
  };

  const handleResetAndAnalyze = async () => {
    if (!activeStore || analysisTask?.status === 'running') return;
    try {
      const res = await api.startResetAndAnalyze(activeStore.id);
      setAnalysisTask({ taskId: res.task_id, step: 'Анализ начался...', progress: 0, status: 'pending' });

      if (analysisPollRef.current) clearInterval(analysisPollRef.current);
      analysisPollRef.current = setInterval(async () => {
        try {
          const s = await api.getSyncStatus(activeStore.id, res.task_id);
          setAnalysisTask({ taskId: res.task_id, step: s.step || '...', progress: s.progress || 0, status: s.status });
          if (s.status === 'completed' || s.status === 'failed') {
            if (analysisPollRef.current) clearInterval(analysisPollRef.current);
            await loadCards();
            setTimeout(() => setAnalysisTask(null), 6000);
          }
        } catch {
          if (analysisPollRef.current) clearInterval(analysisPollRef.current);
        }
      }, 2000);
    } catch (err: any) {
      setAnalysisTask({ taskId: '', step: `Ошибка: ${err.message}`, progress: 0, status: 'failed' });
      setTimeout(() => setAnalysisTask(null), 5000);
    }
  };

  const loadSyncPreview = async () => {
    if (!activeStore) return;
    setSyncPreviewLoading(true);
    setSyncPreviewError('');
    try {
      const preview = await api.getSyncPreview(activeStore.id);
      setSyncPreview(preview);
    } catch (err: any) {
      setSyncPreview(null);
      setSyncPreviewError(err.message || 'Не удалось получить превью синхронизации');
    } finally {
      setSyncPreviewLoading(false);
    }
  };

  const openSyncDialog = async () => {
    if (!activeStore) return;
    setSyncDialogOpen(true);
    await loadSyncPreview();
  };

  const startIncrementalSync = async () => {
    if (!activeStore || syncSubmitting) return;
    setSyncSubmitting(true);
    try {
      const task = await api.startSync(activeStore.id, 'incremental');
      saveSyncTask(activeStore.id, task.task_id);
      toast.success('Синхронизация запущена');
      setSyncDialogOpen(false);
      await loadCards();
    } catch (err: any) {
      toast.error(err.message || 'Не удалось запустить синхронизацию');
    } finally {
      setSyncSubmitting(false);
    }
  };

  const startSelectedCardSync = async (card: Card) => {
    if (!activeStore) return;
    try {
      const task = await api.startSync(activeStore.id, 'manual', [card.nm_id]);
      saveSyncTask(activeStore.id, task.task_id);
      toast.success(`Карточка ${card.nm_id} поставлена в синхронизацию`);
    } catch (err: any) {
      toast.error(err.message || 'Не удалось синхронизировать карточку');
    }
  };

  useEffect(() => () => { if (analysisPollRef.current) clearInterval(analysisPollRef.current); }, []);

  useEffect(() => {
    const querySeverity = searchParams.get('severity');
    if (querySeverity === 'has_issues' || querySeverity === 'no_issues' || querySeverity === 'postponed' || querySeverity === 'unconfirmed') {
      setSeverityFilter(querySeverity);
    } else {
      setSeverityFilter('all');
    }
  }, [searchParams]);

  useEffect(() => {
    if (activeStore) {
      void loadCards();
    }
  }, [activeStore, page, severityFilter, sortBy]);

  useEffect(() => {
    void loadSchedulerStatus();
    const interval = setInterval(loadSchedulerStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadCards = async () => {
    if (!activeStore) return;
    setLoading(true);
    try {
      const filters: Record<string, unknown> = {};
      if (severityFilter === 'has_issues') filters.has_issues = true;
      else if (severityFilter === 'no_issues') filters.no_issues = true;
      else if (severityFilter === 'unconfirmed') filters.is_fully_confirmed = false;
      if (search.trim()) filters.search = search.trim();

      const data: CardListResponse = await api.getCards(activeStore.id, page, 50, filters);
      setCards(data.items);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    await loadCards();
  };

  const handleSeverityChange = (next: SeverityFilter) => {
    setSeverityFilter(next);
    setPage(1);
    const nextParams = new URLSearchParams(searchParams);
    if (next === 'all') nextParams.delete('severity');
    else nextParams.set('severity', next);
    setSearchParams(nextParams, { replace: true });
  };

  const visibleCards = useMemo(() => {
    let list = [...cards];
    if (severityFilter === 'has_issues') {
      list = list.filter((c) => (c.critical_issues_count ?? 0) + (c.warnings_count ?? 0) + (c.improvements_count ?? 0) > 0);
    } else if (severityFilter === 'no_issues') {
      list = list.filter((c) => (c.critical_issues_count ?? 0) + (c.warnings_count ?? 0) + (c.improvements_count ?? 0) === 0);
    } else if (severityFilter === 'postponed') {
      list = list.filter((c) => (c.warnings_count ?? 0) > 0 || (c.improvements_count ?? 0) > 0);
    } else if (severityFilter === 'unconfirmed') {
      list = list.filter((c) => {
        const summary = c.confirmation_summary;
        const total = summary?.total_sections ?? DEFAULT_CONFIRMATION_TOTAL;
        const confirmed = summary?.confirmed_count ?? 0;
        return confirmed < total;
      });
    }
    if (sortBy === 'issues') {
      list.sort((a, b) => {
        const ai = (a.critical_issues_count ?? 0) + (a.warnings_count ?? 0) + (a.improvements_count ?? 0);
        const bi = (b.critical_issues_count ?? 0) + (b.warnings_count ?? 0) + (b.improvements_count ?? 0);
        return sortDir === 'desc' ? bi - ai : ai - bi;
      });
    } else {
      list.sort((a, b) => sortDir === 'desc' ? (b.score ?? 0) - (a.score ?? 0) : (a.score ?? 0) - (b.score ?? 0));
    }
    return list;
  }, [cards, severityFilter, sortBy, sortDir]);

  const cardsWithIssues = useMemo(
    () => visibleCards.filter((c) => (c.critical_issues_count ?? 0) + (c.warnings_count ?? 0) + (c.improvements_count ?? 0) > 0).length,
    [visibleCards],
  );
  const criticalCards = useMemo(
    () => visibleCards.filter((c) => (c.critical_issues_count ?? 0) > 0).length,
    [visibleCards],
  );

  const isAnalysisRunning = analysisTask?.status === 'running' || analysisTask?.status === 'pending';
  const hasActiveFilters = severityFilter !== 'all' || search.length > 0;

  const handleReset = () => {
    setSeverityFilter('all');
    setSearch('');
    setPage(1);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('severity');
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <TooltipProvider delayDuration={200}>
      <>
        <div className="min-h-screen bg-muted/40">
          {/* ── 1. Nav ── */}
          <nav className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border">
            <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between">
              <button
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => navigate('/workspace')}
              >
                <ArrowLeft className="h-4 w-4" />
                Рабочее пространство
              </button>
              <Badge variant="secondary" className="text-xs font-normal px-2.5 py-0.5">
                Расширенный режим
              </Badge>
            </div>
          </nav>

          {/* ── 2. Header ── */}
          <div className="max-w-[1400px] mx-auto px-6 pt-4 pb-1 flex items-center justify-between">
            <h1 className="text-lg font-semibold text-foreground">Карточки товаров</h1>
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void openSyncDialog()}
                disabled={!activeStore || syncPreviewLoading || isAnalysisRunning}
                className="gap-1.5 h-8 text-sm"
              >
                {syncPreviewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Сверить с WB
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetAndAnalyze}
                disabled={!!isAnalysisRunning}
                className="gap-1.5 h-8 text-sm"
              >
                {isAnalysisRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                Заново
              </Button>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <RefreshCw
                  className={`h-3.5 w-3.5 ${schedulerStatus?.is_running ? 'text-zone-green' : 'text-muted-foreground'}`}
                />
                {schedulerStatus ? (
                  <span>
                    {schedulerStatus.last_tick_at
                      ? `Обновлено: ${new Date(schedulerStatus.last_tick_at + 'Z').toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
                      : 'Ожидание...'}
                    {schedulerStatus.next_tick_in_sec != null && (
                      <span className="ml-1.5 text-muted-foreground/60">
                        · след. через {schedulerStatus.next_tick_in_sec < 60
                          ? `${schedulerStatus.next_tick_in_sec}с`
                          : `${Math.round(schedulerStatus.next_tick_in_sec / 60)}м`}
                      </span>
                    )}
                  </span>
                ) : (
                  <span>Авто-обновление каждые 10 мин</span>
                )}
              </div>
            </div>
          </div>

          {/* ── 3. FilterPanel ── */}
          <div className="bg-card border-b border-border px-6 py-3">
            <div className="max-w-[1400px] mx-auto flex items-center gap-3">
              <form className="relative w-[260px]" onSubmit={handleSearch}>
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="ID, артикул или название..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full h-8 pl-8 pr-3 text-sm rounded-md border border-border/50 bg-secondary/40 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                />
              </form>

              <Select value={severityFilter} onValueChange={(v) => handleSeverityChange(v as SeverityFilter)}>
                <SelectTrigger className="w-[160px] h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все карточки</SelectItem>
                  <SelectItem value="has_issues">Есть проблемы</SelectItem>
                  <SelectItem value="no_issues">Нет проблем</SelectItem>
                  <SelectItem value="postponed">Отложенные</SelectItem>
                  <SelectItem value="unconfirmed">Не подтверждено</SelectItem>
                </SelectContent>
              </Select>

              <div className="flex items-center gap-0.5">
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortFilter)}>
                  <SelectTrigger className="w-[170px] h-8 text-sm border-dashed">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="issues">По кол-ву проблем</SelectItem>
                    <SelectItem value="score">По рейтингу</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
                >
                  {sortDir === 'desc' ? (
                    <ArrowDown className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ArrowUp className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </Button>
              </div>

              {hasActiveFilters && (
                <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground gap-1.5" onClick={handleReset}>
                  <X className="h-3.5 w-3.5" />
                  Сбросить
                </Button>
              )}

              <div className="flex-1" />

              <div className="text-xs text-muted-foreground/70 flex items-center gap-1.5 select-none">
                <span>Товаров <span className="text-foreground/60 font-medium">{visibleCards.length}</span></span>
                <span className="text-border">·</span>
                <span>С ошибками <span className="text-destructive/70 font-medium">{cardsWithIssues}</span></span>
                <span className="text-border">·</span>
                <span>Критичных <span className="text-destructive/70 font-medium">{criticalCards}</span></span>
              </div>
            </div>
          </div>

          {/* ── 4. Content ── */}
          <div className="max-w-[1400px] mx-auto px-6 py-4">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                  <Loader2 className="h-8 w-8 text-muted-foreground animate-spin" />
                </div>
                <span className="text-sm text-muted-foreground">Загрузка карточек...</span>
              </div>
            ) : visibleCards.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                  <Package className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium text-foreground mb-1">Товары не найдены</h3>
                <p className="text-sm text-muted-foreground">Попробуйте изменить фильтры или строку поиска</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-3">
                  Показано <span className="font-medium">{visibleCards.length}</span> товаров
                </p>

                <div className="grid gap-4">
                  {visibleCards.map((card) => {
                    const status = statusForCard(card);
                    const score = card.score ?? 0;
                    const potentialGain = Math.max(3, Math.max(0, Math.round((100 - score) * 0.35)));
                    const confirmation = getCardConfirmation(card);
                    const isComplete = confirmation.confirmed === confirmation.total;
                    const hasPartialConfirmation = confirmation.confirmed > 0 && !isComplete;
                    const StatusIcon = STATUS_STYLES[status.mode].icon;

                    return (
                      <div key={card.id} className="group bg-card border border-border rounded-xl hover:shadow-md transition-all duration-200">
                        {/* Main grid row */}
                        <div className="grid items-center gap-4 p-4" style={{ gridTemplateColumns: '340px 1fr 100px 40px 200px auto' }}>
                          {/* Col 1: Product */}
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-muted flex-shrink-0 flex items-center justify-center border border-border">
                              {card.main_photo_url ? (
                                <img src={card.main_photo_url} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <Package size={18} className="text-muted-foreground" />
                              )}
                              <span
                                className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-card ${
                                  status.mode === 'critical' ? 'bg-zone-red' :
                                  status.mode === 'warning' ? 'bg-zone-yellow' : 'bg-zone-green'
                                }`}
                              />
                            </div>
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <a
                                href={`https://www.wildberries.ru/catalog/${card.nm_id}/detail.aspx`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-medium text-foreground hover:text-primary hover:underline inline-flex items-start gap-1 max-w-full"
                              >
                                <span className="line-clamp-2 break-words">{card.title || `Карточка ${card.nm_id}`}</span>
                                <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-0 group-hover:opacity-60 transition-opacity mt-0.5" />
                              </a>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => { navigator.clipboard.writeText(String(card.nm_id)); toast('Скопировано'); }}
                                  className="inline-flex items-center gap-0.5 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  {card.nm_id}
                                  <Copy size={10} className="opacity-0 group-hover:opacity-60" />
                                </button>
                                {card.vendor_code && (
                                  <>
                                    <span className="text-[11px] text-muted-foreground/40">·</span>
                                    <button
                                      onClick={() => { navigator.clipboard.writeText(String(card.vendor_code)); toast('Скопировано'); }}
                                      className="inline-flex items-center gap-0.5 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                      {card.vendor_code}
                                      <Copy size={10} className="opacity-0 group-hover:opacity-60" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Col 2: Metric bars */}
                          <div className="flex items-center">
                            <div className="flex items-end gap-2.5 justify-center w-full">
                              {METRICS.map((metric) => {
                                const mScore = metricScore(card, metric);
                                const ratio = metric.max > 0 ? mScore / metric.max : 0;
                                const pct = Math.round(ratio * 100);
                                const fillHeight = clamp(Math.round(12 + ratio * 30), 6, 44);
                                const colorClass = metricColor(mScore, metric.max);

                                return (
                                  <Tooltip key={`${card.id}-${metric.key}`}>
                                    <TooltipTrigger asChild>
                                      <div className="flex flex-col items-center gap-1 cursor-default">
                                        <div className="relative w-[12px] h-[44px] rounded-[4px] bg-muted/50 flex items-end overflow-hidden">
                                          <span
                                            className={`block w-full rounded-[4px] transition-all ${colorClass}`}
                                            style={{ height: `${fillHeight}px` }}
                                          />
                                        </div>
                                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground leading-none">
                                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${colorClass}`} />
                                          {metric.label}
                                        </span>
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="text-xs">
                                      <div className="font-semibold">{pct}%</div>
                                      <div className="text-muted-foreground">{mScore}/{metric.max}</div>
                                    </TooltipContent>
                                  </Tooltip>
                                );
                              })}
                            </div>
                          </div>

                          {/* Col 3: Score */}
                          <div className="flex flex-col items-center gap-0.5 px-4 min-w-[100px]">
                            <div className="flex items-baseline gap-1">
                              <span className="text-2xl font-bold text-foreground">
                                {score}
                              </span>
                              <span className="text-sm text-muted-foreground">/ 100</span>
                            </div>
                            {potentialGain > 0 && (
                              <div className="text-xs text-zone-green font-medium">
                                +{potentialGain}
                              </div>
                            )}
                          </div>

                          {/* Col 4: Micro-indicators */}
                          <div className="flex items-center justify-center gap-1.5">
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {(card as any).has_ab_test ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button className="cursor-pointer hover:opacity-80 transition-opacity">
                                    <FlaskConical className="h-3.5 w-3.5 text-zone-yellow" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                  Активный A/B тест
                                </TooltipContent>
                              </Tooltip>
                            ) /* eslint-disable-next-line @typescript-eslint/no-explicit-any */ : (card as any).has_unanswered_questions ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button className="cursor-pointer hover:opacity-80 transition-opacity">
                                    <MessageSquare className="h-3.5 w-3.5 text-primary" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                  Есть неотвеченные вопросы
                                </TooltipContent>
                              </Tooltip>
                            ) : status.mode === 'success' ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button className="cursor-pointer hover:opacity-80 transition-opacity">
                                    <FlaskConical className="h-3.5 w-3.5 text-zone-yellow" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                  Активный A/B тест
                                </TooltipContent>
                              </Tooltip>
                            ) : hasPartialConfirmation ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button className="cursor-pointer hover:opacity-80 transition-opacity">
                                    <MessageSquare className="h-3.5 w-3.5 text-primary/70" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                  Есть неотвеченные вопросы
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <div className="w-4 h-4" />
                            )}
                          </div>

                          {/* Col 5: Status + confirmation */}
                          {(() => {
                            const totalIssues = (card.critical_issues_count ?? 0) + (card.warnings_count ?? 0) + (card.improvements_count ?? 0);
                            const isCorrect = status.mode === 'success';

                            const ConfirmationBar = () => (
                              <div className="flex items-center gap-1.5 w-full">
                                <ShieldCheck className={`h-3.5 w-3.5 ${isComplete ? 'text-zone-green' : 'text-muted-foreground/40'}`} />
                                <div className="flex-1 flex gap-[2px]">
                                  {Array.from({ length: confirmation.total }, (_, i) => (
                                    <div
                                      key={i}
                                      className={`h-1.5 rounded-full flex-1 ${
                                        i < confirmation.confirmed
                                          ? (isComplete ? 'bg-zone-green' : 'bg-zone-yellow')
                                          : 'bg-muted'
                                      }`}
                                    />
                                  ))}
                                </div>
                                <span className={`text-[10px] font-medium tabular-nums ${isComplete ? 'text-zone-green' : 'text-muted-foreground'}`}>
                                  {confirmation.confirmed}/{confirmation.total}
                                </span>
                              </div>
                            );

                            const Attribution = () => (
                              <div className="flex items-center gap-1.5 justify-center whitespace-nowrap">
                                {(() => {
                                  const reviewerName = confirmation.reviewer || '—';
                                  return (
                                    <>
                                      <Avatar className="h-4 w-4">
                                        <AvatarFallback className="text-[7px] font-medium bg-muted">{getInitials(reviewerName)}</AvatarFallback>
                                      </Avatar>
                                      <span className="text-[10px] text-muted-foreground">{reviewerName}</span>
                                    </>
                                  );
                                })()}
                                {confirmation.date && (
                                  <>
                                    <span className="text-[10px] text-muted-foreground/40">·</span>
                                    <span className="text-[10px] text-muted-foreground">{confirmation.date}</span>
                                  </>
                                )}
                              </div>
                            );

                            return (
                              <div className="flex flex-col items-center gap-1.5 min-w-[140px]">
                                {/* Badge */}
                                <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_STYLES[status.mode].badge}`}>
                                  <StatusIcon className="h-3.5 w-3.5" />
                                  {status.label}
                                </div>

                                {/* Error count */}
                                {totalIssues > 0 && (
                                  <span className="text-[12px] text-muted-foreground font-medium">
                                    {pluralErrors(totalIssues)}
                                  </span>
                                )}

                                {/* Confirmation section */}
                                {isCorrect && isComplete ? (
                                  <>
                                    <span className="text-[11px] text-foreground font-medium flex items-center gap-1">
                                      <ShieldCheck className="h-3 w-3 text-zone-green" />
                                      Подтверждено
                                    </span>
                                    {confirmation.reviewer && <Attribution />}
                                  </>
                                ) : isCorrect && !isComplete && confirmation.confirmed > 0 ? (
                                  <div className="w-full px-1 pt-1.5 border-t border-border">
                                    <div className="flex items-center gap-1 mb-1">
                                      <AlertTriangle className="h-3 w-3 text-zone-yellow" />
                                      <span className="text-[11px] text-foreground font-medium">Частично</span>
                                    </div>
                                    <ConfirmationBar />
                                    {confirmation.reviewer && <div className="mt-1"><Attribution /></div>}
                                  </div>
                                ) : confirmation.confirmed > 0 ? (
                                  <div className="w-full px-1 pt-1.5 border-t border-border">
                                    <ConfirmationBar />
                                    {confirmation.reviewer && <div className="mt-1"><Attribution /></div>}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })()}

                          {/* Col 6: Actions */}
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5 whitespace-nowrap"
                              onClick={() => navigate(`/workspace/cards/${card.id}`)}
                            >
                              Открыть карточку
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuItem className="gap-2" onClick={() => void startSelectedCardSync(card)}>
                                  <RefreshCw className="h-4 w-4" />
                                  Синхронизировать карточку
                                </DropdownMenuItem>
                                <DropdownMenuItem className="gap-2" onClick={() => navigate('/ab-tests')}>
                                  <FlaskConical className="h-4 w-4" />
                                  Запустить A/B тест
                                </DropdownMenuItem>
                                <DropdownMenuItem className="gap-2" onClick={() => navigate('/photo-studio')}>
                                  <Camera className="h-4 w-4" />
                                  Сгенерировать фото
                                </DropdownMenuItem>
                                <DropdownMenuItem className="gap-2" onClick={() => navigate('/photo-studio')}>
                                  <Video className="h-4 w-4" />
                                  Сгенерировать видео
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>

                        {/* Footer */}
                        <div className="border-t border-dashed border-border/30 px-4 py-1.5 flex items-center justify-between opacity-60 hover:opacity-90 transition-opacity">
                          <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <Sparkles className="h-3 w-3" />
                            Глубокий AI-анализ медиаконтента · Проверка фото и видео на соответствие требованиям WB
                          </div>
                          <Button variant="ghost" size="sm" className="h-6 text-[11px] gap-1 text-muted-foreground hover:text-foreground">
                            <Sparkles className="h-2.5 w-2.5" />
                            Запустить · 1 кредит
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination */}
                {total > 50 && (
                  <div className="flex items-center justify-center gap-4 mt-6">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                      ← Назад
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Страница {page} из {Math.max(1, Math.ceil(total / 50))}
                    </span>
                    <Button variant="outline" size="sm" disabled={page >= Math.ceil(total / 50)} onClick={() => setPage((p) => p + 1)}>
                      Далее →
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <Dialog open={syncDialogOpen} onOpenChange={setSyncDialogOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Сверка с Wildberries</DialogTitle>
              <DialogDescription>
                Превью показывает, сколько карточек реально изменились на стороне WB по `updatedAt`.
              </DialogDescription>
            </DialogHeader>

            {syncPreviewLoading ? (
              <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Считаем изменения...
              </div>
            ) : syncPreviewError ? (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
                {syncPreviewError}
              </div>
            ) : syncPreview ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="text-xs text-muted-foreground">Карточек в WB</div>
                    <div className="mt-1 text-xl font-semibold">{syncPreview.total_wb}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="text-xs text-muted-foreground">Изменились / новые</div>
                    <div className="mt-1 text-xl font-semibold text-primary">{syncPreview.changed_count}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="text-xs text-muted-foreground">Без изменений</div>
                    <div className="mt-1 text-xl font-semibold text-muted-foreground">{syncPreview.unchanged_count}</div>
                  </div>
                </div>

                <div className="rounded-lg border border-border">
                  <div className="border-b border-border px-4 py-3 text-sm font-medium">
                    Что попадёт в синхронизацию
                  </div>
                  {syncPreview.changed.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground">
                      Все карточки уже актуальны.
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto">
                      {syncPreview.changed.slice(0, 12).map((entry) => (
                        <div key={`${entry.nm_id}-${entry.status}`} className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3 last:border-b-0">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-foreground">
                              {entry.title || `Карточка ${entry.nm_id}`}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              WB {entry.nm_id}
                              {entry.vendor_code ? ` · ${entry.vendor_code}` : ''}
                              {entry.subject ? ` · ${entry.subject}` : ''}
                            </div>
                          </div>
                          <Badge variant={entry.status === 'new' ? 'default' : 'secondary'}>
                            {entry.status === 'new' ? 'Новая' : 'Изменена'}
                          </Badge>
                        </div>
                      ))}
                      {syncPreview.changed.length > 12 && (
                        <div className="px-4 py-3 text-xs text-muted-foreground">
                          И ещё {syncPreview.changed.length - 12} карточек.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => void loadSyncPreview()} disabled={syncPreviewLoading || syncSubmitting}>
                Обновить превью
              </Button>
              <Button onClick={() => void startIncrementalSync()} disabled={syncPreviewLoading || syncSubmitting || !syncPreview}>
                {syncSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Синхронизировать изменения
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Bottom analysis progress banner */}
        {analysisTask && (
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-foreground/95 backdrop-blur-sm border-t border-border shadow-[0_-4px_24px_rgba(0,0,0,0.3)]">
            <div className="max-w-[900px] mx-auto flex items-center gap-3 px-6 py-3">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {analysisTask.status === 'completed' ? (
                  <CheckCircle2 size={16} className="text-zone-green flex-shrink-0" />
                ) : analysisTask.status === 'failed' ? (
                  <AlertTriangle size={16} className="text-zone-red flex-shrink-0" />
                ) : (
                  <Loader2 size={16} className="animate-spin text-primary flex-shrink-0" />
                )}
                <span className="text-sm text-background truncate">
                  {analysisTask.status === 'completed' ? '✅ ' : ''}
                  {analysisTask.step}
                </span>
              </div>
              <div className="w-[200px] flex-shrink-0">
                <Progress
                  value={analysisTask.progress}
                  className="h-1.5"
                />
              </div>
              <span className="text-xs text-muted-foreground flex-shrink-0">{analysisTask.progress}%</span>
            </div>
          </div>
        )}
      </>
    </TooltipProvider>
  );
}
