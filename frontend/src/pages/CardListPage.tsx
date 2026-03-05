import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import api from '../api/client';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronDown,
  FlaskConical,
  Loader2,
  MoreVertical,
  RotateCcw,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
  Video,
  Clock3,
  Package,
} from 'lucide-react';
import type { Card, CardListResponse } from '../types';

type SeverityFilter = 'all' | 'has_issues' | 'no_issues' | 'postponed' | 'unconfirmed';
type SortFilter = 'issues' | 'score';

interface QualityMetric {
  label: string;
  key: string;
  max: number;
}

const METRICS: QualityMetric[] = [
  { label: 'FCS', key: 'fcs', max: 100 },
  { label: 'Хар-ки', key: 'characteristics_score', max: 20 },
  { label: 'Title', key: 'title_score', max: 20 },
  { label: 'Desc', key: 'description_score', max: 20 },
  { label: 'Фото', key: 'photos_score', max: 20 },
  { label: 'Видео', key: 'video_score', max: 10 },
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
  if (ratio >= 0.75) return '#22C55E';
  if (ratio >= 0.45) return '#F59E0B';
  if (ratio > 0) return '#EF4444';
  return '#D8DCE8';
}

function metricScore(card: Card, metric: QualityMetric): number {
  const breakdown = (card.score_breakdown || {}) as Record<string, unknown>;
  if (metric.key === 'angles_score') {
    const photos = toNumber(breakdown.photos_score);
    return clamp(Math.round(photos / 2), 0, metric.max);
  }
  return clamp(toNumber(breakdown[metric.key]), 0, metric.max);
}

function statusForCard(card: Card): {
  mode: 'critical' | 'warning' | 'success';
  label: string;
  detail: string;
} {
  const totalIssues = (card.critical_issues_count ?? 0) + (card.warnings_count ?? 0) + (card.improvements_count ?? 0);

  if ((card.critical_issues_count ?? 0) > 0) {
    return {
      mode: 'critical',
      label: 'Требует исправления',
      detail: `${totalIssues} ошибок`,
    };
  }

  if ((card.warnings_count ?? 0) > 0 || (card.improvements_count ?? 0) > 0) {
    return {
      mode: 'warning',
      label: 'Есть отложенные',
      detail: `${(card.warnings_count ?? 0) + (card.improvements_count ?? 0)} ошибки`,
    };
  }

  return {
    mode: 'success',
    label: 'В норме',
    detail: '0 ошибок',
  };
}

