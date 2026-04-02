import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useStore } from '../contexts/StoreContext';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api, { API_ORIGIN } from '../api/client';
import {
  ChevronLeft,
  Send,
  Paperclip,
  X,
  Image as ImageIcon,
  Sparkles,
  User,
  Bot,
  Palette,
  Shirt,
  Maximize,
  Eraser,
  Loader2,
  Search,
  GalleryHorizontal,
  HelpCircle,
  ChevronDown,
  Copy,
  ExternalLink,
  ImagePlus,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
  Star,
  Folder,
  Upload,
  ArrowLeft,
  Plus,
  CheckCircle2,
  Maximize2,
  Minimize2,
  Download,
  Trash2,
  Play,
  Video,
  Wand2,
  Type,
  Mountain,
  Move,
  GripVertical,
  Camera,
  Save,
} from 'lucide-react';

interface PhotoMedia {
  id: string;
  assetId?: number;
  url: string;
  fileName?: string;
  type: 'image' | 'video';
  prompt?: string;
  localFile?: File;
}

interface ChatMessage {
  id: string;
  dbId?: number;
  role: 'user' | 'assistant';
  type: 'welcome' | 'text' | 'image' | 'action-progress' | 'action-complete' | 'action-error';
  content: string;
  timestamp: Date;
  photos?: PhotoMedia[];
  isLoading?: boolean;
}

interface ProductItem {
  id: string;
  nm_id: number;
  vendor_code?: string | null;
  title?: string | null;
  main_photo_url?: string | null;
  photos: string[];
}

interface GalleryAsset {
  id: number;
  ownerType: 'system' | 'user';
  assetType: string;
  name: string;
  url: string;
  prompt?: string;
  category?: string | null;
}

type QuickActionId = 'change-background' | 'change-pose' | 'put-on-model' | 'enhance';

type GeneratorTab = 'own-model' | 'new-model' | 'custom-prompt' | 'scenes' | 'poses' | 'video';

const GEN_TABS: { id: GeneratorTab; label: string; icon: React.ElementType }[] = [
  { id: 'own-model', label: 'Своя фотомодель', icon: User },
  { id: 'new-model', label: 'Новая фотомодель', icon: Shirt },
  { id: 'custom-prompt', label: 'Свой промпт', icon: Type },
  { id: 'scenes', label: 'Сцены', icon: Mountain },
  { id: 'poses', label: 'Позы', icon: Move },
  { id: 'video', label: 'Видео', icon: Video },
];

interface QuickMenuAction {
  id: QuickActionId;
  icon: React.ElementType;
  label: string;
  options: Array<{ id?: string; label: string; prompt: string; quickAction?: Record<string, any> }>;
}

const API_BASE = API_ORIGIN;

const WELCOME_MSG: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  type: 'welcome',
  content: 'Привет! 👋 Я помогу обработать ваши фото. Выберите товар слева или загрузите своё фото.',
  timestamp: new Date(),
};

const QUICK_PRESETS = [
  { icon: Palette, label: 'Изменить фон', prompt: 'Измени фон на белый студийный' },
  { icon: Shirt, label: 'На модель', prompt: 'Одень товар на модель' },
  { icon: Maximize, label: 'Улучшить', prompt: 'Улучши качество фото' },
  { icon: Eraser, label: 'Убрать фон', prompt: 'Убери фон, сделай прозрачным' },
];

const QUICK_MENU: QuickMenuAction[] = [
  {
    id: 'change-background',
    icon: Palette,
    label: 'Сменить фон',
    options: [
      { label: 'Белая студия', prompt: 'Сделай чистый белый студийный фон' },
      { label: 'Лофт интерьер', prompt: 'Сделай современный интерьер в стиле лофт' },
      { label: 'Уличная сцена', prompt: 'Сделай уличный городской фон' },
      { label: 'Тёплая студия', prompt: 'Сделай тёплую студийную сцену с мягким светом' },
      { label: 'Минимализм', prompt: 'Сделай минималистичный фон без лишних деталей' },
    ],
  },
  {
    id: 'change-pose',
    icon: Maximize,
    label: 'Сменить позу',
    options: [
      { label: 'Стоя фронтально', prompt: 'Смени позу модели: стоя фронтально, полный рост' },
      { label: 'В пол-оборота', prompt: 'Смени позу модели: пол-оборота, уверенная стойка' },
      { label: 'Сидя', prompt: 'Смени позу модели: аккуратно сидя, полный рост' },
      { label: 'В движении', prompt: 'Смени позу модели: естественный шаг в движении' },
    ],
  },
  {
    id: 'put-on-model',
    icon: Shirt,
    label: 'На модель',
    options: [
      { label: 'Европейская модель', prompt: 'Надень одежду на европейскую модель, реалистично' },
      { label: 'Азиатская модель', prompt: 'Надень одежду на азиатскую модель, реалистично' },
      { label: 'Studio fashion', prompt: 'Надень одежду на fashion-модель в студии' },
    ],
  },
  {
    id: 'enhance',
    icon: Sparkles,
    label: 'Улучшить',
    options: [
      { label: 'Авто-улучшение', prompt: 'Автоматически улучши качество, сохрани естественный вид' },
      { label: 'Ярче и насыщеннее', prompt: 'Сделай фото ярче и насыщеннее, без пересвета' },
      { label: 'Мягкий свет', prompt: 'Добавь мягкий студийный свет и аккуратные тени' },
      { label: 'Контрастнее', prompt: 'Увеличь локальный контраст и четкость деталей' },
      { label: 'Теплее', prompt: 'Сделай цветовую температуру теплее' },
      { label: 'Холоднее', prompt: 'Сделай цветовую температуру холоднее' },
      { label: 'Убрать тени', prompt: 'Убери лишние тени и выровняй освещение' },
      { label: 'Добавить тени', prompt: 'Добавь реалистичные мягкие тени для объема' },
      { label: 'HDR эффект', prompt: 'Сделай HDR-подобную обработку с реалистичной детализацией' },
    ],
  },
];

const ENHANCE_MENU_OPTIONS: Array<{ id: string; label: string; prompt: string; quickAction: Record<string, any> }> = [
  {
    id: 'enhance-medium',
    label: 'Авто-улучшение',
    prompt: 'Автоматически улучши качество, сохрани естественный вид',
    quickAction: { type: 'enhance', level: 'medium' },
  },
  {
    id: 'enhance-light',
    label: 'Лёгкое улучшение',
    prompt: 'Сделай мягкое улучшение без сильной ретуши',
    quickAction: { type: 'enhance', level: 'light' },
  },
  {
    id: 'enhance-strong',
    label: 'Сильное улучшение',
    prompt: 'Сделай более заметную детализацию и чистоту изображения',
    quickAction: { type: 'enhance', level: 'strong' },
  },
];

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function uid(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toAbsoluteMediaUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) return `${API_BASE}${url}`;
  return `${API_BASE}/${url}`;
}

function fileNameFromUrl(url: string) {
  const safe = (url || '').split('?')[0].split('#')[0];
  const parts = safe.split('/');
  return parts[parts.length - 1] || 'image.jpg';
}

