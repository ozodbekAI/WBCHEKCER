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
  PauseCircle,
  Play,
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
import { toast } from 'sonner';
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
import '../styles/index.css';

type FilterTab = 'all' | 'running' | 'completed' | 'issues';

interface ListItem {
  id_company: number;
  company_id: number;
  nm_id: number;
  title: string;
  status: string;
  spend_rub?: number;
  estimated_spend_rub?: number;
  views_per_photo?: number;
  photos_count?: number;
  current_photo_order?: number;
  last_error?: string;
  can_start?: boolean;
  can_stop?: boolean;
  winner_decision?: string;
  photos?: Array<{
    order: number;
    file_url: string;
    wb_url?: string | null;
    winner_score?: number;
    winner_score_confidence?: number;
    winner_score_conversion_source?: string;
    winner_score_reason?: string;
  }>;
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

const MEDIA_BASE = API_ORIGIN;
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

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function normalizeStatus(raw?: string) {
  const s = (raw || '').toLowerCase();
  if (s.includes('running')) return 'running';
  if (s.includes('finished') || s.includes('completed')) return 'finished';
  if (s.includes('stopped')) return 'stopped';
  if (s.includes('failed')) return 'failed';
  return 'pending';
}

function statusLabel(raw?: string) {
  const s = normalizeStatus(raw);
  if (s === 'running') return 'Запущен';
  if (s === 'finished') return 'Завершён';
  if (s === 'stopped') return 'Остановлен';
  if (s === 'failed') return 'Ошибка';
  return 'Ожидает';
}

function isAttentionItem(item: ListItem) {
  const s = normalizeStatus(item.status);
  if (s === 'failed' || s === 'stopped') return true;
  return s === 'pending' && Boolean((item.last_error || '').trim());
}

function formatRub(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n));
}

