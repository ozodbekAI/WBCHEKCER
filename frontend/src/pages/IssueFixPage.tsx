import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import { trackAction } from '../hooks/useActivityTracker';
import { Package, Tag, Home, Bot, ClipboardList, Pencil, ArrowRight, Trash2, Plus, Send, AlertTriangle, FileCheck, List } from 'lucide-react';
import type { IssueWithCard, IssuesGrouped, QueueProgress } from '../types';

/** Extract swap info from issue's error_details */
function getSwapInfo(issue: IssueWithCard): { isSwap: boolean; isClear: boolean; swapToName: string; swapToValue: string } {
  const details = issue.error_details || [];
  for (const d of details) {
    if (d?.fix_action === 'swap') {
      return { isSwap: true, isClear: false, swapToName: d.swap_to_name || '', swapToValue: d.swap_to_value || '' };
    }
    if (d?.fix_action === 'clear') {
      return { isSwap: false, isClear: true, swapToName: '', swapToValue: '' };
    }
  }
  return { isSwap: false, isClear: false, swapToName: '', swapToValue: '' };
}

interface CompoundFix {
  name: string;
  field_path: string;
  action: 'replace' | 'set' | 'clear';
  value: string | string[] | null;
  current_value?: string | null;
}

/** Serialize a compound fix value to a string for storage */
function serializeFixValue(value: string | string[] | null | undefined): string {
  if (value === null || value === undefined) return '__CLEAR__';
  if (Array.isArray(value)) return JSON.stringify(value);
  return value;
}

/** Extract compound (multi-field) fixes from error_details */
function getCompoundFixes(issue: IssueWithCard): CompoundFix[] {
  const details = issue.error_details || [];
  for (const d of details) {
    if (d?.type === 'compound' || d?.fix_action === 'compound') {
      return (d.fixes || []) as CompoundFix[];
    }
  }
  return [];
}

function isMediaIssue(issue: IssueWithCard): boolean {
  const code = String(issue.code || '').toLowerCase();
  return (
    code === 'no_photos' ||
    code === 'few_photos' ||
    code === 'add_more_photos' ||
    isVideoMediaIssue(issue)
  );
}

function isVideoMediaIssue(issue: IssueWithCard): boolean {
  const code = String(issue.code || '').toLowerCase();
  const category = String(issue.category || '').toLowerCase();
  const fieldPath = String(issue.field_path || '').toLowerCase();
  return code === 'no_video' || category === 'video' || fieldPath.startsWith('videos');
}