export default function PhotoStudioPage() {
  const { activeStore, loadStores } = useStore();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const cardNmId = searchParams.get('nmId');
  const cardIdParam = searchParams.get('cardId');
  const returnTab = searchParams.get('returnTab');
  const requestedMode = searchParams.get('mode');
  const requestedGenTab = searchParams.get('genTab');
  const cardReturnUrl = cardIdParam ? `/workspace/cards/${cardIdParam}${returnTab ? `?tab=${returnTab}` : ''}` : null;
  const initialMode: 'chat' | 'generator' = requestedMode === 'generator' ? 'generator' : 'chat';
  const initialGenTab: GeneratorTab =
    requestedGenTab && GEN_TABS.some((tab) => tab.id === requestedGenTab)
      ? (requestedGenTab as GeneratorTab)
      : 'own-model';

  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MSG]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [mode, setMode] = useState<'chat' | 'generator'>(initialMode);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickActive, setQuickActive] = useState<QuickActionId>('change-background');
  const [quickMenu, setQuickMenu] = useState<QuickMenuAction[]>(QUICK_MENU);
  const [samplesOpen, setSamplesOpen] = useState(false);
  const [galleryType, setGalleryType] = useState<'scene' | 'model'>('scene');
  const [galleryAssets, setGalleryAssets] = useState<GalleryAsset[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [attachedPhotos, setAttachedPhotos] = useState<PhotoMedia[]>([]);
  const [generatedPhotos, setGeneratedPhotos] = useState<PhotoMedia[]>([]);

  const [products, setProducts] = useState<ProductItem[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsQuery, setProductsQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null);
  const [selectedProductPhotos, setSelectedProductPhotos] = useState<string[]>([]);
  const [slotUpdating, setSlotUpdating] = useState<number | null>(null);
  const [slotDragOver, setSlotDragOver] = useState<number | null>(null);

  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [rightExpanded, setRightExpanded] = useState(false);
  const [historyTab, setHistoryTab] = useState<'image' | 'video'>('image');
  const [addingToCard, setAddingToCard] = useState<string | null>(null);
  const [addedToCard, setAddedToCard] = useState<Set<string>>(new Set());

  // Card photo management
  const [cardPhotosOriginal, setCardPhotosOriginal] = useState<string[]>([]);
  const [cardPhotosDirty, setCardPhotosDirty] = useState(false);
  const [cardPhotosSaving, setCardPhotosSaving] = useState(false);
  const [cardUploadInputRef2] = useState(() => ({ current: null as HTMLInputElement | null }));
  const [sidebarDragOver, setSidebarDragOver] = useState(false);

  // Gallery add from history
  const [galleryAddPhoto, setGalleryAddPhoto] = useState<PhotoMedia | null>(null);
  const [galleryAddType, setGalleryAddType] = useState<'scene' | 'model'>('scene');
  const [galleryAdding, setGalleryAdding] = useState(false);

  // Preview with prompt
  const [previewPhoto, setPreviewPhoto] = useState<PhotoMedia | null>(null);
  const [hoveredHistoryId, setHoveredHistoryId] = useState<string | null>(null);

  // Hover enlarge preview (floating tooltip)
  const [hoverPreview, setHoverPreview] = useState<{ photo: PhotoMedia; rect: DOMRect } | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Telegram-style multi-select delete
  const [chatSelectMode, setChatSelectMode] = useState(false);
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string>>(new Set());

  // Generator state
  const [genTab, setGenTab] = useState<GeneratorTab>(initialGenTab);
  const [genGarmentPhoto, setGenGarmentPhoto] = useState<PhotoMedia | null>(null);
  const [genModelPhoto, setGenModelPhoto] = useState<PhotoMedia | null>(null);
  const [genCustomPrompt, setGenCustomPrompt] = useState('');
  const [genNewModelPrompt, setGenNewModelPrompt] = useState('');
  const [genVideoPrompt, setGenVideoPrompt] = useState('');
  const [genSelectedScene, setGenSelectedScene] = useState<{ id: string; label: string; quickAction: Record<string, any> } | null>(null);
  const [genSelectedPose, setGenSelectedPose] = useState<{ id: string; label: string; quickAction: Record<string, any> } | null>(null);
  const [genRunning, setGenRunning] = useState(false);
  const [genSourcePhoto, setGenSourcePhoto] = useState<PhotoMedia | null>(null);
  const [catalogVideos, setCatalogVideos] = useState<Array<{ id: string; label: string; prompt: string; quickAction: Record<string, any> }>>([]);

  const genFileInputRef1 = useRef<HTMLInputElement>(null);
  const genFileInputRef2 = useRef<HTMLInputElement>(null);
  const genSourceInputRef = useRef<HTMLInputElement>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryUploadInputRef = useRef<HTMLInputElement>(null);
  const quickDropdownRef = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);
  const [isDrag, setIsDrag] = useState(false);

  useEffect(() => {
    if (!activeStore) {
      loadStores();
    }
  }, [activeStore, loadStores]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadProducts();
    }, 250);
    return () => clearTimeout(timer);
  }, [activeStore, productsQuery]);

  // Auto-select product when coming from CardDetailPage
  useEffect(() => {
    if (!cardNmId || !activeStore || products.length === 0) return;
    const nmId = Number(cardNmId);
    if (!nmId || selectedProduct?.nm_id === nmId) return;
    const match = products.find((p) => p.nm_id === nmId);
    if (match) {
      void handleOpenProduct(match);
    }
  }, [cardNmId, activeStore, products]);

  useEffect(() => {
    void loadQuickCatalog();
  }, []);

  useEffect(() => {
    if (!quickOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const node = e.target as Node | null;
      if (quickDropdownRef.current && node && !quickDropdownRef.current.contains(node)) {
        setQuickOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [quickOpen]);

  const loadProducts = async () => {
    if (!activeStore) {
      setProducts([]);
      return;
    }
    setProductsLoading(true);
    try {
      const data = await api.getWbCardsLive(activeStore.id, {
        limit: 80,
        with_photo: 1,
        q: productsQuery.trim() || undefined,
      });
      const mapped: ProductItem[] = (data?.cards || [])
        .map((c: any, idx: number) => ({
          id: `${c?.nm_id || 'card'}-${idx}`,
          nm_id: Number(c?.nm_id || 0),
          vendor_code: c?.vendor_code || null,
          title: c?.title || null,
          main_photo_url: toAbsoluteMediaUrl(c?.main_photo_url || c?.photos?.[0] || ''),
          photos: (Array.isArray(c?.photos) ? c.photos : [])
            .map((u: any) => toAbsoluteMediaUrl(String(u || '')))
            .filter(Boolean),
        }))
        .filter((c: ProductItem) => Number.isFinite(c.nm_id) && c.nm_id > 0);
      setProducts(mapped);
    } catch (e) {
      console.error('Products load error', e);
      setProducts([]);
    } finally {
      setProductsLoading(false);
    }
  };

  const loadQuickCatalog = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/photo/catalog/all`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const scenes = (Array.isArray(data?.scenes) ? data.scenes : []).map((item: any) => ({
        id: `scene-${item?.id}`,
        label: String(item?.label || item?.name || `Сцена ${item?.id || ''}`),
        prompt: String(item?.prompt || ''),
        quickAction: { type: 'change-background', scene_item_id: Number(item?.id || 0) },
      })).filter((item: any) => item.quickAction.scene_item_id > 0);

      const poses = (Array.isArray(data?.poses) ? data.poses : []).map((item: any) => ({
        id: `pose-${item?.id}`,
        label: String(item?.label || item?.name || `Поза ${item?.id || ''}`),
        prompt: String(item?.prompt || ''),
        quickAction: { type: 'change-pose', pose_prompt_id: Number(item?.id || 0) },
      })).filter((item: any) => item.quickAction.pose_prompt_id > 0);

      const models = (Array.isArray(data?.models) ? data.models : []).map((item: any) => ({
        id: `model-${item?.id}`,
        label: String(item?.label || item?.name || `Модель ${item?.id || ''}`),
        prompt: String(item?.prompt || item?.name || ''),
        quickAction: {
          type: 'put-on-model',
          model_item_id: Number(item?.id || 0),
          new_model_prompt: String(item?.prompt || item?.name || ''),
        },
      })).filter((item: any) => item.quickAction.model_item_id > 0);

      const videos = (Array.isArray(data?.videos) ? data.videos : []).map((item: any) => ({
        id: `video-${item?.id}`,
        label: String(item?.label || item?.name || `Видео ${item?.id || ''}`),
        prompt: String(item?.prompt || ''),
        quickAction: { type: 'create-video', prompt: String(item?.prompt || '') },
      })).filter((item: any) => !!item.prompt);

      setCatalogVideos(videos);

      const fallbackMap = new Map<QuickActionId, QuickMenuAction['options']>(QUICK_MENU.map((m) => [m.id, m.options]));
      const nextMenu: QuickMenuAction[] = [
        { id: 'change-background', icon: Palette, label: 'Сменить фон', options: scenes.length ? scenes : (fallbackMap.get('change-background') || []) },
        { id: 'change-pose', icon: Maximize, label: 'Сменить позу', options: poses.length ? poses : (fallbackMap.get('change-pose') || []) },
        { id: 'put-on-model', icon: Shirt, label: 'На модель', options: models.length ? models : (fallbackMap.get('put-on-model') || []) },
        { id: 'enhance', icon: Sparkles, label: 'Улучшить', options: ENHANCE_MENU_OPTIONS.length ? ENHANCE_MENU_OPTIONS : (fallbackMap.get('enhance') || []) },
      ];

      setQuickMenu(nextMenu);
      setQuickActive((prev) => (nextMenu.some((item) => item.id === prev) ? prev : nextMenu[0]?.id || 'change-background'));
    } catch (e) {
      console.error('Quick catalog load error', e);
      setQuickMenu(QUICK_MENU);
    }
  };

  const handleOpenProduct = async (card: ProductItem) => {
    setSelectedProduct(card);
    setCardPhotosDirty(false);
    const wbPhotos = (card.photos || []).map((u) => toAbsoluteMediaUrl(u)).filter(Boolean);
    if (wbPhotos.length > 0) {
      setSelectedProductPhotos(wbPhotos);
      setCardPhotosOriginal(wbPhotos);
      return;
    }

    if (!activeStore) {
      setSelectedProductPhotos([]);
      return;
    }

    try {
      const fallbackCards = await api.getCards(activeStore.id, 1, 1, { search: String(card.nm_id) });
      const match = (fallbackCards?.items || []).find((it: any) => Number(it?.nm_id) === Number(card.nm_id));
      if (!match?.id) {
        setSelectedProductPhotos([]);
        return;
      }
      const detail = await api.getCard(activeStore.id, match.id);
      const photos = Array.isArray(detail?.photos) ? detail.photos : [];
      const mapped = photos.map((u: string) => toAbsoluteMediaUrl(u)).filter(Boolean);
      setSelectedProductPhotos(mapped);
      setCardPhotosOriginal(mapped);
    } catch (e) {
      console.error('Product detail load error', e);
      setSelectedProductPhotos([]);
      setCardPhotosOriginal([]);
    }
  };

  const resolveLocalCardId = useCallback(async (nmId: number): Promise<number | null> => {
    if (!activeStore) return null;
    const cards = await api.getCards(activeStore.id, 1, 10, { search: String(nmId) });
    const match = (cards?.items || []).find((item: any) => Number(item?.nm_id) === Number(nmId));
    return match?.id ? Number(match.id) : null;
  }, [activeStore]);

  const loadGalleryAssets = async (type: 'scene' | 'model' = galleryType) => {
    setGalleryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/photo-assets/catalog?asset_type=${type}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const mapped: GalleryAsset[] = (Array.isArray(data?.assets) ? data.assets : [])
        .map((a: any) => ({
          id: Number(a?.id || 0),
          ownerType: String(a?.owner_type || '').toLowerCase() === 'system' ? 'system' : 'user',
          assetType: String(a?.asset_type || ''),
          name: String(a?.name || `Asset ${a?.id || ''}`),
          url: toAbsoluteMediaUrl(String(a?.image_url || a?.file_url || a?.url || '')),
          prompt: a?.prompt ? String(a.prompt) : undefined,
          category: a?.category ? String(a.category) : null,
        }))
        .filter((a: GalleryAsset) => a.id > 0 && !!a.url);
      setGalleryAssets(mapped);
    } catch (e) {
      console.error('Gallery assets load error', e);
      setGalleryAssets([]);
    } finally {
      setGalleryLoading(false);
    }
  };

  useEffect(() => {
    if (!samplesOpen) return;
    void loadGalleryAssets(galleryType);
  }, [samplesOpen, galleryType]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/photo/chat/history`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();

        const assets: any[] = data.assets || [];
        const rawMsgs: any[] = data.messages || [];

        const assetMap = new Map<number, PhotoMedia>();
        for (const a of assets) {
          const aid = Number(a.asset_id);
          if (!aid) continue;
          const url = toAbsoluteMediaUrl(a.file_url || a.fileUrl || '');
          if (!url) continue;
          assetMap.set(aid, {
            id: `asset-${aid}`,
            assetId: aid,
            url,
            fileName: a.file_name,
            type: /\.(mp4|mov|webm)/i.test(url) ? 'video' : 'image',
            prompt: a.prompt || a.caption || '',
          });
        }

        const mapped: ChatMessage[] = rawMsgs.map((m: any) => {
          const dbId = Number(m.id);
          const role: 'user' | 'assistant' = (m.role === 'model' || m.role === 'assistant') ? 'assistant' : 'user';
          const aids: number[] = (m.meta?.asset_ids || []).map(Number).filter(Boolean);
          const photos = aids.map((id) => assetMap.get(id)).filter(Boolean) as PhotoMedia[];

          return {
            id: `db-${dbId}`,
            dbId,
            role,
            type: m.msg_type === 'image' ? 'image' : 'text',
            content: m.content || '',
            timestamp: m.created_at ? new Date(m.created_at) : new Date(),
            photos: photos.length ? photos : undefined,
          };
        });

        const genPhotos = assets
          .filter((a: any) => a.source === 'generated')
          .map((a: any) => ({
            id: `asset-${a.asset_id}`,
            assetId: a.asset_id,
            url: toAbsoluteMediaUrl(a.file_url),
            fileName: a.file_name,
            type: 'image' as const,
            prompt: a.prompt || a.caption || '',
          }))
          .filter((p: PhotoMedia) => !!p.url);

        setGeneratedPhotos(genPhotos);

        if (mapped.length > 0) {
          setMessages([WELCOME_MSG, ...mapped]);
        }
      } catch (e) {
        console.warn('Failed to load chat history', e);
      }
    })();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const remaining = 3 - attachedPhotos.length;
    const toAdd = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, remaining);
    const newPhotos: PhotoMedia[] = toAdd.map((f) => ({
      id: crypto.randomUUID?.() || uid(),
      url: URL.createObjectURL(f),
      fileName: f.name,
      type: 'image',
      localFile: f,
    }));
    setAttachedPhotos((prev) => [...prev, ...newPhotos]);
    e.target.value = '';
  };

  const attachByUrl = (rawUrl: string, assetId?: number) => {
    const url = toAbsoluteMediaUrl(rawUrl);
    if (!url) return;
    setAttachedPhotos((prev) => {
      if (prev.length >= 3) return prev;
      if (prev.some((p) => p.url === url)) return prev;
      return [
        ...prev,
        {
          id: assetId ? `asset-${assetId}` : uid(),
          assetId,
          url,
          fileName: fileNameFromUrl(url),
          type: 'image',
        },
      ];
    });
  };

  const removeAttached = (id: string) => {
    setAttachedPhotos((prev) => {
      const photo = prev.find((p) => p.id === id);
      if (photo?.url.startsWith('blob:')) URL.revokeObjectURL(photo.url);
      return prev.filter((p) => p.id !== id);
    });
  };

  const uploadFile = async (file: File): Promise<{ assetId?: number; url?: string }> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_BASE}/api/photo/assets/upload`, {
      method: 'POST',
      headers: authHeaders(),
      body: fd,
    });
    if (!res.ok) throw new Error('Upload failed');
    const data = await res.json();
    return { assetId: data.asset_id || data.id, url: toAbsoluteMediaUrl(data.file_url || data.url) };
  };

  const importUrlAsAsset = async (url: string): Promise<{ assetId?: number; url?: string }> => {
    const res = await fetch(`${API_BASE}/api/photo/assets/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ source_url: url }),
    });
    if (!res.ok) throw new Error('Import failed');
    const data = await res.json();
    return { assetId: data.asset_id || data.id, url: toAbsoluteMediaUrl(data.file_url || data.url) };
  };

  const sendMessage = async ({
    text,
    photos,
    quickAction,
  }: {
    text: string;
    photos: PhotoMedia[];
    quickAction?: Record<string, any>;
  }) => {
    const normalizedText = (text || '').trim();
    if (!normalizedText && photos.length === 0 && !quickAction) return;
    if (isStreaming) return;

    setIsStreaming(true);
    setInputText('');
    setAttachedPhotos([]);

    const userMsg: ChatMessage = {
      id: uid(),
      role: 'user',
      type: photos.length > 0 && !normalizedText ? 'image' : 'text',
      content: normalizedText,
      timestamp: new Date(),
      photos: photos.length > 0 ? photos : undefined,
    };
    setMessages((prev) => [...prev, userMsg]);

    const assetIds: number[] = [];
    const fallbackPhotoUrls: string[] = [];
    const addFallbackUrl = (raw?: string) => {
      const abs = toAbsoluteMediaUrl(raw || '');
      if (!abs || abs.startsWith('blob:')) return;
      if (!fallbackPhotoUrls.includes(abs)) fallbackPhotoUrls.push(abs);
    };

    for (const p of photos) {
      if (p.localFile) {
        try {
          const result = await uploadFile(p.localFile);
          if (result.assetId) assetIds.push(result.assetId);
          addFallbackUrl(result.url);
        } catch (e) {
          console.warn('Upload failed:', e);
        }
      } else if (p.assetId) {
        assetIds.push(p.assetId);
        addFallbackUrl(p.url);
      } else if (p.url) {
        try {
          const imported = await importUrlAsAsset(p.url);
          if (imported.assetId) assetIds.push(imported.assetId);
          addFallbackUrl(imported.url || p.url);
        } catch (e) {
          console.warn('Import failed:', e);
          addFallbackUrl(p.url);
        }
      }
    }

    try {
      const requestMessage = normalizedText || (quickAction ? 'Быстрая команда' : '');
      const body: any = { message: requestMessage };
      if (assetIds.length > 0) body.asset_ids = assetIds;
      if (fallbackPhotoUrls.length > 0) body.photo_urls = fallbackPhotoUrls;
      if (quickAction) body.quick_action = quickAction;

      const res = await fetch(`${API_BASE}/api/photo/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      const dec = new TextDecoder();
      let botContent = '';
      let botPhotos: PhotoMedia[] = [];
      let botMsgId = uid();
      let botAdded = false;

      const addOrUpdateBot = (type: ChatMessage['type'] = 'text', loading = false) => {
        if (!botAdded) {
          botAdded = true;
          setMessages((prev) => [
            ...prev,
            {
              id: botMsgId,
              role: 'assistant',
              type,
              content: botContent,
              timestamp: new Date(),
              photos: botPhotos.length > 0 ? [...botPhotos] : undefined,
              isLoading: loading,
            },
          ]);
        } else {
          setMessages((prev) => prev.map((m) =>
            m.id === botMsgId
              ? { ...m, type, content: botContent, photos: botPhotos.length > 0 ? [...botPhotos] : undefined, isLoading: loading }
              : m,
          ));
        }
      };

      if (reader) {
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';

          for (const ln of lines) {
            if (!ln.startsWith('data: ')) continue;
            try {
              const d = JSON.parse(ln.slice(6));

              if (d.type === 'ack') {
                if (d.user_message_id) {
                  setMessages((prev) => prev.map((m) =>
                    m.id === userMsg.id ? { ...m, dbId: d.user_message_id } : m,
                  ));
                }
              }
              else if (d.type === 'chat' || d.type === 'question' || d.type === 'response') {
                botContent = d.content || d.message || '';
                addOrUpdateBot('text');
              }
              else if (d.type === 'text' || d.type === 'chunk') {
                botContent += d.content || d.text || '';
                addOrUpdateBot('text');
              }
              else if (d.type === 'error' || d.type === 'limit_reached') {
                botContent = d.message || d.content || 'Произошла ошибка';
                addOrUpdateBot('action-error');
              }
              else if (d.type === 'images_start') {
                botContent = `Генерация ${d.total || 1} изображений...`;
                addOrUpdateBot('action-progress', true);
              }
              else if (d.type === 'image_started') {
                botContent = `Генерация изображения ${d.index}/${d.total}...`;
                addOrUpdateBot('action-progress', true);
              }
              else if (d.type === 'generation_start') {
                botContent = d.prompt
                  ? `Выполняю: ${d.prompt}...`
                  : 'Запускаю генерацию...';
                addOrUpdateBot('action-progress', true);
              }
              else if (d.type === 'generation_complete') {
                const newPhoto: PhotoMedia = {
                  id: `gen-${d.asset_id || Date.now()}`,
                  assetId: d.asset_id,
                  url: toAbsoluteMediaUrl(d.image_url || d.url),
                  fileName: d.file_name,
                  type: 'image',
                  prompt: d.prompt,
                };
                botPhotos.push(newPhoto);
                setGeneratedPhotos((prev) => [newPhoto, ...prev]);
                const total = Number(d.total || 1);
                const index = Number(d.index || total);
                const hasMore = index < total;
                botContent = hasMore
                  ? `Генерация ${index}/${total}...`
                  : (d.prompt ? `Готово: ${d.prompt}` : 'Готово!');
                addOrUpdateBot('action-complete', hasMore);
              }
              else if (d.type === 'media' || d.type === 'image') {
                const u = toAbsoluteMediaUrl(d.url || d.image_url);
                if (!u) continue;
                botPhotos.push({
                  id: uid(),
                  assetId: Number(d.asset_id || d.assetId || 0) || undefined,
                  url: u,
                  type: 'image',
                  fileName: d.filename,
                });
                addOrUpdateBot('text');
              }
            } catch {
              // ignore broken chunk
            }
          }
        }
      }

      if (!botAdded) {
        botContent = 'Готово.';
        addOrUpdateBot('text');
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: 'assistant',
          type: 'action-error',
          content: 'Ошибка соединения. Попробуйте ещё раз.',
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleSend = async () => {
    const text = inputText.trim();
    const photos = [...attachedPhotos];
    await sendMessage({ text, photos });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setIsDrag(false);

    // History drag dropped onto chat → attach to chat input
    const historyRaw = e.dataTransfer.getData('application/x-photostudio-history') || e.dataTransfer.getData('application/x-photostudio-chat');
    if (historyRaw) {
      try {
        const payload = JSON.parse(historyRaw);
        const url = String(payload?.url || '');
        if (url && canAttachMore) attachByUrl(url, payload?.assetId ?? undefined);
      } catch { /* ignore */ }
      return;
    }

    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    const remaining = 3 - attachedPhotos.length;
    const toAdd = files.slice(0, remaining).map((f) => ({
      id: crypto.randomUUID?.() || uid(),
      url: URL.createObjectURL(f),
      fileName: f.name,
      type: 'image' as const,
      localFile: f,
    }));
    setAttachedPhotos((prev) => [...prev, ...toAdd]);
  };

  const handleGallerySelect = (asset: GalleryAsset) => {
    attachByUrl(asset.url);
    if (!inputText.trim() && asset.prompt) {
      setInputText(asset.prompt);
    }
    setSamplesOpen(false);
    setMode('chat');
  };

  const handleGalleryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setGalleryUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('asset_type', galleryType);
      fd.append('name', file.name.replace(/\.[^.]+$/, '') || 'Sample');
      const res = await fetch(`${API_BASE}/photo-assets/user/upload`, {
        method: 'POST',
        headers: authHeaders(),
        body: fd,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadGalleryAssets(galleryType);
    } catch (err) {
      console.error('Gallery upload error:', err);
      alert('Не удалось загрузить образец');
    } finally {
      setGalleryUploading(false);
      e.target.value = '';
    }
  };

  const handleHistoryDragStart = (e: React.DragEvent, media: PhotoMedia) => {
    const payload = JSON.stringify({
      source: 'history',
      url: media.url,
      assetId: media.assetId || null,
    });
    e.dataTransfer.setData('application/x-photostudio-history', payload);
    e.dataTransfer.setData('text/plain', payload);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const applyHistoryImageToCardSlot = (slot: number, rawUrl: string) => {
    if (!selectedProduct) return;
    const sourceUrl = toAbsoluteMediaUrl(rawUrl);
    if (!sourceUrl) return;

    setSelectedProductPhotos((prev) => {
      const next = [...prev];
      const idx = slot - 1;
      if (idx < next.length) {
        next[idx] = sourceUrl;
      } else {
        next.push(sourceUrl);
      }
      return next;
    });
    setCardPhotosDirty(true);
    setSlotDragOver(null);
  };

  const handleCardSlotDrop = (e: React.DragEvent, slot: number) => {
    e.preventDefault();
    let raw = e.dataTransfer.getData('application/x-photostudio-history');
    if (!raw) raw = e.dataTransfer.getData('text/plain');
    if (!raw) {
      setSlotDragOver(null);
      return;
    }
    try {
      const payload = JSON.parse(raw);
      const url = String(payload?.url || '');
      if (url) {
        applyHistoryImageToCardSlot(slot, url);
      } else {
        setSlotDragOver(null);
      }
    } catch {
      setSlotDragOver(null);
    }
  };

  const addGeneratedPhotoToCard = (photo: PhotoMedia) => {
    if (!selectedProduct) return;
    const sourceUrl = toAbsoluteMediaUrl(photo.url);
    if (!sourceUrl) return;

    setSelectedProductPhotos((prev) => [...prev, sourceUrl]);
    setCardPhotosDirty(true);
    setAddedToCard((prev) => new Set(prev).add(photo.id));
  };

  const filteredProducts = useMemo(() => {
    if (!productsQuery.trim()) return products;
    const q = productsQuery.trim().toLowerCase();
    return products.filter((c) => {
      const title = String(c.title || '').toLowerCase();
      const vendor = String(c.vendor_code || '').toLowerCase();
      return title.includes(q) || vendor.includes(q) || String(c.nm_id).includes(q);
    });
  }, [products, productsQuery]);

  const canAttachMore = attachedPhotos.length < 3;
  const historyPhotos = useMemo(() => generatedPhotos.filter((p) => p.type === 'image'), [generatedPhotos]);
  const historyVideos = useMemo(() => generatedPhotos.filter((p) => p.type === 'video'), [generatedPhotos]);
  const gallerySystemAssets = useMemo(
    () => galleryAssets.filter((a) => a.ownerType === 'system'),
    [galleryAssets],
  );
  const galleryUserAssets = useMemo(
    () => galleryAssets.filter((a) => a.ownerType === 'user'),
    [galleryAssets],
  );
  const activeQuickMenu = useMemo(
    () => quickMenu.find((x) => x.id === quickActive) || quickMenu[0] || QUICK_MENU[0],
    [quickActive, quickMenu],
  );

  const handleQuickPick = async (
    action: QuickMenuAction,
    option: { label: string; prompt: string; quickAction?: Record<string, any> },
  ) => {
    setQuickOpen(false);
    setMode('chat');
    const messageText = `${action.label}: ${option.label}`;
    if (option.quickAction) {
      await sendMessage({
        text: messageText,
        photos: [...attachedPhotos],
        quickAction: option.quickAction,
      });
      return;
    }
    setInputText(option.prompt || messageText);
  };

  const copyText = async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // noop
    }
  };

  const handleDownload = async (p: PhotoMedia) => {
    try {
      const res = await fetch(p.url, { mode: 'cors' });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileNameFromUrl(p.url);
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(p.url, '_blank');
    }
  };

  const clearChat = async () => {
    if (!confirm('Очистить всю историю чата?')) return;
    try {
      await fetch(`${API_BASE}/api/photo/chat/clear`, {
        method: 'POST',
        headers: authHeaders(),
      });
      setMessages([WELCOME_MSG]);
    } catch (e) {
      console.error('Clear chat error', e);
    }
  };

  const deleteSelectedMessages = async (ids: Set<string>) => {
    const dbIds = Array.from(ids)
      .map((id) => {
        const msg = messages.find((m) => m.id === id);
        return msg?.dbId ?? null;
      })
      .filter((id): id is number => id !== null);
    if (dbIds.length > 0) {
      try {
        await fetch(`${API_BASE}/api/photo/chat/messages/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ message_ids: dbIds }),
        });
      } catch (e) {
        console.error('Delete messages error', e);
      }
    }
    setMessages((prev) => prev.filter((m) => !ids.has(m.id)));
    setSelectedMsgIds(new Set());
    setChatSelectMode(false);
  };

  // Delete photo from history
  const deleteHistoryPhoto = (photoId: string) => {
    setGeneratedPhotos((prev) => prev.filter((p) => p.id !== photoId));
  };

  // Add generated photo to gallery (scenes or models)
  const addPhotoToGallery = async (photo: PhotoMedia, assetType: 'scene' | 'model') => {
    setGalleryAdding(true);
    try {
      // Import the image URL as a gallery asset
      const res = await fetch(`${API_BASE}/photo-assets/user/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          source_url: photo.url,
          asset_type: assetType,
          name: photo.prompt || photo.fileName || 'Generated',
          prompt: photo.prompt || '',
        }),
      });
      if (!res.ok) {
        // Fallback: download and upload as file
        const imgRes = await fetch(photo.url, { mode: 'cors' });
        const blob = await imgRes.blob();
        const fd = new FormData();
        fd.append('file', blob, photo.fileName || 'image.png');
        fd.append('asset_type', assetType);
        fd.append('name', photo.prompt || 'Generated');
        const uploadRes = await fetch(`${API_BASE}/photo-assets/user/upload`, {
          method: 'POST',
          headers: authHeaders(),
          body: fd,
        });
        if (!uploadRes.ok) throw new Error('Upload failed');
      }
      setGalleryAddPhoto(null);
      alert(`Добавлено в ${assetType === 'scene' ? 'Локации' : 'Модели'}`);
    } catch (e) {
      console.error('Gallery add error:', e);
      alert('Не удалось добавить в галерею');
    } finally {
      setGalleryAdding(false);
    }
  };

  // Card photo management
  const handleCardPhotoDelete = (index: number) => {
    if (selectedProductPhotos.length <= 1) {
      alert('Нельзя удалить последнее фото карточки');
      return;
    }
    setSelectedProductPhotos((prev) => {
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
    setCardPhotosDirty(true);
  };

  const handleCardPhotoReorder = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setSelectedProductPhotos((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    setCardPhotosDirty(true);
  };

  const handleCardPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    e.target.value = '';

    if (!selectedProduct) return;

    try {
      const uploaded = await uploadFile(file);
      if (!uploaded.url) return;
      const nextUrl = toAbsoluteMediaUrl(String(uploaded.url || ''));
      if (!nextUrl) return;
      setSelectedProductPhotos((prev) => [...prev, nextUrl]);
      setCardPhotosDirty(true);
    } catch (err) {
      console.error('Card photo upload error:', err);
      alert('Не удалось загрузить фото');
    }
  };

  const handleSaveCardPhotoChanges = async () => {
    if (!activeStore || !selectedProduct || cardPhotosSaving) return;
    setCardPhotosSaving(true);
    try {
      const localCardId = await resolveLocalCardId(selectedProduct.nm_id);
      if (!localCardId) throw new Error('Карточка не найдена в локальной базе');

      const updated = await api.syncCardPhotos(activeStore.id, localCardId, selectedProductPhotos);
      const nextPhotos = (Array.isArray(updated?.photos) ? updated.photos : [])
        .map((u: any) => toAbsoluteMediaUrl(String(u || '')))
        .filter(Boolean);

      setSelectedProductPhotos(nextPhotos);
      setCardPhotosOriginal(nextPhotos);
      setCardPhotosDirty(false);
      await loadProducts();
    } catch (err) {
      console.error('Save card photos error:', err);
      alert('Не удалось сохранить изменения');
    } finally {
      setCardPhotosSaving(false);
    }
  };

  // Hover enlarge handlers
  const handleHistoryMouseEnter = (e: React.MouseEvent, photo: PhotoMedia) => {
    setHoveredHistoryId(photo.id);
    const el = e.currentTarget as HTMLElement;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      const rect = el.getBoundingClientRect();
      setHoverPreview({ photo, rect });
    }, 350);
  };

  const handleHistoryMouseLeave = () => {
    setHoveredHistoryId(null);
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    setHoverPreview(null);
  };

  // Chat photo drag start
  const handleChatPhotoDragStart = (e: React.DragEvent, photo: PhotoMedia) => {
    const payload = JSON.stringify({
      source: 'chat',
      url: photo.url,
      assetId: photo.assetId || null,
    });
    e.dataTransfer.setData('application/x-photostudio-chat', payload);
    e.dataTransfer.setData('application/x-photostudio-history', payload);
    e.dataTransfer.setData('text/plain', payload);
    e.dataTransfer.effectAllowed = 'copy';
  };

  // Card photo drag reorder state
  const [cardDragFrom, setCardDragFrom] = useState<number | null>(null);
  const [cardDragOver, setCardDragOver] = useState<number | null>(null);

  const handleCardPhotoDragStart = (e: React.DragEvent, index: number) => {
    setCardDragFrom(index);
    e.dataTransfer.setData('application/x-card-reorder', String(index));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleCardPhotoDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    // Check if it's a card reorder or external drop (history/chat)
    const hasReorder = e.dataTransfer.types.includes('application/x-card-reorder');
    const hasHistory = e.dataTransfer.types.includes('application/x-photostudio-history') || e.dataTransfer.types.includes('application/x-photostudio-chat');
    if (hasReorder) {
      e.dataTransfer.dropEffect = 'move';
      setCardDragOver(index);
    } else if (hasHistory) {
      e.dataTransfer.dropEffect = 'copy';
      setSlotDragOver(index + 1);
    }
  };

  const handleCardPhotoDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    // Check card reorder first
    const reorderData = e.dataTransfer.getData('application/x-card-reorder');
    if (reorderData !== '') {
      const fromIndex = Number(reorderData);
      if (!isNaN(fromIndex)) {
        handleCardPhotoReorder(fromIndex, toIndex);
      }
      setCardDragFrom(null);
      setCardDragOver(null);
      return;
    }
    // Check for chat photo drop
    let raw = e.dataTransfer.getData('application/x-photostudio-chat');
    if (raw) {
      try {
        const payload = JSON.parse(raw);
        const url = String(payload?.url || '');
        if (url) {
          applyHistoryImageToCardSlot(toIndex + 1, url);
        }
      } catch { /* ignore */ }
      setCardDragFrom(null);
      setCardDragOver(null);
      return;
    }
    // Otherwise it's a history drop
    handleCardSlotDrop(e, toIndex + 1);
    setCardDragFrom(null);
    setCardDragOver(null);
  };

  // Get catalog scenes and poses for the Generator
  const catalogScenes = useMemo(() => {
    const sceneMenu = quickMenu.find((m) => m.id === 'change-background');
    if (!sceneMenu) return [];
    return sceneMenu.options.filter((o) => o.quickAction);
  }, [quickMenu]);

  const catalogPoses = useMemo(() => {
    const poseMenu = quickMenu.find((m) => m.id === 'change-pose');
    if (!poseMenu) return [];
    return poseMenu.options.filter((o) => o.quickAction);
  }, [quickMenu]);

  const catalogModels = useMemo(() => {
    const modelMenu = quickMenu.find((m) => m.id === 'put-on-model');
    if (!modelMenu) return [];
    return modelMenu.options.filter((o) => o.quickAction);
  }, [quickMenu]);

  // Available product photos for quick-pick in generator
  const availablePhotos = useMemo((): PhotoMedia[] => {
    return selectedProductPhotos.map((u, i) => ({
      id: `product-photo-${i}`,
      url: u,
      fileName: `photo-${i + 1}.jpg`,
      type: 'image' as const,
    }));
  }, [selectedProductPhotos]);

  const handleGenFileSelect = (setter: (pm: PhotoMedia | null) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    setter({
      id: uid(),
      url: URL.createObjectURL(file),
      fileName: file.name,
      type: 'image',
      localFile: file,
    });
    e.target.value = '';
  };

  const handleGenRun = async () => {
    if (genRunning || isStreaming) return;

    let photos: PhotoMedia[] = [];
    let quickAction: Record<string, any> | undefined;
    let text = '';

    if (genTab === 'own-model') {
      if (!genGarmentPhoto || !genModelPhoto) {
        alert('Перетащите 2 фото: изделие + фотомодель');
        return;
      }
      photos = [genGarmentPhoto, genModelPhoto];
      quickAction = { type: 'normalize-own-model' };
      text = 'Нормализация: своя фотомодель';
    } else if (genTab === 'new-model') {
      if (!genGarmentPhoto) {
        alert('Загрузите фото изделия');
        return;
      }
      const modelOpt = catalogModels[0];
      photos = [genGarmentPhoto];
      quickAction = {
        type: 'put-on-model',
        new_model_prompt: genNewModelPrompt || modelOpt?.prompt || 'Надень одежду на модель',
        ...(modelOpt?.quickAction || {}),
      };
      text = `На новую модель: ${genNewModelPrompt || 'авто'}`;
    } else if (genTab === 'custom-prompt') {
      if (!genCustomPrompt.trim()) {
        alert('Введите промпт');
        return;
      }
      if (genSourcePhoto) photos = [genSourcePhoto];
      quickAction = genSourcePhoto
        ? { type: 'custom-generation', prompt: genCustomPrompt }
        : undefined;
      text = genCustomPrompt;
    } else if (genTab === 'scenes') {
      if (!genSourcePhoto) {
        alert('Выберите исходное фото');
        return;
      }
      if (!genSelectedScene) {
        alert('Выберите сцену');
        return;
      }
      photos = [genSourcePhoto];
      quickAction = genSelectedScene.quickAction;
      text = `Сцена: ${genSelectedScene.label}`;
    } else if (genTab === 'poses') {
      if (!genSourcePhoto) {
        alert('Выберите исходное фото');
        return;
      }
      if (!genSelectedPose) {
        alert('Выберите позу');
        return;
      }
      photos = [genSourcePhoto];
      quickAction = genSelectedPose.quickAction;
      text = `Поза: ${genSelectedPose.label}`;
    } else if (genTab === 'video') {
      if (!genSourcePhoto) {
        alert('Выберите исходное фото');
        return;
      }
      photos = [genSourcePhoto];
      quickAction = {
        type: 'generate-video',
        prompt: genVideoPrompt || 'Оживи фото, сделай естественное движение',
        model: 'hailuo/minimax-video-01-live',
        duration: 5,
        resolution: '720p',
      };
      text = `Видео: ${genVideoPrompt || 'авто'}`;
    }

    setGenRunning(true);
    setMode('chat');
    try {
      await sendMessage({ text, photos, quickAction });
    } finally {
      setGenRunning(false);
    }
  };

  const handleGenPhotoPick = (photo: PhotoMedia, target: 'garment' | 'model' | 'source') => {
    if (target === 'garment') setGenGarmentPhoto(photo);
    else if (target === 'model') setGenModelPhoto(photo);
    else setGenSourcePhoto(photo);
  };

  return (
    <div className="ps-root ps-root--v2">
      <div className="ps-nav-header">
        {cardIdParam ? (
          <button className="ps-nav-back" onClick={() => navigate(cardReturnUrl!)}>
            <ChevronLeft size={16} />
            К карточке
          </button>
        ) : (
          <button className="ps-nav-back" onClick={() => navigate('/workspace')}>
            <ChevronLeft size={16} />
            Рабочее пространство
          </button>
        )}
      </div>
      <div className="ps-layout">
        {!leftCollapsed ? (
          <aside
            className={`ps-sidebar ps-sidebar--products${sidebarDragOver ? ' ps-sidebar--drag-over' : ''}`}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('application/x-photostudio-history') || e.dataTransfer.types.includes('application/x-photostudio-chat')) {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'copy';
                setSidebarDragOver(true);
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setSidebarDragOver(false);
            }}
            onDrop={(e) => {
              setSidebarDragOver(false);
              const raw = e.dataTransfer.getData('application/x-photostudio-history') || e.dataTransfer.getData('application/x-photostudio-chat') || e.dataTransfer.getData('text/plain');
              if (!raw) return;
              try {
                const payload = JSON.parse(raw);
                const url = String(payload?.url || '');
                if (url) applyHistoryImageToCardSlot(selectedProductPhotos.length + 1, url);
              } catch { /* ignore */ }
            }}
          >
            <div className="ps-side-head">
              {selectedProduct ? (
                <button className="ps-side-back" onClick={() => { setSelectedProduct(null); setSelectedProductPhotos([]); }}>
                  <ChevronLeft size={14} />
                  <span>Фото карточки</span>
                </button>
              ) : cardIdParam ? (
                <button className="ps-side-back" onClick={() => navigate(cardReturnUrl!)}>
                  <ArrowLeft size={14} />
                  <span>К карточке</span>
                </button>
              ) : (
                <div className="ps-side-title-row">
                  <ImageIcon size={16} />
                  <span>Товары</span>
                  <span className="ps-side-count">{products.length}</span>
                </div>
              )}
              <button className="ps-side-collapse" onClick={() => setLeftCollapsed(true)} title="Свернуть">
                <PanelLeftClose size={16} />
              </button>
            </div>

            {!selectedProduct && (
              <div className="ps-side-search-wrap">
                <Search size={14} />
                <input
                  value={productsQuery}
                  onChange={(e) => setProductsQuery(e.target.value)}
                  placeholder="Артикул или название..."
                  className="ps-side-search"
                />
              </div>
            )}

            <div className="ps-sidebar-body">
              {!activeStore ? (
                <div className="ps-sidebar-empty">Сначала выберите магазин в рабочем пространстве</div>
              ) : selectedProduct ? (
                selectedProductPhotos.length === 0 ? (
                  <div className="ps-sidebar-empty">У карточки нет фото</div>
                ) : (
                  <>
                    <div className="ps-card-info-block">
                      <div className="ps-card-info-title">{selectedProduct.title || `Карточка ${selectedProduct.nm_id}`}</div>
                      <div className="ps-card-info-badges">
                        <span className="ps-product-badge">
                          Артикул: {selectedProduct.nm_id}
                          <button type="button" className="ps-product-copy" onClick={(e) => { e.stopPropagation(); void copyText(String(selectedProduct.nm_id)); }}>
                            <Copy size={11} />
                          </button>
                        </span>
                        {selectedProduct.vendor_code && (
                          <span className="ps-product-badge">
                            VendorCode: {selectedProduct.vendor_code}
                            <button type="button" className="ps-product-copy" onClick={(e) => { e.stopPropagation(); void copyText(String(selectedProduct.vendor_code || '')); }}>
                              <Copy size={11} />
                            </button>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="ps-product-grid">
                      {selectedProductPhotos.map((u, i) => (
                        <div
                          key={`${u}-${i}`}
                          className={`ps-product-photo ${slotDragOver === i + 1 ? 'is-drop-over' : ''} ${slotUpdating === i + 1 ? 'is-updating' : ''} ${cardDragOver === i ? 'is-reorder-over' : ''}`}
                          draggable
                          onDragStart={(e) => handleCardPhotoDragStart(e, i)}
                          onDragOver={(e) => handleCardPhotoDragOver(e, i)}
                          onDragLeave={() => { setCardDragOver(null); setSlotDragOver(null); }}
                          onDrop={(e) => handleCardPhotoDrop(e, i)}
                          onDragEnd={() => { setCardDragFrom(null); setCardDragOver(null); }}
                        >
                          <img
                            src={u}
                            alt=""
                            crossOrigin="anonymous"
                            onDoubleClick={() => { if (canAttachMore) attachByUrl(u); }}
                            title="Двойной клик — прикрепить к чату"
                          />
                          {i === 0 && <span className="ps-product-cover-badge">ОБЛОЖКА</span>}
                          <span className="ps-product-order-badge">{i + 1}</span>
                          <div className="ps-product-photo-overlay">
                            <button
                              className="ps-product-photo-action"
                              onClick={(e) => { e.stopPropagation(); handleCardPhotoDelete(i); }}
                              title="Удалить фото"
                            >
                              <Trash2 size={12} />
                            </button>
                            <button
                              className="ps-product-photo-action"
                              onClick={(e) => { e.stopPropagation(); setGalleryAddPhoto({ id: uid(), url: u, type: 'image' }); }}
                              title="В галерею образцов"
                            >
                              <Plus size={12} />
                            </button>
                          </div>
                          {slotUpdating === i + 1 && (
                            <span className="ps-product-photo-status">
                              <Loader2 size={12} className="ps-spin" />
                            </span>
                          )}
                        </div>
                      ))}
                      {/* Upload slot */}
                      <button
                        className={`ps-product-photo ps-product-photo--upload ${slotDragOver === selectedProductPhotos.length + 1 ? 'is-drop-over' : ''}`}
                        onClick={() => document.getElementById('card-photo-upload')?.click()}
                        onDragOver={(e) => {
                          const hasHistory = e.dataTransfer.types.includes('application/x-photostudio-history') || e.dataTransfer.types.includes('application/x-photostudio-chat');
                          if (hasHistory) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setSlotDragOver(selectedProductPhotos.length + 1); }
                        }}
                        onDragLeave={() => setSlotDragOver(null)}
                        onDrop={(e) => handleCardSlotDrop(e, selectedProductPhotos.length + 1)}
                      >
                        <Plus size={20} />
                        <span>Загрузить</span>
                      </button>
                      <input
                        id="card-photo-upload"
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={handleCardPhotoUpload}
                      />
                    </div>
                    <div className="ps-card-photo-hint">
                      💡 Двойной клик — прикрепить к чату (макс. 3)
                    </div>
                    {cardPhotosDirty && (
                      <button
                        className="ps-card-save-btn"
                        onClick={handleSaveCardPhotoChanges}
                        disabled={cardPhotosSaving}
                      >
                        {cardPhotosSaving ? (
                          <><Loader2 size={14} className="ps-spin" /> Сохраняю...</>
                        ) : (
                          <><Save size={14} /> Сохранить изменения</>
                        )}
                      </button>
                    )}
                  </>
                )
              ) : productsLoading ? (
                <div className="ps-sidebar-empty">
                  <Loader2 size={18} className="ps-spin" />
                  <span>Загрузка товаров...</span>
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="ps-sidebar-empty">Товары не найдены</div>
              ) : (
                <div className="ps-product-list ps-product-list--divide">
                  {filteredProducts.map((card) => (
                    <button key={card.id} className="ps-product-item" onClick={() => void handleOpenProduct(card)}>
                      <div className="ps-product-thumb">
                        {card.main_photo_url ? (
                          <img src={card.main_photo_url} alt="" crossOrigin="anonymous" />
                        ) : (
                          <ImageIcon size={14} />
                        )}
                      </div>
                      <div className="ps-product-meta">
                        <div className="ps-product-title">{card.title || `Карточка ${card.nm_id}`}</div>
                        <div className="ps-product-badge-row">
                          <span className="ps-product-badge">
                            Артикул: {card.nm_id}
                            <button
                              type="button"
                              className="ps-product-copy"
                              onClick={(e) => {
                                e.stopPropagation();
                                void copyText(String(card.nm_id));
                              }}
                            >
                              <Copy size={11} />
                            </button>
                          </span>
                        </div>
                        {card.vendor_code ? (
                          <div className="ps-product-badge-row">
                            <span className="ps-product-badge">
                              VendorCode: {card.vendor_code}
                              <button
                                type="button"
                                className="ps-product-copy"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void copyText(String(card.vendor_code || ''));
                                }}
                              >
                                <Copy size={11} />
                              </button>
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>
        ) : (
          <aside className="ps-sidebar-collapsed">
            <button className="ps-side-collapse" onClick={() => setLeftCollapsed(false)}>
              <PanelLeft size={16} />
            </button>
          </aside>
        )}

        <div
          className={`ps-chat ${isDrag ? 'ps-chat--drag' : ''}`}
          onDragEnter={(e) => {
            if (e.dataTransfer.types.includes('application/x-card-reorder')) return;
            dragDepth.current += 1;
            setIsDrag(true);
          }}
          onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setIsDrag(false); }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('application/x-card-reorder')) e.preventDefault();
          }}
          onDrop={handleDrop}
        >
          <div className="ps-chat-header ps-chat-header--v2">
            <div className="ps-chat-header-left">
              <Sparkles size={18} className="ps-accent" />
              <h2>AI Фотостудия</h2>
              {selectedProduct ? (
                <span className="ps-chat-product-badge">
                  {selectedProduct.title || `#${selectedProduct.nm_id}`}
                </span>
              ) : null}
            </div>
            <div className="ps-chat-header-center">
              <div className="ps-mode-toggle">
                <button className={`ps-mode-btn ${mode === 'chat' ? 'active' : ''}`} onClick={() => setMode('chat')}>Чат</button>
                <button className={`ps-mode-btn ${mode === 'generator' ? 'active' : ''}`} onClick={() => setMode('generator')}>Генератор</button>
              </div>
            </div>
            <div className="ps-chat-header-right">
              {chatSelectMode ? (
                <button className="ps-choose-btn ps-choose-btn--cancel" onClick={() => { setChatSelectMode(false); setSelectedMsgIds(new Set()); }}>
                  Отмена
                </button>
              ) : (
                <button className="ps-choose-btn" onClick={() => setChatSelectMode(true)}>
                  <CheckCircle2 size={14} />
                  Выбрать
                </button>
              )}
            </div>
          </div>

          {mode === 'chat' ? (
            <>
              <div className="ps-messages">
                {chatSelectMode && (
                  <div className="ps-select-bar">
                    <button className="ps-select-bar-btn" onClick={() => {
                      const allIds = new Set(messages.filter((m) => m.type !== 'welcome').map((m) => m.id));
                      setSelectedMsgIds(allIds);
                    }}>Выбрать все</button>
                    <button
                      className="ps-select-bar-btn ps-select-bar-btn--danger"
                      disabled={selectedMsgIds.size === 0}
                      onClick={() => void deleteSelectedMessages(selectedMsgIds)}
                    >
                      Удалить ({selectedMsgIds.size})
                    </button>
                    <button
                      className="ps-select-bar-btn ps-select-bar-btn--danger"
                      onClick={() => {
                        const allIds = new Set(messages.filter((m) => m.type !== 'welcome').map((m) => m.id));
                        void deleteSelectedMessages(allIds);
                      }}
                    >Удалить все</button>
                  </div>
                )}
                {messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    onPhotoClick={(photo) => setPreviewPhoto(photo)}
                    onPhotoDragStart={handleChatPhotoDragStart}
                    selectMode={chatSelectMode}
                    isSelected={selectedMsgIds.has(msg.id)}
                    onToggleSelect={(id) => setSelectedMsgIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id); else next.add(id);
                      return next;
                    })}
                  />
                ))}
                {isStreaming && messages[messages.length - 1]?.role !== 'assistant' && (
                  <div className="ps-typing">
                    <div className="ps-typing-dots"><span /><span /><span /></div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              <div className="ps-action-bar">
                <div ref={quickDropdownRef} className={`ps-dropdown ${quickOpen ? 'open' : ''}`}>
                  <button className="ps-action-chip" onClick={() => setQuickOpen((v) => !v)}>
                    <Sparkles size={14} />
                    Быстрые команды
                    <ChevronDown size={14} />
                  </button>
                  {quickOpen ? (
                    <div className="ps-dropdown-menu ps-dropdown-menu--matrix">
                      <div className="ps-quick-col">
                        <div className="ps-quick-col-title">Выберите действие</div>
                        {quickMenu.map((item) => (
                          <button
                            key={item.id}
                            className={`ps-quick-action-row ${quickActive === item.id ? 'active' : ''}`}
                            onMouseEnter={() => setQuickActive(item.id)}
                            onClick={() => setQuickActive(item.id)}
                          >
                            <item.icon size={14} />
                            <span>{item.label}</span>
                            <ChevronDown size={12} />
                          </button>
                        ))}
                      </div>
                      <div className="ps-quick-col">
                        <div className="ps-quick-col-title">Выберите вариант</div>
                        <div className="ps-quick-options">
                          {activeQuickMenu.options.map((opt) => (
                            <button
                              key={`${activeQuickMenu.id}-${opt.id || opt.label}`}
                              className="ps-quick-option-row"
                              onClick={() => { void handleQuickPick(activeQuickMenu, opt); }}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                <button className="ps-action-chip" onClick={() => setSamplesOpen(true)}>
                  <GalleryHorizontal size={14} />
                  Галерея образцов
                  {attachedPhotos.length > 0 ? (
                    <span className="ps-chip-badge">{attachedPhotos.length}</span>
                  ) : null}
                  <ChevronDown size={14} />
                </button>

                <button className="ps-action-chip" onClick={() => setInstructionsOpen(true)}>
                  <HelpCircle size={14} />
                  Инструкции
                </button>
              </div>

              {attachedPhotos.length > 0 && (
                <div className="ps-attached-preview">
                  {attachedPhotos.length === 1 ? (
                    <div className="ps-attached-single">
                      <div className="ps-attached-single-thumb">
                        <img src={attachedPhotos[0].url} alt="" crossOrigin="anonymous" />
                        <button className="ps-attached-remove-abs" onClick={() => removeAttached(attachedPhotos[0].id)}>
                          <X size={10} />
                        </button>
                      </div>
                      <div className="ps-attached-single-info">
                        <span className="ps-attached-label-text">Фото прикреплено</span>
                      </div>
                    </div>
                  ) : (
                    <div className="ps-attached-multi">
                      {attachedPhotos.map((p, i) => (
                        <div key={p.id} className="ps-attached-thumb ps-attached-thumb--ord">
                          <img src={p.url} alt="" crossOrigin="anonymous" />
                          <span className="ps-attached-ord-badge">{i + 1}</span>
                          <button className="ps-attached-remove" onClick={() => removeAttached(p.id)}>
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                      <span className="ps-attached-label">{attachedPhotos.length}/3 фото</span>
                    </div>
                  )}
                </div>
              )}

              <form className="ps-input" onSubmit={(e) => { e.preventDefault(); void handleSend(); }}>
                <button type="button" className="ps-icon-btn" onClick={() => fileInputRef.current?.click()} disabled={isStreaming || !canAttachMore}>
                  <Paperclip size={18} />
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={handleFileSelect} />

                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={attachedPhotos.length ? 'Что сделать с фото?' : 'Напишите, что хотите сделать...'}
                  disabled={isStreaming}
                  className="ps-text-input"
                />

                <button
                  type="submit"
                  className={`ps-send-btn ps-send-btn--pill ${(inputText.trim() || attachedPhotos.length) && !isStreaming ? 'ps-send-btn--active' : ''}`}
                  disabled={(!inputText.trim() && !attachedPhotos.length) || isStreaming}
                >
                  <Send size={18} />
                </button>
              </form>
            </>
          ) : (
            <div className="ps-generator-pane">
              {/* Generator sub-tabs */}
              <div className="ps-gen-tabs">
                {GEN_TABS.map((t) => (
                  <button
                    key={t.id}
                    className={`ps-gen-tab ${genTab === t.id ? 'active' : ''}`}
                    onClick={() => setGenTab(t.id)}
                  >
                    <t.icon size={13} />
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>

              <div className="ps-gen-body">
                {/* ========== Своя фотомодель ========== */}
                {genTab === 'own-model' && (
                  <div className="ps-gen-section">
                    <div className="ps-gen-section-title">Нормализация: своя фотомодель</div>
                    <div className="ps-gen-section-desc">Загрузите фото изделия и фотомодели — AI совместит их</div>

                    <div className="ps-gen-dropzones">
                      <div className="ps-gen-dropzone" onClick={() => genFileInputRef1.current?.click()}>
                        {genGarmentPhoto ? (
                          <div className="ps-gen-dropzone-preview">
                            <img src={genGarmentPhoto.url} alt="" crossOrigin="anonymous" />
                            <button className="ps-gen-dropzone-remove" onClick={(e) => { e.stopPropagation(); setGenGarmentPhoto(null); }}>
                              <X size={10} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <Upload size={20} />
                            <span className="ps-gen-dropzone-label">ИЗДЕЛИЕ</span>
                            <span className="ps-gen-dropzone-hint">одежда / аксессуар</span>
                          </>
                        )}
                        <input ref={genFileInputRef1} type="file" accept="image/*" hidden onChange={handleGenFileSelect(setGenGarmentPhoto)} />
                      </div>

                      <div className="ps-gen-dropzone" onClick={() => genFileInputRef2.current?.click()}>
                        {genModelPhoto ? (
                          <div className="ps-gen-dropzone-preview">
                            <img src={genModelPhoto.url} alt="" crossOrigin="anonymous" />
                            <button className="ps-gen-dropzone-remove" onClick={(e) => { e.stopPropagation(); setGenModelPhoto(null); }}>
                              <X size={10} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <User size={20} />
                            <span className="ps-gen-dropzone-label">ФОТОМОДЕЛЬ</span>
                            <span className="ps-gen-dropzone-hint">фото модели</span>
                          </>
                        )}
                        <input ref={genFileInputRef2} type="file" accept="image/*" hidden onChange={handleGenFileSelect(setGenModelPhoto)} />
                      </div>
                    </div>

                    {availablePhotos.length > 0 && (
                      <div className="ps-gen-available">
                        <span className="ps-gen-available-label">Фото товара:</span>
                        <div className="ps-gen-available-grid">
                          {availablePhotos.map((p, i) => (
                            <button key={p.id} className="ps-gen-available-thumb" title={`Выбрать как ${!genGarmentPhoto ? 'изделие' : 'фотомодель'}`} onClick={() => {
                              if (!genGarmentPhoto) setGenGarmentPhoto(p);
                              else if (!genModelPhoto) setGenModelPhoto(p);
                            }}>
                              <img src={p.url} alt="" crossOrigin="anonymous" />
                              <span className="ps-gen-available-num">{i + 1}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {availablePhotos.length === 0 && !genGarmentPhoto && !genModelPhoto && (
                      <div className="ps-gen-hint-text">Доступные фото: нет — выберите товар слева или загрузите файлы</div>
                    )}
                  </div>
                )}

                {/* ========== Новая фотомодель ========== */}
                {genTab === 'new-model' && (
                  <div className="ps-gen-section">
                    <div className="ps-gen-section-title">Новая фотомодель (AI)</div>
                    <div className="ps-gen-section-desc">Загрузите фото изделия — AI создаст новую модель</div>

                    <div className="ps-gen-dropzones ps-gen-dropzones--single">
                      <div className="ps-gen-dropzone" onClick={() => genFileInputRef1.current?.click()}>
                        {genGarmentPhoto ? (
                          <div className="ps-gen-dropzone-preview">
                            <img src={genGarmentPhoto.url} alt="" crossOrigin="anonymous" />
                            <button className="ps-gen-dropzone-remove" onClick={(e) => { e.stopPropagation(); setGenGarmentPhoto(null); }}>
                              <X size={10} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <Upload size={20} />
                            <span className="ps-gen-dropzone-label">ИЗДЕЛИЕ</span>
                            <span className="ps-gen-dropzone-hint">одежда / аксессуар</span>
                          </>
                        )}
                        <input ref={genFileInputRef1} type="file" accept="image/*" hidden onChange={handleGenFileSelect(setGenGarmentPhoto)} />
                      </div>
                    </div>

                    {availablePhotos.length > 0 && (
                      <div className="ps-gen-available">
                        <span className="ps-gen-available-label">Фото товара:</span>
                        <div className="ps-gen-available-grid">
                          {availablePhotos.map((p, i) => (
                            <button key={p.id} className="ps-gen-available-thumb" onClick={() => setGenGarmentPhoto(p)}>
                              <img src={p.url} alt="" crossOrigin="anonymous" />
                              <span className="ps-gen-available-num">{i + 1}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {catalogModels.length > 0 && (
                      <div className="ps-gen-catalog-pick">
                        <span className="ps-gen-available-label">Тип модели:</span>
                        <div className="ps-gen-catalog-options">
                          {catalogModels.map((opt) => (
                            <button
                              key={opt.id || opt.label}
                              className={`ps-gen-catalog-option ${genNewModelPrompt === opt.prompt ? 'active' : ''}`}
                              onClick={() => setGenNewModelPrompt(opt.prompt)}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <input
                      type="text"
                      className="ps-gen-prompt-input"
                      value={genNewModelPrompt}
                      onChange={(e) => setGenNewModelPrompt(e.target.value)}
                      placeholder="Описание модели (необязательно)..."
                    />
                  </div>
                )}

                {/* ========== Свой промпт ========== */}
                {genTab === 'custom-prompt' && (
                  <div className="ps-gen-section">
                    <div className="ps-gen-section-title">Свой промпт</div>
                    <div className="ps-gen-section-desc">Напишите что угодно — AI обработает фото по вашему описанию</div>

                    <div className="ps-gen-dropzones ps-gen-dropzones--single">
                      <div className="ps-gen-dropzone" onClick={() => genSourceInputRef.current?.click()}>
                        {genSourcePhoto ? (
                          <div className="ps-gen-dropzone-preview">
                            <img src={genSourcePhoto.url} alt="" crossOrigin="anonymous" />
                            <button className="ps-gen-dropzone-remove" onClick={(e) => { e.stopPropagation(); setGenSourcePhoto(null); }}>
                              <X size={10} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <ImageIcon size={20} />
                            <span className="ps-gen-dropzone-label">ФОТО</span>
                            <span className="ps-gen-dropzone-hint">исходное изображение</span>
                          </>
                        )}
                        <input ref={genSourceInputRef} type="file" accept="image/*" hidden onChange={handleGenFileSelect(setGenSourcePhoto)} />
                      </div>
                    </div>

                    {availablePhotos.length > 0 && (
                      <div className="ps-gen-available">
                        <span className="ps-gen-available-label">Фото товара:</span>
                        <div className="ps-gen-available-grid">
                          {availablePhotos.map((p, i) => (
                            <button key={p.id} className="ps-gen-available-thumb" onClick={() => setGenSourcePhoto(p)}>
                              <img src={p.url} alt="" crossOrigin="anonymous" />
                              <span className="ps-gen-available-num">{i + 1}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <textarea
                      className="ps-gen-prompt-textarea"
                      value={genCustomPrompt}
                      onChange={(e) => setGenCustomPrompt(e.target.value)}
                      placeholder="Опишите, что сделать с фото..."
                      rows={4}
                    />
                  </div>
                )}

                {/* ========== Сцены ========== */}
                {genTab === 'scenes' && (
                  <div className="ps-gen-section">
                    <div className="ps-gen-section-title">Смена сцены / фона</div>
                    <div className="ps-gen-section-desc">Выберите фото и сцену — AI заменит фон</div>

                    <div className="ps-gen-dropzones ps-gen-dropzones--single">
                      <div className="ps-gen-dropzone" onClick={() => genSourceInputRef.current?.click()}>
                        {genSourcePhoto ? (
                          <div className="ps-gen-dropzone-preview">
                            <img src={genSourcePhoto.url} alt="" crossOrigin="anonymous" />
                            <button className="ps-gen-dropzone-remove" onClick={(e) => { e.stopPropagation(); setGenSourcePhoto(null); }}>
                              <X size={10} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <ImageIcon size={20} />
                            <span className="ps-gen-dropzone-label">ФОТО</span>
                            <span className="ps-gen-dropzone-hint">исходное фото</span>
                          </>
                        )}
                        <input ref={genSourceInputRef} type="file" accept="image/*" hidden onChange={handleGenFileSelect(setGenSourcePhoto)} />
                      </div>
                    </div>

                    {availablePhotos.length > 0 && (
                      <div className="ps-gen-available">
                        <span className="ps-gen-available-label">Фото товара:</span>
                        <div className="ps-gen-available-grid">
                          {availablePhotos.map((p, i) => (
                            <button key={p.id} className="ps-gen-available-thumb" onClick={() => setGenSourcePhoto(p)}>
                              <img src={p.url} alt="" crossOrigin="anonymous" />
                              <span className="ps-gen-available-num">{i + 1}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="ps-gen-catalog-pick">
                      <span className="ps-gen-available-label">Сцена:</span>
                      <div className="ps-gen-catalog-options">
                        {catalogScenes.length > 0 ? catalogScenes.map((opt) => (
                          <button
                            key={opt.id || opt.label}
                            className={`ps-gen-catalog-option ${genSelectedScene?.label === opt.label ? 'active' : ''}`}
                            onClick={() => setGenSelectedScene({ id: opt.id || opt.label, label: opt.label, quickAction: opt.quickAction! })}
                          >
                            {opt.label}
                          </button>
                        )) : (
                          <span className="ps-gen-hint-text">Нет доступных сцен в каталоге</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ========== Позы ========== */}
                {genTab === 'poses' && (
                  <div className="ps-gen-section">
                    <div className="ps-gen-section-title">Смена позы</div>
                    <div className="ps-gen-section-desc">Выберите фото и позу — AI изменит положение модели</div>

                    <div className="ps-gen-dropzones ps-gen-dropzones--single">
                      <div className="ps-gen-dropzone" onClick={() => genSourceInputRef.current?.click()}>
                        {genSourcePhoto ? (
                          <div className="ps-gen-dropzone-preview">
                            <img src={genSourcePhoto.url} alt="" crossOrigin="anonymous" />
                            <button className="ps-gen-dropzone-remove" onClick={(e) => { e.stopPropagation(); setGenSourcePhoto(null); }}>
                              <X size={10} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <ImageIcon size={20} />
                            <span className="ps-gen-dropzone-label">ФОТО</span>
                            <span className="ps-gen-dropzone-hint">фото с моделью</span>
                          </>
                        )}
                        <input ref={genSourceInputRef} type="file" accept="image/*" hidden onChange={handleGenFileSelect(setGenSourcePhoto)} />
                      </div>
                    </div>

                    {availablePhotos.length > 0 && (
                      <div className="ps-gen-available">
                        <span className="ps-gen-available-label">Фото товара:</span>
                        <div className="ps-gen-available-grid">
                          {availablePhotos.map((p, i) => (
                            <button key={p.id} className="ps-gen-available-thumb" onClick={() => setGenSourcePhoto(p)}>
                              <img src={p.url} alt="" crossOrigin="anonymous" />
                              <span className="ps-gen-available-num">{i + 1}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="ps-gen-catalog-pick">
                      <span className="ps-gen-available-label">Поза:</span>
                      <div className="ps-gen-catalog-options">
                        {catalogPoses.length > 0 ? catalogPoses.map((opt) => (
                          <button
                            key={opt.id || opt.label}
                            className={`ps-gen-catalog-option ${genSelectedPose?.label === opt.label ? 'active' : ''}`}
                            onClick={() => setGenSelectedPose({ id: opt.id || opt.label, label: opt.label, quickAction: opt.quickAction! })}
                          >
                            {opt.label}
                          </button>
                        )) : (
                          <span className="ps-gen-hint-text">Нет доступных поз в каталоге</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ========== Видео ========== */}
                {genTab === 'video' && (
                  <div className="ps-gen-section">
                    <div className="ps-gen-section-title">Генерация видео</div>
                    <div className="ps-gen-section-desc">Загрузите фото — AI создаст короткое видео с движением</div>

                    <div className="ps-gen-dropzones ps-gen-dropzones--single">
                      <div className="ps-gen-dropzone" onClick={() => genSourceInputRef.current?.click()}>
                        {genSourcePhoto ? (
                          <div className="ps-gen-dropzone-preview">
                            <img src={genSourcePhoto.url} alt="" crossOrigin="anonymous" />
                            <button className="ps-gen-dropzone-remove" onClick={(e) => { e.stopPropagation(); setGenSourcePhoto(null); }}>
                              <X size={10} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <Video size={20} />
                            <span className="ps-gen-dropzone-label">ФОТО</span>
                            <span className="ps-gen-dropzone-hint">исходное фото</span>
                          </>
                        )}
                        <input ref={genSourceInputRef} type="file" accept="image/*" hidden onChange={handleGenFileSelect(setGenSourcePhoto)} />
                      </div>
                    </div>

                    {availablePhotos.length > 0 && (
                      <div className="ps-gen-available">
                        <span className="ps-gen-available-label">Фото товара:</span>
                        <div className="ps-gen-available-grid">
                          {availablePhotos.map((p, i) => (
                            <button key={p.id} className="ps-gen-available-thumb" onClick={() => setGenSourcePhoto(p)}>
                              <img src={p.url} alt="" crossOrigin="anonymous" />
                              <span className="ps-gen-available-num">{i + 1}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {catalogVideos.length > 0 && (
                      <div className="ps-gen-catalog-pick">
                        <span className="ps-gen-available-label">Тип движения:</span>
                        <div className="ps-gen-catalog-options">
                          {catalogVideos.map((v) => (
                            <button
                              key={v.id}
                              className={`ps-gen-catalog-option ${genVideoPrompt === v.prompt ? 'active' : ''}`}
                              onClick={() => setGenVideoPrompt(genVideoPrompt === v.prompt ? '' : v.prompt)}
                            >
                              {v.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <input
                      type="text"
                      className="ps-gen-prompt-input"
                      value={genVideoPrompt}
                      onChange={(e) => setGenVideoPrompt(e.target.value)}
                      placeholder="Или введите своё описание движения..."
                    />
                  </div>
                )}
              </div>

              {/* Run button */}
              <div className="ps-gen-footer">
                <button
                  className="ps-gen-run-btn"
                  onClick={handleGenRun}
                  disabled={genRunning || isStreaming}
                >
                  {genRunning ? (
                    <><Loader2 size={16} className="ps-spin" /> Выполняю...</>
                  ) : (
                    <><Play size={16} /> Запустить</>
                  )}
                </button>
              </div>
            </div>
          )}

          {isDrag && (
            <div className="ps-drag-overlay">
              <Paperclip size={24} />
              <span>Отпустите — фото прикрепится</span>
              <span className="ps-drag-sub">До 3 фото ({attachedPhotos.length}/3)</span>
            </div>
          )}
        </div>

        {!rightCollapsed ? (
          <aside className={`ps-sidebar ps-sidebar--history ${rightExpanded ? 'ps-sidebar--history--expanded' : ''}`}>
            <div className="ps-side-head">
              <div className="ps-side-title-row">
                <Sparkles size={16} />
                <span>История</span>
              </div>
              <div className="ps-history-head-actions">
                <button className="ps-side-collapse" onClick={() => setRightExpanded(v => !v)} title={rightExpanded ? 'Сжать' : 'Развернуть'}>
                  {rightExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
                <button className="ps-side-collapse" onClick={() => setRightCollapsed(true)} title="Свернуть">
                  <PanelRightClose size={16} />
                </button>
              </div>
            </div>

            <div className="ps-sidebar-body">
              <div className="ps-history-hint">
                Перетащите фото в карточку товара или выберите для редактирования
              </div>

              <div className="ps-history-counters">
                <span className={`ps-history-counter ${historyTab === 'image' ? 'ps-history-counter--active' : ''}`} onClick={() => setHistoryTab('image')}>
                  <Camera size={12} />
                  {historyPhotos.length}/100
                </span>
                <span className={`ps-history-counter ${historyTab === 'video' ? 'ps-history-counter--active' : ''}`} onClick={() => setHistoryTab('video')}>
                  <Video size={12} />
                  {historyVideos.length}/50
                </span>
              </div>

              <div className="ps-history-subtitle">
                {historyTab === 'image' ? `ФОТО (${historyPhotos.length})` : `ВИДЕО (${historyVideos.length})`}
              </div>

              {(historyTab === 'image' ? historyPhotos : historyVideos).length === 0 ? (
                <div className="ps-sidebar-empty">
                  <ImageIcon size={24} />
                  <span>Нет {historyTab === 'image' ? 'фото' : 'видео'}</span>
                  <span className="ps-empty-sub">Прикрепите фото и отправьте команду</span>
                </div>
              ) : (
                <div className="ps-history-grid">
                  {(historyTab === 'image' ? historyPhotos : historyVideos).map((p) => (
                    <div
                      key={p.id}
                      className="ps-history-item"
                      onMouseEnter={(e) => handleHistoryMouseEnter(e, p)}
                      onMouseLeave={handleHistoryMouseLeave}
                    >
                      <div className="ps-history-thumb-wrap">
                        <button
                          className="ps-history-thumb"
                          draggable
                          onDragStart={(e) => handleHistoryDragStart(e, p)}
                          onClick={() => setPreviewPhoto(p)}
                          onDoubleClick={(e) => { e.preventDefault(); if (canAttachMore) attachByUrl(p.url, p.assetId); }}
                          title="Клик — просмотр | Двойной клик — прикрепить к чату"
                        >
                          {p.type === 'video' ? (
                            <video src={p.url} crossOrigin="anonymous" />
                          ) : (
                            <img src={p.url} alt="" crossOrigin="anonymous" />
                          )}
                        </button>
                        {/* Hover actions overlay */}
                        <div className={`ps-history-hover-actions ${hoveredHistoryId === p.id ? 'visible' : ''}`}>
                          <button onClick={() => handleDownload(p)} title="Скачать">
                            <Download size={13} />
                          </button>
                          <button onClick={() => deleteHistoryPhoto(p.id)} title="Удалить">
                            <Trash2 size={13} />
                          </button>
                          <button onClick={() => { setGalleryAddPhoto(p); setGalleryAddType('scene'); }} title="В галерею">
                            <Plus size={13} />
                          </button>
                        </div>
                        {/* Hover prompt tooltip */}
                        {hoveredHistoryId === p.id && p.prompt && (
                          <div className="ps-history-prompt-tip">
                            {p.prompt}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        ) : (
          <aside className="ps-sidebar-collapsed ps-sidebar-collapsed--right">
            <button className="ps-side-collapse" onClick={() => setRightCollapsed(false)}>
              <PanelRight size={16} />
            </button>
          </aside>
        )}
      </div>

      {samplesOpen && (
        <div className="ps-modal-overlay ps-modal-overlay--floating" onClick={() => setSamplesOpen(false)}>
          <div className="ps-modal-card ps-modal-card--gallery" onClick={(e) => e.stopPropagation()}>
            <div className="ps-modal-head">
              <h3>Образцы</h3>
              <div className="ps-modal-head-actions">
                <button title="Развернуть"><ExternalLink size={14} /></button>
                <button onClick={() => setSamplesOpen(false)}><X size={16} /></button>
              </div>
            </div>

            <div className="ps-gallery-section">
              <div className="ps-gallery-headline">
                <Star size={14} />
                <span>Системные</span>
              </div>
              <div className="ps-gallery-type-tabs">
                <button className={galleryType === 'scene' ? 'active' : ''} onClick={() => setGalleryType('scene')}>Локации</button>
                <button className={galleryType === 'model' ? 'active' : ''} onClick={() => setGalleryType('model')}>Модели</button>
              </div>
              {galleryLoading ? (
                <div className="ps-modal-empty"><Loader2 size={16} className="ps-spin" /> Загрузка...</div>
              ) : (
                <div className="ps-gallery-grid">
                  {gallerySystemAssets.length === 0
                    ? Array.from({ length: 12 }).map((_, idx) => (
                      <div key={`placeholder-${idx}`} className="ps-gallery-tile ps-gallery-tile--placeholder">
                        <Star size={18} />
                      </div>
                    ))
                    : gallerySystemAssets.slice(0, 12).map((asset) => (
                      <button key={`sys-${asset.id}`} className="ps-gallery-tile" onClick={() => handleGallerySelect(asset)}>
                        <img src={asset.url} alt={asset.name} crossOrigin="anonymous" />
                      </button>
                    ))}
                </div>
              )}
            </div>

            <div className="ps-gallery-divider" />

            <div className="ps-gallery-section">
              <div className="ps-gallery-headline">
                <Folder size={14} />
                <span>Мои образцы</span>
              </div>
              <div className="ps-gallery-type-tabs">
                <button className={galleryType === 'scene' ? 'active' : ''} onClick={() => setGalleryType('scene')}>Локации</button>
                <button className={galleryType === 'model' ? 'active' : ''} onClick={() => setGalleryType('model')}>Модели</button>
              </div>
              <div className="ps-gallery-grid">
                <button
                  className="ps-gallery-upload"
                  onClick={() => galleryUploadInputRef.current?.click()}
                  disabled={galleryUploading}
                >
                  {galleryUploading ? <Loader2 size={16} className="ps-spin" /> : <Upload size={16} />}
                  <span>{galleryUploading ? 'Загрузка...' : 'Загрузить'}</span>
                </button>

                {galleryUserAssets.slice(0, 11).map((asset) => (
                  <button key={`my-${asset.id}`} className="ps-gallery-tile" onClick={() => handleGallerySelect(asset)}>
                    <img src={asset.url} alt={asset.name} crossOrigin="anonymous" />
                  </button>
                ))}

                {galleryUserAssets.length === 0 ? (
                  <div className="ps-gallery-empty">Пока нет личных образцов</div>
                ) : null}
              </div>
              <input
                ref={galleryUploadInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={handleGalleryUpload}
              />
            </div>
          </div>
        </div>
      )}

      {instructionsOpen && (
        <div className="ps-modal-overlay" onClick={() => setInstructionsOpen(false)}>
          <div className="ps-modal-card ps-modal-card--narrow" onClick={(e) => e.stopPropagation()}>
            <div className="ps-modal-head">
              <h3>Как пользоваться</h3>
              <button onClick={() => setInstructionsOpen(false)}><X size={16} /></button>
            </div>
            <div className="ps-instructions">
              <p>1. Выберите товар и прикрепите фото из карточки или загрузите своё.</p>
              <p>2. Используйте быстрые команды или напишите запрос вручную.</p>
              <p>3. Готовые результаты появятся в правой колонке «История».</p>
              <p>4. Если фото не видно, откройте «Галерея образцов» и прикрепите заново.</p>
              <p>5. Перетащите фото из «История» на слот слева, чтобы обновить фото карточки WB.</p>
            </div>
          </div>
        </div>
      )}

      {previewPhoto && (
        <div className="ps-preview-overlay" onClick={() => setPreviewPhoto(null)}>
          <button className="ps-preview-close"><X size={24} /></button>
          <div className="ps-preview-content" onClick={(e) => e.stopPropagation()}>
            {previewPhoto.type === 'video' ? (
              <video src={previewPhoto.url} controls autoPlay crossOrigin="anonymous" className="ps-preview-img" />
            ) : (
              <img src={previewPhoto.url} alt="" crossOrigin="anonymous" className="ps-preview-img" />
            )}
            {previewPhoto.prompt && (
              <div className="ps-preview-prompt">{previewPhoto.prompt}</div>
            )}
            <div className="ps-preview-actions">
              <button onClick={() => handleDownload(previewPhoto)}>
                <Download size={16} /> Скачать
              </button>
              <button onClick={() => { attachByUrl(previewPhoto.url, previewPhoto.assetId); setPreviewPhoto(null); }} disabled={!canAttachMore}>
                <Paperclip size={16} /> В чат
              </button>
              {selectedProduct && (
                <button onClick={() => { addGeneratedPhotoToCard(previewPhoto); setPreviewPhoto(null); }}>
                  <Plus size={16} /> В карточку
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Gallery add modal */}
      {galleryAddPhoto && (
        <div className="ps-modal-overlay" onClick={() => setGalleryAddPhoto(null)}>
          <div className="ps-modal-card ps-modal-card--narrow" onClick={(e) => e.stopPropagation()}>
            <div className="ps-modal-head">
              <h3>Добавить в галерею</h3>
              <button onClick={() => setGalleryAddPhoto(null)}><X size={16} /></button>
            </div>
            <div className="ps-gallery-add-body">
              <div className="ps-gallery-add-preview">
                <img src={galleryAddPhoto.url} alt="" crossOrigin="anonymous" />
              </div>
              <div className="ps-gallery-add-options">
                <span className="ps-gallery-add-label">Добавить как:</span>
                <div className="ps-gallery-add-btns">
                  <button
                    className={`ps-gallery-add-type-btn ${galleryAddType === 'scene' ? 'active' : ''}`}
                    onClick={() => setGalleryAddType('scene')}
                  >
                    <Mountain size={14} /> Локация
                  </button>
                  <button
                    className={`ps-gallery-add-type-btn ${galleryAddType === 'model' ? 'active' : ''}`}
                    onClick={() => setGalleryAddType('model')}
                  >
                    <User size={14} /> Модель
                  </button>
                </div>
                <button
                  className="ps-gallery-add-confirm"
                  onClick={() => galleryAddPhoto && addPhotoToGallery(galleryAddPhoto, galleryAddType)}
                  disabled={galleryAdding}
                >
                  {galleryAdding ? (
                    <><Loader2 size={14} className="ps-spin" /> Добавляю...</>
                  ) : (
                    <><Plus size={14} /> Добавить</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Hover enlarge tooltip */}
      {hoverPreview && (
        <div
          className="ps-hover-enlarge"
          style={{
            top: Math.max(8, Math.min(hoverPreview.rect.top - 20, window.innerHeight - 420)),
            left: Math.max(8, hoverPreview.rect.left - 292),
          }}
        >
          {hoverPreview.photo.type === 'video' ? (
            <video src={hoverPreview.photo.url} crossOrigin="anonymous" autoPlay muted loop className="ps-hover-enlarge-img" />
          ) : (
            <img src={hoverPreview.photo.url} alt="" crossOrigin="anonymous" className="ps-hover-enlarge-img" />
          )}
          {hoverPreview.photo.prompt && (
            <div className="ps-hover-enlarge-prompt">{hoverPreview.photo.prompt}</div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  msg,
  onPhotoClick,
  onPhotoDragStart,
  selectMode = false,
  isSelected = false,
  onToggleSelect,
}: {
  msg: ChatMessage;
  onPhotoClick: (photo: PhotoMedia) => void;
  onPhotoDragStart: (e: React.DragEvent, photo: PhotoMedia) => void;
  selectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const isUser = msg.role === 'user';
  const isWelcome = msg.type === 'welcome';
  const isSelectable = selectMode && msg.type !== 'welcome';

  return (
    <div
      className={`ps-msg ${isUser ? 'ps-msg--user' : 'ps-msg--bot'} ${isWelcome ? 'ps-msg--welcome' : ''} ${isSelectable ? 'ps-msg--selectable' : ''} ${isSelected ? 'ps-msg--selected' : ''}`}
      onClick={() => isSelectable && onToggleSelect?.(msg.id)}
    >
      <div className="ps-msg-avatar">
        {isSelectable && (
          <div className={`ps-msg-checkbox ${isSelected ? 'ps-msg-checkbox--checked' : ''}`}>
            {isSelected && <span>✓</span>}
          </div>
        )}
        {!isSelectable && (isUser ? <User size={16} /> : <Bot size={16} />)}
      </div>
      <div className="ps-msg-body">
        {msg.content && (
          <div className="ps-msg-text">
            {msg.isLoading && <Loader2 size={14} className="ps-inline-loader ps-spin" />}
            {msg.content}
          </div>
        )}
        {msg.photos && msg.photos.length > 0 && (
          <div className="ps-msg-photos">
            {msg.photos.map((p) => (
              <div
                key={p.id}
                className="ps-msg-photo"
                draggable
                onDragStart={(e) => onPhotoDragStart(e, p)}
                onClick={() => onPhotoClick(p)}
              >
                {p.type === 'video' ? (
                  <video src={p.url} crossOrigin="anonymous" />
                ) : (
                  <img src={p.url} alt="" crossOrigin="anonymous" />
                )}
                <div className="ps-msg-photo-drag-hint">
                  <GripVertical size={12} />
                </div>
              </div>
            ))}
          </div>
        )}
        <span className="ps-msg-time">
          {msg.timestamp.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}
