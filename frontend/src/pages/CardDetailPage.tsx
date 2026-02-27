import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import { trackAction } from '../hooks/useActivityTracker';
import {
  ArrowLeft,
  BadgeCheck,
  Bot,
  Box,
  Camera,
  CircleCheck,
  ClipboardList,
  Clock,
  FileCheck2,
  FileText,
  FolderOpen,
  Globe,
  Image,
  Layers,
  PenLine,
  Ruler,
  Save,
  Search as SearchIcon,
  Send,
  Shield,
  Sparkles,
  Tag,
  Video,
  X,
  ChevronDown as ChevronDownIcon,
  Check,
  RefreshCw,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CardDetail, Issue } from '../types';

type TabKey = 'basic' | 'description' | 'characteristics' | 'sizes' | 'media' | 'package' | 'docs';

type ResolveState = 'resolved' | 'postponed';

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

interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
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

function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function mapIssueToTab(issue: Issue): TabKey {
  const category = (issue.category || '').toLowerCase();
  const path = (issue.field_path || '').toLowerCase();

  // field_path takes priority — characteristics.* issues belong in Характеристики
  // even if detected via photo analysis (ai_photo, ai_mixed)
  if (path.startsWith('characteristics.') || path === 'characteristics') {
    return 'characteristics';
  }
  if (path.startsWith('dimensions') || category === 'size' || category === 'sizes') {
    return 'sizes';
  }
  if (path.startsWith('documents') || category === 'documents' || category === 'certificates') {
    return 'docs';
  }
  if (path.startsWith('package') || category === 'packaging') {
    return 'package';
  }
  if (path === 'title' || path === 'description' || category === 'title' || category === 'description' || category === 'seo') {
    return 'description';
  }
  if (category === 'photos' || category === 'video' || path.startsWith('photos') || path.startsWith('videos')) {
    return 'media';
  }
  return 'basic';
}

function issueSeverityRank(severity: string): number {
  if (severity === 'critical') return 0;
  if (severity === 'warning') return 1;
  if (severity === 'improvement') return 2;
  return 3;
}

function issueSeverityLabel(severity: string): string {
  if (severity === 'critical') return 'Критично';
  if (severity === 'warning') return 'Предупреждение';
  if (severity === 'improvement') return 'Улучшение';
  return 'Инфо';
}

function issueDefaultSuggestion(issue: Issue): string {
  return issue.ai_suggested_value || issue.suggested_value || issue.current_value || '';
}