export default function IssueFixPage() {
  const { severity, cardId: cardIdParam } = useParams<{ severity?: string; cardId?: string }>();
  const navigate = useNavigate();
  const { activeStore } = useStore();
  const { hasPermission } = useAuth();

  const cardIdMode = cardIdParam ? parseInt(cardIdParam, 10) : null;


  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedValue, setSelectedValue] = useState('');
  const [customValue, setCustomValue] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [customSearch, setCustomSearch] = useState('');
  const [showSidebar, setShowSidebar] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [progress, setProgress] = useState<QueueProgress | null>(null);
  const [scoreBeforeTotal, setScoreBeforeTotal] = useState(0);
  const [hasFixedFile, setHasFixedFile] = useState<boolean | null>(null);
  const [currentCardPendingCount, setCurrentCardPendingCount] = useState(0);
  const [totalCardIssues, setTotalCardIssues] = useState(0);

  // Sequential per-card state
  const [currentIssue, setCurrentIssue] = useState<IssueWithCard | null>(null);
  const [currentCardId, setCurrentCardId] = useState<number | null>(null);
  const [cardDone, setCardDone] = useState(false); // card finished, waiting to move to next

  // All issues for sidebar (pending + skipped)
  const [allSidebarIssues, setAllSidebarIssues] = useState<IssueWithCard[]>([]);
  const [sidebarLoading, setSidebarLoading] = useState(false);

  // Track skipped issues that user re-skipped in THIS session (to avoid infinite loop)
  // Using ref instead of state so goToNext reads the latest value synchronously
  const sessionSkippedIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (activeStore) {
      loadFirstIssue();
      loadSidebarIssues();
      api.getFixedFileStatus(activeStore.id)
        .then(r => setHasFixedFile(r.has_fixed_file))
        .catch(() => setHasFixedFile(null));
    }
  }, [activeStore, severity, cardIdMode]);

  const applyIssueToState = (issue: IssueWithCard | null) => {
    setCurrentIssue(issue);
    if (issue) {
      setCurrentCardId(issue.card_id);
      const best = getBestValue(issue);
      setSelectedValue(best);
      // Auto-open custom input when AI has no suggestion but allowed_values exist
      const noSuggestion = !best;
      const hasAllowed = issue.allowed_values && issue.allowed_values.length > 0;
      setShowCustom(noSuggestion && hasAllowed ? true : false);
      setCustomValue('');
      setCustomSearch('');
      setCardDone(false);
      // Update current card pending count
      loadCardPendingCount(issue.card_id);
    }
  };

  const loadCardPendingCount = async (cardId: number) => {
    if (!activeStore) return;
    try {
      const cardIssues = await api.getCardIssues(activeStore.id, cardId, 'pending');
      const count = cardIssues.length || 0;
      setCurrentCardPendingCount(count);
      // Set total on first load
      if (totalCardIssues === 0) {
        setTotalCardIssues(count);
      }
    } catch (err) {
      console.error('Failed to load card pending count:', err);
    }
  };

  const loadFirstIssue = async () => {
    if (!activeStore) return;
    setLoading(true);
    try {
      const issue = await api.getNextIssue(activeStore.id, undefined, cardIdMode || undefined, severity || undefined);
      if (issue) {
        applyIssueToState(issue);
      } else {
        // No pending — try skipped issues
        const grouped: IssuesGrouped = await api.getIssuesGrouped(activeStore.id);
        let skippedPool: IssueWithCard[] = [];
        if (severity === 'critical') skippedPool = (grouped.critical || []).filter(i => i.status === 'skipped');
        else if (severity === 'warning') skippedPool = (grouped.warnings || []).filter(i => i.status === 'skipped');
        else if (severity === 'improvement') skippedPool = (grouped.improvements || []).filter(i => i.status === 'skipped');
        else skippedPool = [
          ...(grouped.critical || []),
          ...(grouped.warnings || []),
          ...(grouped.improvements || []),
        ].filter(i => i.status === 'skipped');

        // Update sidebar data
        const allIssues = severity === 'critical' ? grouped.critical
          : severity === 'warning' ? grouped.warnings
          : severity === 'improvement' ? grouped.improvements
          : [...(grouped.critical || []), ...(grouped.warnings || []), ...(grouped.improvements || [])];
        setAllSidebarIssues(allIssues || []);

        if (skippedPool.length > 0) {
          applyIssueToState(skippedPool[0]);
        } else {
          if (cardIdMode) {
            navigate('/workspace/cards/queue');
            return;
          }
          setCompleted(true);
        }
      }
      const prog = await api.getQueueProgress(activeStore.id, severity || undefined);
      setProgress(prog);
      setScoreBeforeTotal(prog.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadSidebarIssues = async () => {
    if (!activeStore) return;
    setSidebarLoading(true);
    try {
      const grouped: IssuesGrouped = await api.getIssuesGrouped(activeStore.id);
      // Pick the right severity group (or all if no filter)
      let issues: IssueWithCard[] = [];
      if (severity === 'critical') {
        issues = grouped.critical || [];
      } else if (severity === 'warning') {
        issues = grouped.warnings || [];
      } else if (severity === 'improvement') {
        issues = grouped.improvements || [];
      } else {
        // All severities
        issues = [
          ...(grouped.critical || []),
          ...(grouped.warnings || []),
          ...(grouped.improvements || []),
        ];
      }
      setAllSidebarIssues(issues);
    } catch (err) {
      console.error('Failed to load sidebar issues:', err);
    } finally {
      setSidebarLoading(false);
    }
  };

  const handleSidebarIssueClick = async (issue: IssueWithCard) => {
    if (!activeStore) return;
    if (issue.status === 'skipped') {
      // Unskip the issue first, then set as current
      try {
        await api.unskipIssue(activeStore.id, issue.id);
        issue.status = 'pending';
        // Reload sidebar to reflect the change
        loadSidebarIssues();
      } catch (err) {
        console.error('Failed to unskip issue:', err);
        return;
      }
    }
    // Set as current issue
    applyIssueToState(issue);
    setCompleted(false);
    setShowSidebar(false);
    refreshProgress();
  };

  const refreshProgress = async () => {
    if (!activeStore) return;
    try {
      const prog = await api.getQueueProgress(activeStore.id, severity || undefined);
      setProgress(prog);
    } catch {}
  };

  const getBestValue = (issue: IssueWithCard): string => {
    // For swap/clear issues, the best value is the swap_to_value or empty
    const swap = getSwapInfo(issue);
    if (swap.isSwap) return swap.swapToValue || '';
    if (swap.isClear) return '__CLEAR__';

    return issue.ai_suggested_value
      || issue.suggested_value
      || '';
  };

  const getAlternatives = (issue: IssueWithCard): string[] => {
    const best = getBestValue(issue);
    const alts: string[] = [];
    if (best) alts.push(best);

    if (issue.ai_alternatives) {
      issue.ai_alternatives.forEach(a => {
        if (a && !alts.includes(a)) alts.push(a);
      });
    }
    if (issue.alternatives) {
      issue.alternatives.forEach(a => {
        if (a && !alts.includes(a)) alts.push(a);
      });
    }
    if (issue.suggested_value && !alts.includes(issue.suggested_value)) {
      alts.push(issue.suggested_value);
    }

    return alts;
  };

  // Sidebar issues: all pending + skipped for this severity
  const issues: IssueWithCard[] = allSidebarIssues;
  const currentIdx = currentIssue ? allSidebarIssues.findIndex(i => i.id === currentIssue.id) : -1;
  const skippedIssues = allSidebarIssues.filter(i => i.status === 'skipped');

  const [fixedCardIds, setFixedCardIds] = useState<Set<number>>(new Set());
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewSubmitCount, setReviewSubmitCount] = useState(0);
  const [reviewError, setReviewError] = useState<string | null>(null);

  /** Afte// Decrement card pending count
          setCurrentCardPendingCount(prev => Math.max(0, prev - 1));
          r fix/skip: try same card first, then global next */
  const goToNext = useCallback(async () => {
    if (!activeStore) return;
    setShowCustom(false);
    setCustomValue('');
    setCustomSearch('');
    try {
      if (currentCardId !== null) {
        const sameCard = await api.getNextIssue(activeStore.id, undefined, currentCardId, severity || undefined);
        if (sameCard) {
          applyIssueToState(sameCard);
          refreshProgress();
          return;
        }
        // Card is fully done
        if (cardIdMode) {
          // If in card-specific mode, return to queue
          setCardDone(true);
          await new Promise(resolve => setTimeout(resolve, 1200));
          navigate('/workspace/cards/queue');
          return;
        }
        // Otherwise briefly show card-done state, then move on
        setCardDone(true);
        await new Promise(resolve => setTimeout(resolve, 1200));
        setCardDone(false);
      }
      // Move to next card
      const next = await api.getNextIssue(activeStore.id, undefined, undefined, severity || undefined);
      if (next) {
        applyIssueToState(next);
      } else {
        // No more pending — try to pick a skipped issue
        const freshGrouped: IssuesGrouped = await api.getIssuesGrouped(activeStore.id);
        let skippedPool: IssueWithCard[] = [];
        if (severity === 'critical') skippedPool = (freshGrouped.critical || []).filter(i => i.status === 'skipped');
        else if (severity === 'warning') skippedPool = (freshGrouped.warnings || []).filter(i => i.status === 'skipped');
        else if (severity === 'improvement') skippedPool = (freshGrouped.improvements || []).filter(i => i.status === 'skipped');
        else skippedPool = [
          ...(freshGrouped.critical || []),
          ...(freshGrouped.warnings || []),
          ...(freshGrouped.improvements || []),
        ].filter(i => i.status === 'skipped');

        // Update sidebar data
        const allIssues = severity === 'critical' ? freshGrouped.critical
          : severity === 'warning' ? freshGrouped.warnings
          : severity === 'improvement' ? freshGrouped.improvements
          : [...(freshGrouped.critical || []), ...(freshGrouped.warnings || []), ...(freshGrouped.improvements || [])];
        setAllSidebarIssues(allIssues || []);

        // Filter out issues already re-skipped this session
        const remaining = skippedPool.filter(i => !sessionSkippedIdsRef.current.has(i.id));

        if (remaining.length > 0) {
          applyIssueToState(remaining[0]);
        } else if (skippedPool.length > 0) {
          // All skipped issues were re-skipped this session — reset session and start over
          sessionSkippedIdsRef.current = new Set();
          applyIssueToState(skippedPool[0]);
        } else {
          if (cardIdMode) {
            navigate('/workspace/cards/queue');
            return;
          }
          setCompleted(true);
        }
      }
      refreshProgress();
    } catch (err) {
      console.error(err);
    }
  }, [activeStore, currentCardId, cardIdMode, navigate]);

  const handleFix = async () => {
    trackAction();
    if (!activeStore || !currentIssue) return;
    
    const swap = getSwapInfo(currentIssue);
    const compoundFixes = getCompoundFixes(currentIssue);
    const isCompound = compoundFixes.length > 0;
    let value: string;
    
    if (isCompound) {
      // For compound fixes, the main value comes from the first fix entry or custom input
      const mainFix = compoundFixes[0];
      value = showCustom && customValue.trim()
        ? customValue.trim()
        : (mainFix?.action === 'clear' ? '__CLEAR__' : serializeFixValue(mainFix?.value));
    } else if (swap.isSwap || swap.isClear) {
      value = showCustom && customValue.trim()
        ? customValue.trim()
        : swap.swapToValue || '__CLEAR__';
    } else {
      value = showCustom && customValue.trim()
        ? customValue.trim()
        : selectedValue;
      if (!value) return;
    }

    setActionLoading(true);
    try {
      await api.fixIssue(activeStore.id, currentIssue.id, value, false);
      const cardId = currentIssue.card_id;
      const newFixedIds = new Set(fixedCardIds).add(cardId);
      setFixedCardIds(newFixedIds);

      // Immediately submit this card for review if no sync permission
      if (!hasPermission('cards.sync')) {
        try {
          await api.submitForReview(activeStore.id, cardId);
          setReviewSubmitCount(newFixedIds.size);
          setReviewSubmitted(true);
          setReviewError(null);
        } catch (e: any) {
          console.error('submit review failed:', e);
          setReviewError(e?.message || 'Ошибка отправки на проверку');
        }
      }

      await goToNext();
    } catch (err: any) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSkip = async () => {
    trackAction();
    if (!activeStore || !currentIssue) return;
    setActionLoading(true);
    try {
      // Mark as session-skipped so goToNext skips over it
      sessionSkippedIdsRef.current = new Set(sessionSkippedIdsRef.current).add(currentIssue.id);
      if (currentIssue.status !== 'skipped') {
        await api.skipIssue(activeStore.id, currentIssue.id);
      }
      await goToNext();
    } catch (err: any) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  const handlePostpone = async () => {
    trackAction();
    if (!activeStore || !currentIssue) return;
    setActionLoading(true);
    try {
      await api.postponeIssue(activeStore.id, currentIssue.id);
      await goToNext();
    } catch (err: any) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  const openPhotoStudioForIssue = () => {
    if (!currentIssue) return;
    const params = new URLSearchParams({
      cardId: String(currentIssue.card_id),
      nmId: String(currentIssue.card_nm_id),
      mode: 'generator',
    });
    if (isVideoMediaIssue(currentIssue)) {
      params.set('genTab', 'video');
    }
    navigate(`/photo-studio?${params.toString()}`);
  };

  const severityLabel = {
    critical: 'Выход из аварийного режима',
    warning: 'Исправление предупреждений',
    improvement: 'Улучшение карточек',
    postponed: 'Отложенные задачи',
  }[severity || ''] || 'Исправление проблем';

  const finishButtonLabel = 'Применить и завершить ✓';

  // ==================== LOADING ====================
  if (loading) {
    return (
      <div className="issue-fix-page">
        <div className="loading-page">
          <div className="loading-center">
            <div className="spinner" />
            <div className="loading-text">Анализ карточек...</div>
            <div style={{ width: 300 }}>
              <div className="progress-bar-bg">
                <div className="progress-bar-fill" style={{ width: '60%' }} />
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>
                Это займёт несколько секунд
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==================== COMPLETED ====================
  if (completed || !currentIssue) {
    const fixedCount = progress?.fixed ?? 0;
    const avgGain = fixedCount > 0 ? Math.round(fixedCount * 3.5) : 0;

    return (
      <div className="issue-fix-page">
        <div className="completion">
          <div className="completion-card">
            <div className="confetti">
              {Array.from({ length: 36 }).map((_, idx) => (
                <span
                  key={`confetti-${idx}`}
                  className="confetti-piece"
                  style={{
                    left: `${(idx * 7) % 100}%`,
                    background: idx % 3 === 0 ? '#22c55e' : idx % 3 === 1 ? '#86efac' : '#4ade80',
                    animationDelay: `${(idx % 10) * 0.08}s`,
                  }}
                />
              ))}
            </div>
            <div className="completion-icon">✓</div>
            <h2>Все проблемы устранены!</h2>
            <p className="completion-desc">
              В этой категории не осталось проблем для исправления
            </p>

            {fixedCount > 0 && (
              <>
                <div className="score-change">
                  <div>
                    <div className="sc-label">Было</div>
                    <div className="sc-val">{Math.max(42, 100 - avgGain - 20)}</div>
                  </div>
                  <div style={{ color: 'var(--success)', fontWeight: 700 }}>
                    ~+{avgGain}
                  </div>
                  <div>
                    <div className="sc-label">Стало</div>
                    <div className="sc-val new">{Math.min(100, Math.max(42, 100 - 20))}</div>
                  </div>
                  <div>
                    <div className="sc-label">Макс</div>
                    <div className="sc-val">100</div>
                  </div>
                </div>

                <div className="new-status">
                  Новый статус: В норме
                </div>

                <div className="applied-time">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12,6 12,12 16,14" />
                  </svg>
                  Применено: {new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  <span style={{ marginLeft: 8 }}>
                    Эффект станет заметен в течение 24-48 часов после индексации.
                  </span>
                </div>
              </>
            )}

            <button className="btn btn-primary btn-block btn-lg" onClick={() => navigate('/workspace')}>
              <Home size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} /> В рабочее пространство
            </button>

            {fixedCount > 0 && !hasPermission('cards.sync') && (
              <div style={{ marginTop: 20, width: '100%' }}>
                {reviewSubmitting ? (
                  <div style={{
                    background: '#f5f3ff', border: '1px solid #c4b5fd', borderRadius: 12,
                    padding: '16px 20px', color: '#7c3aed', fontWeight: 500, fontSize: 15, textAlign: 'center'
                  }}>
                    ⏳ Отправляем {fixedCardIds.size} карт. на проверку...
                  </div>
                ) : reviewSubmitted ? (
                  <div style={{
                    background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 12,
                    padding: '16px 20px', color: '#15803d', fontWeight: 500, fontSize: 15, textAlign: 'center'
                  }}>
                    ✅ {reviewSubmitCount} карт. отправлено на проверку старшему менеджеру
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ==================== FIX FLOW ====================
  // At this point currentIssue is guaranteed non-null (guarded above)
  const issue = currentIssue!;
  const alternatives = getAlternatives(issue);
  const mediaIssue = isMediaIssue(issue);
  const videoMediaIssue = isVideoMediaIssue(issue);
  // Card-level progress: how many pending issues remain for this card
  const cardTotal = issue.card_pending_count ?? 1;
  const progressPercent = progress
    ? ((progress.fixed) / Math.max(progress.total, 1)) * 100
    : 0;

  return (
    <div className="issue-fix-page">
      {/* Top bar */}
      <div style={{
        padding: '12px 24px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-white)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div className="page-back" onClick={() => navigate(cardIdMode ? '/workspace/cards/queue' : '/workspace')} style={{ marginBottom: 0 }}>
          ← {cardIdMode ? 'К списку карточек' : severityLabel}
        </div>
        <button
          onClick={() => { setShowSidebar(true); loadSidebarIssues(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'white', cursor: 'pointer',
            fontSize: 13, fontWeight: 500, color: '#475569',
            transition: 'border-color 0.15s, background 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.background = '#f8fafc'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'white'; }}
        >
          <List size={15} />
          Все проблемы
          {allSidebarIssues.length > 0 && (
            <span style={{
              background: 'var(--primary)', color: 'white',
              borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 600,
              minWidth: 18, textAlign: 'center',
            }}>
              {allSidebarIssues.length}
            </span>
          )}
        </button>
      </div>

      <div className="fix-page">
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: '#0f172a' }}>
          Исправление проблемы
        </h2>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24 }}>
          {cardIdMode 
            ? `Проверьте и подтвердите корректное значение · шаг ${totalCardIssues - currentCardPendingCount + 1} из ${totalCardIssues}`
            : `Проверьте и подтвердите корректное значение${progress ? ` · ${progress.fixed} из ${progress.total} исправлено` : ''}`
          }
        </p>

        {reviewSubmitted && !hasPermission('cards.sync') && (
          <div style={{
            fontSize: 12, color: '#15803d', background: '#f0fdf4', border: '1px solid #86efac',
            borderRadius: 8, padding: '6px 12px', marginBottom: 16, display: 'inline-block'
          }}>
            ✅ {reviewSubmitCount} карт. отправлено на проверку
          </div>
        )}
        {reviewError && !hasPermission('cards.sync') && (
          <div style={{
            fontSize: 12, color: '#dc2626', background: '#fef2f2', border: '1px solid #fca5a5',
            borderRadius: 8, padding: '6px 12px', marginBottom: 16, display: 'inline-block'
          }}>
            ⚠️ {reviewError}
          </div>
        )}

        {/* Card info */}
        <div className="fix-card-info">
          {issue.card_photos?.[0] ? (
            <img
              src={issue.card_photos[0]}
              alt=""
              className="fix-card-photo"
            />
          ) : (
            <div className="fix-card-photo" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-muted)', fontSize: 20
            }}>
              <Package size={20} />
            </div>
          )}
          <div className="fix-card-details">
            <div className="card-title-text">
              {issue.card_title || `Карточка ${issue.card_nm_id}`}
              <a
                href={`https://www.wildberries.ru/catalog/${issue.card_nm_id}/detail.aspx`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ marginLeft: 6, fontSize: 12, color: 'var(--primary)' }}
              >
                ↗
              </a>
            </div>
            <div className="fix-card-meta">
              <span><Package size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> {issue.card_nm_id}</span>
              {issue.card_vendor_code && (
                <span><Tag size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> {issue.card_vendor_code}</span>
              )}
            </div>
          </div>
          <div className="fix-card-score">
            <span className="score-gain">+{issue.score_impact}</span>
          </div>
        </div>

        {/* Step progress */}
        <div className="fix-step-bar">
          <span>{cardTotal} проблем в этой карточке</span>
          <div className="fix-step-progress">
            <div className="fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {progress ? `${progress.fixed} / ${progress.total} исправлено` : ''}
          </span>
        </div>

        {/* Card-done flash */}
        {cardDone && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center',
            padding: '10px 16px', margin: '0 0 8px 0',
            background: 'var(--success-light, #dcfce7)', color: 'var(--success, #16a34a)',
            borderRadius: 8, fontSize: 14, fontWeight: 500,
          }}>
            ✓ Карточка завершена! Переходим к следующей…
          </div>
        )}

        {/* Current Issue */}
        <div className="current-issue">
          <div className={`issue-header ${issue.severity}`}>
            <div>
              <div className="issue-label">Текущая проблема карточки</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="issue-title">{issue.title}</div>
                {issue.status === 'skipped' && (
                  <span style={{ fontSize: 11, background: '#e5e7eb', color: '#6b7280', borderRadius: 4, padding: '2px 7px', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    пропущено
                  </span>
                )}
              </div>
              {issue.description && (
                <div className="issue-desc">{issue.description}</div>
              )}
            </div>
            <div className="score-badge">+{issue.score_impact}</div>
          </div>

          <div className="issue-body">
            {/* Fixed file warning — shown only when this characteristic requires fixed file data */}
            {hasFixedFile !== true && issue.requires_fixed_file && issue.source !== 'fixed_file' && (
              <div style={{ background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 8, padding: '10px 14px', marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}>
                <AlertTriangle size={15} style={{ color: '#d97706', flexShrink: 0, marginTop: 1 }} />
                <div>
                  <b style={{ color: '#92400e' }}>Это поле берётся из эталонного файла.</b>{' '}
                  <span style={{ color: '#78350f' }}>AI может ошибиться в значении — для 100% точности загрузите файл с правильными данными. </span>
                  <button
                    onClick={() => navigate('/workspace/fixed-file')}
                    style={{ background: 'none', border: 'none', padding: 0, color: '#d97706', textDecoration: 'underline', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
                  >
                    Загрузить файл →
                  </button>
                </div>
              </div>
            )}

            {/* Fixed file source badge */}
            {issue.source === 'fixed_file' && (
              <div style={{ background: '#ecfdf5', border: '1px solid #6ee7b7', borderRadius: 8, padding: '8px 12px', marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <FileCheck size={14} style={{ color: '#059669' }} />
                <span style={{ color: '#065f46', fontWeight: 600 }}>Эталонный файл</span>
                <span style={{ color: '#047857' }}>— значение из загруженного файла с правильными данными</span>
              </div>
            )}

            {/* AI reason */}
            {issue.ai_reason && (
              <div className="ai-reason">
                <span className="ai-icon"><Bot size={14} /></span>
                <span>{issue.ai_reason}</span>
              </div>
            )}

            {/* Recommended fix */}
            {(() => {
              const swap = getSwapInfo(currentIssue);
              const compoundFixes = getCompoundFixes(currentIssue);
              const fieldName = issue.field_path?.replace('characteristics.', '') || '';

              if (compoundFixes.length > 0) {
                // COMPOUND FIX UI: multiple fields change at once
                return (
                  <div className="fix-recommendation">
                    <h4>Составное исправление <span style={{ background: '#fee2e2', color: '#dc2626', fontSize: 11, padding: '2px 8px', borderRadius: 4, marginLeft: 6 }}>{compoundFixes.length} поля</span></h4>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
                      Нажатие «Применить» изменит все перечисленные поля одновременно
                    </p>
                    {compoundFixes.map((fix, idx) => {
                      const fixFieldName = fix.name || fix.field_path?.replace('characteristics.', '') || '';
                      const isClear = fix.action === 'clear';
                      const isSet = fix.action === 'set';
                      const isReplace = fix.action === 'replace';
                      // Use stored current_value for each sub-field only; do NOT fallback to main issue value
                      // (main issue current_value may be a characteristic value, not the sub-field's value)
                      const currentVal = fix.current_value ?? null;
                      return (
                        <div key={idx} className="fix-swap-step">
                          <div className={`fix-swap-step-badge ${isClear ? 'fix-swap-step-badge--remove' : isReplace ? 'fix-swap-step-badge--change' : 'fix-swap-step-badge--add'}`}>
                            {isClear ? <Trash2 size={13} /> : isReplace ? <ArrowRight size={13} /> : <Plus size={13} />}
                            <span>{isClear ? 'Очистить' : isReplace ? 'Изменить' : 'Добавить'}</span>
                          </div>
                          <div className="fix-compare">
                            <div className={`fix-box ${isSet ? 'fix-box--empty-state' : 'current'}`}>
                              <div className="fix-box-label">{fixFieldName}</div>
                              {isSet
                                ? <div className="fix-box-empty">Не заполнено</div>
                                : <div>{currentVal || '—'}</div>
                              }
                            </div>
                            <div className="arrow">→</div>
                            <div className={`fix-box ${isClear ? 'fix-box--clear' : 'new'}`}>
                              <div className="fix-box-label">После</div>
                              {isClear
                                ? <div className="fix-box-empty"><Trash2 size={14} /> Очистить</div>
                                : <div>{Array.isArray(fix.value) ? fix.value.join(', ') : (fix.value || 'значение будет установлено')}</div>
                              }
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              }

              if (swap.isSwap) {
                // SWAP UI: clear wrong field + fill correct field
                return (
                  <div className="fix-recommendation">
                    <h4>Рекомендуемое исправление</h4>

                    {/* Step 1: Clear wrong field */}
                    <div className="fix-swap-step">
                      <div className="fix-swap-step-badge fix-swap-step-badge--remove">
                        <Trash2 size={13} />
                        <span>Очистить</span>
                      </div>
                      <div className="fix-compare">
                        <div className="fix-box current">
                          <div className="fix-box-label">{fieldName}</div>
                          <div>{issue.current_value || '—'}</div>
                        </div>
                        <div className="arrow">→</div>
                        <div className="fix-box fix-box--clear">
                          <div className="fix-box-label">После исправления</div>
                          <div className="fix-box-empty">
                            <Trash2 size={14} />
                            Очистить (не применимо к товару)
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Step 2: Fill correct field */}
                    {swap.swapToName && (
                      <div className="fix-swap-step">
                        <div className="fix-swap-step-badge fix-swap-step-badge--add">
                          <Plus size={13} />
                          <span>Заполнить</span>
                        </div>
                        <div className="fix-compare">
                          <div className="fix-box fix-box--empty-state">
                            <div className="fix-box-label">{swap.swapToName}</div>
                            <div className="fix-box-empty">Не заполнено</div>
                          </div>
                          <div className="arrow">→</div>
                          <div className="fix-box new">
                            <div className="fix-box-label">{swap.swapToName}</div>
                            <div>{swap.swapToValue || 'введите значение ниже'}</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              }

              if (swap.isClear) {
                // CLEAR UI: just remove value
                return (
                  <div className="fix-recommendation">
                    <h4>Рекомендуемое исправление</h4>
                    <div className="fix-compare">
                      <div className="fix-box current">
                        <div className="fix-box-label">{fieldName || 'Текущее состояние'}</div>
                        <div>{issue.current_value || '—'}</div>
                      </div>
                      <div className="arrow">→</div>
                      <div className="fix-box fix-box--clear">
                        <div className="fix-box-label">После исправления</div>
                        <div className="fix-box-empty">
                          <Trash2 size={14} />
                          Очистить (не применимо)
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              // Default REPLACE UI
              if (mediaIssue) {
                return (
                  <div className="fix-recommendation">
                    <h4>Рекомендуемое исправление</h4>
                    <p style={{ marginBottom: 12, color: 'var(--text-secondary)' }}>
                      {videoMediaIssue
                        ? 'Для этой проблемы нужно добавить или сгенерировать видео через Photo Studio.'
                        : 'Для этой проблемы нужно добавить медиа в карточку через Photo Studio.'}
                    </p>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={openPhotoStudioForIssue}
                      type="button"
                    >
                      Открыть Photo Studio
                    </button>
                  </div>
                );
              }

              return (
                <div className="fix-recommendation">
                  <h4>Рекомендуемое исправление</h4>
                  <div className="fix-compare">
                    <div className="fix-box current">
                      <div className="fix-box-label">Текущее состояние</div>
                      <div>{issue.current_value || '—'}</div>
                    </div>
                    <div className="arrow">→</div>
                    <div className="fix-box new">
                      <div className="fix-box-label">После исправления</div>
                      <div>
                        {(selectedValue || getBestValue(currentIssue))
                          ? (selectedValue || getBestValue(currentIssue))
                          : issue.allowed_values && issue.allowed_values.length > 0
                            ? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                Выберите из допустимых значений ниже ↓
                              </span>
                            : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                Введите свой вариант ниже ↓
                              </span>
                        }
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Variants */}
            {!mediaIssue && alternatives.length > 0 && (
              <div className="fix-variants">
                <h4>Варианты решения</h4>
                <div className="variant-chips">
                  {alternatives.map((alt, idx) => (
                    <button
                      key={idx}
                      className={`variant-chip ${selectedValue === alt ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedValue(alt);
                        setShowCustom(false);
                        setCustomValue('');
                        setCustomSearch('');
                      }}
                    >
                      {alt.length > 80 ? alt.substring(0, 80) + '...' : alt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Custom value + Allowed values — merged */}
            {!mediaIssue && (
            <div className="custom-value">
              <div
                className="custom-value-toggle"
                onClick={() => { setShowCustom(!showCustom); setCustomSearch(''); }}
              >
                <Pencil size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> Свой вариант {showCustom ? '▲' : '▼'}
              </div>
              {showCustom && (
                <div className="custom-value-input">
                  <textarea
                    value={customValue}
                    onChange={(e) => setCustomValue(e.target.value)}
                    placeholder="Введите свой вариант значения..."
                    autoFocus
                  />
                  {issue.allowed_values && issue.allowed_values.length > 0 && (() => {
                    const filtered = customSearch.trim()
                      ? issue.allowed_values.filter(v =>
                          String(v).toLowerCase().includes(customSearch.trim().toLowerCase())
                        )
                      : issue.allowed_values;
                    return (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                          Допустимые значения
                        </div>
                        {issue.allowed_values.length > 8 && (
                          <input
                            type="text"
                            value={customSearch}
                            onChange={(e) => setCustomSearch(e.target.value)}
                            placeholder="Поиск значения..."
                            style={{
                              width: '100%',
                              padding: '6px 10px',
                              marginBottom: 8,
                              border: '1px solid var(--border)',
                              borderRadius: 'var(--radius)',
                              fontSize: 13,
                              outline: 'none',
                              boxSizing: 'border-box',
                            }}
                          />
                        )}
                        <div style={{
                          maxHeight: 160,
                          overflowY: 'auto',
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 6,
                          padding: '4px 0',
                        }}>
                          {filtered.length === 0 ? (
                            <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 0' }}>
                              Ничего не найдено
                            </span>
                          ) : filtered.map((v, i) => (
                            <button
                              key={i}
                              onClick={() => setCustomValue(String(v))}
                              style={{
                                padding: '4px 12px',
                                border: '1px solid var(--border)',
                                borderRadius: 16,
                                fontSize: 12,
                                background: customValue === String(v) ? 'var(--primary)' : 'white',
                                color: customValue === String(v) ? 'white' : 'inherit',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {String(v)}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  <div className="custom-value-hint">
                    Используйте, если система не может определить точное значение
                  </div>
                </div>
              )}
            </div>
            )}
          </div>

          {/* Actions */}
          <div className="fix-actions">
            <div className="fix-actions-left">
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleSkip}
                disabled={actionLoading}
              >
                Пропустить
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={handlePostpone}
                disabled={actionLoading}
                style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12,6 12,12 16,14" />
                </svg>
                Отложить
              </button>
            </div>
            <button
              className="btn btn-primary"
              onClick={mediaIssue ? openPhotoStudioForIssue : handleFix}
              disabled={actionLoading || (!mediaIssue && !selectedValue && !customValue.trim() && !getSwapInfo(currentIssue).isSwap && !getSwapInfo(currentIssue).isClear)}
            >
              {actionLoading ? 'Применяется...' : (mediaIssue ? 'Открыть Photo Studio' : finishButtonLabel)}
            </button>
          </div>
        </div>
      </div>

      {/* ==================== SIDEBAR ==================== */}
      {showSidebar && (
        <>
          <div className="sidebar-overlay" onClick={() => setShowSidebar(false)} />
          <div className="problems-sidebar">
            <div className="sidebar-header">
              <h3>Все проблемы ({allSidebarIssues.length})</h3>
              <button className="sidebar-close" onClick={() => setShowSidebar(false)}>
                ✕
              </button>
            </div>
            {skippedIssues.length > 0 && (
              <div style={{
                padding: '8px 16px',
                background: '#fffbeb',
                borderBottom: '1px solid #fde68a',
                fontSize: 12,
                color: '#92400e',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                <AlertTriangle size={13} />
                Пропущено: {skippedIssues.length} · нажмите чтобы вернуть в работу
              </div>
            )}
            <div className="sidebar-body">
              {sidebarLoading ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                  <div className="spinner" style={{ margin: '0 auto 8px' }} />
                  Загрузка...
                </div>
              ) : allSidebarIssues.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  Нет проблем в этой категории
                </div>
              ) : (
                allSidebarIssues.map((si, idx) => (
                  <div
                    key={si.id}
                    className={`sidebar-issue ${currentIssue && si.id === currentIssue.id ? 'active' : ''} ${si.status === 'skipped' ? 'skipped' : ''}`}
                    onClick={() => handleSidebarIssueClick(si)}
                    style={si.status === 'skipped' ? { opacity: 0.75, borderLeft: '3px solid #f59e0b' } : undefined}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div className="si-title">{si.title}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 4 }}>
                        {si.status === 'skipped' && (
                          <span style={{ fontSize: 10, background: '#fef3c7', color: '#92400e', borderRadius: 4, padding: '2px 6px', fontWeight: 500, whiteSpace: 'nowrap' }}>
                            пропущено
                          </span>
                        )}
                        <span className={`si-severity ${si.severity}`}>
                          {si.severity === 'critical' ? 'Критичные' :
                           si.severity === 'warning' ? 'Предупреждения' :
                           'Улучшения'}
                        </span>
                      </div>
                    </div>
                    <div className="si-card">
                      {si.card_title || `Карточка ${si.card_nm_id}`}
                    </div>
                    <div className="si-meta">
                      <span><Package size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> {si.card_nm_id}</span>
                      {si.card_vendor_code && <span><Tag size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> {si.card_vendor_code}</span>}
                    </div>
                    {si.status === 'skipped' && (
                      <div style={{ fontSize: 11, color: '#d97706', marginTop: 4, fontWeight: 500 }}>
                        Нажмите чтобы вернуть в работу →
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