function normalizeAssetUrl(url?: string | null) {
  const raw = (url || '').trim();
  if (!raw) return '';
  if (raw.startsWith('//')) return `https:${raw}`;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  if (raw.startsWith('/')) return `${MEDIA_BASE}${raw}`;
  return `${MEDIA_BASE}/${raw}`;
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
  const [actionCompanyId, setActionCompanyId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [pickedThumb, setPickedThumb] = useState<Record<number, number>>({});
  const [stopTarget, setStopTarget] = useState<ListItem | null>(null);

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
    if (activeStore) {
      void loadTests();
    }
  }, [activeStore]);

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
  }, [view, stepIdx, activeStore]);

  const loadTests = async (refreshOnly = false) => {
    if (refreshOnly) setRefreshing(true);
    else setLoading(true);

    try {
      if (!activeStore) {
        setItems([]);
        return;
      }
      const [running, pending, finished, failed] = await Promise.all([
        api.getPromotionList(activeStore.id, 'running', { page: 1, page_size: 50 }).catch(() => ({ items: [] })),
        api.getPromotionList(activeStore.id, 'pending', { page: 1, page_size: 50 }).catch(() => ({ items: [] })),
        api.getPromotionList(activeStore.id, 'finished', { page: 1, page_size: 50 }).catch(() => ({ items: [] })),
        api.getPromotionList(activeStore.id, 'failed', { page: 1, page_size: 50 }).catch(() => ({ items: [] })),
      ]);

      const mergedRaw = [
        ...(running?.items || []),
        ...(pending?.items || []),
        ...(finished?.items || []),
        ...(failed?.items || []),
      ];
      const merged = Array.from(
        new Map(
          mergedRaw.map((item: any) => {
            const key = Number(item?.id_company || item?.company_id || 0);
            return [key, item];
          }),
        ).values(),
      ).sort((a: any, b: any) => {
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
      if (!activeStore) {
        setBalance(null);
        return;
      }
      const b = await api.getPromotionBalance(activeStore.id);
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
      issues: items.filter((x) => isAttentionItem(x)).length,
      total: items.length,
    }),
    [items],
  );

  const filtered = useMemo(() => {
    if (activeTab === 'all') return items;
    if (activeTab === 'running') {
      return items.filter((x) => normalizeStatus(x.status) === 'running');
    }
    if (activeTab === 'completed') {
      return items.filter((x) => normalizeStatus(x.status) === 'finished');
    }
    return items.filter((x) => isAttentionItem(x));
  }, [items, activeTab]);

  const handleStartNow = async (item: ListItem) => {
    const companyId = Number(item.id_company || item.company_id || 0);
    if (!companyId || !activeStore) return;
    setActionCompanyId(companyId);
    try {
      const res = await api.startPromotionCompany(activeStore.id, companyId);
      if (res?.started || res?.status === 'running') {
        toast.success('Тест запущен');
      } else if (res?.status === 'waiting_balance') {
        toast.message('WB пока не видит бюджет кампании. Автозапуск включён, система попробует ещё раз сама.');
      } else {
        toast.error(res?.error || 'Не удалось запустить тест');
      }
      await loadTests(true);
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось запустить тест');
    } finally {
      setActionCompanyId(null);
    }
  };

  const handleStopNow = async (item: ListItem) => {
    const companyId = Number(item.id_company || item.company_id || 0);
    if (!companyId || !activeStore) return;
    setActionCompanyId(companyId);
    try {
      const res = await api.stopPromotionCompany(activeStore.id, companyId);
      if (res?.error) {
        toast.warning(`Тест остановлен, но есть замечание: ${res.error}`);
      } else {
        toast.success('Тест остановлен, исходное главное фото восстановлено');
      }
      await loadTests(true);
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось остановить тест');
    } finally {
      setActionCompanyId(null);
      setStopTarget(null);
    }
  };

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
    try {
      const data = await api.uploadUserPhotoAsset(file, {
        assetType: 'custom',
        name: file.name || `Slot ${slot}`,
      });
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
      toast.error(e instanceof Error ? e.message : 'Ошибка загрузки фото');
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
      toast.error('У карточки нет фото для выбора');
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
    if (!selectedNmId || submitting || totalVariants < 2 || !activeStore) return;

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

      const created: any = await api.createPromotionCompany(activeStore.id, payload);

      const companyId = created?.id_company ?? created?.company_id;
      if (!companyId) throw new Error('Не вернулся id компании');

      const started: any = await api.updatePromotionCompany(activeStore.id, {
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
      });

      if (started?.status === 'running' || started?.started) {
        toast.success('Фото-тест запущен');
      } else if (started?.status === 'waiting_balance') {
        toast.message('Тест поставлен в ожидание бюджета. Как только WB увидит пополнение, система попробует стартовать его сама.');
      } else if (started?.status === 'failed') {
        toast.error(started?.error || 'Тест создан, но старт завершился ошибкой');
      }
      closeWizard();
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка создания теста');
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
                      <h4>Как работает фото-тест</h4>
                      <p className="mt-1 text-sm text-slate-600">
                        Это <strong>последовательный фото-тест</strong>, а не параллельный A/B-сплит.
                        Варианты оцениваются поочерёдно: система ставит каждое фото главным и собирает показы.
                        Результаты индикативные — на них может влиять время суток и сезонность.
                      </p>
                      <ol className="mt-2">
                        <li>Создание автоматической рекламной кампании</li>
                        <li>Пополнение кампании на сумму расчётных расходов</li>
                        <li>Установку одного из фото в качестве главного</li>
                        <li>Автоматическую смену главного фото в процессе теста</li>
                        <li>Выбор лучшего варианта по CTR и конверсии после завершения</li>
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
                    <div>Ориентировочный расход:</div>
                    <strong>≈ {formatRub(estimatedSpend)} ₽</strong>
                    <div className="mt-1 text-xs text-slate-500">Фактический расход может отличаться в зависимости от аукциона и условий доставки.</div>
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
                    <div className="abt-summary-row abt-summary-total"><span>Ориентировочный бюджет:</span><strong>{formatRub(estimatedSpend)} ₽</strong></div>
                  </div>
                  <p className="abt-bottom-note">Нажмите «Запустить тест», чтобы начать фото-тестирование</p>
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
            <div className="abt-hero-title"><FlaskConical size={22} /> Фото-тесты главного фото</div>
            <p>
              Узнайте, какое фото привлекает больше покупателей.
              Система последовательно покажет каждый вариант и определит лучший по CTR и конверсии.
            </p>
            <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
              <strong>Последовательный фото-тест:</strong> варианты оцениваются поочерёдно, а не одновременно. Результаты индикативные — время суток и сезон могут влиять.
            </div>
            <button className="btn btn-primary mt-3" onClick={openWizard}><Plus size={14} /> Запустить новый тест</button>
          </div>

          <div className="abt-hero-stats">
            <div className="abt-mini-stat"><b>{stats.running}</b><span>Активных</span></div>
            <div className="abt-mini-stat"><b>{stats.finished}</b><span>Завершено</span></div>
            <div className="abt-mini-stat"><b>{stats.issues}</b><span>Требуют внимания</span></div>
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
          <button className={`abt-tab ${activeTab === 'issues' ? 'active' : ''}`} onClick={() => setActiveTab('issues')}>
            <AlertTriangle size={12} /> Ошибки и стоп ({stats.issues})
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
              <p>Создайте первый фото-тест для проверки фото</p>
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
                        <div className="abt-metric"><Banknote size={12} /> {item.estimated_spend_rub ? `≈ ${formatRub(item.estimated_spend_rub)} ₽` : item.spend_rub ? `${formatRub(item.spend_rub)} ₽` : '—'}</div>
                        <div className="abt-metric"><Camera size={12} /> {item.photos_count || item.photos?.length || 0} фото</div>
                      </div>
                    </div>

                      <div className={`abt-state-pill abt-state-pill--${status}`}>
                      {status === 'running' ? <CircleDot size={11} /> : null}
                      {status === 'finished' ? <CheckCircle2 size={11} /> : null}
                      {status === 'stopped' ? <PauseCircle size={11} /> : null}
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
                      {/* Winner decision result card */}
                      {normalizeStatus(item.status) === 'finished' && (
                        <div className={`rounded-xl border px-4 py-3 mb-3 ${
                          item.winner_decision === 'winner_found' ? 'border-emerald-200 bg-emerald-50' :
                          item.winner_decision === 'no_clear_winner' ? 'border-amber-200 bg-amber-50' :
                          item.winner_decision === 'insufficient_data' ? 'border-sky-200 bg-sky-50' :
                          item.winner_decision === 'test_interrupted' ? 'border-rose-200 bg-rose-50' :
                          'border-slate-200 bg-slate-50'
                        }`}>
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            {item.winner_decision === 'winner_found' && <><Trophy size={14} className="text-emerald-600" /> Победитель найден</>}
                            {item.winner_decision === 'no_clear_winner' && <><AlertCircle size={14} className="text-amber-600" /> Нет явного победителя</>}
                            {item.winner_decision === 'insufficient_data' && <><Info size={14} className="text-sky-600" /> Недостаточно данных</>}
                            {item.winner_decision === 'test_interrupted' && <><XCircle size={14} className="text-rose-600" /> Тест прерван</>}
                            {!item.winner_decision && normalizeStatus(item.status) === 'finished' && <><CheckCircle2 size={14} /> Тест завершён</>}
                          </div>
                          <p className="mt-1 text-xs text-slate-600">
                            {item.winner_decision === 'winner_found' && 'Лучший вариант определён на основе CTR и конверсии.'}
                            {item.winner_decision === 'no_clear_winner' && 'Результаты слишком близки — разница между вариантами не существенна.'}
                            {item.winner_decision === 'insufficient_data' && 'Собранных данных недостаточно для уверенного вывода.'}
                            {item.winner_decision === 'test_interrupted' && 'Тест был остановлен до достижения необходимого количества показов.'}
                          </p>
                          {(item.estimated_spend_rub || item.spend_rub) && (
                            <p className="mt-1 text-xs text-slate-500">Ориентировочный расход: ≈ {formatRub(item.estimated_spend_rub || item.spend_rub || 0)} ₽</p>
                          )}
                        </div>
                      )}

                      {item.current_photo_order != null ? <p>Текущее фото: <strong>#{item.current_photo_order}</strong></p> : null}
                      {item.last_error ? <p className="abt-error">Ошибка: {item.last_error}</p> : null}
                      {normalizeStatus(item.status) === 'pending' && item.last_error ? (
                        <p className="text-sm text-slate-500">Автозапуск включён. Система будет повторять запуск сама, когда WB увидит бюджет кампании.</p>
                      ) : null}

                      {(item.can_start || item.can_stop || isAttentionItem(item)) ? (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                          {(item.can_start || isAttentionItem(item)) && normalizeStatus(item.status) !== 'running' ? (
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleStartNow(item);
                              }}
                              disabled={actionCompanyId === key}
                            >
                              <Play size={13} />
                              {actionCompanyId === key ? 'Запуск...' : 'Запустить'}
                            </button>
                          ) : null}
                          {(item.can_stop || normalizeStatus(item.status) === 'running') ? (
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setStopTarget(item);
                              }}
                              disabled={actionCompanyId === key}
                            >
                              <PauseCircle size={13} />
                              {actionCompanyId === key ? 'Остановка...' : 'Остановить тест'}
                            </button>
                          ) : null}
                        </div>
                      ) : null}

                      {item.photos && item.photos.length > 0 ? (
                        <div className="abt-item-photos">
                          {item.photos.map((p, idx) => {
                            const hasScore = p.winner_score !== undefined && p.winner_score !== null;
                            return (
                              <div key={idx} className="abt-item-photo">
                                <img src={normalizeAssetUrl(p.wb_url || p.file_url)} alt={`Фото ${p.order}`} />
                                <span>#{p.order}</span>
                                {hasScore && (
                                  <div className="mt-1 text-[10px] leading-tight text-slate-600">
                                    <div>Оценка: <strong>{(p.winner_score! * 100).toFixed(0)}%</strong></div>
                                    {p.winner_score_confidence !== undefined && (
                                      <div>Уверенность: {(p.winner_score_confidence! * 100).toFixed(0)}%</div>
                                    )}
                                    {p.winner_score_reason && (
                                      <div className="italic">{p.winner_score_reason}</div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
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

      <AlertDialog open={!!stopTarget} onOpenChange={(open) => { if (!open) setStopTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Остановить тест?</AlertDialogTitle>
            <AlertDialogDescription>
              Система остановит кампанию и попытается вернуть исходное главное фото карточки.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (stopTarget) {
                  void handleStopNow(stopTarget);
                }
              }}
            >
              Остановить тест
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ABTestsPage;