export default function CardDetailPage() {
  const { cardId } = useParams<{ cardId: string }>();
  const navigate = useNavigate();
  const { activeStore } = useStore();
  const { hasPermission } = useAuth();

  const [card, setCard] = useState<CardDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<TabKey>('basic');
  const [activeIssueId, setActiveIssueId] = useState<number | null>(null);
  const [resolvedIssues, setResolvedIssues] = useState<Record<number, ResolveState>>({});

  const [titleValue, setTitleValue] = useState('');
  const [descriptionValue, setDescriptionValue] = useState('');
  const [characteristicsDraft, setCharacteristicsDraft] = useState<Record<string, string>>({});
  const [dimensionsDraft, setDimensionsDraft] = useState<DimensionsDraft>({ length: '', width: '', height: '', weight: '' });
  const [packageDraft, setPackageDraft] = useState<PackageDraft>({ type: '', contents: '' });

  const [coverIndex, setCoverIndex] = useState(0);

  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);

  const [aiFixIssue, setAiFixIssue] = useState<Issue | null>(null);
  const [aiFixLoading, setAiFixLoading] = useState(false);
  const [aiFixDraft, setAiFixDraft] = useState('');

  const [saveStamp, setSaveStamp] = useState<string | null>(null);

  // Characteristics tab state
  const [charSearch, setCharSearch] = useState('');
  const [charFilter, setCharFilter] = useState<'all' | 'issues' | 'empty'>('all');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (activeStore && cardId) {
      void loadCard();
    }
  }, [activeStore, cardId]);

  const loadCard = async () => {
    if (!activeStore || !cardId) return;

    setLoading(true);
    try {
      const data = await api.getCard(activeStore.id, Number(cardId));
      setCard(data);
      hydrateDrafts(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const hydrateDrafts = (data: CardDetail) => {
    setTitleValue(data.title || '');
    setDescriptionValue(data.description || '');

    const nextCharacteristics: Record<string, string> = {};
    Object.entries(data.characteristics || {}).forEach(([key, value]) => {
      nextCharacteristics[key] = toText(value);
    });
    setCharacteristicsDraft(nextCharacteristics);

    const dimensions = (data.dimensions || {}) as Record<string, unknown>;
    setDimensionsDraft({
      length: toText(dimensions.length),
      width: toText(dimensions.width),
      height: toText(dimensions.height),
      weight: toText(dimensions.weight),
    });

    const raw = (data.raw_data || {}) as Record<string, unknown>;
    setPackageDraft({
      type: toText(raw.package_type) || 'Коробка',
      contents: toText(raw.complectation) || '',
    });

    setActiveTab('basic');
    setActiveIssueId(null);
    setResolvedIssues({});
    setCoverIndex(0);
    setAiMessages([]);
    setAiPanelOpen(false);
    setSaveStamp(null);
  };

  const pendingIssues = useMemo(() => {
    if (!card) return [];
    return card.issues
      .filter((issue) => issue.status === 'pending')
      .sort((a, b) => issueSeverityRank(a.severity) - issueSeverityRank(b.severity));
  }, [card]);

  const unresolvedIssues = useMemo(
    () => pendingIssues.filter((issue) => !resolvedIssues[issue.id]),
    [pendingIssues, resolvedIssues],
  );

  const issuesByTab = useMemo(() => {
    const grouped: Record<TabKey, Issue[]> = {
      basic: [],
      description: [],
      characteristics: [],
      sizes: [],
      media: [],
      package: [],
      docs: [],
    };

    unresolvedIssues.forEach((issue) => {
      const tab = mapIssueToTab(issue);
      grouped[tab].push(issue);
    });

    return grouped;
  }, [unresolvedIssues]);

  const activeTabIssues = issuesByTab[activeTab] || [];

  const cardScore = card?.score || 0;
  const scoreColor = cardScore >= 75 ? '#16A34A' : cardScore >= 55 ? '#F59E0B' : '#EF4444';
  const potentialGain = unresolvedIssues.reduce((acc, issue) => acc + (issue.score_impact || 0), 0);

  const currentPreviewPhoto = useMemo(() => {
    if (!card?.photos?.length) return null;
    return card.photos[Math.max(0, Math.min(coverIndex, card.photos.length - 1))] || card.photos[0];
  }, [card, coverIndex]);

  // Group characteristics into sections
  const characteristicSections = useMemo(() => {
    const entries = Object.entries(characteristicsDraft);
    const charIssues = issuesByTab.characteristics || [];

    // Keyword-based grouping
    const sectionDefs: Array<{ name: string; keywords: string[] }> = [
      { name: 'Основные характеристики', keywords: ['бренд', 'артикул', 'модель', 'тип', 'назначение', 'страна', 'размер', 'вес', 'пол', 'возраст', 'сезон', 'коллекция', 'комплект', 'гарантия'] },
      { name: 'Дизайн и внешний вид', keywords: ['цвет', 'оттенок', 'рисунок', 'узор', 'принт', 'декор', 'стиль', 'форма', 'покрой', 'силуэт', 'фасон', 'длина', 'вырез'] },
      { name: 'Материалы', keywords: ['материал', 'состав', 'ткань', 'подкладка', 'наполнитель', 'утеплитель', 'волокно', 'хлопок', 'полиэстер', 'кожа'] },
    ];

    const sections: Array<{
      name: string;
      items: Array<{ key: string; value: string }>;
      issues: Issue[];
    }> = [];

    const usedKeys = new Set<string>();

    for (const def of sectionDefs) {
      const items: Array<{ key: string; value: string }> = [];
      for (const [key, value] of entries) {
        const lk = key.toLowerCase();
        if (def.keywords.some((kw) => lk.includes(kw))) {
          items.push({ key, value });
          usedKeys.add(key);
        }
      }
      const sectionIssues = charIssues.filter((issue) => {
        const fp = (issue.field_path || '').replace('characteristics.', '');
        return items.some((item) => item.key === fp);
      });
      if (items.length > 0) {
        sections.push({ name: def.name, items, issues: sectionIssues });
      }
    }

    // Remaining items go to "Прочие характеристики"
    const remaining: Array<{ key: string; value: string }> = [];
    for (const [key, value] of entries) {
      if (!usedKeys.has(key)) {
        remaining.push({ key, value });
      }
    }
    if (remaining.length > 0) {
      const remainingIssues = charIssues.filter((issue) => {
        const fp = (issue.field_path || '').replace('characteristics.', '');
        return remaining.some((item) => item.key === fp);
      });
      sections.push({ name: 'Прочие характеристики', items: remaining, issues: remainingIssues });
    }

    return sections;
  }, [characteristicsDraft, issuesByTab.characteristics]);

  const toggleSection = (sectionName: string) => {
    setCollapsedSections((prev) => ({ ...prev, [sectionName]: !prev[sectionName] }));
  };

  const openIssue = (issue: Issue) => {
    setActiveIssueId(issue.id);
    setActiveTab(mapIssueToTab(issue));
  };

  const markIssue = (issueId: number, state: ResolveState) => {
    setResolvedIssues((prev) => ({ ...prev, [issueId]: state }));
    if (activeIssueId === issueId) {
      setActiveIssueId(null);
    }
  };

  const openAiFix = (issue: Issue) => {
    setAiFixIssue(issue);
    setAiFixDraft(issueDefaultSuggestion(issue));
    setAiFixLoading(true);
    window.setTimeout(() => setAiFixLoading(false), 850);
  };

  const regenerateAiFix = () => {
    if (!aiFixIssue) return;
    const alternatives = [...(aiFixIssue.ai_alternatives || []), ...(aiFixIssue.alternatives || [])]
      .filter((item) => item && item.trim().length > 0);

    if (alternatives.length > 0) {
      const next = alternatives[Math.floor(Math.random() * alternatives.length)];
      setAiFixDraft(next);
      return;
    }

    const base = issueDefaultSuggestion(aiFixIssue);
    if (!base) return;
    setAiFixDraft(base.endsWith('.') ? base : `${base}.`);
  };

  const applyAiFix = () => {
    if (!aiFixIssue) return;
    trackAction();

    const path = (aiFixIssue.field_path || '').toLowerCase();

    if (path === 'title') {
      setTitleValue(aiFixDraft);
    } else if (path === 'description') {
      setDescriptionValue(aiFixDraft);
    } else if (path.startsWith('characteristics.')) {
      const key = aiFixIssue.field_path?.split('.').slice(1).join('.') || '';
      if (key) {
        setCharacteristicsDraft((prev) => ({ ...prev, [key]: aiFixDraft }));
      }
    } else if (path.startsWith('dimensions.')) {
      const dimKey = aiFixIssue.field_path?.split('.').slice(1).join('.') || '';
      if (dimKey === 'length' || dimKey === 'width' || dimKey === 'height' || dimKey === 'weight') {
        setDimensionsDraft((prev) => ({ ...prev, [dimKey]: aiFixDraft }));
      }
    }

    markIssue(aiFixIssue.id, 'resolved');
    setAiFixIssue(null);
  };

  const sendAiPrompt = () => {
    const message = aiInput.trim();
    if (!message) return;

    const userMessage: AiMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: message,
    };

    const assistantReply: AiMessage = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      text: 'Рекомендую сначала закрыть критичные проблемы, затем обновить описание и медиа-блок.',
    };

    setAiMessages((prev) => [...prev, userMessage, assistantReply]);
    setAiInput('');
  };

  const saveCardDraft = () => {
    trackAction();
    setSaveStamp(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
  };

  const renderIssueCard = (issue: Issue) => {
    const recommended = issueDefaultSuggestion(issue);

    return (
      <div key={issue.id} className="cd-issue-card">
        <div className={`cd-issue-card-head cd-severity-${issue.severity}`}>
          <div className="cd-issue-head-left">
            <div className="cd-issue-top-label">Текущая проблема</div>
            <div className="cd-issue-title">{issue.title}</div>
            {issue.description ? <div className="cd-issue-desc">{issue.description}</div> : null}
            {issue.field_path ? (
              <div className="cd-issue-affects">Влияет на: <span>{issue.field_path}</span></div>
            ) : null}
            <div className="cd-issue-recommendation">
              Рекомендация: {recommended || 'Укажите корректное значение вручную'}
            </div>
          </div>
          <div className="cd-issue-head-right">
            <span className="cd-issue-score">+{issue.score_impact}</span>
            <span className="cd-issue-badge">{issueSeverityLabel(issue.severity)}</span>
          </div>
        </div>

        <div className="cd-issue-actions">
          <button className="cd-action-btn cd-action-btn--primary" onClick={() => openAiFix(issue)}>
            <Sparkles size={14} /> Исправить с AI
          </button>
          <button className="cd-action-btn" onClick={() => markIssue(issue.id, 'resolved')}>
            <BadgeCheck size={14} /> Подтвердить корректность
          </button>
          <button className="cd-action-btn cd-action-btn--muted" onClick={() => markIssue(issue.id, 'postponed')}>
            <Clock size={14} /> Отложить
          </button>
        </div>
      </div>
    );
  };

  if (loading || !card) {
    return (
      <div className="loading-page">
        <div className="loading-center">
          <div className="spinner" />
          <div className="loading-text">Загрузка карточки...</div>
        </div>
      </div>
    );
  }

  const sidebarIssues = unresolvedIssues;

  return (
    <div className="card-detail-page">
      <div className="card-detail-topbar">
        <div className="card-detail-title-wrap">
          <button className="card-detail-back" onClick={() => navigate('/workspace/cards')}>
            <ArrowLeft size={16} /> К списку товаров
          </button>
          <div className="card-detail-title-row">
            <div className="card-detail-title-thumb">
              {currentPreviewPhoto ? <img src={currentPreviewPhoto} alt="" /> : <Camera size={18} />}
            </div>
            <div>
              <div className="card-detail-title">{card.title || `Карточка ${card.nm_id}`}</div>
              <div className="card-detail-subtitle">
                <span>{card.nm_id}</span>
                {card.vendor_code ? <span>· {card.vendor_code}</span> : null}
                <a
                  href={`https://www.wildberries.ru/catalog/${card.nm_id}/detail.aspx`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="card-detail-wb-link"
                >
                  ↗
                </a>
              </div>
            </div>
          </div>
        </div>

        <div className="card-detail-top-actions">
          <div className="card-detail-shield">
            <Shield size={14} /> {Object.keys(resolvedIssues).length}/{unresolvedIssues.length + Object.keys(resolvedIssues).length}
          </div>
          <button className="card-detail-ai-btn" onClick={() => setAiPanelOpen((prev) => !prev)}>
            <Bot size={14} /> AI Помощник
          </button>
          <button className="card-detail-save-btn" onClick={saveCardDraft}>
            <Save size={14} /> Сохранить
          </button>
          {!hasPermission('cards.approve') && (
            <button
              className="card-detail-save-btn"
              style={{ background: '#7c3aed', color: '#fff', borderColor: '#7c3aed' }}
              onClick={async () => {
                if (!activeStore || !card) return;
                try {
                  await api.submitForReview(activeStore.id, card.id);
                  alert('✅ Карточка отправлена на проверку');
                } catch (e: any) {
                  alert(e.message || 'Ошибка при отправке');
                }
              }}
            >
              <Send size={14} /> На проверку
            </button>
          )}
        </div>
      </div>

      <div className="card-detail-layout">
        <aside className="card-detail-sidebar">
          <div className="cd-sidebar-head">
            <div>Требуют исправления</div>
            <div className="cd-sidebar-counts">
              <span className="critical">{sidebarIssues.filter((issue) => issue.severity === 'critical').length}</span>
              <span className="warning">{sidebarIssues.filter((issue) => issue.severity === 'warning').length}</span>
            </div>
          </div>

          <div className="cd-sidebar-list">
            {sidebarIssues.length === 0 ? (
              <div className="cd-sidebar-empty">
                <CircleCheck size={20} /> Нет активных проблем
              </div>
            ) : (
              sidebarIssues.map((issue) => (
                <button
                  key={issue.id}
                  className={`cd-sidebar-item ${activeIssueId === issue.id ? 'active' : ''}`}
                  onClick={() => openIssue(issue)}
                >
                  <span className={`cd-sidebar-dot cd-severity-${issue.severity}`} />
                  <span>{issue.title}</span>
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="card-detail-main">
          <div className="cd-progress-track">
            {TAB_ORDER.map((tab) => {
              const issues = issuesByTab[tab.key] || [];
              const hasCritical = issues.some((issue) => issue.severity === 'critical');
              const hasWarning = issues.some((issue) => issue.severity !== 'critical');
              const className = hasCritical ? 'critical' : hasWarning ? 'warning' : 'ok';
              return <span key={`track-${tab.key}`} className={className} />;
            })}
          </div>

          <div className="cd-tabs">
            {TAB_ORDER.map((tab) => {
              const Icon = tab.icon;
              const count = (issuesByTab[tab.key] || []).length;
              return (
                <button
                  key={tab.key}
                  className={`cd-tab-btn ${activeTab === tab.key ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  <Icon size={15} /> {tab.label}
                  {count > 0 ? <span className="cd-tab-badge">{count}</span> : <span className="cd-tab-dot" />}
                </button>
              );
            })}
          </div>

          <div className="cd-tab-content">
            {activeTabIssues.length > 0 ? activeTabIssues.map(renderIssueCard) : (
              <div className="cd-no-issues">
                <CircleCheck size={18} /> Для этого блока активных проблем нет
              </div>
            )}

            {activeTab === 'basic' ? (
              <div className="cd-panel-grid cd-grid-2">
                <label>
                  <span>Бренд</span>
                  <input value={card.brand || ''} readOnly />
                </label>
                <label>
                  <span>Категория</span>
                  <input value={card.subject_name || ''} readOnly />
                </label>
                <label>
                  <span>nmID</span>
                  <input value={String(card.nm_id)} readOnly />
                </label>
                <label>
                  <span>Артикул поставщика</span>
                  <input value={card.vendor_code || ''} readOnly />
                </label>
                <label>
                  <span>Вес, г</span>
                  <input
                    value={dimensionsDraft.weight}
                    onChange={(event) => setDimensionsDraft((prev) => ({ ...prev, weight: event.target.value }))}
                    placeholder="0"
                  />
                </label>
              </div>
            ) : null}

            {activeTab === 'description' ? (
              <div className="cd-panel-stack">
                <label>
                  <span>Название</span>
                  <textarea value={titleValue} onChange={(event) => setTitleValue(event.target.value)} rows={3} />
                  <small>{titleValue.length} символов · рекомендуется 60-120</small>
                </label>
                <label>
                  <span>Описание</span>
                  <textarea
                    value={descriptionValue}
                    onChange={(event) => setDescriptionValue(event.target.value)}
                    rows={8}
                  />
                  <small>{descriptionValue.length} символов</small>
                </label>
              </div>
            ) : null}

            {activeTab === 'characteristics' ? (
              <div className="cd-chars-panel">
                <div className="cd-chars-toolbar">
                  <div className="cd-chars-search">
                    <SearchIcon size={15} />
                    <input
                      type="text"
                      placeholder="Поиск по характеристикам..."
                      value={charSearch}
                      onChange={(event) => setCharSearch(event.target.value)}
                    />
                  </div>
                  <div className="cd-chars-filters">
                    <button
                      className={`cd-chars-filter-btn ${charFilter === 'all' ? 'active' : ''}`}
                      onClick={() => setCharFilter('all')}
                    >
                      Все
                    </button>
                    <button
                      className={`cd-chars-filter-btn ${charFilter === 'issues' ? 'active' : ''}`}
                      onClick={() => setCharFilter('issues')}
                    >
                      Проблемные
                    </button>
                    <button
                      className={`cd-chars-filter-btn ${charFilter === 'empty' ? 'active' : ''}`}
                      onClick={() => setCharFilter('empty')}
                    >
                      Пустые
                    </button>
                  </div>
                  <button className="cd-chars-ai-fill-btn">
                    <Sparkles size={14} /> Заполнить с AI
                  </button>
                </div>

                {characteristicSections.length === 0 ? (
                  <div className="cd-no-issues" style={{ gridColumn: '1 / -1' }}>
                    <FolderOpen size={16} /> Характеристики отсутствуют
                  </div>
                ) : (
                  characteristicSections.map((section) => {
                    const isCollapsed = collapsedSections[section.name];
                    const searchLower = charSearch.toLowerCase();

                    let visibleItems = section.items;
                    if (searchLower) {
                      visibleItems = visibleItems.filter((item) =>
                        item.key.toLowerCase().includes(searchLower) || item.value.toLowerCase().includes(searchLower),
                      );
                    }
                    if (charFilter === 'empty') {
                      visibleItems = visibleItems.filter((item) => !item.value || item.value.trim() === '');
                    } else if (charFilter === 'issues') {
                      const charIssueKeys = new Set(
                        (issuesByTab.characteristics || []).map((iss) =>
                          (iss.field_path || '').replace('characteristics.', ''),
                        ),
                      );
                      visibleItems = visibleItems.filter((item) => charIssueKeys.has(item.key));
                    }

                    if (searchLower && visibleItems.length === 0) return null;

                    return (
                      <div key={section.name} className="cd-chars-section">
                        <button
                          className="cd-chars-section-head"
                          onClick={() => toggleSection(section.name)}
                        >
                          <div className="cd-chars-section-title">
                            <ChevronDownIcon
                              size={16}
                              className={`cd-chars-chevron ${isCollapsed ? 'collapsed' : ''}`}
                            />
                            <span>{section.name}</span>
                            {section.issues.length > 0 ? (
                              <span className="cd-chars-section-badge">{section.issues.length}</span>
                            ) : null}
                          </div>
                          <span className="cd-chars-section-count">{visibleItems.length}</span>
                        </button>

                        {!isCollapsed ? (
                          <div className="cd-chars-section-body">
                            {section.issues.length > 0 ? section.issues.map(renderIssueCard) : null}

                            <div className="cd-chars-grid">
                              {visibleItems.map((item) => {
                                const hasIssue = (issuesByTab.characteristics || []).some(
                                  (iss) => (iss.field_path || '').replace('characteristics.', '') === item.key,
                                );
                                const isEmpty = !item.value || item.value.trim() === '';

                                return (
                                  <label key={item.key} className={`cd-char-field ${hasIssue ? 'cd-char-field--issue' : ''}`}>
                                    <span className="cd-char-label">
                                      {item.key}
                                      {hasIssue ? <span className="cd-char-required">*</span> : null}
                                    </span>
                                    <div className="cd-char-input-wrap">
                                      <input
                                        value={item.value}
                                        onChange={(event) =>
                                          setCharacteristicsDraft((prev) => ({
                                            ...prev,
                                            [item.key]: event.target.value,
                                          }))
                                        }
                                        placeholder={isEmpty ? 'Не заполнено' : ''}
                                      />
                                      {!isEmpty && !hasIssue ? (
                                        <Check size={14} className="cd-char-check" />
                                      ) : null}
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            ) : null}

            {activeTab === 'sizes' ? (
              <div className="cd-panel-grid cd-grid-3">
                <label>
                  <span>Длина, см</span>
                  <input
                    value={dimensionsDraft.length}
                    onChange={(event) => setDimensionsDraft((prev) => ({ ...prev, length: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Ширина, см</span>
                  <input
                    value={dimensionsDraft.width}
                    onChange={(event) => setDimensionsDraft((prev) => ({ ...prev, width: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Высота, см</span>
                  <input
                    value={dimensionsDraft.height}
                    onChange={(event) => setDimensionsDraft((prev) => ({ ...prev, height: event.target.value }))}
                  />
                </label>
              </div>
            ) : null}

            {activeTab === 'media' ? (
              <div className="cd-media-stack">
                <section className="cd-media-card">
                  <div className="cd-media-head">
                    <h3>Фото ({card.photos_count})</h3>
                    <span>{coverIndex + 1}/{Math.max(card.photos.length, 1)}</span>
                  </div>

                  <div className="cd-photo-grid">
                    {card.photos.map((photo, index) => (
                      <button
                        key={`${photo}-${index}`}
                        className={`cd-photo-tile ${coverIndex === index ? 'active' : ''}`}
                        onClick={() => setCoverIndex(index)}
                      >
                        <img src={photo} alt="" />
                        {index === 0 ? <span>Обложка</span> : null}
                      </button>
                    ))}
                    <button className="cd-photo-tile cd-photo-tile--add">
                      <span>+</span>
                      Добавить
                    </button>
                  </div>

                  <div className="cd-media-actions">
                    <button onClick={() => navigate(`/photo-studio?cardId=${card.id}&nmId=${card.nm_id}`)}>
                      <Sparkles size={14} /> Сгенерировать фото
                    </button>
                    <button onClick={() => navigate('/ab-tests')}>
                      <Layers size={14} /> A/B тест
                    </button>
                  </div>
                </section>

                <section className="cd-media-card">
                  <div className="cd-media-head">
                    <h3>Видео ({card.videos_count})</h3>
                  </div>
                  {card.videos_count > 0 ? (
                    <div className="cd-video-list">
                      {card.videos.map((video) => (
                        <a key={video} href={video} target="_blank" rel="noopener noreferrer">
                          <Video size={14} /> {video}
                        </a>
                      ))}
                    </div>
                  ) : (
                    <div className="cd-video-empty">
                      <Video size={20} />
                      Видео не загружено
                      <div className="cd-video-actions">
                        <button>+ Загрузить</button>
                        <button onClick={() => navigate(`/photo-studio?cardId=${card.id}&nmId=${card.nm_id}`)}>
                          <Sparkles size={14} /> Сгенерировать из фото
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              </div>
            ) : null}

            {activeTab === 'package' ? (
              <div className="cd-panel-stack">
                <div className="cd-panel-grid cd-grid-3">
                  <label>
                    <span>Длина, см</span>
                    <input
                      value={dimensionsDraft.length}
                      onChange={(event) => setDimensionsDraft((prev) => ({ ...prev, length: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Ширина, см</span>
                    <input
                      value={dimensionsDraft.width}
                      onChange={(event) => setDimensionsDraft((prev) => ({ ...prev, width: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Высота, см</span>
                    <input
                      value={dimensionsDraft.height}
                      onChange={(event) => setDimensionsDraft((prev) => ({ ...prev, height: event.target.value }))}
                    />
                  </label>
                </div>

                <div className="cd-panel-grid cd-grid-2">
                  <label>
                    <span>Тип упаковки</span>
                    <input
                      value={packageDraft.type}
                      onChange={(event) => setPackageDraft((prev) => ({ ...prev, type: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Комплектация</span>
                    <input
                      value={packageDraft.contents}
                      onChange={(event) => setPackageDraft((prev) => ({ ...prev, contents: event.target.value }))}
                    />
                  </label>
                </div>

                <button className="cd-update-wb-btn">Обновить в WB</button>
              </div>
            ) : null}

            {activeTab === 'docs' ? (
              <div className="cd-docs-stack">
                <div className="cd-doc-block">
                  <FileCheck2 size={16} /> Сертификаты
                </div>
                <div className="cd-doc-block">
                  <PenLine size={16} /> Маркировка
                </div>
              </div>
            ) : null}
          </div>
        </main>

        <aside className="card-detail-right">
          <div className="cd-preview-card">
            {currentPreviewPhoto ? <img src={currentPreviewPhoto} alt="" /> : <Camera size={22} />}
          </div>

          <div className="cd-score-card">
            <div className="cd-score-title">Рейтинг карточки</div>
            <div className="cd-score-value" style={{ color: scoreColor }}>{cardScore}<span>/100</span></div>
            <div className="cd-score-progress">
              <span style={{ width: `${Math.max(2, Math.min(cardScore, 100))}%` }} />
            </div>
            <div className="cd-score-growth">Потенциал роста: +{potentialGain}</div>
            {saveStamp ? <div className="cd-score-saved">Сохранено в {saveStamp}</div> : null}
          </div>
        </aside>
      </div>

      {aiPanelOpen ? (
        <div className="cd-ai-panel">
          <div className="cd-ai-head">
            <div><Bot size={15} /> AI Помощник</div>
            <button onClick={() => setAiPanelOpen(false)}><X size={14} /></button>
          </div>

          <div className="cd-ai-body">
            {aiMessages.length === 0 ? (
              <div className="cd-ai-empty">
                Помогу заполнить карточку и дам SEO-советы
                <div className="cd-ai-quick-grid">
                  <button onClick={() => setAiInput('Проверь название')}>Проверь название</button>
                  <button onClick={() => setAiInput('Улучши описание')}>Улучши описание</button>
                  <button onClick={() => setAiInput('Требования к фото')}>Требования к фото</button>
                  <button onClick={() => setAiInput('SEO советы')}>SEO советы</button>
                </div>
              </div>
            ) : (
              <div className="cd-ai-messages">
                {aiMessages.map((message) => (
                  <div key={message.id} className={`cd-ai-msg ${message.role === 'assistant' ? 'assistant' : 'user'}`}>
                    {message.text}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="cd-ai-input-row">
            <input
              value={aiInput}
              onChange={(event) => setAiInput(event.target.value)}
              placeholder="Спросите что-нибудь..."
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  sendAiPrompt();
                }
              }}
            />
            <button onClick={sendAiPrompt}><Send size={15} /></button>
          </div>
        </div>
      ) : null}

      {aiFixIssue ? (
        <div className="cd-modal-overlay" onClick={() => setAiFixIssue(null)}>
          <div className="cd-modal" onClick={(event) => event.stopPropagation()}>
            <div className="cd-modal-head">
              <div>
                <h3><Sparkles size={18} /> Исправление с AI</h3>
                <p>{aiFixIssue.title}</p>
              </div>
              <button onClick={() => setAiFixIssue(null)}><X size={16} /></button>
            </div>

            {aiFixLoading ? (
              <div className="cd-modal-loading">
                <div className="spinner" />
                AI генерирует исправление...
              </div>
            ) : (
              <>
                <div className="cd-modal-grid">
                  <div>
                    <div className="cd-modal-label">Текущий вариант</div>
                    <textarea value={aiFixIssue.current_value || ''} readOnly rows={8} />
                  </div>
                  <div>
                    <div className="cd-modal-label">Вариант AI</div>
                    <textarea value={aiFixDraft} onChange={(event) => setAiFixDraft(event.target.value)} rows={8} />
                  </div>
                </div>

                <div className="cd-modal-actions">
                  <button className="cd-link-btn" onClick={regenerateAiFix}><RefreshCw size={14} /> Перегенерировать</button>
                  <div>
                    <button className="cd-secondary-btn" onClick={() => setAiFixIssue(null)}>Отменить</button>
                    <button className="cd-primary-btn" onClick={applyAiFix}>Применить</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
