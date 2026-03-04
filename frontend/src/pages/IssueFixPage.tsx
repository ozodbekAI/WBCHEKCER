import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import { trackAction } from '../hooks/useActivityTracker';
import { Package, Tag, Home, Bot, ClipboardList, Pencil, ArrowRight, Trash2, Plus, Send, AlertTriangle, FileCheck } from 'lucide-react';
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
  const { severity } = useParams<{ severity: string }>();
  const navigate = useNavigate();
  const { activeStore } = useStore();
  const { hasPermission } = useAuth();

  const [issues, setIssues] = useState<IssueWithCard[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedValue, setSelectedValue] = useState('');
  const [customValue, setCustomValue] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [progress, setProgress] = useState<QueueProgress | null>(null);
  const [scoreBeforeTotal, setScoreBeforeTotal] = useState(0);
  const [hasFixedFile, setHasFixedFile] = useState<boolean | null>(null);

  useEffect(() => {
    if (activeStore) {
      loadIssues();
      api.getFixedFileStatus(activeStore.id)
        .then(r => setHasFixedFile(r.has_fixed_file))
        .catch(() => setHasFixedFile(null));
    }
  }, [activeStore, severity]);

  const loadIssues = async () => {
    if (!activeStore) return;
    setLoading(true);
    try {
      const grouped: IssuesGrouped = await api.getIssuesGrouped(activeStore.id);
      let filtered: IssueWithCard[] = [];

      switch (severity) {
        case 'critical':
          filtered = grouped.critical;
          break;
        case 'warning':
          filtered = grouped.warnings;
          break;
        case 'improvement':
          filtered = grouped.improvements;
          break;
        case 'postponed':
          filtered = grouped.postponed;
          break;
        default:
          filtered = [
            ...grouped.critical,
            ...grouped.warnings,
            ...grouped.improvements,
          ];
      }

      setIssues(filtered);
      setCurrentIdx(0);

      if (filtered.length > 0) {
        const bestValue = getBestValue(filtered[0]);
        setSelectedValue(bestValue);
      }

      // Get progress
      const prog = await api.getQueueProgress(activeStore.id);
      setProgress(prog);
      setScoreBeforeTotal(prog.fixed + prog.pending);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
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

  const currentIssue = issues[currentIdx] || null;

  const [fixedCardIds, setFixedCardIds] = useState<Set<number>>(new Set());
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewSubmitCount, setReviewSubmitCount] = useState(0);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const goToNext = useCallback(() => {
    if (currentIdx + 1 < issues.length) {
      const nextIdx = currentIdx + 1;
      setCurrentIdx(nextIdx);
      setShowCustom(false);
      setCustomValue('');
      const next = issues[nextIdx];
      if (next) {
        setSelectedValue(getBestValue(next));
      }
    } else {
      setCompleted(true);
    }
  }, [currentIdx, issues]);

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

      goToNext();
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
      await api.skipIssue(activeStore.id, currentIssue.id);
      goToNext();
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
      goToNext();
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

  const finishButtonLabel = currentIdx >= issues.length - 1
    ? 'Применить и завершить ✓'
    : 'Применить и перейти к следующей →';

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
  if (completed || issues.length === 0) {
    const fixedCount = currentIdx;
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
            <h2>
              {issues.length === 0
                ? 'Нет проблем для исправления'
                : 'Все критические проблемы устранены'}
            </h2>
            <p className="completion-desc">
              {issues.length === 0
                ? 'В этой категории не найдено проблем'
                : 'Вернитесь в рабочее пространство для работы над остальными улучшениями'}
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
  const alternatives = getAlternatives(currentIssue);
  const mediaIssue = currentIssue ? isMediaIssue(currentIssue) : false;
  const videoMediaIssue = currentIssue ? isVideoMediaIssue(currentIssue) : false;
  const progressPercent = issues.length > 0 ? ((currentIdx) / issues.length) * 100 : 0;

  return (
    <div className="issue-fix-page">
      {/* Top bar */}
      <div style={{
        padding: '12px 24px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-white)',
      }}>
        <div className="page-back" onClick={() => navigate('/workspace')} style={{ marginBottom: 0 }}>
          ← {severityLabel}
        </div>
      </div>

      <div className="fix-page">
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Исправление проблемы</h2>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: reviewSubmitted ? 8 : 24 }}>
          Проверьте и подтвердите корректное значение · шаг {currentIdx + 1} из {issues.length}
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
          {currentIssue.card_photos?.[0] ? (
            <img
              src={currentIssue.card_photos[0]}
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
              {currentIssue.card_title || `Карточка ${currentIssue.card_nm_id}`}
              <a
                href={`https://www.wildberries.ru/catalog/${currentIssue.card_nm_id}/detail.aspx`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ marginLeft: 6, fontSize: 12, color: 'var(--primary)' }}
              >
                ↗
              </a>
            </div>
            <div className="fix-card-meta">
              <span><Package size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> {currentIssue.card_nm_id}</span>
              {currentIssue.card_vendor_code && (
                <span><Tag size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> {currentIssue.card_vendor_code}</span>
              )}
            </div>
          </div>
          <div className="fix-card-score">
            <span className="score-gain">+{currentIssue.score_impact}</span>
          </div>
        </div>

        {/* Step progress */}
        <div className="fix-step-bar">
          <span>{currentIdx + 1} из {issues.length}</span>
          <div className="fix-step-progress">
            <div className="fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <button className="all-problems-btn" onClick={() => setShowSidebar(true)}>
                        <ClipboardList size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> Все проблемы ({issues.length})
          </button>
        </div>

        {/* Current Issue */}
        <div className="current-issue">
          <div className={`issue-header ${currentIssue.severity}`}>
            <div>
              <div className="issue-label">Текущая проблема карточки</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="issue-title">{currentIssue.title}</div>
                {currentIssue.status === 'skipped' && (
                  <span style={{ fontSize: 11, background: '#e5e7eb', color: '#6b7280', borderRadius: 4, padding: '2px 7px', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    пропущено
                  </span>
                )}
              </div>
              {currentIssue.description && (
                <div className="issue-desc">{currentIssue.description}</div>
              )}
            </div>
            <div className="score-badge">+{currentIssue.score_impact}</div>
          </div>

          <div className="issue-body">
            {/* No fixed file warning — shown once above issue list */}
            {hasFixedFile === false && currentIdx === 0 && (
              <div style={{ background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 8, padding: '10px 14px', marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}>
                <AlertTriangle size={15} style={{ color: '#d97706', flexShrink: 0, marginTop: 1 }} />
                <div>
                  <b style={{ color: '#92400e' }}>Эталонный файл не загружен.</b>{' '}
                  <span style={{ color: '#78350f' }}>AI может ошибаться в составе и сертификатах. </span>
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
            {currentIssue.source === 'fixed_file' && (
              <div style={{ background: '#ecfdf5', border: '1px solid #6ee7b7', borderRadius: 8, padding: '8px 12px', marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <FileCheck size={14} style={{ color: '#059669' }} />
                <span style={{ color: '#065f46', fontWeight: 600 }}>Эталонный файл</span>
                <span style={{ color: '#047857' }}>— значение из загруженного файла с правильными данными</span>
              </div>
            )}

            {/* AI reason */}
            {currentIssue.ai_reason && (
              <div className="ai-reason">
                <span className="ai-icon"><Bot size={14} /></span>
                <span>{currentIssue.ai_reason}</span>
              </div>
            )}

            {/* Recommended fix */}
            {(() => {
              const swap = getSwapInfo(currentIssue);
              const compoundFixes = getCompoundFixes(currentIssue);
              const fieldName = currentIssue.field_path?.replace('characteristics.', '') || '';

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
                      // Use stored current_value for each sub-field; fallback to main issue value only for idx=0
                      const currentVal = fix.current_value ?? (idx === 0 ? currentIssue.current_value : null);
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
                          <div>{currentIssue.current_value || '—'}</div>
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
                        <div>{currentIssue.current_value || '—'}</div>
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
                      <div>{currentIssue.current_value || '—'}</div>
                    </div>
                    <div className="arrow">→</div>
                    <div className="fix-box new">
                      <div className="fix-box-label">После исправления</div>
                      <div>
                        {(selectedValue || getBestValue(currentIssue))
                          ? (selectedValue || getBestValue(currentIssue))
                          : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                              <Bot size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> AI не смог сгенерировать — введите свой вариант ниже
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
                      }}
                    >
                      {alt.length > 80 ? alt.substring(0, 80) + '...' : alt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Custom value */}
            {!mediaIssue && (
            <div className="custom-value">
              <div
                className="custom-value-toggle"
                onClick={() => setShowCustom(!showCustom)}
              >
                                <Pencil size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> Свой вариант {showCustom ? '▲' : '▼'}
              </div>
              {showCustom && (
                <div className="custom-value-input">
                  <textarea
                    value={customValue}
                    onChange={(e) => setCustomValue(e.target.value)}
                    placeholder="Введите свой вариант значения..."
                  />
                  <div className="custom-value-hint">
                    Используйте, если система не может определить точное значение
                  </div>
                </div>
              )}
            </div>
            )}

            {/* Allowed values (for characteristics) */}
            {!mediaIssue && currentIssue.allowed_values && currentIssue.allowed_values.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  Допустимые значения
                </h4>
                <div style={{
                  maxHeight: 120,
                  overflow: 'auto',
                  padding: '8px 12px',
                  background: 'var(--bg)',
                  borderRadius: 'var(--radius)',
                  fontSize: 13,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                }}>
                  {currentIssue.allowed_values.slice(0, 30).map((v, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setSelectedValue(String(v));
                        setShowCustom(false);
                      }}
                      style={{
                        padding: '4px 10px',
                        border: '1px solid var(--border)',
                        borderRadius: 16,
                        fontSize: 12,
                        background: selectedValue === String(v) ? 'var(--primary)' : 'white',
                        color: selectedValue === String(v) ? 'white' : 'inherit',
                        cursor: 'pointer',
                      }}
                    >
                      {String(v)}
                    </button>
                  ))}
                  {currentIssue.allowed_values.length > 30 && (
                    <span style={{ color: 'var(--text-muted)', padding: '4px 8px' }}>
                      +{currentIssue.allowed_values.length - 30} ещё
                    </span>
                  )}
                </div>
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
              <h3>Все проблемы ({issues.length})</h3>
              <button className="sidebar-close" onClick={() => setShowSidebar(false)}>
                ✕
              </button>
            </div>
            <div className="sidebar-body">
              {issues.map((issue, idx) => (
                <div
                  key={issue.id}
                  className={`sidebar-issue ${idx === currentIdx ? 'active' : ''}`}
                  onClick={() => {
                    setCurrentIdx(idx);
                    setSelectedValue(getBestValue(issue));
                    setShowCustom(false);
                    setCustomValue('');
                    setShowSidebar(false);
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div className="si-title">{issue.title}</div>
                    {issue.status === 'skipped' ? (
                      <span style={{ fontSize: 10, background: '#e5e7eb', color: '#6b7280', borderRadius: 4, padding: '2px 6px', fontWeight: 500, whiteSpace: 'nowrap', flexShrink: 0, marginLeft: 4 }}>
                        пропущено
                      </span>
                    ) : (
                      <span className={`si-severity ${issue.severity}`}>
                        {issue.severity === 'critical' ? 'Критичные' :
                         issue.severity === 'warning' ? 'Предупреждения' :
                         'Улучшения'}
                      </span>
                    )}
                  </div>
                  <div className="si-card">
                    {issue.card_title || `Карточка ${issue.card_nm_id}`}
                  </div>
                  <div className="si-meta">
                    <span><Package size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> {issue.card_nm_id}</span>
                    {issue.card_vendor_code && <span><Tag size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> {issue.card_vendor_code}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
