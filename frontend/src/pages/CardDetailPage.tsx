import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import { logAction } from '../hooks/useWorkTracker';
import DraftBanner from '../components/DraftBanner';
import type { CardDraft, CardDraftPayload } from '../types';
import TextEditorDialog from '../components/TextEditorDialog';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  BadgeCheck,
  Bot,
  Box,
  Camera,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  ClipboardList,
  Clock,
  FileCheck2,
  FileCheck,
  FileText,
  FolderOpen,
  Globe,
  Image,
  Layers,
  PenLine,
  Pencil,
  Plus,
  RefreshCw,
  Ruler,
  Search as SearchIcon,
  Send,
  ShoppingBag,
  Shield,
  Sparkles,
  Tag,
  Upload,
  Trash2,
  TriangleAlert,
  Users,
  Video,
  X,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CardDetail, DescriptionEditorDraftPayload, Issue } from '../types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// ─── Types ───────────────────────────────────────────────────────────────────

type TabKey = 'basic' | 'description' | 'characteristics' | 'sizes' | 'media' | 'package' | 'docs';
type ResolveState = 'resolved' | 'postponed';

interface SizeVariant {
  techSize: string;
  wbSize: string;
  skus: string[];
}

interface SectionItem {
  key: string;
  value: string;
}

interface CardFieldSection {
  name: string;
  items: SectionItem[];
  issues: Issue[];
}

interface DimensionsDraft {
  length: string;
  width: string;
  height: string;
  weight: string;
}
interface PackageDraft {
  type: string;
  contents: string;
}

interface CharChipState {
  selectedValues: string[];
  showDropdown: boolean;
  searchTerm: string;
}

const TAB_ORDER: Array<{ key: TabKey; label: string; icon: LucideIcon }> = [
  { key: 'basic', label: 'Основное', icon: Tag },
  { key: 'description', label: 'Описание', icon: FileText },
  { key: 'characteristics', label: 'Характеристики', icon: ClipboardList },
  { key: 'sizes', label: 'Размеры', icon: Ruler },
  { key: 'media', label: 'Медиа', icon: Image },
  { key: 'package', label: 'Упаковка', icon: Globe },
  { key: 'docs', label: 'Документы', icon: Box },
];