function scoreColor(score: number | null): string {
  if (!score) return '#94A3B8';
  if (score >= 75) return '#16A34A';
  if (score >= 55) return '#F59E0B';
  return '#EF4444';
}

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
  const [openMenuCardId, setOpenMenuCardId] = useState<number | null>(null);
  const [analysisTask, setAnalysisTask] = useState<{ taskId: string; step: string; progress: number; status: string } | null>(null);
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
    const closeMenu = () => setOpenMenuCardId(null);
    document.addEventListener('click', closeMenu);
    return () => document.removeEventListener('click', closeMenu);
  }, []);

  useEffect(() => {
    if (activeStore) {
      void loadCards();
    }
  }, [activeStore, page, severityFilter, sortBy]);

  // Poll scheduler status every 30 seconds
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
      if (severityFilter === 'has_issues') {
        filters.has_issues = true;
      } else if (severityFilter === 'no_issues') {
        filters.no_issues = true;
      }
      if (search.trim()) {
        filters.search = search.trim();
      }

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
    if (next === 'all') {
      nextParams.delete('severity');
    } else {
      nextParams.set('severity', next);
    }
    setSearchParams(nextParams, { replace: true });
  };

  const visibleCards = useMemo(() => {
    let list = [...cards];

    if (severityFilter === 'has_issues') {
      list = list.filter((card) => (card.critical_issues_count ?? 0) + (card.warnings_count ?? 0) + (card.improvements_count ?? 0) > 0);
    } else if (severityFilter === 'no_issues') {
      list = list.filter((card) => (card.critical_issues_count ?? 0) + (card.warnings_count ?? 0) + (card.improvements_count ?? 0) === 0);
    } else if (severityFilter === 'postponed') {
      list = list.filter((card) => (card.warnings_count ?? 0) > 0 || (card.improvements_count ?? 0) > 0);
    } else if (severityFilter === 'unconfirmed') {
      list = list.filter((card) => (card.critical_issues_count ?? 0) > 0);
    }

    if (sortBy === 'issues') {
      list.sort((a, b) => {
        const aIssues = (a.critical_issues_count ?? 0) + (a.warnings_count ?? 0) + (a.improvements_count ?? 0);
        const bIssues = (b.critical_issues_count ?? 0) + (b.warnings_count ?? 0) + (b.improvements_count ?? 0);
        return bIssues - aIssues;
      });
    } else {
      list.sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
    }

    return list;
  }, [cards, severityFilter, sortBy]);

  const cardsWithIssues = useMemo(
    () => visibleCards.filter((card) => (card.critical_issues_count ?? 0) + (card.warnings_count ?? 0) + (card.improvements_count ?? 0) > 0).length,
    [visibleCards],
  );

  const criticalCards = useMemo(
    () => visibleCards.filter((card) => (card.critical_issues_count ?? 0) > 0).length,
    [visibleCards],
  );

  return (
    <>
    <div className="card-list-page">
      <div className="card-list-shell">
        <div className="card-list-topline">
          <button className="card-list-back" onClick={() => navigate('/workspace')}>
            <ArrowLeft size={16} /> Рабочее пространство
          </button>
          <span className="card-list-mode-pill">Расширенный режим</span>
        </div>

        <div className="card-list-headline-row">
          <div className="card-list-headline">Карточки товаров</div>
          <div className="card-list-sync-area">
            <button
              className={`ws-sync-btn ws-sync-btn--reset ${analysisTask?.status === 'running' || analysisTask?.status === 'pending' ? 'ws-sync-btn--active' : ''}`}
              onClick={handleResetAndAnalyze}
              disabled={analysisTask?.status === 'running' || analysisTask?.status === 'pending'}
              title="Очистить все анализы и запустить заново"
            >
              {analysisTask?.status === 'running' || analysisTask?.status === 'pending'
                ? <Loader2 size={15} className="ws-spin" />
                : <RotateCcw size={15} />}
              Заново
            </button>
            {/* Auto-sync status — shows last sync time and next tick */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
              <RefreshCw size={13} style={{ color: schedulerStatus?.is_running ? 'var(--success, #22c55e)' : 'var(--text-muted)' }} />
              {schedulerStatus ? (
                <span>
                  {schedulerStatus.last_tick_at
                    ? `Обновлено: ${new Date(schedulerStatus.last_tick_at + 'Z').toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
                    : 'Ожидание...'
                  }
                  {schedulerStatus.next_tick_in_sec != null && (
                    <span style={{ marginLeft: 6, color: 'var(--text-muted)' }}>
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

        <div className="card-list-toolbar">
          <form className="card-list-search" onSubmit={handleSearch}>
            <Search size={16} />
            <input
              type="text"
              placeholder="ID, артикул или название..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </form>

          <div className="card-list-filters">
            <label className="card-list-select-wrap">
              <select
                value={severityFilter}
                onChange={(event) => handleSeverityChange(event.target.value as SeverityFilter)}
              >
                <option value="all">Все карточки</option>
                <option value="has_issues">Есть проблемы</option>
                <option value="no_issues">Нет проблем</option>
                <option value="postponed">Отложенные</option>
                <option value="unconfirmed">Не подтверждено</option>
              </select>
              <ChevronDown size={15} />
            </label>

            <label className="card-list-select-wrap">
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortFilter)}>
                <option value="issues">По кол-ву проблем</option>
                <option value="score">По рейтингу</option>
              </select>
              <ChevronDown size={15} />
            </label>
          </div>

          <div className="card-list-counters">
            <span>Товаров {visibleCards.length}</span>
            <span>С ошибками {cardsWithIssues}</span>
            <span className="critical">Критичных {criticalCards}</span>
          </div>
        </div>

        {loading ? (
          <div className="loading-center" style={{ minHeight: 320 }}>
            <div className="spinner" />
            <div className="loading-text">Загрузка карточек...</div>
          </div>
        ) : visibleCards.length === 0 ? (
          <div className="empty-state" style={{ padding: '56px 0' }}>
            <div className="empty-icon"><Package size={30} /></div>
            <h3>Карточки не найдены</h3>
            <p>Измените фильтр или строку поиска</p>
          </div>
        ) : (
          <>
            <div className="card-list-shown">Показано {visibleCards.length} товаров</div>

            <div className="card-list-rows">
              {visibleCards.map((card) => {
                const status = statusForCard(card);
                const score = card.score ?? 0;
                const potentialGain = Math.max(0, Math.round((100 - score) * 0.35));

                return (
                  <div key={card.id} className="card-list-row">
                    <div className="card-row-main">
                      <div className="card-row-ident">
                        <span className={`card-row-dot card-row-dot--${status.mode}`} />
                        <div className="card-row-thumb">
                          {card.main_photo_url ? <img src={card.main_photo_url} alt="" /> : <Package size={18} />}
                        </div>

                        <div className="card-row-text">
                          <div className="card-row-title">
                            {card.title || `Карточка ${card.nm_id}`}
                          </div>
                          <div className="card-row-meta">
                            <span>{card.nm_id}</span>
                            {card.vendor_code ? <span>{card.vendor_code}</span> : null}
                          </div>
                        </div>
                      </div>

                      <div className="card-row-meters">
                        {METRICS.map((metric) => {
                          const mScore = metricScore(card, metric);
                          const color = metricColor(mScore, metric.max);
                          const ratio = metric.max > 0 ? mScore / metric.max : 0;
                          const pct = Math.round(ratio * 100);
                          const fillHeight = clamp(Math.round(10 + ratio * 24), 6, 34);

                          return (
                            <div key={`${card.id}-${metric.key}`} className="card-meter-col">
                              <div className="card-meter-track" data-tip={`${mScore}/${metric.max}`}>
                                <span style={{ height: `${fillHeight}px`, background: color }} />
                                <div className="card-meter-tooltip" style={{ '--meter-color': color } as React.CSSProperties}>
                                  <span className="card-meter-tooltip-pct">{pct}%</span>
                                  <span className="card-meter-tooltip-raw">{mScore}/{metric.max}</span>
                                </div>
                              </div>
                              <div className="card-meter-label">{metric.label}</div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="card-row-score" style={{ color: scoreColor(card.score) }}>
                        <div className="score-main">{score}<span>/100</span></div>
                        <div className="score-gain">+{Math.max(3, potentialGain)}</div>
                      </div>

                      <button className="card-row-flag-btn" title="Отметить">
                        <Tag size={15} />
                      </button>

                      <div className={`card-row-status card-row-status--${status.mode}`}>
                        <div className="status-pill">
                          {status.mode === 'critical' ? <AlertTriangle size={14} /> : null}
                          {status.mode === 'warning' ? <Clock3 size={14} /> : null}
                          {status.mode === 'success' ? <CheckCircle2 size={14} /> : null}
                          {status.label}
                        </div>
                        <div className="status-detail">{status.detail}</div>
                      </div>

                      <button className="card-open-btn" onClick={() => navigate(`/workspace/cards/${card.id}`)}>
                        Открыть карточку
                      </button>

                      <div className="card-row-actions" onClick={(event) => event.stopPropagation()}>
                        <button
                          className="card-more-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpenMenuCardId((prev) => (prev === card.id ? null : card.id));
                          }}
                        >
                          <MoreVertical size={18} />
                        </button>

                        {openMenuCardId === card.id ? (
                          <div className="card-row-menu" onClick={(event) => event.stopPropagation()}>
                            <button
                              onClick={() => {
                                setOpenMenuCardId(null);
                                navigate('/ab-tests');
                              }}
                            >
                              <FlaskConical size={14} /> Запустить A/B тест
                            </button>
                            <button
                              onClick={() => {
                                setOpenMenuCardId(null);
                                navigate('/photo-studio');
                              }}
                            >
                              <Camera size={14} /> Сгенерировать фото
                            </button>
                            <button
                              onClick={() => {
                                setOpenMenuCardId(null);
                                navigate('/photo-studio');
                              }}
                            >
                              <Video size={14} /> Сгенерировать видео
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="card-row-foot">
                      <div className="card-row-foot-note">
                        <Sparkles size={13} /> Глубокий AI-анализ медиаконтента · Проверка фото и видео на соответствие требованиям WB
                      </div>
                      <button className="card-row-foot-run">
                        <Sparkles size={13} /> Запустить · 1 кредит
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {total > 50 ? (
              <div className="card-list-pagination">
                <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  ← Назад
                </button>
                <span>Страница {page} из {Math.max(1, Math.ceil(total / 50))}</span>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={page >= Math.ceil(total / 50)}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Далее →
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>

    {/* Bottom analysis progress banner */}
    {analysisTask && (
      <div className="analysis-progress-banner">
        <div className="analysis-progress-inner">
          <div className="analysis-progress-left">
            {analysisTask.status === 'completed'
              ? <CheckCircle2 size={16} style={{ color: '#16A34A' }} />
              : analysisTask.status === 'failed'
              ? <AlertTriangle size={16} style={{ color: '#EF4444' }} />
              : <Loader2 size={16} className="ws-spin" />}
            <span className="analysis-progress-step">
              {analysisTask.status === 'completed' ? '✅ ' : ''}
              {analysisTask.step}
            </span>
          </div>
          <div className="analysis-progress-bar-wrap">
            <div
              className="analysis-progress-bar-fill"
              style={{ width: `${analysisTask.progress}%`, background: analysisTask.status === 'failed' ? '#EF4444' : '#6366F1' }}
            />
          </div>
          <span className="analysis-progress-pct">{analysisTask.progress}%</span>
        </div>
      </div>
    )}
    </>
  );
}
