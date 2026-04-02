import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import api, { API_ORIGIN } from '../api/client';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ExternalLink,
  Eye,
  FlaskConical,
  Gift,
  Image as ImageIcon,
  Info,
  Package,
  Plus,
  Rocket,
  Search,
  Settings,
  Trash2,
  Trophy,
  Upload,
  Wallet,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import '../styles/index.css';

type FilterTab = 'all' | 'running' | 'completed';

interface ListItem {
  id_company: number;
  company_id: number;
  nm_id: number;
  title: string;
  status: string;
  spend_rub?: number;
  views_per_photo?: number;
  photos_count?: number;
  current_photo_order?: number;
  last_error?: string;
  photos?: Array<{ order: number; file_url: string; wb_url?: string | null }>;
}

interface WizardPhoto {
  id: string;
  slot: number;
  file_url: string;
  preview_url: string;
  file_name?: string | null;
}

interface PromoBalance {
  balance: number;
  promo_bonus_rub: number;
}

interface WbCardOption {
  id: string;
  nm_id: number;
  vendor_code?: string | null;
  title?: string | null;
  main_photo_url?: string | null;
  photos: string[];
}

const API_BASE = API_ORIGIN;
const MIN_SLOTS = 5;

const WIZARD_STEPS = [
  { id: 'intro', title: 'Как это работает' },
  { id: 'article', title: 'Выбор артикула' },
  { id: 'photos', title: 'Фото для теста' },
  { id: 'impressions', title: 'Количество показов' },
  { id: 'cpm', title: 'Стоимость показов' },
  { id: 'payment', title: 'Источник оплаты' },
  { id: 'after', title: 'Действие после теста' },
  { id: 'summary', title: 'Сводка и запуск' },
] as const;

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...opts?.headers },
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ detail: `Error ${res.status}` }));
    throw new Error(e.detail || `Error ${res.status}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : (null as unknown as T);
}

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function normalizeStatus(raw?: string) {
  const s = (raw || '').toLowerCase();
  if (s.includes('running')) return 'running';
  if (s.includes('finished') || s.includes('completed')) return 'finished';
  if (s.includes('failed')) return 'failed';
  return 'pending';
}

function statusLabel(raw?: string) {
  const s = normalizeStatus(raw);
  if (s === 'running') return 'Запущен';
  if (s === 'finished') return 'Завершён';
  if (s === 'failed') return 'Ошибка';
  return 'Ожидает';
}

function formatRub(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n));
}

function normalizeAssetUrl(url?: string | null) {
  const raw = (url || '').trim();
  if (!raw) return '';
  if (raw.startsWith('//')) return `https:${raw}`;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  if (raw.startsWith('/')) return `${API_BASE}${raw}`;
  return `${API_BASE}/${raw}`;
}

function fileNameFromUrl(url: string) {
  const clean = (url || '').split('?')[0].split('#')[0];
  const parts = clean.split('/');
  return parts[parts.length - 1] || 'image.jpg';
}

function extractCardPreview(card: WbCardOption): string {
  return normalizeAssetUrl(card?.main_photo_url || card?.photos?.[0]);
}

export const ABTestsPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo');
  const { activeStore, loadStores } = useStore();

  const [view, setView] = useState<'home' | 'wizard'>('home');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<ListItem[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [pickedThumb, setPickedThumb] = useState<Record<number, number>>({});

  const [stepIdx, setStepIdx] = useState(0);
  const [selectedNmId, setSelectedNmId] = useState<number | null>(null);
  const [selectedTitle, setSelectedTitle] = useState('');
  const [selectedMainPhoto, setSelectedMainPhoto] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const [selectedCardPhotos, setSelectedCardPhotos] = useState<string[]>([]);

  const [cards, setCards] = useState<WbCardOption[]>([]);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [cardQuery, setCardQuery] = useState('');

  const [slots, setSlots] = useState(MIN_SLOTS);
  const [photos, setPhotos] = useState<Record<number, WizardPhoto>>({});
  const [skipMain, setSkipMain] = useState(false);
  const fileRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const [pickOpen, setPickOpen] = useState(false);
  const [pickSlot, setPickSlot] = useState<number | null>(null);
  const [pickSelectedUrls, setPickSelectedUrls] = useState<string[]>([]);

  const [viewsPerPhoto, setViewsPerPhoto] = useState(1500);
  const [cpm, setCpm] = useState(300);
  const [paymentSource, setPaymentSource] = useState<'balance' | 'topup'>('balance');
  const [balance, setBalance] = useState<PromoBalance | null>(null);
  const [usePromoBonus, setUsePromoBonus] = useState(true);

  const [autoApplyWinner, setAutoApplyWinner] = useState(true);
  const [deleteTestPhotos, setDeleteTestPhotos] = useState(true);
  const [extendedMode, setExtendedMode] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!activeStore) loadStores();
  }, [activeStore, loadStores]);

  useEffect(() => {
    void loadTests();
  }, []);

  useEffect(() => {
    if (view !== 'wizard') return;
    if (stepIdx !== 1) return;
    const timer = setTimeout(() => {
      void loadCards();
    }, 250);
    return () => clearTimeout(timer);
  }, [view, stepIdx, activeStore, cardQuery]);

  useEffect(() => {
    if (view === 'wizard' && WIZARD_STEPS[stepIdx]?.id === 'payment') {
      void loadBalance();
    }
  }, [view, stepIdx]);

  const loadTests = async (refreshOnly = false) => {
    if (refreshOnly) setRefreshing(true);
    else setLoading(true);

    try {
      const [running, pending, finished] = await Promise.all([
        apiFetch<any>('/promotion/running?page=1&page_size=50').catch(() => ({ items: [] })),
        apiFetch<any>('/promotion/pending?page=1&page_size=50').catch(() => ({ items: [] })),
        apiFetch<any>('/promotion/finished?page=1&page_size=50').catch(() => ({ items: [] })),
      ]);

      const merged = [
        ...(running?.items || []),
        ...(pending?.items || []),
        ...(finished?.items || []),
      ].sort((a: any, b: any) => {
        const aid = Number(a.id_company || a.company_id || 0);
        const bid = Number(b.id_company || b.company_id || 0);
        return bid - aid;
      });

      setItems(merged);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadCards = async () => {
    if (!activeStore) {
      setCards([]);
      return;
    }

    setCardsLoading(true);
    try {
      const data = await api.getWbCardsLive(activeStore.id, {
        limit: 80,
        with_photo: 1,
        q: cardQuery.trim() || undefined,
      });
      const mapped: WbCardOption[] = (data?.cards || [])
        .map((c: any, idx: number) => ({
          id: `${c?.nm_id || 'card'}-${idx}`,
          nm_id: Number(c?.nm_id || 0),
          vendor_code: c?.vendor_code || null,
          title: c?.title || null,
          main_photo_url: normalizeAssetUrl(c?.main_photo_url || c?.photos?.[0] || ''),
          photos: (Array.isArray(c?.photos) ? c.photos : [])
            .map((u: any) => normalizeAssetUrl(String(u || '')))
            .filter(Boolean),
        }))
        .filter((c: WbCardOption) => Number.isFinite(c.nm_id) && c.nm_id > 0);
      setCards(mapped);
    } catch (e) {
      console.error('Cards load error:', e);
      setCards([]);
    } finally {
      setCardsLoading(false);
    }
  };

  const selectCard = (card: WbCardOption) => {
    setSelectedCardId(card.nm_id);
    setSelectedNmId(card.nm_id);
    setSelectedTitle(card.title || `Товар #${card.nm_id}`);
    const urls = (card.photos || []).map((u) => normalizeAssetUrl(u)).filter(Boolean);
    const fallback = extractCardPreview(card);
    setSelectedMainPhoto(urls[0] || fallback || null);
    setSelectedCardPhotos(urls.length ? urls : (fallback ? [fallback] : []));
  };

  const loadBalance = async () => {
    try {
      const b = await apiFetch<any>('/promotion/balance');
      if (typeof b === 'number') {
        setBalance({ balance: b, promo_bonus_rub: 0 });
      } else {
        setBalance({
          balance: Number(b?.balance ?? 0),
          promo_bonus_rub: Number(b?.promo_bonus_rub ?? 0),
        });
      }
    } catch {
      setBalance(null);
    }
  };

  const resetWizard = () => {
    setStepIdx(0);
    setSelectedNmId(null);
    setSelectedTitle('');
    setSelectedMainPhoto(null);
    setSelectedCardId(null);
    setSelectedCardPhotos([]);
    setSlots(MIN_SLOTS);
    setPhotos({});
    setSkipMain(false);
    setPickOpen(false);
    setPickSlot(null);
    setPickSelectedUrls([]);
    setViewsPerPhoto(1500);
    setCpm(300);
    setPaymentSource('balance');
    setBalance(null);
    setUsePromoBonus(true);
    setAutoApplyWinner(true);
    setDeleteTestPhotos(true);
    setExtendedMode(false);
    setSubmitting(false);
    setCardQuery('');
  };

  const openWizard = () => {
    resetWizard();
    setView('wizard');
  };

  const closeWizard = () => {
    setView('home');
    resetWizard();
    void loadTests(true);
  };

  const includeMain = !skipMain;
  const uploadedCount = useMemo(() => Object.keys(photos).length, [photos]);
  const totalVariants = useMemo(() => (includeMain ? 1 : 0) + uploadedCount, [includeMain, uploadedCount]);

  const estimatedSpend = useMemo(() => {
    const totalPhotos = Math.max(2, totalVariants);
    const totalImpressions = totalPhotos * viewsPerPhoto;
    const base = (totalImpressions / 1000) * cpm;
    return Math.max(1000, Math.ceil((base * 1.1) / 100) * 100);
  }, [totalVariants, viewsPerPhoto, cpm]);

  const hasEnoughBalance = useMemo(() => {
    if (!balance) return true;
    return Number(balance.balance || 0) >= estimatedSpend;
  }, [balance, estimatedSpend]);

  const stats = useMemo(
    () => ({
      running: items.filter((x) => normalizeStatus(x.status) === 'running').length,
      finished: items.filter((x) => normalizeStatus(x.status) === 'finished').length,
      total: items.length,
    }),
    [items],
  );

  const filtered = useMemo(() => {
    if (activeTab === 'all') return items;
    if (activeTab === 'running') {
      return items.filter((x) => normalizeStatus(x.status) === 'running');
    }
    return items.filter((x) => normalizeStatus(x.status) === 'finished');
  }, [items, activeTab]);

  const canProceed = useMemo(() => {
    const step = WIZARD_STEPS[stepIdx];
    switch (step.id) {
      case 'intro':
        return true;
      case 'article':
        return selectedNmId !== null;
      case 'photos':
        return totalVariants >= 2;
      case 'impressions':
        return viewsPerPhoto >= 1000;
      case 'cpm':
        return cpm >= 100;
      case 'payment':
        if (paymentSource === 'topup') return true;
        return hasEnoughBalance;
      case 'after':
        return true;
      case 'summary':
        return selectedNmId !== null && totalVariants >= 2;
      default:
        return true;
    }
  }, [stepIdx, selectedNmId, totalVariants, viewsPerPhoto, cpm, paymentSource, hasEnoughBalance]);

  const goBack = () => {
    if (stepIdx === 0) closeWizard();
    else setStepIdx((s) => s - 1);
  };

  const goNext = () => {
    setStepIdx((s) => Math.min(WIZARD_STEPS.length - 1, s + 1));
  };

  const handleUploadSlot = async (slot: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('asset_type', 'custom');
    fd.append('name', file.name || `Slot ${slot}`);

    try {
      const res = await fetch(`${API_BASE}/photo-assets/user/upload`, {
        method: 'POST',
        headers: authHeaders(),
        body: fd,
      });
      if (!res.ok) throw new Error('upload error');

      const data = await res.json();
      const resolvedUrl = normalizeAssetUrl(data.file_url || data.url || data.image_url);
      if (!resolvedUrl) throw new Error('upload returned empty URL');

      setPhotos((prev) => ({
        ...prev,
        [slot]: {
          id: uid(),
          slot,
          file_url: resolvedUrl,
          preview_url: resolvedUrl,
          file_name: data.file_name || data.name || file.name,
        },
      }));

      setSlots((s) => Math.max(s, slot));
    } catch (e) {
      console.error(e);
      alert('Ошибка загрузки фото');
    }
  };

  const removeSlot = (slot: number) => {
    setPhotos((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
  };

  const handlePickFromCard = (slot: number) => {
    if (selectedCardPhotos.length === 0) {
      alert('У карточки нет фото для выбора');
      return;
    }
    setPickSlot(slot);
    setPickSelectedUrls([]);
    setPickOpen(true);
  };

  const closePickModal = () => {
    setPickOpen(false);
    setPickSlot(null);
    setPickSelectedUrls([]);
  };

  const applyPickedCardPhotos = (urls: string[]) => {
    if (!urls.length || pickSlot === null) return;

    let maxSlotUsed = pickSlot;

    setPhotos((prev) => {
      const next = { ...prev };
      const seen = new Set(Object.values(next).map((p) => p.file_url));
      let slotCursor = pickSlot;

      for (const rawUrl of urls) {
        const url = normalizeAssetUrl(rawUrl);
        if (!url || seen.has(url)) continue;

        while (next[slotCursor]) slotCursor += 1;

        next[slotCursor] = {
          id: uid(),
          slot: slotCursor,
          file_url: url,
          preview_url: url,
          file_name: fileNameFromUrl(url),
        };

        seen.add(url);
        if (slotCursor > maxSlotUsed) maxSlotUsed = slotCursor;
        slotCursor += 1;
      }

      return next;
    });

    setSlots((prev) => Math.max(prev, maxSlotUsed));
    closePickModal();
  };

  const submit = async () => {
    if (!selectedNmId || submitting || totalVariants < 2) return;

    setSubmitting(true);
    try {
      const payloadPhotos: any[] = [];
      let order = 1;

      if (includeMain) {
        if (!selectedMainPhoto) throw new Error('У карточки нет главного фото');
        payloadPhotos.push({ order, file_url: selectedMainPhoto, file_name: null });
        order += 1;
      }

      for (let slot = 1; slot <= slots; slot++) {
        const p = photos[slot];
        if (!p) continue;
        const fileUrl = (p.file_url || '').trim();
        if (!fileUrl) continue;
        payloadPhotos.push({ order, file_url: fileUrl, file_name: p.file_name || null });
        order += 1;
      }

      if (payloadPhotos.length < 2) throw new Error('Нужно минимум 2 фото в тесте');

      const finalTitle = selectedTitle || `Тест #${selectedNmId}`;
      const totalSlots = payloadPhotos.length;

      const payload = {
        nm_id: selectedNmId,
        card_id: selectedNmId,
        title: finalTitle,
        from_main: includeMain,
        max_slots: totalSlots,
        photos_count: totalSlots,
        main_photo_url: includeMain ? selectedMainPhoto : null,
        keep_winner_as_main: autoApplyWinner,
        delete_test_photos: deleteTestPhotos,
        use_promo_bonus: usePromoBonus,
        photos: payloadPhotos,
      };

      const created: any = await apiFetch('/promotion/create_company', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const companyId = created?.id_company ?? created?.company_id;
      if (!companyId) throw new Error('Не вернулся id компании');

      await apiFetch('/promotion/update', {
        method: 'POST',
        body: JSON.stringify({
          id_company: companyId,
          company_id: companyId,
          nm_id: selectedNmId,
          card_id: selectedNmId,
          title: finalTitle,
          from_main: includeMain,
          max_slots: totalSlots,
          photos_count: totalSlots,
          keep_winner_as_main: autoApplyWinner,
          delete_test_photos: deleteTestPhotos,
          use_promo_bonus: usePromoBonus,
          views_per_photo: viewsPerPhoto,
          cpm,
          spend_rub: estimatedSpend,
          photos: payloadPhotos,
          payment_source: paymentSource,
        }),
      });

      closeWizard();
    } catch (e: any) {
      alert(e?.message || 'Ошибка создания теста');
    } finally {
      setSubmitting(false);
    }
  };

  if (view === 'wizard') {
    const step = WIZARD_STEPS[stepIdx];
    const actionLabel = step.id === 'summary' ? 'Запустить тест' : 'Продолжить';
    const showModal = pickOpen && selectedCardPhotos.length > 0;

    return (
      <div className="abt-page abt-page--wizard">
        <div className="abt-shell">
          <div className="abt-wizard-top">
            <button className="abt-link-back" onClick={goBack}>
              <ArrowLeft size={14} />
              {stepIdx === 0 ? 'Отмена' : 'Назад'}
            </button>

            <div className="abt-wizard-actions">
              <span className="abt-step-badge">Шаг {stepIdx + 1} из {WIZARD_STEPS.length}</span>
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (step.id === 'summary') void submit();
                  else goNext();
                }}
                disabled={!canProceed || submitting}
              >
                {step.id === 'summary' ? <Rocket size={14} /> : null}
                {submitting ? 'Запуск...' : actionLabel}
                {step.id !== 'summary' ? <ChevronRight size={14} /> : null}
              </button>
            </div>
          </div>

          <div className="abt-progress-line">
            {WIZARD_STEPS.map((s, i) => (
              <div key={s.id} className={`abt-progress-seg ${i <= stepIdx ? 'active' : ''}`} />
            ))}
          </div>

          <div className="abt-wizard-main">
            <h1>{step.title}</h1>
            <p className="abt-wizard-sub">
              {step.id === 'intro' && 'Что произойдёт при запуске теста'}
              {step.id === 'article' && 'Выберите товар для тестирования'}
              {step.id === 'photos' && 'Добавьте фотографии для сравнения'}
              {step.id === 'impressions' && 'Сколько раз показать каждое фото покупателям'}
              {step.id === 'cpm' && 'Сколько вы готовы платить за 1000 показов вашего товара'}
              {step.id === 'payment' && 'Откуда списать деньги за рекламу'}
              {step.id === 'after' && 'Что сделать с победителем'}
              {step.id === 'summary' && 'Проверьте настройки и запустите тест'}
            </p>

            <div className="abt-step-content-card">
              {step.id === 'intro' && (
                <div>
                  <div className="abt-callout abt-callout--info">
                    <Info size={18} />
                    <div>
                      <h4>ВНИМАНИЕ. Запуск теста предполагает:</h4>
                      <ol>
                        <li>Создание автоматической рекламной кампании</li>
                        <li>Пополнение кампании на сумму расчётных расходов</li>
                        <li>Установку одного из фото в качестве главного</li>
                        <li>Автоматическую смену главного фото в процессе теста</li>
                        <li>Выбор победителя по CTR после завершения</li>
                      </ol>
                    </div>
                  </div>
                  <p className="abt-bottom-note">Нажмите «Продолжить», чтобы начать настройку теста</p>
                </div>
              )}

              {step.id === 'article' && (
                <div className="abt-article-picker">
                  <div className="abt-search-line">
                    <Search size={14} />
                    <input
                      value={cardQuery}
                      onChange={(e) => setCardQuery(e.target.value)}
                      className="abt-input"
                      placeholder="Поиск по названию, артикулу или nmId..."
                    />
                  </div>

                  <div className="abt-article-toolbar">
                    <button className="abt-refresh-btn" onClick={() => void loadCards()}>
                      {cardsLoading ? 'Загрузка...' : 'Обновить'}
                    </button>
                    <div className="abt-article-count">Показано: {cards.length}</div>
                  </div>

                  <div className="abt-card-list">
                    {cardsLoading && cards.length === 0 ? (
                      <div className="abt-empty-inline">Загрузка карточек...</div>
                    ) : cards.length === 0 ? (
                      <div className="abt-empty-inline">Карточки не найдены</div>
                    ) : (
                      cards.map((card) => {
                        const selected = selectedCardId === card.nm_id;
                        const preview = extractCardPreview(card);
                        return (
                          <button
                            key={card.id}
                            className={`abt-card-row ${selected ? 'selected' : ''}`}
                            onClick={() => selectCard(card)}
                          >
                            <div className="abt-card-row-thumb">
                              {preview ? <img src={preview} alt="" /> : <Package size={14} />}
                            </div>

                            <div className="abt-card-row-main">
                              <div className="abt-card-row-title">{card.title || `Карточка ${card.nm_id}`}</div>
                              <div className="abt-card-row-sub">WB: {card.nm_id} {card.vendor_code ? `• ${card.vendor_code}` : ''}</div>
                            </div>

                            <div className={`abt-radio ${selected ? 'selected' : ''}`}>
                              {selected ? <Check size={12} /> : null}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {step.id === 'photos' && (
                <div className="abt-photos-step">
                  <label className="abt-checkline">
                    <input type="checkbox" checked={skipMain} onChange={(e) => setSkipMain(e.target.checked)} />
                    <span>Не тестировать текущее главное фото (только новые)</span>
                  </label>

                  <div className="abt-slot-grid">
                    {includeMain ? (
                      <div className="abt-main-tile">
                        <div className="abt-main-preview">
                          {selectedMainPhoto ? <img src={selectedMainPhoto} alt="" /> : <div className="abt-main-empty">Нет главного фото</div>}
                          <span>Сейчас главное</span>
                        </div>
                        <div className="abt-slot-caption">Главное (контроль)</div>
                      </div>
                    ) : null}

                    {Array.from({ length: slots - (includeMain ? 1 : 0) }, (_, i) => {
                      const slot = (includeMain ? 2 : 1) + i;
                      const photo = photos[slot];
                      const filled = Boolean(photo);

                      return (
                        <div key={slot} className="abt-slot-shell">
                          <div className={`abt-slot ${filled ? 'filled' : ''}`}>
                            {filled ? (
                              <div className="abt-slot-filled">
                                <img src={photo.preview_url} alt={`Слот ${slot}`} />
                                <button className="abt-slot-remove" onClick={() => removeSlot(slot)} title="Удалить">
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            ) : (
                              <div className="abt-slot-empty">
                                <Upload size={16} />
                                <div className="abt-slot-empty-text">Перетащите или загрузите</div>
                                <button
                                  type="button"
                                  className="abt-mini-btn"
                                  onClick={() => fileRefs.current[slot]?.click()}
                                >
                                  <Upload size={12} />
                                  Загрузить
                                </button>
                                <button
                                  type="button"
                                  className="abt-mini-link"
                                  onClick={() => handlePickFromCard(slot)}
                                  disabled={selectedCardPhotos.length === 0}
                                >
                                  <ImageIcon size={12} />
                                  Из карточки
                                </button>
                              </div>
                            )}

                            <input
                              ref={(el) => {
                                fileRefs.current[slot] = el;
                              }}
                              type="file"
                              accept="image/*"
                              hidden
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) void handleUploadSlot(slot, file);
                                e.currentTarget.value = '';
                              }}
                            />
                          </div>
                          <div className="abt-slot-caption">Слот {slot}</div>
                        </div>
                      );
                    })}

                    <button type="button" className="abt-slot abt-slot-add" onClick={() => setSlots((s) => s + 1)}>
                      <div className="abt-slot-add-circle">
                        <Plus size={16} />
                      </div>
                      <small>Добавить слот</small>
                    </button>
                  </div>

                  {totalVariants < 2 ? (
                    <p className="abt-warning">
                      <AlertTriangle size={14} /> Нужно минимум 2 варианта фото
                    </p>
                  ) : null}

                  <div className="abt-file-note">
                    <strong>Требования к файлам:</strong>
                    <span>
                      Формат PNG/WEBP/JPEG, файл до 10 МБ, разрешение от 700×900 px.
                    </span>
                  </div>

                  <div className="abt-upload-summary">
                    <span>Повторять одинаковое фото в тесте нельзя</span>
                    <span>
                      Загружено: <b>{uploadedCount}</b>
                    </span>
                  </div>

                  {showModal ? (
                    <div
                      className="abt-pick-overlay"
                      onMouseDown={(e) => {
                        if (e.target === e.currentTarget) closePickModal();
                      }}
                    >
                      <div className="abt-pick-backdrop" />
                      <div className="abt-pick-modal">
                        <div className="abt-pick-head">
                          <div>
                            <div className="abt-pick-title">Выберите фото из карточки</div>
                            <div className="abt-pick-sub">Слот: <b>{pickSlot}</b></div>
                          </div>
                          <button className="abt-pick-close" onClick={closePickModal}>
                            <X size={18} />
                          </button>
                        </div>

                        <div className="abt-pick-grid">
                          {selectedCardPhotos.map((url, idx) => {
                            const selected = pickSelectedUrls.includes(url);
                            return (
                              <button
                                key={`${idx}-${url}`}
                                className={`abt-pick-item ${selected ? 'selected' : ''}`}
                                onClick={() => {
                                  setPickSelectedUrls((prev) => {
                                    if (prev.includes(url)) return prev.filter((x) => x !== url);
                                    return [...prev, url];
                                  });
                                }}
                              >
                                <img src={url} alt="" />
                                <span>Фото {idx + 1}</span>
                                <div className="abt-pick-check">
                                  {selected ? 'Выбрано' : 'Выбрать'}
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        <div className="abt-pick-foot">
                          <button
                            className="btn btn-primary"
                            disabled={pickSelectedUrls.length === 0}
                            onClick={() => applyPickedCardPhotos(pickSelectedUrls)}
                          >
                            <Check size={14} /> Подтвердить
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {step.id === 'impressions' && (
                <div className="abt-range-step">
                  <div className="abt-range-head">
                    <label>Показов на одно фото:</label>
                    <div className="abt-number-inline">
                      <input
                        type="number"
                        min={1000}
                        max={2500}
                        step={100}
                        value={viewsPerPhoto}
                        onChange={(e) => setViewsPerPhoto(Number(e.target.value || 0))}
                      />
                    </div>
                  </div>

                  <input
                    type="range"
                    min={1000}
                    max={2500}
                    step={100}
                    value={viewsPerPhoto}
                    onChange={(e) => setViewsPerPhoto(Number(e.target.value))}
                  />

                  <div className="abt-range-labels">
                    <span>1000</span>
                    <span>1500</span>
                    <span>1800</span>
                    <span>2500</span>
                  </div>

                  <div className="abt-callout abt-callout--info">
                    <Info size={16} />
                    <div>
                      Каждая фотография будет показана указанное количество раз.
                      Чем больше показов, тем точнее итоговый результат теста.
                    </div>
                  </div>
                </div>
              )}

              {step.id === 'cpm' && (
                <div className="abt-range-step">
                  <div className="abt-range-head">
                    <label>Стоимость 1000 показов:</label>
                    <div className="abt-number-inline">
                      <input
                        type="number"
                        min={100}
                        max={1500}
                        step={50}
                        value={cpm}
                        onChange={(e) => setCpm(Number(e.target.value || 0))}
                      />
                      <span>₽</span>
                    </div>
                  </div>

                  <input
                    type="range"
                    min={100}
                    max={1500}
                    step={50}
                    value={cpm}
                    onChange={(e) => setCpm(Number(e.target.value))}
                  />

                  <div className="abt-range-labels">
                    <span>100</span>
                    <span>300</span>
                    <span>600</span>
                    <span>1500</span>
                  </div>

                  <div className="abt-spend-card">
                    <div>Рассчитанный расход:</div>
                    <strong>≈ {formatRub(estimatedSpend)} ₽</strong>
                  </div>

                  <div className="abt-callout abt-callout--warning">
                    <Zap size={16} />
                    <div>
                      Чем выше ставка, тем быстрее завершится тест.
                      Если время не критично, можно поставить ниже.
                    </div>
                  </div>
                </div>
              )}

              {step.id === 'payment' && (
                <div className="abt-payment-wrap">
                  <button
                    type="button"
                    className={`abt-payment-card ${paymentSource === 'balance' ? 'selected' : ''}`}
                    onClick={() => setPaymentSource('balance')}
                  >
                    <div className="abt-choice-head">
                      <div className={`abt-choice-dot ${paymentSource === 'balance' ? 'selected' : ''}`} />
                      <div>
                        <div className="abt-choice-title"><Wallet size={14} /> Баланс</div>
                        <div className="abt-choice-sub">{balance ? `${formatRub(balance.balance)} ₽` : '—'}</div>
                      </div>
                    </div>

                    {!hasEnoughBalance && paymentSource === 'balance' ? (
                      <span className="abt-insufficient">Недостаточно</span>
                    ) : null}

                    <label className="abt-promo-line" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={usePromoBonus}
                        onChange={(e) => setUsePromoBonus(e.target.checked)}
                      />
                      <span>
                        <Gift size={14} />
                        Использовать промо-бонусы: <b>{balance ? `${formatRub(balance.promo_bonus_rub)} ₽` : '—'}</b>
                      </span>
                    </label>
                  </button>

                  <button
                    type="button"
                    className={`abt-payment-card ${paymentSource === 'topup' ? 'selected' : ''}`}
                    onClick={() => setPaymentSource('topup')}
                  >
                    <div className="abt-choice-head">
                      <div className={`abt-choice-dot ${paymentSource === 'topup' ? 'selected' : ''}`} />
                      <div>
                        <div className="abt-choice-title"><ExternalLink size={14} /> Пополнить счёт</div>
                        <div className="abt-choice-sub">Перейти в рекламный кабинет WB</div>
                      </div>
                    </div>
                  </button>

                  {!hasEnoughBalance && paymentSource === 'balance' ? (
                    <div className="abt-warning">
                      <AlertCircle size={14} /> На балансе недостаточно средств. Выберите пополнение.
                    </div>
                  ) : null}
                </div>
              )}

              {step.id === 'after' && (
                <div className="abt-after-options">
                  <button
                    type="button"
                    className={`abt-choice-card ${autoApplyWinner ? 'selected' : ''}`}
                    onClick={() => setAutoApplyWinner((v) => !v)}
                  >
                    <div className={`abt-choice-check ${autoApplyWinner ? 'selected' : ''}`}>
                      {autoApplyWinner ? <Check size={12} /> : null}
                    </div>
                    <div>
                      <div className="abt-choice-title">Сделать победителя главным</div>
                      <div className="abt-choice-sub">Победитель автоматически станет главным фото карточки.</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    className={`abt-choice-card ${deleteTestPhotos ? 'selected' : ''}`}
                    onClick={() => setDeleteTestPhotos((v) => !v)}
                  >
                    <div className={`abt-choice-check ${deleteTestPhotos ? 'selected' : ''}`}>
                      {deleteTestPhotos ? <Check size={12} /> : null}
                    </div>
                    <div>
                      <div className="abt-choice-title">Удалить тестовые фото после завершения</div>
                      <div className="abt-choice-sub">Проигравшие варианты будут удалены из карточки товара.</div>
                    </div>
                  </button>
                </div>
              )}

              {step.id === 'summary' && (
                <div>
                  <div className="abt-summary">
                    <div className="abt-summary-row"><span>Товар:</span><strong>{selectedTitle || selectedNmId || '—'}</strong></div>
                    <div className="abt-summary-row"><span>Фото в тесте:</span><strong>{totalVariants}</strong></div>
                    <div className="abt-summary-row"><span>Показов на фото:</span><strong>{formatRub(viewsPerPhoto)}</strong></div>
                    <div className="abt-summary-row"><span>Стоимость 1000 показов:</span><strong>{formatRub(cpm)} ₽</strong></div>
                    <div className="abt-summary-row"><span>Победитель станет главным:</span><strong>{autoApplyWinner ? 'Да' : 'Нет'}</strong></div>
                    <div className="abt-summary-row abt-summary-total"><span>Расчётный бюджет:</span><strong>{formatRub(estimatedSpend)} ₽</strong></div>
                  </div>
                  <p className="abt-bottom-note">Нажмите «Запустить тест», чтобы начать A/B тестирование</p>
                </div>
              )}
            </div>

            <div className="abt-mode-row">
              <button
                type="button"
                className="abt-mode-toggle"
                onClick={() => setExtendedMode((v) => !v)}
              >
                <Settings size={14} />
                Расширенный режим
                <span className={`abt-mode-badge ${extendedMode ? 'on' : ''}`}>{extendedMode ? 'вкл' : 'выкл'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="abt-page">
      <div className="abt-shell">
        <div className="abt-home-top-link" onClick={() => navigate(returnTo || '/workspace')}>{returnTo ? '‹ К карточке' : '‹ Рабочее пространство'}</div>

        <section className="abt-hero">
          <div className="abt-hero-main">
            <div className="abt-hero-title"><FlaskConical size={22} /> A/B тесты главного фото</div>
            <p>
              Узнайте, какое фото привлекает больше покупателей.
              Система автоматически покажет разные фото и выберет победителя по CTR.
            </p>
            <button className="btn btn-primary" onClick={openWizard}><Plus size={14} /> Запустить новый тест</button>
          </div>

          <div className="abt-hero-stats">
            <div className="abt-mini-stat"><b>{stats.running}</b><span>Активных</span></div>
            <div className="abt-mini-stat"><b>{stats.finished}</b><span>Завершено</span></div>
          </div>
        </section>

        <div className="abt-tabs">
          <button className={`abt-tab ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>
            Все ({stats.total})
          </button>
          <button className={`abt-tab ${activeTab === 'running' ? 'active' : ''}`} onClick={() => setActiveTab('running')}>
            <CircleDot size={12} /> Активные ({stats.running})
          </button>
          <button className={`abt-tab ${activeTab === 'completed' ? 'active' : ''}`} onClick={() => setActiveTab('completed')}>
            <CheckCircle2 size={12} /> Завершённые ({stats.finished})
          </button>
        </div>

        <div className="abt-refresh-row">
          <button className="abt-refresh-btn" onClick={() => void loadTests(true)}>
            {refreshing ? 'Обновление...' : 'Обновить'}
          </button>
        </div>

        <div className="abt-list">
          {loading ? (
            <div className="abt-empty"><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="abt-empty">
              <FlaskConical size={46} />
              <h3>Нет тестов</h3>
              <p>Создайте первый A/B тест для проверки фото</p>
              <button className="btn btn-primary" onClick={openWizard}><Plus size={14} /> Создать тест</button>
            </div>
          ) : (
            filtered.map((item) => {
              const key = item.id_company || item.company_id;
              const status = normalizeStatus(item.status);
              const thumbs = (item.photos || [])
                .slice()
                .sort((a, b) => Number(a.order) - Number(b.order))
                .slice(0, 3);

              const picked = pickedThumb[key] ?? 0;
              const cover = thumbs[picked] || thumbs[0] || null;
              const expanded = expandedId === key;

              return (
                <div key={key} className="abt-item abt-item--rich">
                  <div className="abt-list-top" onClick={() => setExpandedId((prev) => (prev === key ? null : key))}>
                    <div className="abt-list-thumbs">
                      <div className="abt-thumb-main">
                        {cover ? (
                          <img src={normalizeAssetUrl(cover.wb_url || cover.file_url)} alt="" />
                        ) : (
                          <div className="abt-thumb-placeholder"><ImageIcon size={16} /></div>
                        )}
                      </div>

                      <div className="abt-thumb-strip">
                        {thumbs.length === 0 ? (
                          <>
                            <div className="abt-thumb-btn" />
                            <div className="abt-thumb-btn" />
                            <div className="abt-thumb-btn" />
                          </>
                        ) : (
                          thumbs.map((p, idx) => {
                            const src = normalizeAssetUrl(p.wb_url || p.file_url);
                            const active = idx === picked;
                            return (
                              <button
                                key={`${key}-${p.order}`}
                                className={`abt-thumb-btn ${active ? 'active' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPickedThumb((prev) => ({ ...prev, [key]: idx }));
                                }}
                                title={`Фото ${p.order}`}
                              >
                                {src ? <img src={src} alt="" /> : null}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>

                    <div className="abt-list-body">
                      <div className="abt-list-title">
                        <span>{item.title || `nm_id ${item.nm_id}`}</span>
                        {status === 'finished' ? (
                          <span className="abt-trophy-badge"><Trophy size={11} /></span>
                        ) : null}
                      </div>
                      <div className="abt-list-sub">WB: {item.nm_id}</div>

                      <div className="abt-list-metrics">
                        <div className="abt-metric"><Eye size={12} /> {formatRub(Number(item.views_per_photo || 0))} / фото</div>
                        <div className="abt-metric"><Banknote size={12} /> {item.spend_rub ? `${formatRub(item.spend_rub)} ₽` : '—'}</div>
                        <div className="abt-metric"><Camera size={12} /> {item.photos_count || item.photos?.length || 0} фото</div>
                      </div>
                    </div>

                    <div className={`abt-state-pill abt-state-pill--${status}`}>
                      {status === 'running' ? <CircleDot size={11} /> : null}
                      {status === 'finished' ? <CheckCircle2 size={11} /> : null}
                      {status === 'failed' ? <XCircle size={11} /> : null}
                      {status === 'pending' ? <AlertCircle size={11} /> : null}
                      {statusLabel(item.status)}
                    </div>

                    <button className="abt-open-btn" onClick={(e) => e.stopPropagation()}>
                      <ChevronRight size={16} />
                    </button>
                  </div>

                  {expanded ? (
                    <div className="abt-item-details">
                      {item.current_photo_order != null ? <p>Текущее фото: <strong>#{item.current_photo_order}</strong></p> : null}
                      {item.last_error ? <p className="abt-error">Ошибка: {item.last_error}</p> : null}

                      {item.photos && item.photos.length > 0 ? (
                        <div className="abt-item-photos">
                          {item.photos.map((p, idx) => (
                            <div key={idx} className="abt-item-photo">
                              <img src={normalizeAssetUrl(p.wb_url || p.file_url)} alt={`Фото ${p.order}`} />
                              <span>#{p.order}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default ABTestsPage;
