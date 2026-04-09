import React, { useEffect, useState, useCallback, useRef } from 'react';

import { toast } from 'sonner';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import { logAction } from '../hooks/useWorkTracker';
import { Package, Tag, ShoppingBag, Home, Bot, Pencil, ArrowRight, Trash2, Plus, AlertTriangle, FileCheck, List, X, Check, Copy, ArrowLeft, Users, ChevronRight, Sparkles, BadgeCheck, Clock } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Checkbox } from '../components/ui/checkbox';
import TextEditorDialog from '../components/TextEditorDialog';
import type { IssueWithCard, IssuesGrouped, QueueProgress } from '../types';

/** Extract swap info from issue's error_details */
function getSwapInfo(issue: IssueWithCard): { isSwap: boolean; isClear: boolean; swapToName: string; swapToValue: string } {
  const directSuggestion = String(issue.ai_suggested_value || issue.suggested_value || '').trim();
  const fieldPath = String(issue.field_path || '').trim().toLowerCase();
  const fieldName = fieldPath.startsWith('characteristics.') ? fieldPath.slice('characteristics.'.length) : fieldPath;
  const details = issue.error_details || [];
  for (const d of details) {
    if (d?.fix_action === 'swap') {
      const swapToName = String(d.swap_to_name || '').trim();
      const normalizedSwapToName = swapToName.toLowerCase();
      const swapToValue = Array.isArray(d.swap_to_value) ? d.swap_to_value.join(', ') : String(d.swap_to_value || '');
      const sameField = Boolean(
        normalizedSwapToName
        && (normalizedSwapToName === fieldName || normalizedSwapToName === fieldPath)
      );
      if (directSuggestion && sameField) {
        continue;
      }
      return { isSwap: true, isClear: false, swapToName, swapToValue };
    }
    if (d?.fix_action === 'clear') {
      if (directSuggestion) {
        continue;
      }
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
  allowed_values?: any[];
  alternatives?: string[];
  ai_suggested_value?: string | null;
  max_count?: number | null;
}

interface CompoundFieldState {
  selectedValues: string[];
  showCustom: boolean;
  customSearch: string;
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

function isCharacteristicFieldIssue(issue: IssueWithCard): boolean {
  return String(issue.field_path || '').toLowerCase().startsWith('characteristics.');
}

function isMediaIssue(issue: IssueWithCard): boolean {
  const code = String(issue.code || '').toLowerCase();
  const category = String(issue.category || '').toLowerCase();
  const fieldPath = String(issue.field_path || '').toLowerCase();
  if (isCharacteristicFieldIssue(issue)) {
    return false;
  }
  return (
    code === 'no_photos' ||
    code === 'few_photos' ||
    code === 'add_more_photos' ||
    category === 'photos' ||
    fieldPath.startsWith('photos') ||
    isVideoMediaIssue(issue)
  );
}

function isVideoMediaIssue(issue: IssueWithCard): boolean {
  const code = String(issue.code || '').toLowerCase();
  const category = String(issue.category || '').toLowerCase();
  const fieldPath = String(issue.field_path || '').toLowerCase();
  return code === 'no_video' || category === 'video' || fieldPath.startsWith('videos');
}

function isTextIssue(issue: IssueWithCard): boolean {
  const cat = String(issue.category || '').toLowerCase();
  const fp = String(issue.field_path || '').toLowerCase();
  return cat === 'title' || cat === 'description' || fp === 'title' || fp === 'description';
}

function getTextIssueField(issue: IssueWithCard): 'title' | 'description' {
  const cat = String(issue.category || '').toLowerCase();
  const fp = String(issue.field_path || '').toLowerCase();
  return (cat === 'title' || fp === 'title') ? 'title' : 'description';
}

function CopyableId({ text, label, icon }: { text: string; label: string; icon: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    toast.success(label);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={handleCopy} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors" title="Копировать">
      {icon} {text} {copied
        ? <Check size={11} className="text-zone-green" />
        : <Copy size={11} className="opacity-65" />}
    </button>
  );
}

function issueCategoryLabel(issue: IssueWithCard): string {
  const cat = String(issue.category || '').toLowerCase();
  if (isCharacteristicFieldIssue(issue) || cat === 'characteristics' || cat === 'photo_mismatch') return 'Ошибка характеристики';
  if (cat === 'description') return 'Ошибка описания';
  if (cat === 'title') return 'Ошибка названия';
  if (cat === 'media' || cat === 'photos' || cat === 'video') return 'Проблема с медиа';
  return 'Ошибка характеристики';
}

// ─── Shared chip component ─────────────────────────────────────────────────

function ValueChip({ value, onRemove }: { value: string; onRemove?: () => void }) {
  const displayValue = value === '__CLEAR__' ? 'Очистить' : value;
  return (
    <span className="inline-flex items-center gap-1 bg-muted border border-border rounded-md px-2.5 py-1 text-[13px] font-medium text-foreground whitespace-nowrap">
      <span className="max-w-[200px] overflow-hidden text-ellipsis">{displayValue}</span>
      {onRemove && (
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="flex items-center text-muted-foreground hover:text-foreground">
          <X size={11} />
        </button>
      )}
    </span>
  );
}

// ─── Shared dropdown item ───────────────────────────────────────────────────

function DropdownItem({ label, isSelected, isPrimary, isAI, onClick }: { label: string; isSelected: boolean; isPrimary?: boolean; isAI?: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-[13px] cursor-pointer transition-colors ${
        isSelected ? 'bg-accent' : 'hover:bg-muted'
      } ${isPrimary && !isSelected ? 'text-primary font-semibold' : ''} ${!isPrimary ? 'font-normal' : ''}`}
    >
      {isAI && <Bot size={14} />}
      <span className="overflow-hidden text-ellipsis whitespace-nowrap flex-1">{label}</span>
      {isSelected && <Check size={14} className="flex-shrink-0 text-primary" />}
    </div>
  );
}

// ─── Sticky "Готово" button for dropdown ─────────────────────────────────────

function DropdownDoneButton({ count, onDone }: { count: number; onDone: () => void }) {
  if (count === 0) return null;
  return (
    <div className="border-b border-border px-3 py-2 bg-card rounded-t-lg">
      <button
        onClick={(e) => { e.stopPropagation(); onDone(); }}
        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <Check className="h-3 w-3" /> Готово
      </button>
    </div>
  );
}

export default function IssueFixPage() {
  const { severity, cardId: cardIdParam } = useParams<{ severity?: string; cardId?: string }>();
  const navigate = useNavigate();
  const { activeStore } = useStore();
  const { hasPermission, user } = useAuth();

  const cardIdMode = cardIdParam ? parseInt(cardIdParam, 10) : null;

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [customValue, setCustomValue] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [customSearch, setCustomSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showCustom) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowCustom(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showCustom]);

  // Compound field states (per sub-field)
  const [compoundStates, setCompoundStates] = useState<CompoundFieldState[]>([]);
  const compoundDropdownRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Click-outside for compound dropdowns
  useEffect(() => {
    const anyOpen = compoundStates.some(s => s.showCustom);
    if (!anyOpen) return;
    const handler = (e: MouseEvent) => {
      setCompoundStates(prev => prev.map((state, idx) => {
        if (!state.showCustom) return state;
        const ref = compoundDropdownRefs.current[idx];
        if (ref && !ref.contains(e.target as Node)) {
          return { ...state, showCustom: false };
        }
        return state;
      }));
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [compoundStates]);

  // Text editor dialog state (for title/description issues)
  const [textEditorOpen, setTextEditorOpen] = useState(false);
  const [textEditorValue, setTextEditorValue] = useState('');

  // Delegation dialog state
  const [showDelegateDialog, setShowDelegateDialog] = useState(false);
  const [teamMembers, setTeamMembers] = useState<{ id: number; name: string; role: string; isCurrent?: boolean }[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [selectedDelegateIds, setSelectedDelegateIds] = useState<Set<number>>(new Set());
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
  const [cardDone, setCardDone] = useState(false);

  // All issues for sidebar (pending + skipped)
  const [allSidebarIssues, setAllSidebarIssues] = useState<IssueWithCard[]>([]);
  const [sidebarLoading, setSidebarLoading] = useState(false);

  // Track skipped issues that user re-skipped in THIS session
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
      const compoundFixes = getCompoundFixes(issue);
      if (compoundFixes.length > 0) {
        const states: CompoundFieldState[] = compoundFixes.map(fix => {
          const bestVal = fix.action === 'clear' ? '' : (
            fix.ai_suggested_value
            || (Array.isArray(fix.value) ? fix.value.join(', ') : (fix.value || ''))
          );
          const vals = bestVal ? bestVal.split(/[;,]\s*/).filter(Boolean) : [];
          const noSuggestion = !bestVal;
          const hasAllowed = fix.allowed_values && fix.allowed_values.length > 0;
          return {
            selectedValues: vals,
            showCustom: noSuggestion && hasAllowed ? true : false,
            customSearch: '',
          };
        });
        setCompoundStates(states);
        setSelectedValues([]);
        setShowCustom(false);
      } else {
        setCompoundStates([]);
        const best = getBestValue(issue);
        setSelectedValues(best ? best.split(/[;,]\s*/).filter(Boolean) : []);
        const swap = getSwapInfo(issue);
        const noSuggestion = !best && !swap.isClear;
        const hasAllowed = issue.allowed_values && issue.allowed_values.length > 0;
        setShowCustom(noSuggestion && hasAllowed ? true : false);
      }
      setCustomValue('');
      setCustomSearch('');
      setTextEditorValue('');
      setTextEditorOpen(false);
      setCardDone(false);
      loadCardPendingCount(issue.card_id);
    }
  };

  const loadCardPendingCount = async (cardId: number) => {
    if (!activeStore) return;
    try {
      const cardIssues = await api.getCardIssues(activeStore.id, cardId, 'pending');
      const count = cardIssues.length || 0;
      setCurrentCardPendingCount(count);
      if (totalCardIssues === 0) {
        setTotalCardIssues(count);
      }
    } catch (err) {
      console.error('Failed to load card pending count:', err);
    }
  };

  const getPoolFromGrouped = (grouped: IssuesGrouped, sev?: string): IssueWithCard[] => {
    if (sev === 'media') return grouped.media || [];
    if (sev === 'critical') return grouped.critical || [];
    if (sev === 'warning') return grouped.warnings || [];
    if (sev === 'improvement') return grouped.improvements || [];
    return [...(grouped.critical || []), ...(grouped.warnings || []), ...(grouped.improvements || []), ...(grouped.media || [])];
  };

  const loadFirstIssue = async () => {
    if (!activeStore) return;
    setLoading(true);
    try {
      const issue = await api.getNextIssue(activeStore.id, undefined, cardIdMode || undefined, severity || undefined);
      const effectiveIssue = issue;
      if (effectiveIssue) {
        applyIssueToState(effectiveIssue);
      } else {
        const grouped: IssuesGrouped = await api.getIssuesGrouped(activeStore.id);
        const pool = getPoolFromGrouped(grouped, severity);
        let skippedPool = pool.filter(i => i.status === 'skipped');

        const allIssues = pool;
        setAllSidebarIssues(allIssues);

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
      const issues = getPoolFromGrouped(grouped, severity);
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
      try {
        await api.unskipIssue(activeStore.id, issue.id);
        issue.status = 'pending';
        loadSidebarIssues();
      } catch (err) {
        console.error('Failed to unskip issue:', err);
        return;
      }
    }
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
    const swap = getSwapInfo(issue);
    if (swap.isSwap) return swap.swapToValue || '';
    if (swap.isClear) return '';
    return issue.ai_suggested_value || issue.suggested_value || '';
  };

  const getAlternatives = (issue: IssueWithCard): string[] => {
    const best = getBestValue(issue);
    const alts: string[] = [];
    if (best) alts.push(best);
    if (issue.ai_alternatives) {
      issue.ai_alternatives.forEach(a => { if (a && !alts.includes(a)) alts.push(a); });
    }
    if (issue.alternatives) {
      issue.alternatives.forEach(a => { if (a && !alts.includes(a)) alts.push(a); });
    }
    if (issue.suggested_value && !alts.includes(issue.suggested_value)) {
      alts.push(issue.suggested_value);
    }
    return alts;
  };

  const isCompositionLikeIssue = (issue: IssueWithCard): boolean => {
    const fp = String(issue.field_path || '').toLowerCase();
    const title = String(issue.title || '').toLowerCase();
    const desc = String(issue.description || '').toLowerCase();
    return fp.includes('состав') || fp.includes('composition') || title.includes('состав') || title.includes('composition') || desc.includes('состав') || desc.includes('composition');
  };

  const issues: IssueWithCard[] = allSidebarIssues;
  const currentIdx = currentIssue ? allSidebarIssues.findIndex(i => i.id === currentIssue.id) : -1;
  const skippedIssues = allSidebarIssues.filter(i => i.status === 'skipped');

  const [fixedCardIds, setFixedCardIds] = useState<Set<number>>(new Set());
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewSubmitCount, setReviewSubmitCount] = useState(0);
  const [reviewError, setReviewError] = useState<string | null>(null);

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
        if (cardIdMode) {
          setCardDone(true);
          await new Promise(resolve => setTimeout(resolve, 1200));
          navigate('/workspace/cards/queue');
          return;
        }
        setCardDone(true);
        await new Promise(resolve => setTimeout(resolve, 1200));
        setCardDone(false);
      }
      const next = await api.getNextIssue(activeStore.id, undefined, undefined, severity || undefined);
      if (next) {
        applyIssueToState(next);
      } else {
        const freshGrouped: IssuesGrouped = await api.getIssuesGrouped(activeStore.id);
        const pool = getPoolFromGrouped(freshGrouped, severity);
        const skippedPool = pool.filter(i => i.status === 'skipped');
        setAllSidebarIssues(pool);

        const remaining = skippedPool.filter(i => !sessionSkippedIdsRef.current.has(i.id));

        if (remaining.length > 0) {
          applyIssueToState(remaining[0]);
        } else if (skippedPool.length > 0) {
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
    logAction('problem_resolved', `Исправлено: ${currentIssue?.title || 'проблема'}`, { nmId: currentIssue?.card_nm_id });
    if (!activeStore || !currentIssue) return;

    const swap = getSwapInfo(currentIssue);
    const compoundFixes = getCompoundFixes(currentIssue);
    const isCompound = compoundFixes.length > 0;
    const textIssue = isTextIssue(currentIssue);
    let value: string;

    if (textIssue) {
      value = textEditorValue.trim();
      if (!value) return;
    } else if (isCompound) {
      const compoundValues = compoundFixes.map((fix, idx) => {
        const fieldState = compoundStates[idx];
        if (fix.action === 'clear') return '__CLEAR__';
        if (fieldState && fieldState.selectedValues.length > 0) {
          return fieldState.selectedValues.join(', ');
        }
        return serializeFixValue(fix.value);
      });
      value = JSON.stringify(compoundValues);
    } else if (swap.isSwap || swap.isClear) {
      value = showCustom && customValue.trim()
        ? customValue.trim()
        : swap.swapToValue || '__CLEAR__';
    } else {
      value = showCustom && customValue.trim()
        ? customValue.trim()
        : selectedValues.join(', ');
      if (!value) return;
    }

    setActionLoading(true);
    try {
      await api.fixIssue(activeStore.id, currentIssue.id, value, false);
      const cardId = currentIssue.card_id;
      const newFixedIds = new Set(fixedCardIds).add(cardId);
      setFixedCardIds(newFixedIds);
      setCurrentCardPendingCount(prev => Math.max(0, prev - 1));

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
    logAction('problem_skipped', `Пропущено: ${currentIssue?.title || 'проблема'}`, { nmId: currentIssue?.card_nm_id });
    if (!activeStore || !currentIssue) return;
    setActionLoading(true);
    try {
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

  const openDelegateDialog = async () => {
    if (!activeStore) return;
    setShowDelegateDialog(true);
    setSelectedDelegateIds(new Set());
    setTeamMembers([]);
    setTeamLoading(true);
    try {
      const members = await api.getTeamMembers(activeStore.id);
      setTeamMembers(
        members.map((m: any) => ({
          id: m.id,
          name: [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email,
          role: m.role,
          isCurrent: user?.id === m.id,
        }))
      );
    } catch (err) {
      console.error('Failed to load team members:', err);
      toast.error('Не удалось загрузить список сотрудников');
    } finally {
      setTeamLoading(false);
    }
  };

  const handleDelegate = async () => {
    logAction('problem_deferred', `Отложено: ${currentIssue?.title || 'проблема'}`, { nmId: currentIssue?.card_nm_id });
    if (!activeStore || !currentIssue || selectedDelegateIds.size === 0) return;
    setActionLoading(true);
    try {
      await api.assignIssue(activeStore.id, currentIssue.id, Array.from(selectedDelegateIds));
      toast.success(`Задача передана (${selectedDelegateIds.size})`);
      setShowDelegateDialog(false);
      setSelectedDelegateIds(new Set());
      await goToNext();
    } catch {
      toast.error('Не удалось передать задачу');
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
    const returnUrl = `/workspace/fix/${severity || 'media'}`;
    navigate(`/photo-studio?${params.toString()}&returnUrl=${encodeURIComponent(returnUrl)}`);
  };

  const severityLabel = {
    critical: 'Выход из аварийного режима',
    warning: 'Исправление предупреждений',
    improvement: 'Улучшение карточек',
    postponed: 'Отложенные задачи',
    media: 'Фото и видео',
  }[severity || ''] || 'Исправление проблем';

  // ==================== LOADING ====================
  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="flex items-center justify-center min-h-screen">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">Анализ карточек...</span>
            <div className="w-[300px]">
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: '60%' }} />
              </div>
              <p className="text-xs text-muted-foreground mt-2 text-center">Это займёт несколько секунд</p>
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
      <div className="min-h-screen bg-background">
        <div className="max-w-[600px] mx-auto pt-20 px-4">
          <div className="relative bg-zone-green/10 border-2 border-zone-green/30 rounded-2xl p-10 text-center overflow-hidden">
            {/* Confetti */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
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

            <div className="relative z-10">
              <div className="w-16 h-16 rounded-full bg-zone-green text-white flex items-center justify-center text-2xl font-bold mx-auto mb-4">✓</div>
              <h2 className="text-xl font-bold text-foreground mb-2">Все проблемы устранены!</h2>
              <p className="text-sm text-muted-foreground mb-6">В этой категории не осталось проблем для исправления</p>

              {fixedCount > 0 && (
                <>
                  <div className="flex items-center justify-center gap-6 mb-4">
                    <div className="text-center">
                      <div className="text-[11px] text-muted-foreground mb-1">Было</div>
                      <div className="text-2xl font-bold text-foreground">{Math.max(42, 100 - avgGain - 20)}</div>
                    </div>
                    <span className="text-zone-green font-bold text-lg">~+{avgGain}</span>
                    <div className="text-center">
                      <div className="text-[11px] text-muted-foreground mb-1">Стало</div>
                      <div className="text-2xl font-bold text-zone-green">{Math.min(100, Math.max(42, 100 - 20))}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[11px] text-muted-foreground mb-1">Макс</div>
                      <div className="text-2xl font-bold text-foreground">100</div>
                    </div>
                  </div>

                  <Badge variant="secondary" className="mb-4">Новый статус: В норме</Badge>

                  <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground mb-6">
                    <Clock size={14} />
                    <span>Применено: {new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span>· Эффект станет заметен в течение 24-48 часов</span>
                  </div>
                </>
              )}

              <Button className="w-full" size="lg" onClick={() => navigate('/workspace')}>
                <Home size={16} className="mr-2" /> В рабочее пространство
              </Button>

              {fixedCount > 0 && !hasPermission('cards.sync') && (
                <div className="mt-5">
                  {reviewSubmitting ? (
                    <div className="rounded-xl border border-primary/30 bg-primary/5 px-5 py-4 text-sm font-medium text-primary text-center">
                      ⏳ Отправляем {fixedCardIds.size} карт. на проверку...
                    </div>
                  ) : reviewSubmitted ? (
                    <div className="rounded-xl border border-zone-green/40 bg-zone-green/10 px-5 py-4 text-sm font-medium text-zone-green text-center">
                      ✅ {reviewSubmitCount} карт. отправлено на проверку старшему менеджеру
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==================== FIX FLOW ====================
  const issue = currentIssue!;
  const alternatives = getAlternatives(issue);
  const mediaIssue = isMediaIssue(issue);
  const videoMediaIssue = isVideoMediaIssue(issue);
  const progressPercent = progress
    ? ((progress.fixed) / Math.max(progress.total, 1)) * 100
    : 0;

  return (
    <div className="min-h-screen bg-background">
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
        <button
          onClick={() => navigate(cardIdMode ? '/workspace/cards/queue' : '/workspace')}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} />
          <span>{cardIdMode ? 'К списку карточек' : severityLabel}</span>
        </button>
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={() => { setShowSidebar(true); loadSidebarIssues(); }}
        >
          <List size={14} className="mr-1.5" />
          Все проблемы
          {allSidebarIssues.length > 0 && (
            <Badge variant="default" className="ml-1.5 h-5 min-w-[18px] text-[11px]">{allSidebarIssues.length}</Badge>
          )}
        </Button>
      </div>

      {/* ── Main content ── */}
      <div className="max-w-[800px] mx-auto px-4 py-6">

        {/* Review status banners */}
        {reviewSubmitted && !hasPermission('cards.sync') && (
          <div className="text-xs text-zone-green bg-zone-green/10 border border-zone-green/30 rounded-lg px-3 py-1.5 mb-4 inline-block">
            ✅ {reviewSubmitCount} карт. отправлено на проверку
          </div>
        )}
        {reviewError && !hasPermission('cards.sync') && (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-1.5 mb-4 inline-block">
            ⚠️ {reviewError}
          </div>
        )}

        {/* ── Card info ── */}
        <div className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card mb-4">
          {issue.card_photos?.[0] ? (
            <img src={issue.card_photos[0]} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
          ) : (
            <div className="w-12 h-12 rounded-lg border border-border bg-muted flex items-center justify-center flex-shrink-0">
              <Package size={20} className="text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[15px] font-semibold text-foreground truncate">
                {issue.card_title || `Карточка ${issue.card_nm_id}`}
              </span>
              <a
                href={`https://www.wildberries.ru/catalog/${issue.card_nm_id}/detail.aspx`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary text-xs hover:underline flex-shrink-0"
              >
                ↗ WB
              </a>
            </div>
            <div className="flex items-center gap-3">
              <CopyableId
                text={String(issue.card_nm_id)}
                label="Артикул ВБ скопирован"
                icon={<ShoppingBag size={11} />}
              />
              {issue.card_vendor_code && (
                <CopyableId
                  text={issue.card_vendor_code}
                  label="Код поставщика скопирован"
                  icon={<Tag size={11} />}
                />
              )}
            </div>
          </div>
        </div>

        {/* ── Progress ── */}
        {progress && (
          <p className="text-xs text-muted-foreground mb-2">
            Исправление {progress.fixed + 1} из {progress.total}
          </p>
        )}

        {/* ── Card-done flash ── */}
        {cardDone && (
          <div className="flex items-center justify-center gap-2 rounded-lg bg-zone-green/10 border border-zone-green/30 px-4 py-2.5 mb-3 text-sm font-medium text-zone-green">
            <Check size={16} /> Карточка завершена! Переходим к следующей…
          </div>
        )}

        {/* ── Current Issue ── */}
        <div className="rounded-xl border border-border bg-card overflow-visible">
          {/* Issue header */}
          <div className={`px-4 py-3 border-b rounded-t-xl ${
            issue.severity === 'critical' ? 'bg-destructive/5 border-destructive/20' : 'bg-zone-yellow/5 border-zone-yellow/20'
          }`}>
            <div className="flex items-start justify-between">
              <div>
                <div className={`text-[14px] font-semibold mb-1 ${
                  issue.severity === 'critical' ? 'text-destructive' : 'text-zone-yellow'
                }`}>
                  {issueCategoryLabel(issue)}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{issue.title}</span>
                  {issue.status === 'skipped' && (
                    <Badge variant="secondary" className="text-[10px] h-5">пропущено</Badge>
                  )}
                </div>
              </div>
              <Badge variant="secondary" className="text-[10px] h-5 flex-shrink-0">+{issue.score_impact} к рейтингу</Badge>
            </div>
          </div>

          {/* Issue body */}
          <div className="p-4 space-y-3">
            {/* Reason block */}
            {issue.description && (
              <div className={`rounded-lg p-3 text-sm ${
                issue.severity === 'critical' ? 'bg-destructive/5' : 'bg-zone-yellow/5'
              }`}>
                <div className="text-[11px] text-muted-foreground mb-1">Причина</div>
                <p className="text-sm font-medium text-foreground">{issue.description.replace(/^[a-z_]+:\s*/i, '')}</p>
              </div>
            )}

            {/* Fixed file warning */}
            {hasFixedFile !== true && (issue.requires_fixed_file || isCompositionLikeIssue(issue)) && issue.source !== 'fixed_file' && (
              <div className="flex items-start gap-2 rounded-lg bg-zone-yellow/10 border border-zone-yellow/40 p-3 text-xs">
                <AlertTriangle size={14} className="text-zone-yellow flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-zone-yellow">Это поле берётся из эталонного файла.</span>{' '}
                  <span className="text-muted-foreground">AI может ошибиться — для точности </span>
                  <button onClick={() => navigate('/workspace/fixed-file')} className="text-zone-yellow font-semibold hover:underline">
                    загрузите файл →
                  </button>
                </div>
              </div>
            )}

            {/* Fixed file source badge */}
            {issue.source === 'fixed_file' && (
              <div className="flex items-center gap-2 rounded-lg bg-zone-green/10 border border-zone-green/30 px-3 py-2 text-xs">
                <FileCheck size={13} className="text-zone-green" />
                <span className="font-semibold text-zone-green">Эталонный файл</span>
                <span className="text-muted-foreground">— значение из загруженного файла</span>
              </div>
            )}

            {/* ── Recommended fix ── */}
            {(() => {
              const swap = getSwapInfo(currentIssue);
              const compoundFixes = getCompoundFixes(currentIssue);
              const fieldName = issue.field_path?.replace('characteristics.', '') || '';

              // ── COMPOUND FIX ──
              if (compoundFixes.length > 0) {
                return (
                  <div className="space-y-4">
                    <p className="text-xs text-muted-foreground">
                      Нажатие «Применить» изменит все перечисленные поля одновременно
                    </p>
                    {compoundFixes.map((fix, idx) => {
                      const fixFieldName = fix.name || fix.field_path?.replace('characteristics.', '') || '';
                      const isClear = fix.action === 'clear';
                      const fieldState = compoundStates[idx] || { selectedValues: [], showCustom: false, customSearch: '' };
                      const currentVal = fix.current_value ?? null;
                      const fixAlternatives: string[] = [];
                      const bestVal = fix.ai_suggested_value || (Array.isArray(fix.value) ? fix.value.join(', ') : (fix.value || ''));
                      if (bestVal) fixAlternatives.push(bestVal);
                      if (fix.alternatives) {
                        fix.alternatives.forEach(a => { if (a && !fixAlternatives.includes(a)) fixAlternatives.push(a); });
                      }
                      const fixMaxCount = fix.max_count || (fix.allowed_values && fix.allowed_values.length > 0 ? fix.allowed_values.length : null);
                      const fixIsAtLimit = fixMaxCount !== null && fieldState.selectedValues.length >= fixMaxCount;

                      const updateFieldState = (updater: (prev: CompoundFieldState) => CompoundFieldState) => {
                        setCompoundStates(prev => prev.map((s, i) => i === idx ? updater(s) : s));
                      };

                      if (isClear) {
                        return (
                          <div key={idx}>
                            <div className="text-[13px] font-medium text-foreground mb-2">{fixFieldName}</div>
                            <div className="flex items-stretch gap-2">
                              <div className="flex-1 rounded-md border border-border bg-background p-2.5 min-h-[42px]">
                                <div className="text-[10px] text-muted-foreground mb-1.5 opacity-70">Текущее значение</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {currentVal ? currentVal.split(/[,;]/).map(v => v.trim()).filter(Boolean).map((val, i) => (
                                    <ValueChip key={i} value={val} />
                                  )) : <span className="text-[13px] text-muted-foreground">—</span>}
                                </div>
                              </div>
                              <div className="flex items-center justify-center px-1">
                                <ArrowRight size={18} className="text-muted-foreground opacity-50" />
                              </div>
                              <div className="flex-1 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 min-h-[42px]">
                                <div className="text-[10px] text-muted-foreground mb-1.5 opacity-70">После исправления</div>
                                <div className="flex items-center gap-1.5 text-destructive text-sm">
                                  <Trash2 size={14} /> Очистить
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      // Editable compound field
                      return (
                        <div key={idx}>
                          <div className="text-[13px] font-medium text-foreground mb-2">{fixFieldName}</div>
                          <div className="flex items-stretch gap-2">
                            {/* Current value */}
                            <div className="flex-1 rounded-md border border-border bg-background p-2.5 min-h-[42px]">
                              <div className="text-[10px] text-muted-foreground mb-1.5 opacity-70">Текущее значение</div>
                              <div className="flex flex-wrap gap-1.5">
                                {(() => {
                                  const parts = (currentVal || '').split(/[,;]/).map(v => v.trim()).filter(Boolean);
                                  if (parts.length === 0) return <span className="text-[13px] text-muted-foreground">—</span>;
                                  return parts.map((val, i) => <ValueChip key={i} value={val} />);
                                })()}
                              </div>
                            </div>
                            <div className="flex items-center justify-center px-1">
                              <ArrowRight size={18} className="text-muted-foreground opacity-50" />
                            </div>
                            {/* Proposed value */}
                            <div
                              ref={(el) => { compoundDropdownRefs.current[idx] = el; }}
                              onClick={() => {
                                if (!fieldState.showCustom) {
                                  updateFieldState(s => ({ ...s, showCustom: true }));
                                }
                              }}
                              className={`flex-1 rounded-md border p-2.5 min-h-[42px] cursor-pointer relative transition-colors ${
                                fieldState.showCustom ? 'border-primary bg-primary/5' : 'border-border bg-background'
                              }`}
                            >
                              <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1.5 opacity-70">
                                <span>Предлагаемое исправление</span>
                                {fixMaxCount !== null && (
                                  <span className={fixIsAtLimit ? 'text-destructive font-semibold' : ''}>
                                    {fieldState.selectedValues.length}/{fixMaxCount}
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-1.5 items-center">
                                {fieldState.selectedValues.map((val, vidx) => (
                                  <ValueChip key={vidx} value={val} onRemove={() => updateFieldState(s => ({ ...s, selectedValues: s.selectedValues.filter((_, i) => i !== vidx) }))} />
                                ))}
                                {fieldState.showCustom && (
                                  <input
                                    type="text"
                                    autoFocus
                                    value={fieldState.customSearch}
                                    onChange={(e) => updateFieldState(s => ({ ...s, customSearch: e.target.value }))}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') updateFieldState(s => ({ ...s, showCustom: false }));
                                      if (e.key === 'Enter' && fieldState.customSearch.trim() && !fixIsAtLimit) {
                                        updateFieldState(s => ({ ...s, selectedValues: [...s.selectedValues, s.customSearch.trim()], customSearch: '' }));
                                      }
                                      if (e.key === 'Backspace' && !fieldState.customSearch && fieldState.selectedValues.length > 0) {
                                        updateFieldState(s => ({ ...s, selectedValues: s.selectedValues.slice(0, -1) }));
                                      }
                                    }}
                                    placeholder={fieldState.selectedValues.length === 0 ? 'выберите или введите...' : ''}
                                    className="flex-1 min-w-[80px] border-none outline-none bg-transparent text-xs text-foreground p-0"
                                  />
                                )}
                                {!fieldState.showCustom && fieldState.selectedValues.length === 0 && (
                                  <span className="text-xs text-muted-foreground">нажмите для выбора...</span>
                                )}
                              </div>

                              {/* Dropdown */}
                              {fieldState.showCustom && (
                                <div className="absolute top-full left-0 right-0 mt-1 border border-border rounded-lg bg-card shadow-lg z-50 flex flex-col">
                                  <DropdownDoneButton count={fieldState.selectedValues.length} onDone={() => updateFieldState(s => ({ ...s, showCustom: false, customSearch: '' }))} />
                                  <div className="max-h-[200px] overflow-y-auto">
                                    {fixAlternatives.length > 0 && (
                                      <div className="border-b border-border">
                                        <div className="px-3 pt-2 pb-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Рекомендации</div>
                                        {fixAlternatives.map((alt, aidx) => (
                                          <DropdownItem
                                            key={aidx}
                                            label={alt}
                                            isSelected={fieldState.selectedValues.includes(alt)}
                                            isPrimary={aidx === 0}
                                            isAI={aidx === 0}
                                            onClick={() => {
                                              const isSelected = fieldState.selectedValues.includes(alt);
                                              if (isSelected) updateFieldState(s => ({ ...s, selectedValues: s.selectedValues.filter(v => v !== alt) }));
                                              else if (!fixIsAtLimit) updateFieldState(s => ({ ...s, selectedValues: [...s.selectedValues, alt], customSearch: '' }));
                                            }}
                                          />
                                        ))}
                                      </div>
                                    )}
                                    {fix.allowed_values && fix.allowed_values.length > 0 && (() => {
                                      const searchTerm = fieldState.customSearch || '';
                                      const filtered = searchTerm.trim()
                                        ? fix.allowed_values!.filter(v => String(v).toLowerCase().includes(searchTerm.trim().toLowerCase()))
                                        : fix.allowed_values!;
                                      return (
                                        <>
                                          <div className="px-3 pt-2 pb-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                                            Допустимые значения {searchTerm.trim() && `(${filtered.length}/${fix.allowed_values!.length})`}
                                          </div>
                                          {filtered.length === 0 ? (
                                            <div className="px-3 py-2 text-[13px] text-muted-foreground">Ничего не найдено</div>
                                          ) : filtered.slice(0, 50).map((v, i) => {
                                            const val = String(v);
                                            return (
                                              <DropdownItem
                                                key={i}
                                                label={val}
                                                isSelected={fieldState.selectedValues.includes(val)}
                                                onClick={() => {
                                                  const isSelected = fieldState.selectedValues.includes(val);
                                                  if (isSelected) updateFieldState(s => ({ ...s, selectedValues: s.selectedValues.filter(sv => sv !== val) }));
                                                  else if (!fixIsAtLimit) updateFieldState(s => ({ ...s, selectedValues: [...s.selectedValues, val], customSearch: '' }));
                                                }}
                                              />
                                            );
                                          })}
                                          {filtered.length > 50 && (
                                            <div className="px-3 py-1.5 text-[11px] text-muted-foreground">+{filtered.length - 50} ещё — уточните запрос</div>
                                          )}
                                        </>
                                      );
                                    })()}
                                  </div>
                                </div>
                              )}
                              {!fieldState.showCustom && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); updateFieldState(s => ({ ...s, showCustom: true })); }}
                                  className="text-[11px] text-muted-foreground opacity-70 mt-1 inline-flex items-center gap-1 hover:opacity-100"
                                >
                                  <Pencil size={10} /> ввести своё значение
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              }

              // ── SWAP ──
              if (swap.isSwap) {
                return (
                  <div className="space-y-3">
                    {/* Clear wrong field */}
                    <div>
                      <Badge variant="destructive" className="mb-2 text-[11px]">
                        <Trash2 size={12} className="mr-1" /> Очистить
                      </Badge>
                      <div className="flex items-stretch gap-2">
                        <div className="flex-1 rounded-md border border-border bg-background p-2.5">
                          <div className="text-[10px] text-muted-foreground mb-1 opacity-70">{fieldName}</div>
                          <div className="text-sm text-foreground">{issue.current_value || '—'}</div>
                        </div>
                        <div className="flex items-center px-1"><ArrowRight size={18} className="text-muted-foreground opacity-50" /></div>
                        <div className="flex-1 rounded-md border border-destructive/40 bg-destructive/5 p-2.5">
                          <div className="text-[10px] text-muted-foreground mb-1 opacity-70">После исправления</div>
                          <div className="flex items-center gap-1.5 text-destructive text-sm">
                            <Trash2 size={14} /> Очистить (не применимо к товару)
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* Fill correct field */}
                    {swap.swapToName && (
                      <div>
                        <Badge className="mb-2 text-[11px] bg-zone-green text-white">
                          <Plus size={12} className="mr-1" /> Заполнить
                        </Badge>
                        <div className="flex items-stretch gap-2">
                          <div className="flex-1 rounded-md border border-border bg-background p-2.5">
                            <div className="text-[10px] text-muted-foreground mb-1 opacity-70">{swap.swapToName}</div>
                            <div className="text-sm text-muted-foreground">Не заполнено</div>
                          </div>
                          <div className="flex items-center px-1"><ArrowRight size={18} className="text-muted-foreground opacity-50" /></div>
                          <div className="flex-1 rounded-md border border-zone-green/40 bg-zone-green/5 p-2.5">
                            <div className="text-[10px] text-muted-foreground mb-1 opacity-70">{swap.swapToName}</div>
                            <div className="text-sm font-medium text-foreground">{swap.swapToValue || 'введите значение ниже'}</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              }

              // ── TITLE / DESCRIPTION ──
              if (isTextIssue(currentIssue)) {
                const textField = getTextIssueField(currentIssue);
                const fieldLabel = textField === 'title' ? 'Название' : 'Описание';
                const currentText = issue.current_value || '';
                const suggestedText = issue.ai_suggested_value || issue.suggested_value || '';
                const maxChars = textField === 'title' ? 120 : 2000;
                return (
                  <div className="space-y-3">
                    <div className="text-[13px] font-medium text-foreground">{fieldLabel}</div>
                    {/* Current value */}
                    <div className="rounded-md border border-border bg-background p-3">
                      <div className="text-[10px] text-muted-foreground mb-1.5 opacity-70">Текущее значение</div>
                      <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{currentText || '—'}</p>
                      <div className="text-[11px] text-muted-foreground mt-1.5">{currentText.length} / {maxChars} символов</div>
                    </div>
                    {/* New value */}
                    <div className={`rounded-md border p-3 ${textEditorValue && textEditorValue !== currentText ? 'border-primary/40 bg-primary/5' : 'border-border bg-background'}`}>
                      <div className="text-[10px] text-muted-foreground mb-1.5 opacity-70">Новое значение</div>
                      {textEditorValue && textEditorValue !== currentText ? (
                        <>
                          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{textEditorValue}</p>
                          <div className="text-[11px] text-muted-foreground mt-1.5">{textEditorValue.length} / {maxChars} символов</div>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">Нажмите «Предложить новое» для редактирования</p>
                      )}
                    </div>
                    {/* Open editor button */}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setTextEditorOpen(true)}
                    >
                      <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Предложить новое
                    </Button>
                  </div>
                );
              }

              // ── MEDIA ──
              if (mediaIssue) {
                return (
                  <div>
                    <p className="text-sm text-muted-foreground mb-3">
                      {videoMediaIssue
                        ? 'Для этой проблемы нужно добавить или сгенерировать видео через Photo Studio.'
                        : 'Для этой проблемы нужно добавить медиа в карточку через Photo Studio.'}
                    </p>
                    <Button size="sm" onClick={openPhotoStudioForIssue}>
                      Открыть Photo Studio
                    </Button>
                  </div>
                );
              }

              // ── DEFAULT REPLACE ──
              const maxCount = issue.max_count
                || (issue.error_details || []).reduce((acc: number | null, d: any) => d?.max_count ?? acc, null)
                || (issue.allowed_values && issue.allowed_values.length > 0 ? issue.allowed_values.length : null);
              const isAtLimit = maxCount !== null && selectedValues.length >= maxCount;

              return (
                <div>
                  {fieldName && <div className="text-[13px] font-medium text-foreground mb-2">{fieldName}</div>}
                  <div className="flex items-stretch gap-2">
                    {/* Current value */}
                    <div className="flex-1 rounded-md border border-border bg-background p-2.5 min-h-[42px]">
                      <div className="text-[10px] text-muted-foreground mb-1.5 opacity-70">Текущее значение</div>
                      <div className="flex flex-wrap gap-1.5">
                        {(() => {
                          const parts = (issue.current_value || '').split(/[,;]/).map(v => v.trim()).filter(Boolean);
                          if (parts.length === 0) return <span className="text-[13px] text-muted-foreground">—</span>;
                          return parts.map((val, i) => <ValueChip key={i} value={val} />);
                        })()}
                      </div>
                    </div>

                    <div className="flex items-center justify-center px-1">
                      <ArrowRight size={18} className="text-muted-foreground opacity-50" />
                    </div>

                    {/* Proposed value */}
                    <div
                      ref={dropdownRef}
                      onClick={() => { if (!showCustom) setShowCustom(true); }}
                      className={`flex-1 rounded-md border p-2.5 min-h-[42px] cursor-pointer relative transition-colors ${
                        showCustom ? 'border-primary bg-primary/5' : 'border-border bg-background'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1.5 opacity-70">
                        <span>Предлагаемое исправление</span>
                        {maxCount !== null && (
                          <span className={isAtLimit ? 'text-destructive font-semibold' : ''}>
                            {selectedValues.length}/{maxCount}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {selectedValues.map((val, idx) => (
                          <ValueChip key={idx} value={val} onRemove={() => setSelectedValues(prev => prev.filter((_, i) => i !== idx))} />
                        ))}

                        {customValue && (
                          <ValueChip value={customValue} onRemove={() => setCustomValue('')} />
                        )}

                        {showCustom && (
                          <input
                            type="text"
                            autoFocus
                            value={customSearch}
                            onChange={(e) => setCustomSearch(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setShowCustom(false);
                              if (e.key === 'Enter' && customSearch.trim() && !isAtLimit) {
                                setSelectedValues(prev => [...prev, customSearch.trim()]);
                                setCustomSearch('');
                              }
                              if (e.key === 'Backspace' && !customSearch && selectedValues.length > 0) {
                                setSelectedValues(prev => prev.slice(0, -1));
                              }
                            }}
                            placeholder={selectedValues.length === 0 && !customValue ? 'выберите или введите...' : ''}
                            className="flex-1 min-w-[80px] border-none outline-none bg-transparent text-xs text-foreground p-0"
                          />
                        )}

                        {!showCustom && selectedValues.length === 0 && !customValue && (
                          <span className="text-xs text-muted-foreground">нажмите для выбора...</span>
                        )}
                      </div>

                      {/* Dropdown */}
                      {showCustom && (
                        <div className="absolute top-full left-0 right-0 mt-1 border border-border rounded-lg bg-card shadow-lg z-50 flex flex-col">
                          <DropdownDoneButton count={selectedValues.length} onDone={() => { setShowCustom(false); setCustomSearch(''); }} />
                          <div className="max-h-[200px] overflow-y-auto">
                            {alternatives.length > 0 && (
                              <div className="border-b border-border">
                                <div className="px-3 pt-2 pb-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Рекомендации</div>
                                {alternatives.map((alt, idx) => (
                                  <DropdownItem
                                    key={idx}
                                    label={alt}
                                    isSelected={selectedValues.includes(alt)}
                                    isPrimary={idx === 0}
                                    isAI={idx === 0}
                                    onClick={() => {
                                      if (selectedValues.includes(alt)) setSelectedValues(prev => prev.filter(v => v !== alt));
                                      else if (!isAtLimit) { setSelectedValues(prev => [...prev, alt]); setCustomSearch(''); }
                                    }}
                                  />
                                ))}
                              </div>
                            )}
                            {issue.allowed_values && issue.allowed_values.length > 0 && (() => {
                              const searchTerm = customSearch || '';
                              const filtered = searchTerm.trim()
                                ? issue.allowed_values.filter(v => String(v).toLowerCase().includes(searchTerm.trim().toLowerCase()))
                                : issue.allowed_values;
                              return (
                                <>
                                  <div className="px-3 pt-2 pb-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                                    Допустимые значения {searchTerm.trim() && `(${filtered.length}/${issue.allowed_values.length})`}
                                  </div>
                                  {filtered.length === 0 ? (
                                    <div className="px-3 py-2 text-[13px] text-muted-foreground">Ничего не найдено</div>
                                  ) : filtered.slice(0, 50).map((v, i) => {
                                    const val = String(v);
                                    return (
                                      <DropdownItem
                                        key={i}
                                        label={val}
                                        isSelected={selectedValues.includes(val)}
                                        onClick={() => {
                                          if (selectedValues.includes(val)) setSelectedValues(prev => prev.filter(sv => sv !== val));
                                          else if (!isAtLimit) { setSelectedValues(prev => [...prev, val]); setCustomSearch(''); }
                                        }}
                                      />
                                    );
                                  })}
                                  {filtered.length > 50 && (
                                    <div className="px-3 py-1.5 text-[11px] text-muted-foreground">+{filtered.length - 50} ещё — уточните запрос</div>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      )}
                      {!showCustom && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowCustom(true); }}
                          className="text-[11px] text-muted-foreground opacity-70 mt-1 inline-flex items-center gap-1 hover:opacity-100"
                        >
                          <Pencil size={10} /> ввести своё значение
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Source indicator */}
            {issue.ai_reason && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Bot size={13} className="opacity-50" />
                <span>Источник: {issue.source === 'fixed_file' ? 'эталонный файл' : 'анализ фото'}</span>
              </div>
            )}
          </div>

          {/* ── Actions ── */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/30">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={handleSkip}
                disabled={actionLoading}
                title="Пропустить эту ошибку — вернётся в очередь позже"
              >
                <Clock className="h-3.5 w-3.5 mr-1" /> Пропустить
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={handleSkip}
                disabled={actionLoading}
                title="Оставить текущее значение на Wildberries без изменений"
              >
                <BadgeCheck className="h-3.5 w-3.5 mr-1" /> Оставить текущее
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={openDelegateDialog}
                disabled={actionLoading}
                title="Передать задачу другому сотруднику — будет создан тикет во входящих"
              >
                <Users className="h-3.5 w-3.5 mr-1" /> Передать
              </Button>
            </div>
            {(() => {
              const textIssue = currentIssue && isTextIssue(currentIssue);
              const isDisabled = actionLoading || (!mediaIssue && !textIssue && selectedValues.length === 0 && !customValue.trim() && !getSwapInfo(currentIssue).isSwap && !getSwapInfo(currentIssue).isClear)
                || (textIssue && !textEditorValue.trim());
              return (
                <Button
                  size="sm"
                  onClick={mediaIssue ? openPhotoStudioForIssue : handleFix}
                  disabled={isDisabled}
                >
                  {actionLoading ? (
                    <><div className="h-3.5 w-3.5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mr-1.5" /> Применяется...</>
                  ) : mediaIssue ? 'Открыть Photo Studio' : (
                    <><Sparkles className="h-3.5 w-3.5 mr-1" /> Применить исправление</>
                  )}
                </Button>
              );
            })()}
          </div>
        </div>
      </div>

      {/* ==================== DELEGATE DIALOG ==================== */}
      {showDelegateDialog && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/55"
            onClick={() => { setShowDelegateDialog(false); setSelectedDelegateIds(new Set()); }}
          />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] bg-card border border-border rounded-2xl p-5 min-w-[300px] max-w-[360px] shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[15px] font-semibold text-foreground">Передать задачу</h3>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => { setShowDelegateDialog(false); setSelectedDelegateIds(new Set()); }}>
                <X size={16} />
              </Button>
            </div>
            {teamLoading ? (
              <div className="text-center py-5 text-muted-foreground text-sm">Загрузка...</div>
            ) : teamMembers.length === 0 ? (
              <div className="text-center py-5 text-muted-foreground text-sm">Нет доступных сотрудников</div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-2">Выберите сотрудников:</p>
                <div className="flex flex-col gap-1 max-h-[260px] overflow-y-auto">
                  {teamMembers.map(member => {
                    const isSelected = selectedDelegateIds.has(member.id);
                    return (
                      <button
                        key={member.id}
                        onClick={() => {
                          setSelectedDelegateIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(member.id)) next.delete(member.id);
                            else next.add(member.id);
                            return next;
                          });
                        }}
                        disabled={actionLoading}
                        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-colors text-left w-full ${
                          isSelected ? 'border-primary/25 bg-primary/5' : 'border-transparent hover:border-border hover:bg-accent'
                        }`}
                      >
                        <Checkbox checked={isSelected} className="pointer-events-none" />
                        <div
                          className="w-8 h-8 rounded-full text-white flex items-center justify-center flex-shrink-0 text-xs font-semibold shadow-sm"
                          style={{ background: `linear-gradient(135deg, hsl(${200 + (member.id % 40)} 70% 58%), hsl(${220 + (member.id % 30)} 65% 52%))` }}
                        >
                          {member.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                        </div>
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="text-[13px] font-medium text-foreground truncate">
                            {member.name}
                            {member.isCurrent ? ' (Вы)' : ''}
                          </span>
                          <span className="text-[11px] text-muted-foreground">{member.role}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {selectedDelegateIds.size > 0 && (
                  <Button
                    size="sm"
                    className="w-full mt-3 gap-1.5"
                    onClick={() => void handleDelegate()}
                    disabled={actionLoading}
                  >
                    <Users size={14} /> Передать ({selectedDelegateIds.size})
                  </Button>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ==================== SIDEBAR ==================== */}
      {showSidebar && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setShowSidebar(false)} />
          <div className="fixed top-0 right-0 bottom-0 w-[380px] z-50 bg-card border-l border-border shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Все проблемы ({allSidebarIssues.length})</h3>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setShowSidebar(false)}>
                <X size={16} />
              </Button>
            </div>
            {skippedIssues.length > 0 && (
              <div className="flex items-center gap-1.5 px-4 py-2 bg-zone-yellow/10 border-b border-zone-yellow/30 text-xs text-zone-yellow">
                <AlertTriangle size={13} />
                Пропущено: {skippedIssues.length} · нажмите чтобы вернуть в работу
              </div>
            )}
            <div className="flex-1 overflow-y-auto">
              {sidebarLoading ? (
                <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                  <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm">Загрузка...</span>
                </div>
              ) : allSidebarIssues.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">Нет проблем в этой категории</div>
              ) : (
                <div className="p-2 space-y-1">
                  {allSidebarIssues.map((si) => (
                    <div
                      key={si.id}
                      onClick={() => handleSidebarIssueClick(si)}
                      className={`rounded-lg border p-3 cursor-pointer transition-colors ${
                        currentIssue && si.id === currentIssue.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50 hover:bg-muted/50'
                      } ${si.status === 'skipped' ? 'opacity-75 border-l-[3px] border-l-zone-yellow' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="text-sm font-semibold text-foreground line-clamp-1">{si.title}</span>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {si.status === 'skipped' && (
                            <Badge variant="secondary" className="text-[10px] h-4 bg-zone-yellow/20 text-zone-yellow">пропущено</Badge>
                          )}
                          <Badge
                            variant={si.severity === 'critical' ? 'destructive' : 'secondary'}
                            className="text-[10px] h-4"
                          >
                            {si.severity === 'critical' ? 'Критичные' : si.severity === 'warning' ? 'Предупреждения' : 'Улучшения'}
                          </Badge>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground mb-0.5 line-clamp-1">
                        {si.card_title || `Карточка ${si.card_nm_id}`}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-0.5"><Package size={11} /> {si.card_nm_id}</span>
                        {si.card_vendor_code && <span className="inline-flex items-center gap-0.5"><Tag size={11} /> {si.card_vendor_code}</span>}
                      </div>
                      {si.status === 'skipped' && (
                        <div className="text-[11px] text-zone-yellow font-medium mt-1">
                          Нажмите чтобы вернуть в работу →
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
      {/* ==================== TEXT EDITOR DIALOG ==================== */}
      {currentIssue && isTextIssue(currentIssue) && (
        <TextEditorDialog
          open={textEditorOpen}
          onOpenChange={setTextEditorOpen}
          fieldLabel={getTextIssueField(currentIssue) === 'title' ? 'Название' : 'Описание'}
          currentValue={currentIssue.current_value || ''}
          suggestedValue={currentIssue.ai_suggested_value || currentIssue.suggested_value || ''}
          keywords={(() => {
            if (getTextIssueField(currentIssue) === 'title') return [];
            // Collect keywords from current issue + all description issues for same card
            const kws = new Set<string>();
            const cardId = currentIssue.card_id;
            const allIssues = allSidebarIssues || [];
            const descIssues = allIssues.filter(i => i.card_id === cardId && isTextIssue(i) && getTextIssueField(i) === 'description');
            descIssues.forEach(issue => {
              (issue.alternatives || []).forEach((a: string) => { if (a?.trim()) kws.add(a.trim()); });
              (issue.ai_alternatives || []).forEach((a: string) => { if (a?.trim()) kws.add(a.trim()); });
            });
            return Array.from(kws);
          })()}
          forceRichLayout={getTextIssueField(currentIssue) === 'description'}
          suggestionActionLabel={getTextIssueField(currentIssue) === 'description' ? 'Сделать новое' : 'Вставить рекомендацию'}
          onApply={(newValue) => {
            setTextEditorValue(newValue);
          }}
        />
      )}
    </div>
  );
}