const DOCUMENT_CHARACTERISTIC_KEYWORDS = [
  'сертифик',
  'декларац',
  'регистрац',
  'тнвэд',
  'тн вэд',
  'ндс',
  'маркиров',
  'честный знак',
  'документ',
  'код товара',
  'код тнвэд',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function isDocumentCharacteristicKey(key: string): boolean {
  const lowerKey = String(key || '').toLowerCase();
  return DOCUMENT_CHARACTERISTIC_KEYWORDS.some((keyword) => lowerKey.includes(keyword));
}

function isDocumentIssue(issue: Issue): boolean {
  const category = (issue.category || '').toLowerCase();
  const path = (issue.field_path || '').toLowerCase();
  const title = (issue.title || '').toLowerCase();

  if (path.startsWith('documents') || category === 'documents' || category === 'certificates') return true;
  if (path.startsWith('characteristics.')) {
    return isDocumentCharacteristicKey(path.replace('characteristics.', ''));
  }
  return DOCUMENT_CHARACTERISTIC_KEYWORDS.some((keyword) => title.includes(keyword));
}

function mapIssueToTab(issue: Issue): TabKey {
  const category = (issue.category || '').toLowerCase();
  const path = (issue.field_path || '').toLowerCase();
  if (path.startsWith('characteristics.') || path === 'characteristics') {
    return isDocumentIssue(issue) ? 'docs' : 'characteristics';
  }
  if (path.startsWith('dimensions') || category === 'size' || category === 'sizes') return 'sizes';
  if (isDocumentIssue(issue)) return 'docs';
  if (path.startsWith('package') || category === 'packaging') return 'package';
  if (path === 'title' || path === 'description' || category === 'title' || category === 'description' || category === 'seo') return 'description';
  if (category === 'photos' || category === 'video' || path.startsWith('photos') || path.startsWith('videos')) return 'media';
  return 'basic';
}

function issueSeverityRank(severity: string): number {
  if (severity === 'critical') return 0;
  if (severity === 'warning') return 1;
  if (severity === 'improvement') return 2;
  return 3;
}

function issueCategoryLabel(issue: Issue): string {
  const cat = (issue.category || '').toLowerCase();
  const path = (issue.field_path || '').toLowerCase();
  if (path.startsWith('characteristics.') || cat === 'characteristics' || cat === 'photo_mismatch') return 'Ошибка характеристики';
  if (cat === 'description') return 'Ошибка описания';
  if (cat === 'title') return 'Ошибка названия';
  if (cat === 'media' || cat === 'photos' || cat === 'video') return 'Проблема с медиа';
  if (cat === 'seo') return 'Ошибка SEO';
  return 'Ошибка характеристики';
}

function issueSourceLabel(issue: Issue): string | null {
  if (issue.source === 'fixed_file') return 'эталонный файл';
  if (issue.source === 'photo_analysis' || issue.code?.startsWith('vision_')) return 'анализ фото';
  if (issue.ai_reason) return 'AI-анализ';
  return null;
}

function splitChipValues(value: string | null | undefined): string[] {
  return String(value || '')
    .split(/[;,]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function issueSuggestedValue(issue: Issue): string | null {
  const direct = (issue.ai_suggested_value || issue.suggested_value || '').trim();
  if (direct) return direct;

  for (const detail of issue.error_details || []) {
    if (!detail || typeof detail !== 'object') continue;
    const marker = String((detail as any).fix_action || (detail as any).type || '').trim().toLowerCase();
    const swapValue = String((detail as any).swap_to_value || '').trim();
    if (marker === 'swap' && swapValue) return swapValue;
  }

  return null;
}

function issueSuggestedChipValues(issue: Issue, fallbackValue: string): string[] {
  const suggested = issueSuggestedValue(issue);
  if (suggested) return splitChipValues(suggested);
  return splitChipValues(fallbackValue);
}

function issueRecommendation(issue: Issue): string | null {
  return issueSuggestedValue(issue);
}

function pluralErrorsLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} ошибка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${count} ошибки`;
  return `${count} ошибок`;
}

function pluralSectionsLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} раздел`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${count} раздела`;
  return `${count} разделов`;
}

// ─── Copyable ID helper ──────────────────────────────────────────────────────

function CopyableId({ value, label, icon }: { value: string; label: string; icon: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    toast.success(label);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <span className="copyable-meta" title="Копировать" onClick={handleCopy}>
      {icon} <span className="font-mono">{value}</span>{' '}
      {copied
        ? <Check size={11} className="inline align-middle text-zone-green" />
        : <Copy size={11} className="inline align-middle opacity-65" />}
    </span>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function CardDetailPage() {
  const { cardId } = useParams<{ cardId: string }>();
  const navigate = useNavigate();
  const { activeStore } = useStore();
  const { hasPermission, user } = useAuth();
  const canSync = hasPermission('cards.sync');

  const [card, setCard] = useState<CardDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') as TabKey | null;
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab && ['basic', 'description', 'characteristics', 'media', 'seo'].includes(initialTab) ? initialTab : 'basic');
  const [resolvedIssues, setResolvedIssues] = useState<Record<number, ResolveState>>({});
  const [confirmedSections, setConfirmedSections] = useState<Record<TabKey, boolean>>({} as Record<TabKey, boolean>);
  const [confirmDialogTab, setConfirmDialogTab] = useState<TabKey | null>(null);
  
  const [expandedIssues, setExpandedIssues] = useState<Record<number, boolean>>({});
  const [autoFocusCharKey, setAutoFocusCharKey] = useState<string | null>(null);

  const [titleValue, setTitleValue] = useState('');
  const [descriptionValue, setDescriptionValue] = useState('');
  const [brandValue, setBrandValue] = useState('');
  const [categoryValue, setCategoryValue] = useState('');
  const [characteristicsDraft, setCharacteristicsDraft] = useState<Record<string, string>>({});
  const [dimensionsDraft, setDimensionsDraft] = useState<DimensionsDraft>({ length: '', width: '', height: '', weight: '' });
  const [packageDraft, setPackageDraft] = useState<PackageDraft>({ type: '', contents: '' });
  const [sizeVariants, setSizeVariants] = useState<SizeVariant[]>([]);
  const [expandedSizeIndex, setExpandedSizeIndex] = useState<number | null>(null);

  const [coverIndex, setCoverIndex] = useState(0);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [deletePhotoTarget, setDeletePhotoTarget] = useState<number | null>(null);
  const [fileDragOver, setFileDragOver] = useState(false);
  const [mediaSyncing, setMediaSyncing] = useState(false);
  const [videoPlayerSrc, setVideoPlayerSrc] = useState<string | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [hasDraftChanges, setHasDraftChanges] = useState(false);
  
  // Draft state
  const [otherDraft, setOtherDraft] = useState<CardDraft | null>(null);
  const [draftDismissed, setDraftDismissed] = useState(false);

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialHydration = useRef(true);

  // Characteristics filters
  const [charSearch, setCharSearch] = useState('');
  const [charFilter, setCharFilter] = useState<'all' | 'issues' | 'empty'>('all');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  // Chip-based editor state per characteristic key
  const [charChipStates, setCharChipStates] = useState<Record<string, CharChipState>>({});
  const charDropdownRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const expandedCardRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const topbarRef = useRef<HTMLDivElement>(null);
  const [expandedNormalChars, setExpandedNormalChars] = useState<Record<string, boolean>>({});
  const normalCharRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Pending collapse confirmation
  const [pendingCollapse, setPendingCollapse] = useState<{ type: 'issue'; id: number; charKey: string } | { type: 'normal'; charKey: string } | null>(null);

  // Fixed file status
  const [hasFixedFile, setHasFixedFile] = useState<boolean | null>(null);

  // Delegation dialog
  const [showDelegateDialog, setShowDelegateDialog] = useState(false);
  const [photoLightbox, setPhotoLightbox] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const [lightboxPan, setLightboxPan] = useState({ x: 0, y: 0 });
  const lightboxDragging = useRef(false);
  const lightboxLastPos = useRef({ x: 0, y: 0 });
  const [delegateIssue, setDelegateIssue] = useState<Issue | null>(null);
  const [teamMembers, setTeamMembers] = useState<{ id: number; name: string; role: string; isCurrent?: boolean }[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [selectedDelegateIds, setSelectedDelegateIds] = useState<Set<number>>(new Set());

  // Review (На согласование) dialog
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [selectedReviewerIds, setSelectedReviewerIds] = useState<Set<number>>(new Set());
  const [reviewTeamMembers, setReviewTeamMembers] = useState<{ id: number; name: string; role: string }[]>([]);
  const [reviewTeamLoading, setReviewTeamLoading] = useState(false);

  // Text editor dialog state
  const [textEditorOpen, setTextEditorOpen] = useState(false);
  const [textEditorField, setTextEditorField] = useState<'title' | 'description'>('title');
  const [textEditorIssue, setTextEditorIssue] = useState<Issue | null>(null);
  const [textEditorKeywords, setTextEditorKeywords] = useState<string[]>([]);
  const [textEditorKeywordsLoading, setTextEditorKeywordsLoading] = useState(false);

  // Refs for click-outside access
  const charChipStatesRef = useRef(charChipStates);
  charChipStatesRef.current = charChipStates;
  const characteristicsDraftRef = useRef(characteristicsDraft);
  characteristicsDraftRef.current = characteristicsDraft;

  /** Check if a characteristic draft value differs from the original card data */
  const isCharDirty = useCallback((charKey: string): boolean => {
    if (!card) return false;
    const original = toText((card.characteristics || {})[charKey]);
    const draft = characteristicsDraft[charKey] ?? '';
    return original !== draft;
  }, [card, characteristicsDraft]);

  const getCharKeyForIssueId = useCallback((issueId: number): string | undefined => {
    const issue = (card?.issues || []).find(i => i.id === issueId);
    return issue ? (issue.field_path || '').replace('characteristics.', '') : undefined;
  }, [card]);

  const getCommittedChipValues = useCallback((chipState: CharChipState): string[] => {
    const pending = chipState.searchTerm.trim();
    if (!pending || chipState.selectedValues.includes(pending)) return chipState.selectedValues;
    return [...chipState.selectedValues, pending];
  }, []);

  const hasChipChangesRef = useCallback((charKey: string): boolean => {
    const chipState = charChipStatesRef.current[charKey];
    if (!chipState) return false;
    const draftValue = characteristicsDraftRef.current[charKey] ?? '';
    const originalVals = draftValue.split(/[;,]\s*/).map(s => s.trim()).filter(Boolean).sort();
    const committedVals = getCommittedChipValues(chipState).map(s => s.trim()).filter(Boolean).sort();
    if (originalVals.length !== committedVals.length) return true;
    return originalVals.some((v, i) => v !== committedVals[i]);
  }, [getCommittedChipValues]);

  /** Clear chip state for a key (used on cancel/collapse without saving) */
  const clearChipState = useCallback((key: string) => {
    setCharChipStates(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // ── Unified click-outside handler (capture phase) ──
  useEffect(() => {
    const anyDropdownOpen = Object.values(charChipStates).some(s => s.showDropdown);
    const anyExpanded = Object.values(expandedIssues).some(Boolean);
    const anyNormalExpanded = Object.values(expandedNormalChars).some(Boolean);
    if (!anyDropdownOpen && !anyExpanded && !anyNormalExpanded) return;

    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const el = e.target as HTMLElement;

      // Skip if click is on navigation, topbar, sidebar, or dialog elements
      if (el.closest?.('nav, [role="dialog"], [role="alertdialog"], .sticky, aside, [data-radix-popper-content-wrapper]')) return;

      // 1. Close chip dropdowns if click is outside their container
      setCharChipStates(prev => {
        const next = { ...prev };
        let changed = false;
        for (const key of Object.keys(next)) {
          if (next[key].showDropdown) {
            const ref = charDropdownRefs.current[key];
            if (ref && !ref.contains(target)) {
              next[key] = { ...next[key], showDropdown: false };
              changed = true;
            }
          }
        }
        return changed ? next : prev;
      });

      // 2. Collapse expanded issue cards
      for (const idStr of Object.keys(expandedIssues)) {
        const id = Number(idStr);
        if (!expandedIssues[id]) continue;
        const ref = expandedCardRefs.current[id];
        if (ref && !ref.contains(target)) {
          const charKey = getCharKeyForIssueId(id);
          if (charKey && hasChipChangesRef(charKey)) {
            e.preventDefault();
            e.stopPropagation();
            setPendingCollapse({ type: 'issue', id, charKey });
            return;
          }
          if (charKey) clearChipState(charKey);
          setExpandedIssues(prev => ({ ...prev, [id]: false }));
          setTimeout(() => {
            expandedCardRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 50);
        }
      }

      // 3. Collapse expanded normal char cards
      for (const key of Object.keys(expandedNormalChars)) {
        if (!expandedNormalChars[key]) continue;
        const ref = normalCharRefs.current[key];
        if (ref && !ref.contains(target)) {
          if (hasChipChangesRef(key)) {
            e.preventDefault();
            e.stopPropagation();
            setPendingCollapse({ type: 'normal', charKey: key });
            return;
          }
          clearChipState(key);
          setExpandedNormalChars(prev => ({ ...prev, [key]: false }));
        }
      }
    };

    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [charChipStates, expandedIssues, expandedNormalChars, getCharKeyForIssueId, hasChipChangesRef, clearChipState]);

  // ── AutoFocus: open dropdown when a card is expanded via click ──
  useEffect(() => {
    if (!autoFocusCharKey) return;
    const key = autoFocusCharKey;
    setAutoFocusCharKey(null);
    updateChipState(key, s => ({ ...s, showDropdown: true }));
  }, [autoFocusCharKey]);

  // ── Keyboard shortcuts: Escape to collapse, Ctrl+Enter to save draft ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+Enter / Cmd+Enter → save card draft
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveCardDraft();
        return;
      }

      // Escape → collapse any expanded card (with unsaved changes check)
      if (e.key === 'Escape') {
        // Close any open dropdowns first
        const anyDropdownOpen = Object.entries(charChipStates).find(([, s]) => s.showDropdown);
        if (anyDropdownOpen) {
          const [key] = anyDropdownOpen;
          updateChipState(key, s => ({ ...s, showDropdown: false }));
          return;
        }

        // Collapse expanded issue cards
        for (const idStr of Object.keys(expandedIssues)) {
          const id = Number(idStr);
          if (!expandedIssues[id]) continue;
          const charKey = getCharKeyForIssueId(id);
          if (charKey && hasChipChangesRef(charKey)) {
            setPendingCollapse({ type: 'issue', id, charKey });
            return;
          }
          if (charKey) clearChipState(charKey);
          setExpandedIssues(prev => ({ ...prev, [id]: false }));
          return;
        }

        // Collapse expanded normal char cards
        for (const key of Object.keys(expandedNormalChars)) {
          if (!expandedNormalChars[key]) continue;
          if (hasChipChangesRef(key)) {
            setPendingCollapse({ type: 'normal', charKey: key });
            return;
          }
          clearChipState(key);
          setExpandedNormalChars(prev => ({ ...prev, [key]: false }));
          return;
        }
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [charChipStates, expandedIssues, expandedNormalChars, getCharKeyForIssueId, hasChipChangesRef, clearChipState]);

  // ── Measure topbar height for sticky offset ──
  useEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    const update = () => document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (activeStore && cardId) {
      setConfirmedSections({} as Record<TabKey, boolean>);
      void loadCard();
      // Load confirmed sections from server
      api.getConfirmedSections(activeStore.id, Number(cardId))
        .then(sections => {
          const map: Record<string, boolean> = {};
          sections.forEach(s => { map[s] = true; });
          setConfirmedSections(map as Record<TabKey, boolean>);
        })
        .catch(() => { /* start with empty state on request failure */ });
    }
  }, [activeStore, cardId]);

  useEffect(() => {
    if (activeStore) {
      api.getFixedFileStatus(activeStore.id)
        .then(r => setHasFixedFile(r.has_fixed_file))
        .catch(() => setHasFixedFile(null));
    }
  }, [activeStore]);

  const loadCard = async () => {
    if (!activeStore || !cardId) return;
    setLoading(true);
    setOtherDraft(null);
    setDraftDismissed(false);
    try {
      const [data, draft] = await Promise.all([
        api.getCard(activeStore.id, Number(cardId)),
        api.getCardDraft(activeStore.id, Number(cardId)).catch(() => null),
      ]);
      setCard(data);

      if (draft && user && draft.author_id === user.id) {
        // Current user's draft → hydrate from it
        hydrateDraftsFromDraft(data, draft.data);
        setHasDraftChanges(true);
      } else {
        // No draft or someone else's draft → hydrate from WB
        hydrateDrafts(data);
        if (draft) {
          setOtherDraft(draft);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const hydrateDrafts = (data: CardDetail) => {
    setTitleValue(data.title || '');
    setDescriptionValue(data.description || '');
    setBrandValue(data.brand || '');
    setCategoryValue(data.subject_name || '');
    const nextChars: Record<string, string> = {};
    Object.entries(data.characteristics || {}).forEach(([k, v]) => { nextChars[k] = toText(v); });
    setCharacteristicsDraft(nextChars);
    const dims = (data.dimensions || {}) as Record<string, unknown>;
    setDimensionsDraft({ length: toText(dims.length), width: toText(dims.width), height: toText(dims.height), weight: toText(dims.weight) });
    const raw = (data.raw_data || {}) as Record<string, unknown>;
    setPackageDraft({ type: toText(raw.package_type) || 'Коробка', contents: toText(raw.complectation) || '' });
    // Parse size variants from raw_data.sizes (WB API format)
    const rawSizes = Array.isArray(raw.sizes) ? raw.sizes : [];
    const parsedSizes: SizeVariant[] = rawSizes.map((s: any) => ({
      techSize: String(s.techSize || s.tech_size || ''),
      wbSize: String(s.wbSize || s.wb_size || s.origName || ''),
      skus: Array.isArray(s.skus) ? s.skus.map(String) : (s.barcode ? [String(s.barcode)] : []),
    }));
    setSizeVariants(parsedSizes.length > 0 ? parsedSizes : []);
    setExpandedSizeIndex(null);
    setActiveTab('basic');
    setResolvedIssues({});
    setExpandedIssues({});
    setCoverIndex(0);
    setDeletePhotoTarget(null);
    setMediaSyncing(false);
    setAutoSaveStatus('idle');
    setHasDraftChanges(false);
    setCharChipStates({});
  };

  /** Hydrate from a saved draft, falling back to card data for missing fields */
  const hydrateDraftsFromDraft = (data: CardDetail, draft: CardDraftPayload) => {
    // Start with WB data as base, then overlay draft values
    hydrateDrafts(data);
    if (draft.title !== undefined) setTitleValue(draft.title);
    if (draft.description !== undefined) setDescriptionValue(draft.description);
    if (draft.brand !== undefined) setBrandValue(draft.brand);
    if (draft.subject_name !== undefined) setCategoryValue(draft.subject_name);
    if (draft.characteristics) {
      setCharacteristicsDraft(prev => ({ ...prev, ...draft.characteristics }));
    }
    if (draft.dimensions) {
      setDimensionsDraft(prev => ({
        length: draft.dimensions?.length ?? prev.length,
        width: draft.dimensions?.width ?? prev.width,
        height: draft.dimensions?.height ?? prev.height,
        weight: draft.dimensions?.weight ?? prev.weight,
      }));
    }
    if (draft.package_type !== undefined || draft.complectation !== undefined) {
      setPackageDraft(prev => ({
        type: draft.package_type ?? prev.type,
        contents: draft.complectation ?? prev.contents,
      }));
    }
  };

  // ─── Derived data ──────────────────────────────────────────────────────────

  const pendingIssues = useMemo(() => {
    if (!card) return [];
    return card.issues
      .filter((i) => i.status === 'pending')
      .sort((a, b) => issueSeverityRank(a.severity) - issueSeverityRank(b.severity));
  }, [card]);

  const unresolvedIssues = useMemo(
    () => pendingIssues.filter((i) => !resolvedIssues[i.id] && !confirmedSections[mapIssueToTab(i)]),
    [pendingIssues, resolvedIssues, confirmedSections],
  );

  const issuesByTab = useMemo(() => {
    const grouped: Record<TabKey, Issue[]> = { basic: [], description: [], characteristics: [], sizes: [], media: [], package: [], docs: [] };
    unresolvedIssues.forEach((i) => { grouped[mapIssueToTab(i)].push(i); });
    return grouped;
  }, [unresolvedIssues]);

  const activeTabIssues = issuesByTab[activeTab] || [];

  const cardScore = card?.score || 0;
  const potentialGain = unresolvedIssues.reduce((acc, i) => acc + (i.score_impact || 0), 0);

  const currentPreviewPhoto = useMemo(() => {
    if (!card?.photos?.length) return null;
    return card.photos[Math.max(0, Math.min(coverIndex, card.photos.length - 1))] || card.photos[0];
  }, [card, coverIndex]);

  // ─── Characteristic sections ───────────────────────────────────────────────

  const characteristicSections = useMemo(() => {
    const entries = Object.entries(characteristicsDraft).filter(([key]) => !isDocumentCharacteristicKey(key));
    const charIssues = issuesByTab.characteristics || [];

    const sectionDefs: Array<{ name: string; keywords: string[] }> = [
      { name: 'Основные характеристики', keywords: ['бренд', 'артикул', 'модель', 'тип', 'назначение', 'страна', 'размер', 'вес', 'пол', 'возраст', 'сезон', 'коллекция', 'комплект', 'гарантия', 'посадк', 'рукав', 'верх', 'низ', 'ростовк'] },
      { name: 'Дизайн и внешний вид', keywords: ['цвет', 'оттенок', 'рисунок', 'узор', 'принт', 'декор', 'стиль', 'форма', 'покрой', 'силуэт', 'фасон', 'длина', 'вырез'] },
      { name: 'Материалы', keywords: ['материал', 'состав', 'ткань', 'подкладка', 'наполнитель', 'утеплитель', 'волокно', 'хлопок', 'полиэстер', 'кожа'] },
    ];

    const sections: CardFieldSection[] = [];
    const usedKeys = new Set<string>();

    for (const def of sectionDefs) {
      const items: SectionItem[] = [];
      for (const [key, value] of entries) {
        const lk = key.toLowerCase();
        if (def.keywords.some((kw) => lk.includes(kw))) {
          items.push({ key, value });
          usedKeys.add(key);
        }
      }
      const sectionIssues = charIssues.filter((iss) => {
        const fp = (iss.field_path || '').replace('characteristics.', '');
        return items.some((item) => item.key === fp);
      });
      if (items.length > 0) sections.push({ name: def.name, items, issues: sectionIssues });
    }

    const remaining: SectionItem[] = [];
    for (const [key, value] of entries) {
      if (!usedKeys.has(key)) remaining.push({ key, value });
    }
    if (remaining.length > 0) {
      const remainingIssues = charIssues.filter((iss) => {
        const fp = (iss.field_path || '').replace('characteristics.', '');
        return remaining.some((item) => item.key === fp);
      });
      sections.push({ name: 'Прочие характеристики', items: remaining, issues: remainingIssues });
    }

    return sections;
  }, [characteristicsDraft, issuesByTab.characteristics]);

  const documentSections = useMemo(() => {
    const entries = Object.entries(characteristicsDraft).filter(([key]) => isDocumentCharacteristicKey(key));
    const docIssues = (issuesByTab.docs || []).filter((iss) => (iss.field_path || '').startsWith('characteristics.'));
    const sectionDefs: Array<{ name: string; keywords: string[] }> = [
      { name: 'Сертификаты и декларации', keywords: ['сертифик', 'декларац', 'регистрац', 'срок действия', 'дата окончания', 'дата регистрации', 'номер'] },
      { name: 'Коды и маркировка', keywords: ['тнвэд', 'тн вэд', 'ндс', 'маркиров', 'честный знак', 'код'] },
    ];

    const sections: CardFieldSection[] = [];
    const usedKeys = new Set<string>();

    for (const def of sectionDefs) {
      const items: SectionItem[] = [];
      for (const [key, value] of entries) {
        const lk = key.toLowerCase();
        if (def.keywords.some((kw) => lk.includes(kw))) {
          items.push({ key, value });
          usedKeys.add(key);
        }
      }
      const sectionIssues = docIssues.filter((iss) => {
        const fp = (iss.field_path || '').replace('characteristics.', '');
        return items.some((item) => item.key === fp);
      });
      if (items.length > 0) sections.push({ name: def.name, items, issues: sectionIssues });
    }

    const remaining: SectionItem[] = [];
    for (const [key, value] of entries) {
      if (!usedKeys.has(key)) remaining.push({ key, value });
    }
    if (remaining.length > 0) {
      const remainingIssues = docIssues.filter((iss) => {
        const fp = (iss.field_path || '').replace('characteristics.', '');
        return remaining.some((item) => item.key === fp);
      });
      sections.push({ name: 'Прочие документы', items: remaining, issues: remainingIssues });
    }

    return sections;
  }, [characteristicsDraft, issuesByTab.docs]);

  // ─── Actions ───────────────────────────────────────────────────────────────

  const toggleSection = (name: string) => setCollapsedSections((p) => ({ ...p, [name]: !p[name] }));
  const toggleIssueExpand = (id: number) => {
    const wasExpanded = expandedIssues[id];
    setExpandedIssues((p) => ({ ...p, [id]: !p[id] }));
    // After DOM update, scroll the card into center view
    setTimeout(() => {
      const el = expandedCardRefs.current[id];
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  };

  const markIssue = (issueId: number, state: ResolveState) => {
    setResolvedIssues((p) => ({ ...p, [issueId]: state }));
  };

  const applyInlineFix = (issue: Issue, value: string) => {
    logAction('problem_resolved', `Исправлено: ${issue.title || issue.field_path}`, { nmId: card?.nm_id });
    const path = (issue.field_path || '').toLowerCase();
    if (path === 'title') setTitleValue(value);
    else if (path === 'description') setDescriptionValue(value);
    else if (path === 'brand') setBrandValue(value);
    else if (path === 'subject_name' || path === 'category' || path === 'subject') setCategoryValue(value);
    else if (path.startsWith('characteristics.')) {
      const key = issue.field_path?.split('.').slice(1).join('.') || '';
      if (key) setCharacteristicsDraft((p) => ({ ...p, [key]: value }));
    } else if (path.startsWith('dimensions.')) {
      const dimKey = issue.field_path?.split('.').slice(1).join('.') || '';
      if (dimKey === 'length' || dimKey === 'width' || dimKey === 'height' || dimKey === 'weight')
        setDimensionsDraft((p) => ({ ...p, [dimKey]: value }));
    }
    markIssue(issue.id, 'resolved');
  };

  const openTextEditor = (field: 'title' | 'description', issue?: Issue | null) => {
    setTextEditorField(field);
    setTextEditorIssue(issue ?? null);
    setTextEditorOpen(true);
  };

  const openIssueForManualFix = (issue: Issue) => {
    if ((issue.field_path || '').toLowerCase() === 'title') {
      openTextEditor('title', issue);
      return;
    }
    if ((issue.field_path || '').toLowerCase() === 'description') {
      openTextEditor('description', issue);
      return;
    }

    const targetTab = mapIssueToTab(issue);
    setActiveTab(targetTab);
    setExpandedIssues((prev) => ({ ...prev, [issue.id]: true }));
    setTimeout(() => {
      expandedCardRefs.current[issue.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);

    if ((issue.allowed_values || []).length > 0) {
      toast.info('Автозамена скрыта: выберите подтвержденное значение вручную.');
    } else {
      toast.info('Для этой ошибки нужно ручное исправление.');
    }
  };

  const handleIssuePrimaryAction = (issue: Issue, preferredValue?: string | null) => {
    const suggested = String(preferredValue ?? issueSuggestedValue(issue) ?? '').trim();
    if (suggested) {
      applyInlineFix(issue, suggested);
      return;
    }
    openIssueForManualFix(issue);
  };

  const handleTextEditorApply = (newValue: string) => {
    if (textEditorField === 'title') setTitleValue(newValue);
    else setDescriptionValue(newValue);
    if (textEditorIssue && textEditorIssue.id > 0) {
      logAction('problem_resolved', `Исправлено: ${textEditorIssue.title || textEditorIssue.field_path}`, { nmId: card?.nm_id });
      markIssue(textEditorIssue.id, 'resolved');
    }
  };

  const buildDescriptionEditorDraft = useCallback((): DescriptionEditorDraftPayload | undefined => {
    if (!card) return undefined;
    return {
      title: titleValue,
      description: descriptionValue,
      characteristics: {
        ...(card.characteristics || {}),
        ...(characteristicsDraft || {}),
      },
    };
  }, [card, titleValue, descriptionValue, characteristicsDraft]);

  const loadDescriptionEditorContext = useCallback(async () => {
    if (!activeStore || !card) return;
    setTextEditorKeywordsLoading(true);
    try {
      const context = await api.getDescriptionEditorContext(
        activeStore.id,
        card.id,
        buildDescriptionEditorDraft(),
      );
      setTextEditorKeywords(context.keywords || []);
    } catch (error) {
      setTextEditorKeywords([]);
      toast.error(error instanceof Error ? error.message : 'Не удалось загрузить ключевые слова');
    } finally {
      setTextEditorKeywordsLoading(false);
    }
  }, [activeStore, card, buildDescriptionEditorDraft]);

  const handleDescriptionEditorGenerate = useCallback(async ({ instructions }: { instructions?: string }) => {
    if (!activeStore || !card) {
      throw new Error('Карточка недоступна');
    }
    try {
      const result = await api.generateDescriptionEditorValue(activeStore.id, card.id, {
        draft: buildDescriptionEditorDraft(),
        instructions,
      });
      setTextEditorKeywords(result.keywords || []);
      return { value: result.value };
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сгенерировать описание');
      throw error;
    }
  }, [activeStore, card, buildDescriptionEditorDraft]);

  useEffect(() => {
    if (textEditorOpen && textEditorField === 'description') {
      void loadDescriptionEditorContext();
      return;
    }
    setTextEditorKeywords([]);
    setTextEditorKeywordsLoading(false);
  }, [textEditorOpen, textEditorField, loadDescriptionEditorContext]);

  // getChipState removed — always use ensureChipStateInitialized + charChipStates[key]

  const updateChipState = (key: string, updater: (prev: CharChipState) => CharChipState) => {
    setCharChipStates(prev => {
      if (!prev[key]) {
        // Initialize from draft/original value instead of empty
        const draftVal = characteristicsDraftRef.current[key] ?? '';
        const originalVal = card ? toText((card.characteristics || {})[key]) : '';
        const currentValue = draftVal || originalVal;
        const vals = splitChipValues(currentValue);
        const current = { selectedValues: vals, showDropdown: false, searchTerm: '' };
        return { ...prev, [key]: updater(current) };
      }
      return { ...prev, [key]: updater(prev[key]) };
    });
  };

  const ensureChipStateInitialized = (key: string, currentValue: string, issue?: Issue) => {
    setCharChipStates(prev => {
      if (prev[key]) return prev;
      const vals = issue ? issueSuggestedChipValues(issue, currentValue) : splitChipValues(currentValue);
      return { ...prev, [key]: { selectedValues: vals, showDropdown: false, searchTerm: '' } };
    });
  };

  /** Save chip values to draft for a given charKey */
  const saveChipToDraft = (charKey: string) => {
    const chipState = charChipStates[charKey];
    if (!chipState) return;
    const committedValues = getCommittedChipValues(chipState);
    const value = committedValues.join(', ');
    setCharacteristicsDraft(p => ({ ...p, [charKey]: value }));
    setCharChipStates(prev => ({
      ...prev,
      [charKey]: { ...chipState, selectedValues: committedValues, searchTerm: '' },
    }));
    toast.success(`«${charKey}» обновлено`);
  };

  const commitPhotoChanges = useCallback(async (nextPhotos: string[], successMessage: string) => {
    if (!activeStore || !card) return;
    const updated = await api.syncCardPhotos(activeStore.id, card.id, nextPhotos);
    setCard(updated);
    setCoverIndex((prev) => Math.min(prev, Math.max(0, (updated.photos?.length || 1) - 1)));
    toast.success(successMessage);
  }, [activeStore, card]);

  const handlePhotoFiles = useCallback(async (inputFiles: File[] | FileList | null | undefined) => {
    const allFiles = Array.from(inputFiles || []);
    if (!allFiles.length) return;

    const images = allFiles.filter((file) => file.type.startsWith('image/'));
    const videos = allFiles.filter((file) => file.type.startsWith('video/'));

    if (videos.length) {
      toast.error('Загрузка видео из карточки пока не подключена к WB. Видео доступны только для просмотра.');
    }
    if (!images.length) return;
    if (!activeStore || !card) return;
    if (!canSync) {
      toast.error('Для изменения фото нужен доступ `cards.sync`');
      return;
    }

    setMediaSyncing(true);
    try {
      const uploadedAssets = await Promise.all(
        images.map((file) => api.uploadUserPhotoAsset(file, { assetType: 'custom', name: file.name || 'Photo' })),
      );
      const uploadedUrls = uploadedAssets
        .map((item: any) => String(item?.image_url || item?.file_url || item?.url || '').trim())
        .filter(Boolean);

      if (uploadedUrls.length !== images.length) {
        throw new Error('Не все фото удалось загрузить');
      }

      await commitPhotoChanges([...(card.photos || []), ...uploadedUrls], `Загружено ${uploadedUrls.length} фото`);
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось загрузить фото');
    } finally {
      setMediaSyncing(false);
    }
  }, [activeStore, card, canSync, commitPhotoChanges]);

  const handlePhotoDelete = useCallback(async () => {
    if (deletePhotoTarget === null || !card) return;
    if ((card.photos || []).length <= 1) {
      toast.error('Нельзя удалить последнее фото карточки');
      setDeletePhotoTarget(null);
      return;
    }

    setMediaSyncing(true);
    try {
      const nextPhotos = (card.photos || []).filter((_, idx) => idx !== deletePhotoTarget);
      await commitPhotoChanges(nextPhotos, 'Фото удалено');
      setDeletePhotoTarget(null);
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось удалить фото');
    } finally {
      setMediaSyncing(false);
    }
  }, [card, commitPhotoChanges, deletePhotoTarget]);

  const handlePhotoReorder = useCallback(async (fromIndex: number, toIndex: number) => {
    if (!card || fromIndex === toIndex) return;

    const nextPhotos = [...(card.photos || [])];
    const [moved] = nextPhotos.splice(fromIndex, 1);
    nextPhotos.splice(toIndex, 0, moved);

    setMediaSyncing(true);
    try {
      await commitPhotoChanges(nextPhotos, 'Порядок фото обновлён');
      setCoverIndex(toIndex);
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось изменить порядок фото');
    } finally {
      setMediaSyncing(false);
    }
  }, [card, commitPhotoChanges]);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setFileDragOver(false);
    void handlePhotoFiles(e.dataTransfer.files);
  }, [handlePhotoFiles]);

  const saveCardDraft = useCallback(async () => {
    if (!activeStore || !cardId) return;
    logAction('field_edited', 'Сохранён черновик карточки', { nmId: card?.nm_id });
    setAutoSaveStatus('saving');
    try {
      const payload: CardDraftPayload = {
        title: titleValue,
        description: descriptionValue,
        brand: brandValue,
        subject_name: categoryValue,
        characteristics: characteristicsDraftRef.current,
        dimensions: dimensionsDraft,
        package_type: packageDraft.type,
        complectation: packageDraft.contents,
      };
      await api.saveCardDraft(activeStore.id, Number(cardId), payload);
      setAutoSaveStatus('saved');
    } catch {
      console.warn('Draft save request failed, keeping local state');
      setTimeout(() => setAutoSaveStatus('saved'), 400);
    }
  }, [activeStore, cardId, titleValue, descriptionValue, brandValue, categoryValue, dimensionsDraft, packageDraft]);

  // ─── Auto-save draft on any change ─────────────────────────────────────────
  useEffect(() => {
    if (isInitialHydration.current) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setAutoSaveStatus('idle');
    setHasDraftChanges(true);
    autoSaveTimer.current = setTimeout(() => saveCardDraft(), 1500);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [titleValue, descriptionValue, brandValue, categoryValue, characteristicsDraft, dimensionsDraft, packageDraft, saveCardDraft]);

  // Mark initial hydration complete after first card load
  useEffect(() => {
    if (card && isInitialHydration.current) {
      // Defer to let hydrateDrafts settle
      setTimeout(() => { isInitialHydration.current = false; }, 100);
    }
  }, [card]);
  const handleConfirmClick = () => {
    if (activeTabIssues.length > 0) {
      setConfirmDialogTab(activeTab);
    } else {
      confirmSection(activeTab);
    }
  };

  const confirmSection = async (tab: TabKey) => {
    const tabIssues = (issuesByTab[tab] || []);
    tabIssues.forEach((i) => markIssue(i.id, 'resolved'));
    await toggleSectionConfirm(tab);
    if (tabIssues.length > 0) {
      toast.success(`Раздел подтверждён, ${tabIssues.length} ошибок снято`);
    }
  };

  const renderConfirmButton = () => (
    <div className="flex justify-end mb-4">
      {confirmedSections[activeTab] ? (
        <div className="flex items-center gap-2 rounded-lg bg-zone-green/10 border border-zone-green/30 px-3 py-1.5">
          <Check className="h-4 w-4 text-zone-green" />
          <span className="text-sm font-medium text-zone-green">Раздел подтверждён</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-destructive ml-1 px-2"
            onClick={() => toggleSectionConfirm(activeTab)}
          >
            <X className="h-3.5 w-3.5 mr-1" /> Отменить
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="h-9 text-sm text-muted-foreground border-border hover:bg-muted"
          onClick={handleConfirmClick}
        >
          <CircleCheck className="h-4 w-4 mr-1.5" /> Подтвердить раздел
          {activeTabIssues.length > 0 && (
            <span className="ml-1.5 text-[10px] text-muted-foreground/60">({activeTabIssues.length} ошибок)</span>
          )}
        </Button>
      )}
    </div>
  );

  const toggleSectionConfirm = async (tab: TabKey) => {
    const isConfirmed = confirmedSections[tab];
    setConfirmedSections(prev => ({ ...prev, [tab]: !isConfirmed }));
    if (activeStore && cardId) {
      try {
        if (isConfirmed) {
          await api.unconfirmSection(activeStore.id, Number(cardId), tab);
        } else {
          await api.confirmSection(activeStore.id, Number(cardId), tab);
        }
      } catch {
        console.warn('Section confirm request failed, keeping local state');
      }
    }
  };

  // ─── Delegation ────────────────────────────────────────────────────────────

  const openDelegateDialog = async (issue: Issue) => {
    if (!activeStore) return;
    setPendingCollapse(null); // close unsaved-changes dialog if open
    setDelegateIssue(issue);
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
    } catch {
      toast.error('Не удалось загрузить список сотрудников');
    } finally {
      setTeamLoading(false);
    }
  };

  const handleDelegate = useCallback(async () => {
    if (!activeStore || !delegateIssue || selectedDelegateIds.size === 0) return;
    try {
      await api.assignIssue(activeStore.id, delegateIssue.id, Array.from(selectedDelegateIds));
      toast.success(`Задача передана (${selectedDelegateIds.size})`);
      markIssue(delegateIssue.id, 'resolved');
      setShowDelegateDialog(false);
      setDelegateIssue(null);
      setSelectedDelegateIds(new Set());
    } catch {
      toast.error('Не удалось передать задачу');
    }
  }, [activeStore, delegateIssue, selectedDelegateIds]);

  // ─── Review (На согласование) ─────────────────────────────────────────────
  const openReviewDialog = async () => {
    if (!activeStore) return;
    setShowReviewDialog(true);
    setReviewNote('');
    setSelectedReviewerIds(new Set());
    setReviewTeamLoading(true);
    try {
      const members = await api.getTeamMembers(activeStore.id);
      setReviewTeamMembers(
        members.map((m: any) => ({
          id: m.id,
          name: [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email,
          role: m.role,
        }))
      );
    } catch {
      toast.error('Не удалось загрузить список сотрудников');
    } finally {
      setReviewTeamLoading(false);
    }
  };

  const handleSubmitForReview = async () => {
    if (!activeStore || !card || selectedReviewerIds.size === 0) return;
    setShowReviewDialog(false);
    const selectedMembers = reviewTeamMembers.filter(m => selectedReviewerIds.has(m.id));
    try {
      await api.submitForReview(
        activeStore.id,
        card.id,
        reviewNote || undefined,
        selectedMembers.map(reviewer => reviewer.id),
      );
      toast.success(`Отправлено на согласование (${selectedMembers.length})`);
    } catch {
      toast.error('Не удалось отправить на согласование');
    }
    setReviewNote('');
    setSelectedReviewerIds(new Set());
  };

  // ─── Helpers for issue lookup by char key ──────────────────────────────────


  const getIssueForCharKey = (key: string, tab: 'characteristics' | 'docs' = 'characteristics'): Issue | undefined => {
    return (issuesByTab[tab] || []).find(
      (iss) => (iss.field_path || '').replace('characteristics.', '') === key,
    );
  };

  // ─── Loading ───────────────────────────────────────────────────────────────

  if (loading || !card) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-muted-foreground">Загрузка карточки...</span>
        </div>
      </div>
    );
  }

  // ─── Progress bar segments ─────────────────────────────────────────────────

  const totalIssuesAll = pendingIssues.length;
  const resolvedCount = Object.keys(resolvedIssues).length;
  const confirmedCount = TAB_ORDER.filter(t => confirmedSections[t.key]).length;
  const sectionsWithIssuesCount = TAB_ORDER.filter((tab) => (issuesByTab[tab.key] || []).length > 0).length;
  const progressSegments = TAB_ORDER.map((tab) => {
    const tabIssues = pendingIssues.filter((i) => mapIssueToTab(i) === tab.key);
    const tabResolved = tabIssues.filter((i) => resolvedIssues[i.id]).length;
    const tabTotal = tabIssues.length;
    const isConfirmed = !!confirmedSections[tab.key];
    return { key: tab.key, total: tabTotal, resolved: tabResolved, isConfirmed };
  });

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      {/* ── Topbar ── */}
      <div id="card-topbar" ref={topbarRef} className="sticky top-0 z-20 bg-background border-b border-border">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <button
              onClick={() => navigate('/workspace/cards')}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-1"
            >
              <ArrowLeft className="h-4 w-4" /> К списку товаров
            </button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg overflow-hidden bg-muted flex-shrink-0 flex items-center justify-center border border-border">
                {currentPreviewPhoto ? <img src={currentPreviewPhoto} alt="" className="w-full h-full object-cover" /> : <Camera size={16} className="text-muted-foreground" />}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h1 className="text-lg font-semibold text-foreground">{card.title || `Карточка ${card.nm_id}`}</h1>
                  <a href={`https://www.wildberries.ru/catalog/${card.nm_id}/detail.aspx`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-sm" title="Открыть на WB">↗ WB</a>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                  <CopyableId value={String(card.nm_id)} label="Артикул ВБ скопирован" icon={<ShoppingBag size={12} className="inline align-middle relative -top-px" />} />
                  {card.vendor_code && <><span className="text-muted-foreground/40">·</span><CopyableId value={card.vendor_code} label="Артикул поставщика скопирован" icon={<Tag size={12} className="inline align-middle relative -top-px" />} /></>}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs gap-1">
              <CircleCheck className="h-3 w-3" /> {confirmedCount}/{TAB_ORDER.length} разделов
            </Badge>
            {unresolvedIssues.length > 0 && (
              <Badge variant="outline" className="text-xs gap-1 text-amber-700 border-amber-200 bg-amber-50">
                <AlertTriangle className="h-3 w-3" />
                {pluralErrorsLabel(unresolvedIssues.length)}
                {sectionsWithIssuesCount > 0 ? ` в ${pluralSectionsLabel(sectionsWithIssuesCount)}` : ''}
              </Badge>
            )}
            {hasDraftChanges ? (
              <div className="flex items-center gap-1.5 text-[11px]">
                {autoSaveStatus === 'saving' ? (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <RefreshCw className="h-3 w-3 animate-spin" /> Сохранение...
                  </span>
                ) : autoSaveStatus === 'saved' ? (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Check className="h-3 w-3 text-zone-green" /> Черновик сохранён
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <PenLine className="h-3 w-3" /> Черновик
                  </span>
                )}
                <span className="text-muted-foreground/40">·</span>
                <button
                  className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                  onClick={async () => {
                    if (!activeStore || !card || !cardId) return;
                    try {
                      await api.deleteCardDraft(activeStore.id, Number(cardId));
                    } catch {
                      console.warn('Draft delete API not available');
                    }
                    hydrateDrafts(card);
                    setHasDraftChanges(false);
                    isInitialHydration.current = true;
                    setTimeout(() => { isInitialHydration.current = false; }, 100);
                    toast.success('Сброшено к данным WB');
                  }}
                >
                  Сбросить к WB
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Globe className="h-3 w-3" /> Данные WB
              </div>
            )}
            <div className="w-px h-5 bg-border" />
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-sm"
              onClick={() => openReviewDialog()}
            >
              <Send className="h-3.5 w-3.5 mr-1" /> На согласование
            </Button>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      size="sm"
                      className="h-8 text-sm"
                      disabled={confirmedCount < TAB_ORDER.length || !canSync}
                      onClick={async () => {
                        if (!activeStore || !card) return;
                        try {
                          const updated = await api.applyCard(activeStore.id, card.id);
                          setCard(updated);
                          setOtherDraft(null);
                          setDraftDismissed(false);
                          isInitialHydration.current = true;
                          hydrateDrafts(updated);
                          setHasDraftChanges(false);
                          setAutoSaveStatus('idle');
                          setResolvedIssues({});
                          toast.success('Изменения отправлены на Wildberries');
                        } catch (e: any) {
                          toast.error(e.message || 'Ошибка при отправке');
                        }
                      }}
                    >
                      <Upload className="h-3.5 w-3.5 mr-1" /> Отправить на WB
                    </Button>
                  </span>
                </TooltipTrigger>
                {!canSync ? (
                  <TooltipContent>Для отправки на WB нужен доступ `cards.sync`</TooltipContent>
                ) : confirmedCount < TAB_ORDER.length ? (
                  <TooltipContent>Подтвердите все {TAB_ORDER.length} разделов для отправки</TooltipContent>
                ) : null}
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>



      {/* ── Tabs row (sticky below topbar) ── */}
      <div className="sticky z-10 bg-background border-b border-border" style={{ top: 'var(--topbar-h, 57px)' }}>
        <div className="max-w-[1600px] mx-auto px-4 flex items-center justify-center">
          <div className="flex items-center gap-2">
            {TAB_ORDER.map((tab) => {
              const Icon = tab.icon;
              const count = (issuesByTab[tab.key] || []).length;
              const isActive = activeTab === tab.key;
              const isConfirmed = !!confirmedSections[tab.key];

              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-sm transition-colors border-b-2 -mb-px whitespace-nowrap ${
                    isActive
                      ? 'border-primary text-foreground font-medium'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                  {isConfirmed ? (
                    <Check className="ml-0.5 h-3.5 w-3.5 text-zone-green" />
                  ) : count > 0 ? (
                    <span className="ml-0.5 min-w-[18px] h-[18px] rounded-full bg-zone-red text-[10px] font-semibold text-white flex items-center justify-center">{count}</span>
                  ) : (
                    <span className="ml-1 w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Main layout with sidebar ── */}
      <div className="max-w-[1600px] mx-auto px-4 py-4 flex gap-4">
        {/* ── Issues sidebar ── */}
        <aside className="w-[200px] flex-shrink-0 sticky self-start overflow-y-auto" style={{ top: 'calc(var(--topbar-h, 57px) + 46px)', maxHeight: 'calc(100vh - var(--topbar-h, 57px) - 56px)' }}>
          <div className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
              <span className="text-xs font-semibold text-foreground">Требуют исправления</span>
              <div className="flex items-center gap-1.5">
                <span className="min-w-[18px] h-[18px] rounded-full bg-zone-red text-[10px] font-semibold text-white flex items-center justify-center px-1">
                  {unresolvedIssues.filter((i) => i.severity === 'critical').length}
                </span>
                <span className="min-w-[18px] h-[18px] rounded-full bg-zone-yellow text-[10px] font-semibold text-white flex items-center justify-center px-1">
                  {unresolvedIssues.filter((i) => i.severity === 'warning').length}
                </span>
              </div>
            </div>

            <div className="py-1">
              {unresolvedIssues.length === 0 ? (
                <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground justify-center">
                  <CircleCheck size={14} className="text-zone-green" /> Нет активных проблем
                </div>
              ) : (
                unresolvedIssues.map((issue) => (
                  <button
                    key={issue.id}
                    onClick={() => {
                      const tab = mapIssueToTab(issue);
                      setActiveTab(tab);
                      if (tab === 'characteristics') {
                        const charKey = (issue.field_path || '').replace('characteristics.', '');
                        if (charKey) {
                          setExpandedIssues(prev => ({ ...prev, [issue.id]: true }));
                          setTimeout(() => {
                            const el = expandedCardRefs.current[issue.id] || normalCharRefs.current[charKey];
                            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          }, 150);
                        }
                      } else {
                        setExpandedIssues(prev => ({ ...prev, [issue.id]: true }));
                        setTimeout(() => {
                          expandedCardRefs.current[issue.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, 150);
                      }
                    }}
                    className="group flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs hover:bg-muted/50 transition-colors relative"
                    title={`${issue.field_path ? issue.field_path.replace(/^characteristics\./, '') + ' — ' : ''}${issueCategoryLabel(issue)}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      issue.severity === 'critical' ? 'bg-zone-red' : issue.severity === 'warning' ? 'bg-zone-yellow' : 'bg-zone-green'
                    }`} />
                    <span className="text-foreground truncate">
                      {issue.field_path && (
                        <span className="font-medium">{issue.field_path.replace(/^characteristics\./, '')}</span>
                      )}
                      {issue.field_path ? ' — ' : ''}
                      <span className="text-muted-foreground">{issueCategoryLabel(issue)}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </aside>

        {/* ── Tab content ── */}
        <div className="flex-1 min-w-0">

          {/* ── Draft banner (another user's draft) ── */}
          {otherDraft && !draftDismissed && (
            <DraftBanner
              draft={otherDraft}
              onLoadDraft={() => {
                if (card && otherDraft) {
                  hydrateDraftsFromDraft(card, otherDraft.data);
                  setDraftDismissed(true);
                  toast.success('Черновик загружен');
                }
              }}
              onDismiss={() => setDraftDismissed(true)}
            />
          )}

        {/* ── Tab content ── */}
        {/* ── Characteristics tab ── */}
        {activeTab === 'characteristics' && (
          <div>
            {renderConfirmButton()}
            {/* Toolbar */}
            <div className="flex items-center gap-3 mb-4">
              <div className="relative flex-1 max-w-[400px]">
                <SearchIcon className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Поиск по характеристикам..."
                  value={charSearch}
                  onChange={(e) => setCharSearch(e.target.value)}
                  className="w-full h-9 pl-9 pr-3 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="flex items-center gap-0 bg-muted rounded-lg p-0.5">
                {(['all', 'issues', 'empty'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setCharFilter(f)}
                    className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                      charFilter === f ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {f === 'all' ? 'Все' : f === 'issues' ? 'Проблемные' : 'Пустые'}
                  </button>
                ))}
              </div>
            </div>

            {/* Sections */}
            {characteristicSections.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                <FolderOpen size={16} /> Характеристики отсутствуют
              </div>
            ) : (
              characteristicSections.map((section) => {
                const isCollapsed = collapsedSections[section.name];
                const searchLower = charSearch.toLowerCase();

                let visibleItems = section.items;
                if (searchLower) visibleItems = visibleItems.filter((item) => item.key.toLowerCase().includes(searchLower) || item.value.toLowerCase().includes(searchLower));
                if (charFilter === 'empty') visibleItems = visibleItems.filter((item) => !item.value?.trim());
                else if (charFilter === 'issues') {
                  const issueKeys = new Set((issuesByTab.characteristics || []).map((iss) => (iss.field_path || '').replace('characteristics.', '')));
                  visibleItems = visibleItems.filter((item) => issueKeys.has(item.key));
                }

                if (searchLower && visibleItems.length === 0) return null;

                return (
                  <div key={section.name} className="mb-4">
                    <button
                      onClick={() => toggleSection(section.name)}
                      className="flex items-center gap-2 w-full text-left py-2"
                    >
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                      <span className="text-sm font-semibold text-foreground">{section.name}</span>
                      {section.issues.length > 0 && (
                        <span className="min-w-[20px] h-5 rounded-full bg-zone-red text-[10px] font-semibold text-white flex items-center justify-center px-1.5">{section.issues.length}</span>
                      )}
                      <span className="flex-1" />
                      <span className="text-xs text-muted-foreground">{visibleItems.length}</span>
                    </button>

                    {!isCollapsed && (
                      <div className="grid grid-cols-2 gap-3 mt-1">
                        {visibleItems.map((item) => {
                          const issue = getIssueForCharKey(item.key);
                          const isEmpty = !item.value?.trim();
                          const isExpanded = issue ? expandedIssues[issue.id] : false;

                          // If issue exists, render enhanced card with chips + inline comparison
                          if (issue) {
                            return renderCharCardWithIssue(item.key, item.value, issue, isExpanded);
                          }

                          // Normal field without issue — expandable with chip editor
                          const isNormalExpanded = expandedNormalChars[item.key];
                          return renderNormalCharCard(item.key, item.value, isEmpty, isNormalExpanded);
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
        {activeTab === 'basic' && (
          <div>
            {renderConfirmButton()}
            {(() => {
              // Separate category and brand issues from other basic issues
              const categoryIssues = activeTabIssues.filter(i => {
                const path = (i.field_path || '').toLowerCase();
                const title = (i.title || '').toLowerCase();
                const cat = (i.category || '').toLowerCase();
                return path === 'subject_name' || path === 'category' || path === 'subject' ||
                  cat === 'category' || cat === 'subject' ||
                  title.includes('категори') || title.includes('предмет');
              });
              const brandIssues = activeTabIssues.filter(i => {
                const path = (i.field_path || '').toLowerCase();
                const cat = (i.category || '').toLowerCase();
                return path === 'brand' || cat === 'brand';
              });
              const otherIssues = activeTabIssues.filter(i => !categoryIssues.includes(i) && !brandIssues.includes(i));

              const renderEditableField = (
                label: string,
                value: string,
                onChange: (v: string) => void,
                issues: Issue[],
                fieldKey: string,
              ) => {
                const issue = issues[0];
                const hasIssue = !!issue;
                const isExpanded = issue ? expandedIssues[issue.id] : false;
                const suggestedValue = issue ? (issue.ai_suggested_value || issue.suggested_value || '') : '';
                const isModified = fieldKey === 'brand'
                  ? value !== (card.brand || '')
                  : value !== (card.subject_name || '');

                return (
                  <div
                    key={fieldKey}
                    ref={issue ? (el => { expandedCardRefs.current[issue.id] = el; }) : undefined}
                    className={`rounded-lg border p-3 transition-colors ${isExpanded ? 'col-span-2' : ''} ${
                      hasIssue
                        ? issue.severity === 'critical'
                          ? 'border-[rgba(239,68,68,0.5)] bg-[rgba(239,68,68,0.04)]'
                          : 'border-[rgba(234,179,8,0.5)] bg-[rgba(234,179,8,0.04)]'
                        : 'border-border bg-card'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        {hasIssue && (
                          <TriangleAlert className={`h-3.5 w-3.5 flex-shrink-0 ${issue.severity === 'critical' ? 'text-zone-red' : 'text-zone-yellow'}`} />
                        )}
                        <span className="text-xs text-muted-foreground">{label}</span>
                        {isModified && !hasIssue && (
                          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                        )}
                      </div>
                      {hasIssue && (
                        <button
                          onClick={() => toggleIssueExpand(issue.id)}
                          className="text-[11px] text-primary hover:underline flex-shrink-0"
                        >
                          {isExpanded ? 'Скрыть ∧' : 'Подробнее ∨'}
                        </button>
                      )}
                    </div>

                    {/* Editable input with suggestion */}
                    <div className="relative">
                      <input
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      {hasIssue && suggestedValue && value !== suggestedValue && (
                        <div className="flex items-center gap-1.5 mt-1.5 text-xs">
                          <ArrowRight size={10} className="text-muted-foreground opacity-50 flex-shrink-0" />
                          <span className="text-primary font-medium truncate">{suggestedValue}</span>
                        </div>
                      )}
                    </div>

                    {/* Expanded error details */}
                    {hasIssue && isExpanded && (
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <TriangleAlert className={`h-3.5 w-3.5 flex-shrink-0 ${issue.severity === 'critical' ? 'text-zone-red' : 'text-zone-yellow'}`} />
                          <p className="text-sm font-medium text-foreground">{issue.title}</p>
                          {issue.score_impact > 0 && (
                            <Badge variant="secondary" className="text-[10px] h-5 flex-shrink-0">+{issue.score_impact} к рейтингу</Badge>
                          )}
                        </div>
                        {issue.description && (
                          <p className="text-xs text-muted-foreground">{issue.description}</p>
                        )}
                        {issueSourceLabel(issue) && (
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <Bot size={12} className="opacity-50" /> Источник: {issueSourceLabel(issue)}
                          </div>
                        )}
                        {issueRecommendation(issue) && (
                          <div className="flex items-center gap-1.5 text-[12px]">
                            <Sparkles size={12} className="text-primary" />
                            <span className="text-muted-foreground">Рекомендация:</span>
                            <span className="font-medium text-foreground">{issueRecommendation(issue)}</span>
                          </div>
                        )}
                        {(() => {
                          const alternatives = [
                            ...(issue.ai_alternatives || []),
                            ...(issue.alternatives || []),
                          ].filter((s, i, arr) => s?.trim() && arr.indexOf(s) === i);
                          const allOptions = suggestedValue
                            ? [suggestedValue, ...alternatives.filter(a => a !== suggestedValue)]
                            : alternatives;
                          const allowedValues = issue.allowed_values || [];
                          const vals = allowedValues.length > 0 ? allowedValues : allOptions;
                          if (vals.length === 0) return null;
                          return (
                            <div className="space-y-1.5">
                              <span className="text-xs text-muted-foreground">Варианты:</span>
                              <div className="flex flex-wrap gap-1.5">
                                {vals.map((val: string, idx: number) => (
                                  <button
                                    key={idx}
                                    onClick={() => applyInlineFix(issue, String(val))}
                                    className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                                      String(val) === suggestedValue
                                        ? 'border-primary bg-primary/10 text-primary font-medium'
                                        : 'border-border text-foreground hover:bg-muted'
                                    }`}
                                  >
                                    {String(val)}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })()}
                        {issue.ai_reason && (
                          <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                            <strong>Причина:</strong> {issue.ai_reason}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Action buttons for issues */}
                    {hasIssue && (
                      <div className="flex items-center gap-1.5 mt-2">
                        {suggestedValue && (
                          <button
                            onClick={(e) => { e.stopPropagation(); applyInlineFix(issue, suggestedValue); }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                            title="Будет применено рекомендуемое значение"
                          >
                            <Sparkles className="h-3 w-3" /> Применить
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); markIssue(issue.id, 'resolved'); }}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          title="Оставить текущее значение на Wildberries без изменений"
                        >
                          <BadgeCheck className="h-3 w-3" /> Оставить текущее
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); openDelegateDialog(issue); }}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          title="Передать задачу другому сотруднику — будет создан тикет во входящих"
                        >
                          <Users className="h-3 w-3" /> Передать
                        </button>
                      </div>
                    )}
                  </div>
                );
              };

              return (
                <>
                  {otherIssues.length > 0 && otherIssues.map((issue) => renderIssueBlock(issue))}
                  <div className="grid grid-cols-2 gap-3 mt-4">
                    {renderEditableField('Бренд', brandValue, setBrandValue, brandIssues, 'brand')}
                    {renderEditableField('Категория', categoryValue, setCategoryValue, categoryIssues, 'category')}

                    {/* nmID */}
                    <div className="rounded-lg border border-border bg-card p-3">
                      <span className="text-xs text-muted-foreground mb-1.5 block">nmID</span>
                      <input value={String(card.nm_id)} readOnly className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none" />
                    </div>

                    {/* Артикул поставщика */}
                    <div className="rounded-lg border border-border bg-card p-3">
                      <span className="text-xs text-muted-foreground mb-1.5 block">Артикул поставщика</span>
                      <input value={card.vendor_code || ''} readOnly className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none" />
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* ── Description tab ── */}
        {activeTab === 'description' && (
          <div className="space-y-4">
            {renderConfirmButton()}
            {/* ── Title field ── */}
            {(() => {
              const titleIssues = activeTabIssues.filter(i => (i.field_path || '').toLowerCase() === 'title' || (i.category || '').toLowerCase() === 'title');
              const otherIssues = activeTabIssues.filter(i => {
                const path = (i.field_path || '').toLowerCase();
                const cat = (i.category || '').toLowerCase();
                return path !== 'title' && cat !== 'title' && path !== 'description' && cat !== 'description' && cat !== 'seo';
              });
              const descIssues = activeTabIssues.filter(i => {
                const path = (i.field_path || '').toLowerCase();
                const cat = (i.category || '').toLowerCase();
                return (path === 'description' || cat === 'description' || cat === 'seo') && path !== 'title' && cat !== 'title';
              });
              const titleBorderClass = titleIssues.length > 0
                ? titleIssues.some(i => i.severity === 'critical') ? 'border-zone-red/50' : 'border-zone-yellow/50'
                : 'border-border';
              const descBorderClass = descIssues.length > 0
                ? descIssues.some(i => i.severity === 'critical') ? 'border-zone-red/50' : 'border-zone-yellow/50'
                : 'border-border';

              return (
                <>
                  {otherIssues.map((issue) => renderIssueBlock(issue))}

                  {/* Title field — read-only, edit only via TextEditorDialog */}
                  <div className={`rounded-lg border ${titleBorderClass} bg-card p-4`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-muted-foreground">Название</span>
                      <button
                        onClick={() => {
                          const issue = titleIssues[0];
                          if (issue) openTextEditor('title', issue);
                          else openTextEditor('title');
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                      >
                        <Sparkles className="h-3 w-3" /> Редактировать
                      </button>
                    </div>
                    <div
                      onClick={() => {
                        const issue = titleIssues[0];
                        if (issue) openTextEditor('title', issue);
                        else openTextEditor('title');
                      }}
                      className={`w-full px-3 py-2 text-sm rounded-md border ${titleBorderClass} bg-background text-foreground cursor-pointer hover:border-primary/50 transition-colors min-h-[60px] whitespace-pre-wrap`}
                    >
                      {titleValue || <span className="text-muted-foreground">Нет названия</span>}
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[11px] text-muted-foreground">{titleValue.length} символов · рекомендуется 60-120</span>
                    </div>
                    {titleIssues.map((issue) => {
                      const suggestedValue = issue.ai_suggested_value || issue.suggested_value || '';
                      return (
                        <div key={issue.id} ref={el => { expandedCardRefs.current[issue.id] = el; }} className={`mt-2 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs ${
                          issue.severity === 'critical' ? 'bg-[rgba(239,68,68,0.06)]' : 'bg-[rgba(234,179,8,0.06)]'
                        }`}>
                          <TriangleAlert className={`h-3 w-3 flex-shrink-0 ${issue.severity === 'critical' ? 'text-zone-red' : 'text-zone-yellow'}`} />
                          <span className="text-foreground flex-1 truncate">{issue.title}</span>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {suggestedValue && titleValue !== suggestedValue && (
                              <button onClick={() => openTextEditor('title', issue)} className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                                <Sparkles className="h-3 w-3" /> Предложить новое
                              </button>
                            )}
                            <button onClick={() => markIssue(issue.id, 'resolved')} className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                              <BadgeCheck className="h-3 w-3" /> Оставить текущее
                            </button>
                            <button onClick={() => openDelegateDialog(issue)} className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                              <Users className="h-3 w-3" /> Передать
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Description field — read-only, edit only via TextEditorDialog */}
                  <div className={`rounded-lg border ${descBorderClass} bg-card p-4`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-muted-foreground">Описание</span>
                      <button
                        onClick={() => {
                          const issue = descIssues[0];
                          if (issue) openTextEditor('description', issue);
                          else openTextEditor('description');
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                      >
                        <Sparkles className="h-3 w-3" /> Редактировать
                      </button>
                    </div>
                    <div
                      onClick={() => {
                        const issue = descIssues[0];
                        if (issue) openTextEditor('description', issue);
                        else openTextEditor('description');
                      }}
                      className={`w-full px-3 py-2 text-sm rounded-md border ${descBorderClass} bg-background text-foreground cursor-pointer hover:border-primary/50 transition-colors min-h-[80px] whitespace-pre-wrap overflow-hidden`}
                      style={{ maxHeight: 200 }}
                    >
                      {descriptionValue || <span className="text-muted-foreground">Нет описания</span>}
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[11px] text-muted-foreground">{descriptionValue.length} символов</span>
                    </div>
                    {descIssues.map((issue) => {
                      const suggestedValue = issue.ai_suggested_value || issue.suggested_value || '';
                      return (
                        <div key={issue.id} ref={el => { expandedCardRefs.current[issue.id] = el; }} className={`mt-2 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs ${
                          issue.severity === 'critical' ? 'bg-[rgba(239,68,68,0.06)]' : 'bg-[rgba(234,179,8,0.06)]'
                        }`}>
                          <TriangleAlert className={`h-3 w-3 flex-shrink-0 ${issue.severity === 'critical' ? 'text-zone-red' : 'text-zone-yellow'}`} />
                          <span className="text-foreground flex-1 truncate">{issue.title}</span>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {suggestedValue && descriptionValue !== suggestedValue && (
                              <button onClick={() => openTextEditor('description', issue)} className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                                <Sparkles className="h-3 w-3" /> Предложить новое
                              </button>
                            )}
                            <button onClick={() => markIssue(issue.id, 'resolved')} className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Оставить текущее значение на Wildberries без изменений">
                              <BadgeCheck className="h-3 w-3" /> Оставить текущее
                            </button>
                            <button onClick={() => openDelegateDialog(issue)} className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Передать задачу другому сотруднику">
                              <Users className="h-3 w-3" /> Передать
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </div>
        )}
        {activeTab === 'sizes' && (
          <div className="space-y-2">
            {renderConfirmButton()}
            {activeTabIssues.length > 0 && activeTabIssues.map((issue) => renderIssueBlock(issue))}

            {sizeVariants.length === 0 && (
              <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                <Ruler className="h-5 w-5 mx-auto mb-2 opacity-50" />
                Размеры не указаны
              </div>
            )}

            {sizeVariants.map((sv, idx) => {
              const isExpanded = expandedSizeIndex === idx;
              const label = `Размер продавца ${sv.techSize}`;
              return (
                <div key={idx} className="rounded-lg border border-border bg-card overflow-hidden">
                  {/* Collapsed header */}
                  <button
                    onClick={() => setExpandedSizeIndex(isExpanded ? null : idx)}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{label}</span>
                      <span className="text-muted-foreground">· {sv.wbSize || sv.techSize}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSizeVariants(prev => prev.filter((_, i) => i !== idx));
                          if (expandedSizeIndex === idx) setExpandedSizeIndex(null);
                        }}
                        className="p-1.5 rounded-md text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 border-t border-border space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <span className="text-xs text-muted-foreground mb-1.5 block">Размер</span>
                          <input
                            value={sv.techSize}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSizeVariants(prev => prev.map((s, i) => i === idx ? { ...s, techSize: val } : s));
                            }}
                            className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground mb-1.5 block">Рос. размер</span>
                          <input
                            value={sv.wbSize}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSizeVariants(prev => prev.map((s, i) => i === idx ? { ...s, wbSize: val } : s));
                            }}
                            className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                          Баркоды <Zap className="h-3 w-3 text-primary" />
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {sv.skus.map((sku, skuIdx) => (
                            <Badge key={skuIdx} variant="secondary" className="text-xs font-mono px-2 py-1">
                              {sku}
                            </Badge>
                          ))}
                          {sv.skus.length === 0 && (
                            <span className="text-xs text-muted-foreground">Нет баркодов</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Bottom actions */}
            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => {
                  setSizeVariants(prev => [...prev, { techSize: '', wbSize: '', skus: [] }]);
                  setExpandedSizeIndex(sizeVariants.length);
                }}
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Добавить размер
              </Button>
            </div>
          </div>
        )}
        {activeTab === 'media' && (
          <div className="space-y-4">
            {renderConfirmButton()}




            <div
              className={`rounded-lg border-2 bg-card p-4 transition-colors ${fileDragOver ? 'border-primary border-dashed bg-primary/5' : 'border-border border-solid'}`}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('Files')) {
                  e.preventDefault();
                  setFileDragOver(true);
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setFileDragOver(false);
              }}
              onDrop={handleFileDrop}
            >
              {/* Header */}
              {(() => {
                const totalMedia = card.photos_count + card.videos_count;

                return (
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold">
                      <span>Фото и видео ({totalMedia})</span>
                    </h3>
                    <div className="flex items-center gap-2">
                      {mediaSyncing && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Синхронизация...
                        </span>
                      )}
                      <Button variant="outline" size="sm" className="text-xs" onClick={() => navigate(`/ab-tests?returnTo=${encodeURIComponent(`/workspace/cards/${cardId}?tab=${activeTab}`)}`)}>
                        <Layers className="h-3.5 w-3.5 mr-1" /> A/B тест
                      </Button>
                    </div>
                  </div>
                );
              })()}

              {!canSync && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 mb-3">
                  Редактирование фото доступно только пользователям с правом `cards.sync`. Видео сейчас доступны только для просмотра.
                </div>
              )}

              {/* Media issue banners */}
              {activeTabIssues.length > 0 && activeTabIssues.map((issue) => {
                const severity = issue.severity === 'critical' ? 'destructive' : 'warning';
                const borderColor = severity === 'destructive' ? 'border-destructive/40' : 'border-yellow-500/40';
                const bgColor = severity === 'destructive' ? 'bg-destructive/5' : 'bg-yellow-500/5';
                const textColor = severity === 'destructive' ? 'text-destructive' : 'text-yellow-700 dark:text-yellow-400';
                const iconColor = severity === 'destructive' ? 'text-destructive' : 'text-yellow-500';
                const isResolved = resolvedIssues[issue.id];
                if (isResolved) return null;

                return (
                  <div key={issue.id} className={`rounded-lg border ${borderColor} ${bgColor} p-3 mb-3`}>
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${iconColor}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-sm font-semibold ${textColor}`}>{issue.title}</span>
                          {(issue as any).rating_impact && (issue as any).rating_impact > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">+{(issue as any).rating_impact} к рейтингу</span>
                          )}
                        </div>
                        {issue.description && (
                          <p className="text-xs text-muted-foreground mb-2.5">{issue.description.replace(/^[a-z_]+:\s*/i, '')}</p>
                        )}
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => photoInputRef.current?.click()}
                            disabled={!canSync || mediaSyncing}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Upload className="h-3 w-3" /> Загрузить фото
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate(`/photo-studio?cardId=${card.id}&nmId=${card.nm_id}&returnTab=${activeTab}`)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          >
                            <Sparkles className="h-3 w-3" /> Сгенерировать фото
                          </button>
                          <button
                            type="button"
                            onClick={() => markIssue(issue.id, 'resolved')}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title="Оставить текущее значение на Wildberries без изменений"
                          >
                            <BadgeCheck className="h-3 w-3" /> Оставить как есть
                          </button>
                          <button
                            type="button"
                            onClick={() => setDelegateIssue(issue)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title="Передать задачу другому сотруднику"
                          >
                            <Send className="h-3 w-3" /> Передать
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {fileDragOver && (
                <div className="flex flex-col items-center justify-center py-8 text-primary mb-3">
                  <Upload className="h-10 w-10 mb-2 animate-bounce" />
                  <span className="text-sm font-medium">Перетащите фото сюда</span>
                </div>
              )}
              <div className={`grid grid-cols-4 gap-3 ${fileDragOver || mediaSyncing ? 'opacity-40 pointer-events-none' : ''}`}>
                {(card.videos || []).map((video, idx) => (
                  <div
                    key={`video-${idx}`}
                    className="group relative aspect-[3/4] rounded-lg overflow-hidden border-2 border-border hover:border-primary/50 bg-muted flex items-center justify-center transition-all cursor-pointer"
                    onClick={() => setVideoPlayerSrc(video)}
                  >
                    <video src={video} className="absolute inset-0 w-full h-full object-cover" muted preload="metadata" />
                    <div className="flex flex-col items-center gap-1 z-10">
                      <div className="h-12 w-12 rounded-full bg-foreground/70 text-background flex items-center justify-center">
                        <Video className="h-6 w-6" />
                      </div>
                    </div>
                    <span className="absolute bottom-0 inset-x-0 bg-foreground/60 text-background text-xs font-medium text-center py-1">Видео</span>
                  </div>
                ))}
                {(card.photos || []).map((photo, idx) => (
                  <button
                    key={`${photo}-${idx}`}
                    type="button"
                    draggable={canSync && !mediaSyncing}
                    onDragStart={(e) => {
                      if (!canSync || mediaSyncing) return;
                      setDragIdx(idx);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(e) => {
                      if (!canSync || mediaSyncing) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIdx === null || dragIdx === idx || !canSync || mediaSyncing) {
                        setDragIdx(null);
                        return;
                      }
                      const fromIndex = dragIdx;
                      setDragIdx(null);
                      void handlePhotoReorder(fromIndex, idx);
                    }}
                    onDragEnd={() => setDragIdx(null)}
                    onClick={() => setCoverIndex(idx)}
                    className={`group relative aspect-[3/4] rounded-lg overflow-hidden border-2 transition-all ${
                      canSync && !mediaSyncing ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                    } ${dragIdx === idx ? 'opacity-40 scale-95' : ''} ${coverIndex === idx ? 'border-primary' : 'border-border hover:border-primary/50'}`}
                  >
                    <img src={photo} alt="" className="w-full h-full object-cover pointer-events-none" />
                    {idx === 0 && <span className="absolute bottom-0 inset-x-0 bg-foreground/60 text-background text-xs font-medium text-center py-1">Обложка</span>}
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLightboxIndex(idx);
                        setPhotoLightbox(true);
                      }}
                      className="absolute top-1.5 left-1.5 bg-black/40 hover:bg-black/60 text-white rounded-lg p-1.5 transition-all cursor-pointer shadow-sm"
                    >
                      <SearchIcon className="h-4 w-4" />
                    </span>
                    {canSync && (
                      <span
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletePhotoTarget(idx);
                        }}
                        className="absolute top-1.5 right-1.5 bg-black/40 hover:bg-black/60 text-white rounded-lg p-1.5 transition-all cursor-pointer shadow-sm"
                      >
                        <X className="h-4 w-4" />
                      </span>
                    )}
                  </button>
                ))}
                {canSync && (
                  <button
                    type="button"
                    disabled={mediaSyncing}
                    onClick={() => photoInputRef.current?.click()}
                    className="aspect-[3/4] rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus className="h-6 w-6" />
                    <span className="text-xs leading-tight text-center px-1">Добавить<br/>фото</span>
                  </button>
                )}
              </div>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  void handlePhotoFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        )}
        {activeTab === 'package' && (
          <div className="space-y-4">
            {renderConfirmButton()}
            {activeTabIssues.length > 0 && activeTabIssues.map((issue) => renderIssueBlock(issue))}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Длина, см', key: 'length' as const },
                { label: 'Ширина, см', key: 'width' as const },
                { label: 'Высота, см', key: 'height' as const },
                { label: 'Вес с упаковкой, кг', key: 'weight' as const },
              ].map((f) => (
                <div key={f.key} className="rounded-lg border border-border bg-card p-3">
                  <span className="text-xs text-muted-foreground mb-1.5 block">{f.label}</span>
                  <input
                    value={dimensionsDraft[f.key]}
                    onChange={(e) => setDimensionsDraft((p) => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              ))}
              {/* Объём упаковки — авторасчёт */}
              <div className="rounded-lg border border-border bg-card p-3">
                <span className="text-xs text-muted-foreground mb-1.5 block">Объём упаковки, л</span>
                <input
                  readOnly
                  value={
                    (() => {
                      const l = parseFloat(dimensionsDraft.length);
                      const w = parseFloat(dimensionsDraft.width);
                      const h = parseFloat(dimensionsDraft.height);
                      if (!isNaN(l) && !isNaN(w) && !isNaN(h) && l > 0 && w > 0 && h > 0) {
                        return ((l * w * h) / 1000).toFixed(2);
                      }
                      return '—';
                    })()
                  }
                  className="w-full h-9 px-3 text-sm rounded-md border border-border bg-muted text-foreground cursor-default"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-card p-3">
                <span className="text-xs text-muted-foreground mb-1.5 block">Тип упаковки</span>
                <input value={packageDraft.type} onChange={(e) => setPackageDraft((p) => ({ ...p, type: e.target.value }))} className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <span className="text-xs text-muted-foreground mb-1.5 block">Комплектация</span>
                <input value={packageDraft.contents} onChange={(e) => setPackageDraft((p) => ({ ...p, contents: e.target.value }))} className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
            </div>
          </div>
        )}
        {activeTab === 'docs' && (
          <div className="space-y-3">
            {renderConfirmButton()}
            {(() => {
              const documentFieldIssues = activeTabIssues.filter((issue) => (issue.field_path || '').startsWith('characteristics.'));
              const otherIssues = activeTabIssues.filter((issue) => !documentFieldIssues.includes(issue));
              const needsDocumentReferenceWarning = documentSections.length > 0 && hasFixedFile !== true;

              return (
                <>
                  {otherIssues.length > 0 && otherIssues.map((issue) => renderIssueBlock(issue))}

                  {needsDocumentReferenceWarning && (
                    <div className="flex items-start gap-2 rounded-lg border border-zone-yellow/40 bg-zone-yellow/10 px-3 py-2.5 text-[13px]">
                      <AlertTriangle size={15} className="text-zone-yellow flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-zone-yellow">Не удалось получить эталонные значения для документов.</span>{' '}
                        <span className="text-muted-foreground">Проверьте и заполните документные поля вручную. Для точной сверки </span>
                        <button onClick={() => navigate('/workspace/fixed-file')} className="text-zone-yellow font-semibold hover:underline">
                          загрузите эталонный файл →
                        </button>
                      </div>
                    </div>
                  )}

                  {documentSections.length > 0 && (
                    <div className="space-y-4">
                      {documentSections.map((section) => {
                        const isCollapsed = collapsedSections[section.name];
                        return (
                          <div key={section.name}>
                            <button
                              onClick={() => toggleSection(section.name)}
                              className="flex items-center gap-2 w-full text-left py-2"
                            >
                              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                              <span className="text-sm font-semibold text-foreground">{section.name}</span>
                              {section.issues.length > 0 && (
                                <span className="min-w-[20px] h-5 rounded-full bg-zone-red text-[10px] font-semibold text-white flex items-center justify-center px-1.5">{section.issues.length}</span>
                              )}
                              <span className="flex-1" />
                              <span className="text-xs text-muted-foreground">{section.items.length}</span>
                            </button>

                            {!isCollapsed && (
                              <div className="grid grid-cols-2 gap-3 mt-1">
                                {section.items.map((item) => {
                                  const issue = getIssueForCharKey(item.key, 'docs');
                                  const isEmpty = !item.value?.trim();
                                  const isExpanded = issue ? expandedIssues[issue.id] : false;

                                  if (issue) {
                                    return renderCharCardWithIssue(item.key, item.value, issue, isExpanded);
                                  }

                                  const isNormalExpanded = expandedNormalChars[item.key];
                                  return renderNormalCharCard(item.key, item.value, isEmpty, isNormalExpanded);
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}
            <div className="rounded-lg border border-border bg-card p-4 flex items-center gap-2 text-sm text-muted-foreground">
              <FileCheck2 className="h-4 w-4" /> Сертификаты
            </div>
            <div className="rounded-lg border border-border bg-card p-4 flex items-center gap-2 text-sm text-muted-foreground">
              <PenLine className="h-4 w-4" /> Маркировка
            </div>
          </div>
        )}
        </div>

        {/* ── Right sidebar: Photo + Score ── */}
        <aside className="w-[200px] flex-shrink-0 sticky self-start" style={{ top: 'calc(var(--topbar-h, 57px) + 46px)' }}>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {currentPreviewPhoto ? (
              <img
                src={currentPreviewPhoto}
                alt={card.title || ''}
                className="w-full aspect-[3/4] object-cover cursor-zoom-in hover:opacity-90 transition-opacity"
                onClick={() => { setLightboxIndex(coverIndex); setPhotoLightbox(true); }}
              />
            ) : (
              <div className="w-full aspect-[3/4] bg-muted flex items-center justify-center">
                <Camera size={32} className="text-muted-foreground" />
              </div>
            )}
            <div className="p-3 border-t border-border">
              <p className="text-xs text-muted-foreground mb-1">Рейтинг карточки</p>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-primary">{cardScore}</span>
                <span className="text-sm text-muted-foreground">/100</span>
              </div>
              <div className="w-full h-2 rounded-full bg-muted mt-2 overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${cardScore}%` }} />
              </div>
              {potentialGain > 0 && (
                <p className="text-xs text-zone-green font-medium mt-1.5">Потенциал роста: +{potentialGain}</p>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* ── Delete Photo Confirmation ── */}
      <AlertDialog open={deletePhotoTarget !== null} onOpenChange={(open) => { if (!open) setDeletePhotoTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogDescription>
            Вы уверены, что хотите удалить это фото? Это действие нельзя отменить.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { void handlePhotoDelete(); }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={photoLightbox} onOpenChange={(open) => { setPhotoLightbox(open); if (!open) { setLightboxZoom(1); setLightboxPan({ x: 0, y: 0 }); } }}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] !p-0 !bg-transparent !border-none !shadow-none [&>button]:hidden"
          onKeyDown={(e) => {
            const allPhotos = card?.photos || [];
            if (e.key === 'ArrowLeft') { setLightboxIndex(i => Math.max(0, i - 1)); setLightboxZoom(1); setLightboxPan({ x: 0, y: 0 }); }
            if (e.key === 'ArrowRight') { setLightboxIndex(i => Math.min(allPhotos.length - 1, i + 1)); setLightboxZoom(1); setLightboxPan({ x: 0, y: 0 }); }
          }}
        >
          {(() => {
            const allPhotos = card?.photos || [];
            if (!allPhotos.length) return null;
            const safeIdx = Math.min(lightboxIndex, allPhotos.length - 1);
            return (
              <div
                className="relative flex items-center justify-center overflow-hidden select-none"
                onWheel={(e) => {
                  e.stopPropagation();
                  setLightboxZoom(z => {
                    const next = Math.min(5, Math.max(1, z + (e.deltaY < 0 ? 0.3 : -0.3)));
                    if (next <= 1) setLightboxPan({ x: 0, y: 0 });
                    return next;
                  });
                }}
                onMouseDown={(e) => {
                  if (lightboxZoom > 1) { lightboxDragging.current = true; lightboxLastPos.current = { x: e.clientX, y: e.clientY }; }
                }}
                onMouseMove={(e) => {
                  if (!lightboxDragging.current) return;
                  setLightboxPan(p => ({ x: p.x + e.clientX - lightboxLastPos.current.x, y: p.y + e.clientY - lightboxLastPos.current.y }));
                  lightboxLastPos.current = { x: e.clientX, y: e.clientY };
                }}
                onMouseUp={() => { lightboxDragging.current = false; }}
                onMouseLeave={() => { lightboxDragging.current = false; }}
              >
                <button
                  onClick={() => setPhotoLightbox(false)}
                  className="fixed top-4 right-4 z-[60] p-2.5 rounded-lg bg-white/20 hover:bg-white/40 text-white transition-all shadow-sm backdrop-blur-sm"
                >
                  <X size={24} />
                </button>
                {safeIdx > 0 && (
                  <button
                    onClick={() => { setLightboxIndex(i => i - 1); setLightboxZoom(1); setLightboxPan({ x: 0, y: 0 }); }}
                    className="fixed left-4 top-1/2 -translate-y-1/2 z-[60] p-2.5 rounded-lg bg-white/20 hover:bg-white/40 text-white transition-all shadow-sm backdrop-blur-sm"
                  >
                    <ChevronLeft size={28} />
                  </button>
                )}
                <img
                  src={allPhotos[safeIdx] || ''}
                  alt={card?.title || ''}
                  className="w-full h-full max-h-[85vh] object-contain rounded-lg transition-transform duration-150"
                  style={{ transform: `scale(${lightboxZoom}) translate(${lightboxPan.x / lightboxZoom}px, ${lightboxPan.y / lightboxZoom}px)`, cursor: lightboxZoom > 1 ? 'grab' : 'zoom-in' }}
                  draggable={false}
                  onDoubleClick={() => { setLightboxZoom(z => z > 1 ? 1 : 2.5); setLightboxPan({ x: 0, y: 0 }); }}
                />
                {safeIdx < allPhotos.length - 1 && (
                  <button
                    onClick={() => { setLightboxIndex(i => i + 1); setLightboxZoom(1); setLightboxPan({ x: 0, y: 0 }); }}
                    className="fixed right-4 top-1/2 -translate-y-1/2 z-[60] p-2.5 rounded-lg bg-white/20 hover:bg-white/40 text-white transition-all shadow-sm backdrop-blur-sm"
                  >
                    <ChevronRight size={28} />
                  </button>
                )}
                <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs bg-black/60 text-white px-3 py-1 rounded-full">
                  {safeIdx + 1} / {allPhotos.length}{lightboxZoom > 1 ? ` · ${Math.round(lightboxZoom * 100)}%` : ''}
                </span>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={!!videoPlayerSrc} onOpenChange={(open) => { if (!open) setVideoPlayerSrc(null); }}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] p-2 bg-card border-border flex items-center justify-center">
          {videoPlayerSrc && (
            <video
              src={videoPlayerSrc}
              controls
              autoPlay
              className="w-full max-h-[85vh] rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Text Editor Dialog */}
      <TextEditorDialog
        open={textEditorOpen}
        onOpenChange={setTextEditorOpen}
        fieldLabel={textEditorField === 'title' ? 'Название' : 'Описание'}
        currentValue={textEditorField === 'title' ? titleValue : descriptionValue}
        suggestedValue={textEditorIssue?.ai_suggested_value || textEditorIssue?.suggested_value || (textEditorField === 'title' ? titleValue : descriptionValue)}
        keywords={textEditorField === 'description' ? textEditorKeywords : []}
        forceRichLayout={textEditorField === 'description'}
        suggestionActionLabel={textEditorField === 'description' ? 'Сделать новое' : 'Вставить рекомендацию'}
        keywordsLoading={textEditorField === 'description' ? textEditorKeywordsLoading : false}
        onGenerate={textEditorField === 'description' ? handleDescriptionEditorGenerate : undefined}
        onApply={handleTextEditorApply}
      />

      {showDelegateDialog && (
        <>
          <div className="fixed inset-0 z-[60] bg-foreground/40 backdrop-blur-sm" onClick={() => { setShowDelegateDialog(false); setDelegateIssue(null); setSelectedDelegateIds(new Set()); }} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] bg-card border border-border rounded-xl shadow-xl min-w-[300px] max-w-[360px] p-5">
            <div className="flex justify-between items-center mb-3.5">
              <h3 className="text-[15px] font-semibold text-foreground">Передать задачу</h3>
              <button onClick={() => { setShowDelegateDialog(false); setDelegateIssue(null); setSelectedDelegateIds(new Set()); }} className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted">
                <X size={16} />
              </button>
            </div>
            {teamLoading ? (
              <div className="text-center py-5 text-sm text-muted-foreground">Загрузка...</div>
            ) : teamMembers.length === 0 ? (
              <div className="text-center py-5 text-sm text-muted-foreground">Нет доступных сотрудников</div>
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
                        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors w-full ${
                          isSelected ? 'bg-primary/5 border border-primary/20' : 'hover:bg-muted border border-transparent'
                        }`}
                      >
                        <Checkbox checked={isSelected} className="pointer-events-none" />
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
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
                  >
                    <Users size={14} /> Передать ({selectedDelegateIds.size})
                  </Button>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ── Review (На согласование) dialog ── */}
      {showReviewDialog && (
        <>
          <div className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm" onClick={() => setShowReviewDialog(false)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[51] bg-card border border-border rounded-xl shadow-xl min-w-[300px] max-w-[400px] p-5">
            <div className="flex justify-between items-center mb-3.5">
              <h3 className="text-[15px] font-semibold text-foreground">Отправить на согласование</h3>
              <button onClick={() => setShowReviewDialog(false)} className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted">
                <X size={16} />
              </button>
            </div>
            <div className="mb-3">
              <textarea
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                rows={2}
                placeholder="Комментарий (необязательно)..."
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground mb-2">Выберите проверяющих:</p>
            {reviewTeamLoading ? (
              <div className="text-center py-5 text-sm text-muted-foreground">Загрузка...</div>
            ) : reviewTeamMembers.length === 0 ? (
              <div className="text-center py-5 text-sm text-muted-foreground">Нет доступных сотрудников</div>
            ) : (
              <div className="flex flex-col gap-1 max-h-[240px] overflow-y-auto">
                {reviewTeamMembers.map(member => {
                  const isSelected = selectedReviewerIds.has(member.id);
                  return (
                    <button
                      key={member.id}
                      onClick={() => setSelectedReviewerIds(prev => {
                        const next = new Set(prev);
                        if (next.has(member.id)) next.delete(member.id);
                        else next.add(member.id);
                        return next;
                      })}
                      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors w-full ${isSelected ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted'}`}
                    >
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
                        style={{ background: `linear-gradient(135deg, hsl(${200 + (member.id % 40)} 70% 58%), hsl(${220 + (member.id % 30)} 65% 52%))` }}
                      >
                        {member.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                      </div>
                      <div className="flex flex-col gap-0.5 flex-1">
                        <span className="text-[13px] font-medium text-foreground">{member.name}</span>
                        <span className="text-[11px] text-muted-foreground">{member.role}</span>
                      </div>
                      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${isSelected ? 'bg-primary border-primary' : 'border-border'}`}>
                        {isSelected && <Check size={12} className="text-primary-foreground" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {selectedReviewerIds.size > 0 && (
              <Button
                size="sm"
                className="w-full mt-3 gap-1.5"
                onClick={() => handleSubmitForReview()}
              >
                <Send size={14} /> Отправить ({selectedReviewerIds.size})
              </Button>
            )}
          </div>
        </>
      )}

      {/* ── Unsaved changes confirmation ── */}
      <AlertDialog open={!!pendingCollapse} onOpenChange={(open) => { if (!open) setPendingCollapse(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Сохранить изменения?</AlertDialogTitle>
            <AlertDialogDescription>
              Вы изменили значение характеристики «{pendingCollapse?.charKey}». Сохранить введённые данные?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              if (!pendingCollapse) return;
              // Discard: reset chip state and collapse
              const key = pendingCollapse.charKey;
              setCharChipStates(prev => { const next = { ...prev }; delete next[key]; return next; });
              if (pendingCollapse.type === 'issue') {
                setExpandedIssues(prev => ({ ...prev, [pendingCollapse.id]: false }));
              } else {
                setExpandedNormalChars(prev => ({ ...prev, [key]: false }));
              }
              setPendingCollapse(null);
            }}>
              Отменить изменения
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (!pendingCollapse) return;
              const key = pendingCollapse.charKey;
              saveChipToDraft(key);
              // Don't collapse — keep the card expanded so user can continue working
              setPendingCollapse(null);
            }}>
              Сохранить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Confirm section with issues dialog ── */}
      <AlertDialog open={!!confirmDialogTab} onOpenChange={(open) => { if (!open) setConfirmDialogTab(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Подтвердить раздел с ошибками?</AlertDialogTitle>
            <AlertDialogDescription>
              В этом разделе {activeTabIssues.length} {activeTabIssues.length === 1 ? 'ошибка' : activeTabIssues.length < 5 ? 'ошибки' : 'ошибок'}, обнаруженных системой. 
              При подтверждении они будут сняты — система примет текущие значения как правильные.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDialogTab) {
                  confirmSection(confirmDialogTab);
                }
                setConfirmDialogTab(null);
              }}
            >
              Подтвердить и снять ошибки
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  // ─── Characteristic card with issue (chips, inline comparison, badges) ────

  function renderCharCardWithIssue(charKey: string, originalValue: string, issue: Issue, isExpanded: boolean) {
    const currentValue = characteristicsDraft[charKey] ?? originalValue;
    const suggestedValue = issueSuggestedValue(issue) || '';
    const source = issueSourceLabel(issue);
    const dirty = isCharDirty(charKey);

    // ── COLLAPSED (compact) state ──
    if (!isExpanded) {
      return (
        <div
          key={charKey}
          className={`rounded-lg border p-3 transition-colors ${
            issue.severity === 'critical' ? 'border-[rgba(239,68,68,0.5)] bg-[rgba(239,68,68,0.04)]' : 'border-[rgba(234,179,8,0.5)] bg-[rgba(234,179,8,0.04)]'
          }`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <TriangleAlert className={`h-3.5 w-3.5 flex-shrink-0 ${issue.severity === 'critical' ? 'text-zone-red' : 'text-zone-yellow'}`} />
              <span className="text-xs text-muted-foreground">{charKey}</span>
              {dirty && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" title="Изменено" />}
            </div>
            <button
              onClick={() => toggleIssueExpand(issue.id)}
              className="text-[11px] text-primary hover:underline flex-shrink-0"
            >
              Подробнее ∨
            </button>
          </div>
          <div
            onClick={() => {
              ensureChipStateInitialized(charKey, currentValue, issue);
              setExpandedIssues((p) => ({ ...p, [issue.id]: true }));
              setTimeout(() => {
                expandedCardRefs.current[issue.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 50);
            }}
            className="relative w-full h-9 px-3 flex items-center gap-2 text-sm rounded-md border border-border bg-background cursor-pointer hover:border-primary/50 transition-colors"
          >
            <span className="text-foreground truncate">{currentValue || '—'}</span>
            {suggestedValue && currentValue !== suggestedValue && (
              <>
                <ArrowRight size={12} className="text-muted-foreground opacity-50 flex-shrink-0" />
                <span className="text-primary font-medium truncate">{suggestedValue}</span>
              </>
            )}
          </div>
          {/* ── Quick actions in collapsed state ── */}
          <div className="flex items-center gap-1.5 mt-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleIssuePrimaryAction(issue, suggestedValue || null);
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              title={suggestedValue ? 'Будет применено рекомендуемое значение' : 'Открыть ручное исправление'}
            >
              <Sparkles className="h-3 w-3" /> {suggestedValue ? 'Применить' : 'Исправить вручную'}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); markIssue(issue.id, 'resolved'); }}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Оставить текущее значение на Wildberries без изменений"
            >
              <BadgeCheck className="h-3 w-3" /> Оставить текущее
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); openDelegateDialog(issue); }}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Передать задачу другому сотруднику — будет создан тикет во входящих"
            >
              <Users className="h-3 w-3" /> Передать
            </button>
          </div>
        </div>
      );
    }

    // ── EXPANDED state — full detail view ──
    // Read chip state; if not yet initialized, compute inline fallback from current value (no setState during render)
    const chipState = charChipStates[charKey] || (() => {
      const vals = issueSuggestedChipValues(issue, currentValue);
      return { selectedValues: vals, showDropdown: false, searchTerm: '' } as CharChipState;
    })();
    const currentParts = currentValue ? currentValue.split(/[;,]\s*/).filter(Boolean) : [];
    const recommendation = issueRecommendation(issue);
    const alternatives = [
      ...(issue.ai_alternatives || []),
      ...(issue.alternatives || []),
    ].filter((s, i, arr) => s?.trim() && arr.indexOf(s) === i);
    const allSuggestions = suggestedValue ? [suggestedValue, ...alternatives.filter(a => a !== suggestedValue)] : alternatives;
    const maxCount = issue.max_count || (issue.allowed_values && issue.allowed_values.length > 0 ? issue.allowed_values.length : null);
    const isAtLimit = maxCount !== null && chipState.selectedValues.length >= maxCount;

    const isFixedFileSource = issue.source === 'fixed_file';
    const needsFixedFileWarning = !isFixedFileSource && hasFixedFile !== true && (
      (issue as any).requires_fixed_file ||
      issue.field_path?.toLowerCase().includes('состав') ||
      issue.title?.toLowerCase().includes('состав')
    );

    return (
      <div
        ref={el => { expandedCardRefs.current[issue.id] = el; }}
        key={charKey}
        className={`rounded-lg border p-3 transition-colors col-span-2 ${
          issue.severity === 'critical' ? 'border-[rgba(239,68,68,0.5)] bg-[rgba(239,68,68,0.04)]' : 'border-[rgba(234,179,8,0.5)] bg-[rgba(234,179,8,0.04)]'
        }`}
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[14px] font-semibold ${issue.severity === 'critical' ? 'text-zone-red' : 'text-zone-yellow'}`}>
                {issueCategoryLabel(issue)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <TriangleAlert className={`h-3.5 w-3.5 flex-shrink-0 ${issue.severity === 'critical' ? 'text-zone-red' : 'text-zone-yellow'}`} />
              <span className="text-sm font-medium text-foreground">{charKey}</span>
              {issue.score_impact > 0 && (
                <Badge variant="secondary" className="text-[10px] h-5 flex-shrink-0">+{issue.score_impact} к рейтингу</Badge>
              )}
            </div>
          </div>
          <button
            onClick={() => { clearChipState(charKey); toggleIssueExpand(issue.id); }}
            className="text-[11px] text-primary hover:underline flex-shrink-0"
          >
            Скрыть ∧
          </button>
        </div>

        {/* ── Source ── */}
        {source && (
          <div className="flex items-center gap-1.5 mb-2 text-[11px] text-muted-foreground">
            <Bot size={12} className="opacity-50" />
            Источник: {source}
          </div>
        )}

        {/* ── Fixed file badges ── */}
        {isFixedFileSource && (
          <div className="flex items-center gap-2 mb-2 text-[12px] rounded-md bg-zone-green/10 border border-zone-green/30 px-3 py-1.5">
            <FileCheck size={13} className="text-zone-green" />
            <span className="font-semibold text-zone-green">Эталонный файл</span>
            <span className="text-muted-foreground">— значение из загруженного файла</span>
          </div>
        )}
        {needsFixedFileWarning && (
          <div className="flex items-start gap-2 mb-2 text-[12px] rounded-md bg-zone-yellow/10 border border-zone-yellow/40 px-3 py-2">
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

        {/* ── Inline comparison: Current → Suggested (chips) ── */}
        <div className="flex items-stretch gap-2 mb-2">
          {/* Current value */}
          <div className="flex-1 rounded-md border border-border bg-background p-2.5 min-h-[42px]">
            <div className="text-[10px] text-muted-foreground mb-1.5 opacity-70">Текущее значение</div>
            <div className="flex flex-wrap gap-1.5">
              {currentParts.length > 0 ? currentParts.map((val, i) => (
                <span key={i} className="inline-flex items-center bg-muted border border-border rounded-md px-2.5 py-1 text-[13px] font-medium text-foreground whitespace-nowrap">
                  {val}
                </span>
              )) : (
                <span className="text-[13px] text-muted-foreground">—</span>
              )}
            </div>
          </div>

          <div className="flex items-center justify-center px-1">
            <ArrowRight size={18} className="text-muted-foreground opacity-50" />
          </div>

          {/* Proposed value (editable chips) */}
          <div
            ref={(el) => { charDropdownRefs.current[charKey] = el; }}
            onClick={() => {
              if (!chipState.showDropdown) {
                updateChipState(charKey, s => ({ ...s, showDropdown: true }));
              }
            }}
            className={`flex-1 rounded-md border p-2.5 min-h-[42px] cursor-pointer relative transition-colors ${
              chipState.showDropdown ? 'border-primary bg-primary/5' : 'border-border bg-background'
            }`}
          >
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1.5 opacity-70">
              <span>Предлагаемое исправление</span>
              {maxCount !== null && (
                <span className={`${isAtLimit ? 'text-destructive font-semibold' : ''}`}>
                  {chipState.selectedValues.length}/{maxCount}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 items-center">
              {chipState.selectedValues.map((val, vidx) => (
                <span key={vidx} className="inline-flex items-center gap-1 bg-muted border border-border rounded-md px-2.5 py-1 text-[13px] font-medium text-foreground whitespace-nowrap">
                  <span className="max-w-[180px] overflow-hidden text-ellipsis">{val}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      updateChipState(charKey, s => ({ ...s, selectedValues: s.selectedValues.filter((_, i) => i !== vidx) }));
                    }}
                    className="flex items-center text-muted-foreground hover:text-foreground"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              {chipState.showDropdown && (
                <input
                  type="text"
                  autoFocus
                  value={chipState.searchTerm}
                  onChange={(e) => updateChipState(charKey, s => ({ ...s, searchTerm: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') updateChipState(charKey, s => ({ ...s, showDropdown: false }));
                    if (e.key === 'Enter' && chipState.searchTerm.trim() && !isAtLimit) {
                      updateChipState(charKey, s => ({ ...s, selectedValues: [...s.selectedValues, s.searchTerm.trim()], searchTerm: '' }));
                    }
                    if (e.key === 'Backspace' && !chipState.searchTerm && chipState.selectedValues.length > 0) {
                      updateChipState(charKey, s => ({ ...s, selectedValues: s.selectedValues.slice(0, -1) }));
                    }
                  }}
                  placeholder={chipState.selectedValues.length === 0 ? 'выберите или введите...' : ''}
                  className="flex-1 min-w-[80px] border-none outline-none bg-transparent text-xs text-foreground p-0"
                />
              )}
              {!chipState.showDropdown && chipState.selectedValues.length === 0 && (
                <span className="text-xs text-muted-foreground">нажмите для выбора...</span>
              )}
            </div>

            {/* Dropdown */}
            {chipState.showDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 border border-border rounded-lg bg-card shadow-lg z-50 flex flex-col">
                {/* Sticky confirm button at top of dropdown */}
                {chipState.selectedValues.length > 0 && (
                  <div className="border-b border-border px-3 py-2 bg-card rounded-t-lg">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        updateChipState(charKey, s => ({ ...s, searchTerm: '', showDropdown: false }));
                      }}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      <Check className="h-3 w-3" /> Готово
                    </button>
                  </div>
                )}
                <div className="max-h-[200px] overflow-y-auto">
                {allSuggestions.length > 0 && (
                  <div className="border-b border-border">
                    <div className="px-3 pt-2 pb-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Рекомендации</div>
                    {allSuggestions.map((alt, aidx) => {
                      const isSelected = chipState.selectedValues.includes(alt);
                      return (
                        <div
                          key={aidx}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isSelected) {
                              updateChipState(charKey, s => ({ ...s, selectedValues: s.selectedValues.filter(v => v !== alt) }));
                            } else if (!isAtLimit) {
                              updateChipState(charKey, s => ({ ...s, selectedValues: [...s.selectedValues, alt], searchTerm: '' }));
                            }
                          }}
                          className={`px-3 py-2 text-[13px] cursor-pointer flex items-center gap-1.5 transition-colors ${
                            isSelected ? 'bg-accent' : 'hover:bg-muted'
                          } ${aidx === 0 && !isSelected ? 'text-primary font-semibold' : ''}`}
                        >
                          {aidx === 0 && <Bot size={13} />}
                          <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{alt}</span>
                          {isSelected && <Check size={13} className="flex-shrink-0 text-primary" />}
                        </div>
                      );
                    })}
                  </div>
                )}
                {issue.allowed_values && issue.allowed_values.length > 0 && (() => {
                  const searchTerm = chipState.searchTerm || '';
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
                        const isSelected = chipState.selectedValues.includes(val);
                        return (
                          <div
                            key={i}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isSelected) {
                                updateChipState(charKey, s => ({ ...s, selectedValues: s.selectedValues.filter(sv => sv !== val) }));
                              } else if (!isAtLimit) {
                                updateChipState(charKey, s => ({ ...s, selectedValues: [...s.selectedValues, val], searchTerm: '' }));
                              }
                            }}
                            className={`px-3 py-2 text-[13px] cursor-pointer flex items-center justify-between transition-colors ${
                              isSelected ? 'bg-accent font-medium' : 'hover:bg-muted'
                            }`}
                          >
                            <span>{val}</span>
                            {isSelected && <Check size={13} className="flex-shrink-0 text-primary" />}
                          </div>
                        );
                      })}
                      {filtered.length > 50 && (
                        <div className="px-3 py-1.5 text-[11px] text-muted-foreground">
                          +{filtered.length - 50} ещё — уточните запрос
                        </div>
                      )}
                    </>
                  );
                })()}
                </div>
              </div>
            )}

            {!chipState.showDropdown && (
              <div
                onClick={(e) => { e.stopPropagation(); updateChipState(charKey, s => ({ ...s, showDropdown: true })); }}
                className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer opacity-70 hover:opacity-100"
              >
                <Pencil size={10} />
                <span>ввести своё значение</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Recommendation ── */}
        {recommendation && (
          <div className="flex items-center gap-1.5 mb-2 text-[12px]">
            <Sparkles size={12} className="text-primary" />
            <span className="text-muted-foreground">Рекомендация:</span>
            <span className="font-medium text-foreground">{recommendation}</span>
          </div>
        )}

        {/* ── Issue details ── */}
        <div className="mt-2 pt-2 border-t border-border text-xs space-y-1.5">
          {issue.description && (
            <div className={`rounded-md px-3 py-2 text-xs ${
              issue.severity === 'critical' ? 'bg-[rgba(239,68,68,0.06)]' : 'bg-[rgba(234,179,8,0.06)]'
            }`}>
              <p className="text-[11px] text-muted-foreground/70 mb-1">Причина</p>
              <p className="font-medium text-foreground">{issue.description.replace(/^[a-z_]+:\s*/i, '')}</p>
            </div>
          )}
          {issue.field_path && (
            <p className="text-muted-foreground">Влияет на: <span className="font-mono text-foreground">{issue.field_path}</span></p>
          )}
        </div>

        {/* ── Action buttons ── */}
        <div className="flex items-center gap-2 mt-2.5" onMouseDown={(e) => e.stopPropagation()}>
          <button
            onClick={() => {
              const latestChipState = charChipStatesRef.current[charKey] || chipState;
              const committedValues = getCommittedChipValues(latestChipState);
              const value = committedValues.join(', ');
              updateChipState(charKey, s => ({ ...s, selectedValues: committedValues, searchTerm: '' }));
              if (value) applyInlineFix(issue, value);
              else toast.error('Выберите значение вручную или оставьте текущее отдельно.');
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Sparkles className="h-3 w-3" /> Применить
          </button>
          <button
            onClick={() => markIssue(issue.id, 'resolved')}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Оставить текущее значение на Wildberries без изменений"
          >
            <BadgeCheck className="h-3 w-3" /> Оставить текущее
          </button>
          <button
            onClick={() => openDelegateDialog(issue)}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Передать задачу другому сотруднику — будет создан тикет во входящих"
          >
            <Users className="h-3 w-3" /> Передать
          </button>
        </div>
      </div>
    );
  }

  // ─── Shared issue block for non-characteristics tabs (enhanced) ────────────

  // ─── Normal characteristic card (expandable with chip editor) ─────────────

  function renderNormalCharCard(charKey: string, originalValue: string, isEmpty: boolean, isExpanded: boolean) {
    const currentValue = characteristicsDraft[charKey] ?? originalValue;
    const dirty = isCharDirty(charKey);
    if (!isExpanded) {
      // Collapsed — looks like a normal field, click to expand
      return (
        <div
          key={charKey}
          onClick={() => {
            ensureChipStateInitialized(charKey, currentValue);
            setExpandedNormalChars(p => ({ ...p, [charKey]: true }));
            // Auto-open chip dropdown
            updateChipState(charKey, s => ({ ...s, showDropdown: true }));
          }}
          className={`rounded-lg border bg-card p-3 transition-colors cursor-pointer hover:border-primary/40 ${dirty ? 'border-primary/40' : 'border-border'}`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{charKey}</span>
              {dirty && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" title="Изменено" />}
            </div>
          </div>
          <div className="relative">
            <div className="w-full h-9 px-3 pr-8 text-sm rounded-md border border-border bg-background text-foreground flex items-center">
              {isEmpty ? <span className="text-muted-foreground">Не заполнено</span> : <span className="truncate">{currentValue}</span>}
            </div>
            {!isEmpty && (
              <Check className="h-4 w-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-zone-green" />
            )}
          </div>
        </div>
      );
    }

    // Read chip state; if not yet initialized, compute inline fallback (no setState during render)
    const chipState = charChipStates[charKey] || (() => {
      const vals = currentValue.split(/[;,]\s*/).map(s => s.trim()).filter(Boolean);
      return { selectedValues: vals, showDropdown: false, searchTerm: '' } as CharChipState;
    })();
    const currentParts = currentValue ? currentValue.split(/[;,]\s*/).filter(Boolean) : [];

    return (
      <div
        key={charKey}
        ref={el => { normalCharRefs.current[charKey] = el; }}
        className="rounded-lg border border-primary/40 bg-card p-3 transition-colors col-span-2"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-foreground">{charKey}</span>
          <button
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              clearChipState(charKey);
              setExpandedNormalChars(p => ({ ...p, [charKey]: false }));
            }}
            className="text-[11px] text-primary hover:underline flex-shrink-0 cursor-pointer"
          >
            Свернуть ∧
          </button>
        </div>

        {/* Chip editor */}
        <div
          ref={(el) => { charDropdownRefs.current[charKey] = el; }}
          onClick={() => {
            if (!chipState.showDropdown) {
              updateChipState(charKey, s => ({ ...s, showDropdown: true }));
            }
          }}
          className={`rounded-md border p-2.5 min-h-[42px] cursor-pointer relative transition-colors ${
            chipState.showDropdown ? 'border-primary bg-primary/5' : 'border-border bg-background'
          }`}
        >
          <div className="flex flex-wrap gap-1.5 items-center">
            {chipState.selectedValues.map((val, vidx) => (
              <span key={vidx} className="inline-flex items-center gap-1 bg-muted border border-border rounded-md px-2.5 py-1 text-[13px] font-medium text-foreground whitespace-nowrap">
                <span className="max-w-[180px] overflow-hidden text-ellipsis">{val}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    updateChipState(charKey, s => ({ ...s, selectedValues: s.selectedValues.filter((_, i) => i !== vidx) }));
                  }}
                  className="flex items-center text-muted-foreground hover:text-foreground"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            {chipState.showDropdown && (
              <input
                type="text"
                autoFocus
                value={chipState.searchTerm}
                onChange={(e) => updateChipState(charKey, s => ({ ...s, searchTerm: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') updateChipState(charKey, s => ({ ...s, showDropdown: false }));
                  if (e.key === 'Enter' && chipState.searchTerm.trim()) {
                    updateChipState(charKey, s => ({ ...s, selectedValues: [...s.selectedValues, s.searchTerm.trim()], searchTerm: '' }));
                  }
                  if (e.key === 'Backspace' && !chipState.searchTerm && chipState.selectedValues.length > 0) {
                    updateChipState(charKey, s => ({ ...s, selectedValues: s.selectedValues.slice(0, -1) }));
                  }
                }}
                placeholder={chipState.selectedValues.length === 0 ? 'введите значение...' : ''}
                className="flex-1 min-w-[80px] border-none outline-none bg-transparent text-xs text-foreground p-0"
              />
            )}
            {!chipState.showDropdown && chipState.selectedValues.length === 0 && (
              <span className="text-xs text-muted-foreground">нажмите для ввода...</span>
            )}
          </div>

          {!chipState.showDropdown && (
            <div
              onClick={(e) => { e.stopPropagation(); updateChipState(charKey, s => ({ ...s, showDropdown: true })); }}
              className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer opacity-70 hover:opacity-100"
            >
              <Pencil size={10} />
              <span>ввести своё значение</span>
            </div>
          )}
        </div>

        {/* Save button */}
        <div className="flex items-center gap-2 mt-2" onMouseDown={(e) => e.stopPropagation()}>
          <button
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              const latestChipState = charChipStatesRef.current[charKey] || chipState;
              const committedValues = getCommittedChipValues(latestChipState);
              const value = committedValues.join(', ');
              setCharacteristicsDraft(p => ({ ...p, [charKey]: value }));
              clearChipState(charKey);
              setExpandedNormalChars(p => ({ ...p, [charKey]: false }));
              toast.success(`«${charKey}» обновлено`);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
          >
            <Check className="h-3 w-3" /> Сохранить
          </button>
          <button
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              clearChipState(charKey);
              setExpandedNormalChars(p => ({ ...p, [charKey]: false }));
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            Отмена
          </button>
        </div>
      </div>
    );
  }

  function renderIssueBlock(issue: Issue) {
    const isExpanded = expandedIssues[issue.id];
    const source = issueSourceLabel(issue);
    const recommendation = issueRecommendation(issue);
    const isFixedFileSource = issue.source === 'fixed_file';
    const needsFixedFileWarning = !isFixedFileSource && hasFixedFile !== true && (
      (issue as any).requires_fixed_file ||
      issue.field_path?.toLowerCase().includes('состав') ||
      issue.title?.toLowerCase().includes('состав')
    );

    return (
      <div key={issue.id} ref={el => { expandedCardRefs.current[issue.id] = el; }} className={`rounded-lg border p-4 mb-3 ${
        issue.severity === 'critical' ? 'border-zone-red/40 bg-zone-red/5' : 'border-zone-yellow/50 bg-zone-yellow/5'
      }`}>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            {/* Category */}
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`text-[14px] font-semibold ${issue.severity === 'critical' ? 'text-zone-red' : 'text-zone-yellow'}`}>
                {issueCategoryLabel(issue)}
              </span>
            </div>
            {/* Title + rating badge */}
            <div className="flex items-center gap-2">
              <TriangleAlert className={`h-3.5 w-3.5 flex-shrink-0 ${issue.severity === 'critical' ? 'text-zone-red' : 'text-zone-yellow'}`} />
              <p className="text-sm font-medium text-foreground">{issue.title}</p>
              {issue.score_impact > 0 && (
                <Badge variant="secondary" className="text-[10px] h-5 flex-shrink-0">+{issue.score_impact} к рейтингу</Badge>
              )}
            </div>
            {/* Brief description */}
            {issue.description && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{issue.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => toggleIssueExpand(issue.id)} className="text-[11px] text-primary hover:underline">
              {isExpanded ? 'Скрыть ∧' : 'Подробнее ∨'}
            </button>
          </div>
        </div>

        {/* Source label */}
        {source && (
          <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-muted-foreground">
            <Bot size={12} className="opacity-50" />
            Источник: {source}
          </div>
        )}

        {/* Recommendation */}
        {recommendation && (
          <div className="flex items-center gap-1.5 mt-1.5 text-[12px]">
            <Sparkles size={12} className="text-primary" />
            <span className="text-muted-foreground">Рекомендация:</span>
            <span className="font-medium text-foreground">{recommendation}</span>
          </div>
        )}

        {/* Fixed file badges */}
        {isFixedFileSource && (
          <div className="flex items-center gap-2 mt-2 text-[12px] rounded-md bg-zone-green/10 border border-zone-green/30 px-3 py-1.5">
            <FileCheck size={13} className="text-zone-green" />
            <span className="font-semibold text-zone-green">Эталонный файл</span>
            <span className="text-muted-foreground">— значение из загруженного файла</span>
          </div>
        )}
        {needsFixedFileWarning && (
          <div className="flex items-start gap-2 mt-2 text-[12px] rounded-md bg-zone-yellow/10 border border-zone-yellow/40 px-3 py-2">
            <AlertTriangle size={14} className="text-zone-yellow flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-zone-yellow">Поле берётся из эталонного файла.</span>{' '}
              <button onClick={() => navigate('/workspace/fixed-file')} className="text-zone-yellow font-semibold hover:underline">
                Загрузить файл →
              </button>
            </div>
          </div>
        )}

        {isExpanded && (
          <div className="mt-2 pt-2 border-t border-border text-xs space-y-1.5 text-muted-foreground">
            {issue.description && (
              <div className={`rounded-md px-3 py-2 ${
                issue.severity === 'critical' ? 'bg-[rgba(239,68,68,0.06)]' : 'bg-[rgba(234,179,8,0.06)]'
              }`}>
              <p className="text-[11px] text-muted-foreground/70 mb-1">Причина</p>
                <p className="font-medium text-foreground">{issue.description.replace(/^[a-z_]+:\s*/i, '')}</p>
              </div>
            )}
            {issue.field_path && <p>Влияет на: <span className="font-mono text-foreground">{issue.field_path}</span></p>}
          </div>
        )}

        <div className="flex items-center gap-2 mt-2">
          <button onClick={() => {
            handleIssuePrimaryAction(issue);
          }} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            <Sparkles className="h-3 w-3" /> {issueSuggestedValue(issue) ? 'Применить' : 'Исправить вручную'}
          </button>
          <button onClick={() => markIssue(issue.id, 'resolved')} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Оставить текущее значение на Wildberries без изменений">
            <BadgeCheck className="h-3 w-3" /> Оставить текущее
          </button>
          <button onClick={() => openDelegateDialog(issue)} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Передать задачу другому сотруднику — будет создан тикет во входящих">
            <Users className="h-3 w-3" /> Передать
          </button>
        </div>
      </div>
    );
  }
}
