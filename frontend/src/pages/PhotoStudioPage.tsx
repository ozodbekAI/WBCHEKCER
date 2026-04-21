import ProxiedImg from '../components/ProxiedImg';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useStore } from '../contexts/StoreContext';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api, { API_ORIGIN } from '../api/client';
import { useIsMobile } from '../hooks/use-mobile';
import { applyStreamErrorToMessages, parseSsePayloads, upsertGeneratedPhoto } from '../lib/photoChatStream';
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
  ShoppingBag,
} from 'lucide-react';
import { toast } from 'sonner';

interface PhotoMedia {
  id: string;
  assetId?: number;
  url: string;
  fileName?: string;
  type: 'image' | 'video';
  prompt?: string;
  localFile?: File;
}

interface ThreadContextState {
  last_generated_asset_id: number | null;
  working_asset_ids: number[];
  pending_question: string | null;
  last_action: Record<string, any> | null;
  locale: string | null;
}

interface ThreadMeta {
  id: number;
  preview: string;
  createdAt: string;
  updatedAt?: string;
  messageCount: number;
  isActive?: boolean;
}

const THREADS_STORAGE_KEY = 'photo_studio_threads';

function loadStoredThreads(): ThreadMeta[] {
  try {
    const raw = localStorage.getItem(THREADS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveStoredThreads(threads: ThreadMeta[]) {
  try {
    localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(threads.slice(0, 50)));
  } catch { /* ignore */ }
}

function upsertThread(threads: ThreadMeta[], meta: ThreadMeta): ThreadMeta[] {
  const idx = threads.findIndex((t) => t.id === meta.id);
  if (idx >= 0) {
    const next = [...threads];
    next[idx] = { ...next[idx], ...meta };
    return next;
  }
  return [meta, ...threads];
}

function mapServerThreadMeta(thread: any): ThreadMeta | null {
  const id = Number(thread?.id || 0);
  if (!Number.isFinite(id) || id <= 0) return null;

  const createdAt = String(thread?.created_at || thread?.updated_at || new Date().toISOString());
  const updatedAt = String(thread?.updated_at || thread?.created_at || createdAt);
  return {
    id,
    preview: String(thread?.preview || 'Новый чат'),
    createdAt,
    updatedAt,
    messageCount: Number(thread?.message_count || 0),
    isActive: Boolean(thread?.is_active),
  };
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
  threadId?: number;
  requestId?: string;
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

type StreamIndicatorMode = 'typing' | 'image';

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

const MEDIA_BASE = API_ORIGIN;

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

function uid(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toAbsoluteMediaUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) return `${MEDIA_BASE}${url}`;
  return `${MEDIA_BASE}/${url}`;
}

function fileNameFromUrl(url: string) {
  const safe = (url || '').split('?')[0].split('#')[0];
  const parts = safe.split('/');
  return parts[parts.length - 1] || 'image.jpg';
}

function prependUniquePhoto(list: PhotoMedia[], photo: PhotoMedia) {
  const exists = list.some((item) => (photo.assetId ? item.assetId === photo.assetId : false) || item.url === photo.url);
  return exists ? list : [photo, ...list];
}

function buildStreamMediaPhoto(event: any): PhotoMedia | null {
  const mediaUrl = toAbsoluteMediaUrl(event?.image_url || event?.url || event?.file_url || '');
  if (!mediaUrl) return null;

  const assetId = Number(event?.asset_id || event?.assetId || 0) || undefined;
  const fileName = String(event?.file_name || event?.filename || fileNameFromUrl(mediaUrl));
  const explicitMediaType = String(event?.media_type || '').toLowerCase();
  const isVideo = explicitMediaType === 'video' || /\.(mp4|mov|webm)/i.test(mediaUrl) || /\.(mp4|mov|webm)/i.test(fileName);

  return {
    id: assetId ? `gen-${assetId}` : `gen-${Date.now()}`,
    assetId,
    url: mediaUrl,
    fileName,
    type: isVideo ? 'video' : 'image',
    prompt: event?.prompt ? String(event.prompt) : undefined,
  };
}

function StreamActivityIndicator({ mode }: { mode: StreamIndicatorMode }) {
  return (
    <div className="ps-typing">
      <div className="ps-msg-avatar"><Bot size={16} /></div>
      {mode === 'image' ? (
        <div className="ps-typing-visual">
          <div className="ps-gen-anim ps-gen-anim--indicator">
            <div className="ps-gen-anim-shimmer">
              <div className="ps-gen-anim-icon">
                <Sparkles size={20} />
              </div>
              <div className="ps-gen-anim-bars">
                <div className="ps-gen-anim-bar" style={{ animationDelay: '0s' }} />
                <div className="ps-gen-anim-bar" style={{ animationDelay: '0.15s' }} />
                <div className="ps-gen-anim-bar" style={{ animationDelay: '0.3s' }} />
              </div>
            </div>
          </div>
          <div className="ps-typing-label">Создаю изображение...</div>
        </div>
      ) : (
        <div className="ps-typing-dots"><span /><span /><span /></div>
      )}
    </div>
  );
}

type MobileTab = 'chat' | 'generator' | 'history' | 'products';

export default function PhotoStudioPage() {
  const { activeStore, loadStores } = useStore();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
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
  const [isBotTyping, setIsBotTyping] = useState(false);
  const [botIndicatorMode, setBotIndicatorMode] = useState<StreamIndicatorMode | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [contextState, setContextState] = useState<ThreadContextState>({
    last_generated_asset_id: null,
    working_asset_ids: [],
    pending_question: null,
    last_action: null,
    locale: null,
  });
  const [mode, setMode] = useState<'chat' | 'generator'>(initialMode);
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');
  const [threadList, setThreadList] = useState<ThreadMeta[]>(() => loadStoredThreads());
  const [threadDropdownOpen, setThreadDropdownOpen] = useState(false);
  const threadDropdownRef = useRef<HTMLDivElement>(null);
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
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [lastApplyResult, setLastApplyResult] = useState<{
    matched: boolean;
    missing_urls?: string[];
    unexpected_urls?: string[];
    stabilized?: boolean;
    requested_order?: string[];
    actual_order?: string[];
  } | null>(null);

  // Gallery add from history
  const [galleryAddPhoto, setGalleryAddPhoto] = useState<PhotoMedia | null>(null);
  const [galleryAddType, setGalleryAddType] = useState<'scene' | 'model'>('scene');
  const [galleryAdding, setGalleryAdding] = useState(false);
  const [galleryAddRect, setGalleryAddRect] = useState<DOMRect | null>(null);

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
  const [genSelectedModel, setGenSelectedModel] = useState<{ id?: string; label: string; prompt: string; quickAction?: Record<string, any> } | null>(null);
  const [genSelectedScene, setGenSelectedScene] = useState<{ id: string; label: string; quickAction: Record<string, any> } | null>(null);
  const [genSelectedPose, setGenSelectedPose] = useState<{ id: string; label: string; quickAction: Record<string, any> } | null>(null);
  const [genSelectedVideo, setGenSelectedVideo] = useState<{ id: string; label: string; prompt: string; quickAction: Record<string, any> } | null>(null);
  const [genRunning, setGenRunning] = useState(false);
  const [genShowProductPicker, setGenShowProductPicker] = useState(false);
  const [genLatestResult, setGenLatestResult] = useState<PhotoMedia | null>(null);
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

  // Thread dropdown click-outside
  useEffect(() => {
    if (!threadDropdownOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const node = e.target as Node | null;
      if (threadDropdownRef.current && node && !threadDropdownRef.current.contains(node)) {
        setThreadDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [threadDropdownOpen]);

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
      const data = await api.getPhotoCatalogAll();

      const scenes = (Array.isArray(data?.scenes) ? data.scenes : []).map((item: any) => ({
        id: `scene-${item?.id}`,
        label: String(item?.label || item?.name || `Сцена ${item?.id || ''}`),
        prompt: String(item?.prompt || ''),
        quickAction: { type: 'change-background', scene_item_id: Number(item?.id || 0), scene_prompt: String(item?.prompt || '') },
      })).filter((item: any) => item.quickAction.scene_item_id > 0);

      const poses = (Array.isArray(data?.poses) ? data.poses : []).map((item: any) => ({
        id: `pose-${item?.id}`,
        label: String(item?.label || item?.name || `Поза ${item?.id || ''}`),
        prompt: String(item?.prompt || ''),
        quickAction: { type: 'change-pose', pose_prompt_id: Number(item?.id || 0), pose_prompt: String(item?.prompt || '') },
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
        quickAction: {
          type: 'generate-video',
          video_scenario_id: Number(item?.id || 0),
          prompt: String(item?.prompt || ''),
          model: String(item?.model || 'hailuo/minimax-video-01-live'),
          duration: Number(item?.duration || 5),
          resolution: String(item?.resolution || '720p'),
        },
      })).filter((item: any) => item.quickAction.video_scenario_id > 0);

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
      toast.error('Не удалось загрузить каталог фотостудии');
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
      const data = await api.getPhotoGalleryAssets(type);
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
      toast.error('Не удалось загрузить галерею образцов');
      setGalleryAssets([]);
    } finally {
      setGalleryLoading(false);
    }
  };

  const refreshThreadList = useCallback(async (preferredThreadId?: number | null) => {
    try {
      const data = await api.listPhotoThreads();
      const mapped = (Array.isArray(data?.threads) ? data.threads : [])
        .map((thread: any) => mapServerThreadMeta(thread))
        .filter((thread: ThreadMeta | null): thread is ThreadMeta => thread !== null);

      if (mapped.length > 0) {
        setThreadList(mapped);
        saveStoredThreads(mapped);
      } else {
        setThreadList([]);
        saveStoredThreads([]);
      }

      const nextActiveThreadId = Number(preferredThreadId || data?.active_thread_id || 0) || null;
      if (nextActiveThreadId) {
        setActiveThreadId(nextActiveThreadId);
      }

      return mapped;
    } catch (e) {
      console.warn('Failed to refresh thread list', e);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!samplesOpen) return;
    void loadGalleryAssets(galleryType);
  }, [samplesOpen, galleryType]);

  useEffect(() => {
    (async () => {
      try {
        const [data] = await Promise.all([
          api.getPhotoChatHistory(),
          refreshThreadList(),
        ]);

        // Thread info
        if (data.active_thread_id) setActiveThreadId(data.active_thread_id);
        else if (data.thread_id) setActiveThreadId(data.thread_id);
        if (data.context_state) setContextState(data.context_state);

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


          // For image-type messages, try to build photo from content URL if no asset_ids
          if (m.msg_type === 'image' && photos.length === 0 && m.content) {
            const imgUrl = toAbsoluteMediaUrl(m.content);
            if (imgUrl) {
              photos.push({
                id: `msg-img-${dbId}`,
                url: imgUrl,
                type: /\.(mp4|mov|webm)/i.test(imgUrl) ? 'video' : 'image',
              });
            }
          }

          return {
            id: `db-${dbId}`,
            dbId,
            role,
            type: m.msg_type === 'image' ? 'image' : 'text',
            content: m.msg_type === 'image' ? '' : (m.content || ''),
            timestamp: m.created_at ? new Date(m.created_at) : new Date(),
            photos: photos.length ? photos : undefined,
            threadId: m.thread_id,
            requestId: m.request_id,
          };
        });

        // Build generatedPhotos from ALL session assets (session-scoped persistent media)
        const genPhotos = assets
          .map((a: any) => ({
            id: `asset-${a.asset_id}`,
            assetId: a.asset_id,
            url: toAbsoluteMediaUrl(a.file_url),
            fileName: a.file_name,
            type: (/\.(mp4|mov|webm)/i.test(a.file_url || '') ? 'video' : 'image') as 'image' | 'video',
            prompt: a.prompt || a.caption || '',
          }))
          .filter((p: PhotoMedia) => !!p.url)
          .reverse();

        setGeneratedPhotos(genPhotos);

        // Track thread locally even if thread list refresh is temporarily unavailable.
        const threadId = data.active_thread_id || data.thread_id;
        if (threadId) {
          const firstUserMsg = rawMsgs.find((m: any) => m.role === 'user');
          const preview = firstUserMsg?.content?.slice(0, 60) || 'Новый чат';
          const created = rawMsgs[0]?.created_at || new Date().toISOString();
          setThreadList((prev) => {
            const next = upsertThread(prev, {
              id: threadId,
              preview,
              createdAt: created,
              updatedAt: created,
              messageCount: data.message_count || rawMsgs.length,
              isActive: true,
            });
            saveStoredThreads(next);
            return next;
          });
        }

        if (mapped.length > 0) {
          setMessages([WELCOME_MSG, ...mapped]);
        }
      } catch (e) {
        console.warn('Failed to load chat history', e);
        toast.error('Не удалось восстановить историю фотостудии');
      }
    })();
  }, [refreshThreadList]);

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
    const data = await api.uploadPhotoChatAsset(file);
    return { assetId: data.asset_id || data.id, url: toAbsoluteMediaUrl(data.file_url || data.url) };
  };

  const importUrlAsAsset = async (url: string): Promise<{ assetId?: number; url?: string }> => {
    const data = await api.importPhotoChatAsset(url);
    return { assetId: data.asset_id || data.id, url: toAbsoluteMediaUrl(data.file_url || data.url) };
  };

  const preparePhotoAssets = async (photos: PhotoMedia[]) => {
    const assetIds: number[] = [];
    const fallbackPhotoUrls: string[] = [];
    const failedPhotos: string[] = [];
    const addFallbackUrl = (raw?: string) => {
      const abs = toAbsoluteMediaUrl(raw || '');
      if (!abs || abs.startsWith('blob:')) return;
      if (!fallbackPhotoUrls.includes(abs)) fallbackPhotoUrls.push(abs);
    };
    const markFailed = (photo: PhotoMedia) => {
      failedPhotos.push(photo.fileName || fileNameFromUrl(photo.url) || 'image');
    };

    for (const p of photos) {
      if (p.localFile) {
        try {
          const result = await uploadFile(p.localFile);
          if (result.assetId) {
            assetIds.push(result.assetId);
          } else {
            addFallbackUrl(result.url);
            if (!result.url) markFailed(p);
          }
        } catch (e) {
          console.warn('Upload failed:', e);
          markFailed(p);
        }
        continue;
      }

      if (p.assetId) {
        assetIds.push(p.assetId);
        continue;
      }

      if (!p.url) continue;

      try {
        const imported = await importUrlAsAsset(p.url);
        if (imported.assetId) {
          assetIds.push(imported.assetId);
        } else {
          const fallbackCountBefore = fallbackPhotoUrls.length;
          addFallbackUrl(imported.url || p.url);
          if (fallbackPhotoUrls.length === fallbackCountBefore) markFailed(p);
        }
      } catch (e) {
        console.warn('Import failed:', e);
        const fallbackCountBefore = fallbackPhotoUrls.length;
        addFallbackUrl(p.url);
        if (fallbackPhotoUrls.length === fallbackCountBefore) markFailed(p);
      }
    }

    return {
      assetIds: Array.from(new Set(assetIds)),
      fallbackPhotoUrls,
      failedPhotos,
    };
  };

  const mapGeneratorAssetToPhoto = (asset: any): PhotoMedia | null => {
    const url = toAbsoluteMediaUrl(asset?.file_url || asset?.url || '');
    const assetId = Number(asset?.asset_id || asset?.id || 0);
    if (!url || assetId <= 0) return null;
    return {
      id: `asset-${assetId}`,
      assetId,
      url,
      fileName: asset?.file_name || fileNameFromUrl(url),
      type: (/\.(mp4|mov|webm)/i.test(url) ? 'video' : 'image') as 'image' | 'video',
      prompt: asset?.prompt || asset?.caption || '',
    };
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
    setIsBotTyping(true);
    setBotIndicatorMode('typing');
    let botMsgId = uid();
    let botAdded = false;
    let userMsg: ChatMessage | null = null;

    try {
      const {
        assetIds: uniqueAssetIds,
        fallbackPhotoUrls,
        failedPhotos,
      } = await preparePhotoAssets(photos);
      if (photos.length > 0 && uniqueAssetIds.length === 0 && fallbackPhotoUrls.length === 0) {
        throw new Error('Не удалось подготовить прикреплённые фото. Запрос не был отправлен.');
      }
      if (failedPhotos.length > 0) {
        toast.warning(`Часть вложений не удалось подготовить: ${failedPhotos.length}`);
      }

      userMsg = {
        id: uid(),
        role: 'user',
        type: photos.length > 0 && !normalizedText ? 'image' : 'text',
        content: normalizedText,
        timestamp: new Date(),
        photos: photos.length > 0 ? photos : undefined,
      };
      setMessages((prev) => [...prev, userMsg as ChatMessage]);
      setInputText('');
      setAttachedPhotos([]);

      const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const requestMessage = normalizedText || (quickAction ? 'Быстрая команда' : '');
      const body: any = { message: requestMessage, request_id: requestId };
      if (activeThreadId) body.thread_id = activeThreadId;
      if (uniqueAssetIds.length > 0) body.asset_ids = uniqueAssetIds;
      if (fallbackPhotoUrls.length > 0) body.photo_urls = fallbackPhotoUrls;
      if (quickAction) body.quick_action = quickAction;
      console.log('[PhotoStudio] Sending stream request payload:', {
        request_id: requestId,
        thread_id: body.thread_id || null,
        asset_ids: body.asset_ids || [],
        photo_urls: body.photo_urls || [],
        quick_action: body.quick_action || null,
      });

      const res = await api.streamPhotoChat(body);
      console.log('[PhotoStudio] Stream response status:', res.status, res.statusText);
      console.log('[PhotoStudio] Response headers:', Object.fromEntries(res.headers.entries()));
      if (!res.ok) {
        const errBody = await res.text();
        console.error('[PhotoStudio] Non-OK response body:', errBody);
        throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 300)}`);
      }

      const reader = res.body?.getReader();
      const dec = new TextDecoder();
      let botContent = '';
      let botPhotos: PhotoMedia[] = [];
      let streamThreadId = activeThreadId;
      let sawGenerationStart = false;
      let sawGeneratedMedia = false;

      const addOrUpdateBot = (type: ChatMessage['type'] = 'text', loading = false) => {
        setIsBotTyping(false);
        setBotIndicatorMode(null);
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

      const syncRequestResultsFromHistory = async () => {
        const history = await api.getPhotoChatHistory(streamThreadId || undefined);
        if (history?.active_thread_id) setActiveThreadId(history.active_thread_id);
        else if (history?.thread_id) setActiveThreadId(history.thread_id);
        if (history?.context_state) setContextState(history.context_state);

        if (!history?.messages) return false;

        const resultMsgs = history.messages.filter(
          (item: any) => item.request_id === requestId && item.role === 'model',
        );
        if (!resultMsgs.length) return false;

        const nextPhotos: PhotoMedia[] = [];
        for (const resultMsg of resultMsgs) {
          if (resultMsg.msg_type === 'image' && Array.isArray(resultMsg.meta?.asset_ids)) {
            for (const assetId of resultMsg.meta.asset_ids) {
              const asset = history.assets?.find((entry: any) => Number(entry.asset_id) === Number(assetId));
              const photo = buildStreamMediaPhoto({
                asset_id: asset?.asset_id,
                image_url: asset?.file_url,
                file_name: asset?.file_name,
                prompt: asset?.prompt || asset?.caption,
              });
              if (photo) nextPhotos.push(photo);
            }
          }
          if (resultMsg.msg_type === 'text' && resultMsg.content) {
            botContent = String(resultMsg.content);
          }
        }

        if (nextPhotos.length > 0) {
          botPhotos = nextPhotos.reduce<PhotoMedia[]>((acc, photo) => prependUniquePhoto(acc, photo), botPhotos);
          setGeneratedPhotos((prev) => nextPhotos.reduce((acc, photo) => upsertGeneratedPhoto(acc, photo), prev));
          sawGeneratedMedia = true;
        }

        if (!botContent && nextPhotos.length > 0) {
          botContent = 'Готово!';
        }

        if (botContent || nextPhotos.length > 0) {
          addOrUpdateBot(nextPhotos.length > 0 ? 'action-complete' : 'text', false);
        }

        return !!(botContent || nextPhotos.length > 0);
      };

      let receivedComplete = false;

      if (reader) {
        let buf = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const parsed = parseSsePayloads(buf, '');
            buf = parsed.buffer;

            for (const d of parsed.events) {
              try {
                if (d.type === 'ack') {
                  if (d.thread_id) {
                    streamThreadId = Number(d.thread_id);
                    setActiveThreadId(streamThreadId);
                    setThreadList((prev) => {
                      const nowIso = new Date().toISOString();
                      const next = upsertThread(prev, {
                        id: Number(d.thread_id),
                        preview: (normalizedText || 'Фото').slice(0, 60),
                        createdAt: prev.find((t) => t.id === Number(d.thread_id))?.createdAt || nowIso,
                        updatedAt: nowIso,
                        messageCount: (prev.find((t) => t.id === Number(d.thread_id))?.messageCount || 0) + 1,
                        isActive: true,
                      });
                      saveStoredThreads(next);
                      return next;
                    });
                  }
                  if (d.user_message_id) {
                    setMessages((prev) => prev.map((m) =>
                      userMsg && m.id === userMsg.id ? { ...m, dbId: d.user_message_id, threadId: d.thread_id, requestId: d.request_id } : m,
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
                  receivedComplete = true;
                }
                else if (d.type === 'images_start') {
                  sawGenerationStart = true;
                  setIsBotTyping(true);
                  setBotIndicatorMode('typing');
                  // Keep the typing indicator visible until the server confirms
                  // that image rendering has actually started.
                }
                else if (d.type === 'image_started') {
                  sawGenerationStart = true;
                  setIsBotTyping(true);
                  setBotIndicatorMode('image');
                }
                else if (d.type === 'generation_start') {
                  sawGenerationStart = true;
                  setIsBotTyping(true);
                  setBotIndicatorMode('image');
                }
                else if (d.type === 'generation_complete') {
                  const newPhoto = buildStreamMediaPhoto(d);
                  if (newPhoto) {
                    sawGeneratedMedia = true;
                    botPhotos = prependUniquePhoto(botPhotos, newPhoto);
                    setGeneratedPhotos((prev) => upsertGeneratedPhoto(prev, newPhoto));
                  }
                  const total = Number(d.total || 1);
                  const index = Number(d.index || total);
                  const hasMore = index < total;
                  setIsBotTyping(hasMore);
                  setBotIndicatorMode(hasMore ? 'image' : null);
                  botContent = hasMore
                    ? `Генерация изображения ${index} из ${total}...`
                    : 'Готово!';
                  addOrUpdateBot(hasMore ? 'action-progress' : 'action-complete', hasMore);
                  if (!hasMore && newPhoto) receivedComplete = true;
                }
                else if (d.type === 'media' || d.type === 'image') {
                  const photo = buildStreamMediaPhoto(d);
                  if (!photo) continue;
                  sawGeneratedMedia = true;
                  botPhotos = prependUniquePhoto(botPhotos, photo);
                  addOrUpdateBot('text');
                }
                else if (d.type === 'context_state' && d.context_state) {
                  setContextState(d.context_state);
                }
                else if (d.type === 'keepalive' || d.type === 'ping') {
                  // keepalive from server, ignore
                }
              } catch {
                // ignore broken chunk
              }
            }
          }
        } catch (streamErr: any) {
          console.warn('[PhotoStudio] Stream interrupted:', streamErr?.message);
          // Stream broke mid-flight — poll history to check if result arrived
          if (!receivedComplete && requestId) {
            console.log('[PhotoStudio] Polling history for request_id:', requestId);
            botContent = 'Соединение прервалось, проверяю результат...';
            addOrUpdateBot('action-progress', true);

            // Poll up to 12 times (every 10s = ~2 min) for result
            for (let attempt = 0; attempt < 12; attempt++) {
              await new Promise((r) => setTimeout(r, 10000));
              try {
                const found = await syncRequestResultsFromHistory();
                if (found) {
                    botContent = botContent || 'Готово!';
                    addOrUpdateBot('action-complete', false);
                    receivedComplete = true;
                    break;
                }
                botContent = `Ожидание результата... (${attempt + 1}/12)`;
                addOrUpdateBot('action-progress', true);
              } catch (pollErr) {
                console.warn('[PhotoStudio] Poll attempt failed:', pollErr);
              }
            }

            if (!receivedComplete) {
              botContent = 'Генерация ещё выполняется на сервере. Обновите страницу через пару минут, чтобы увидеть результат.';
              addOrUpdateBot('action-error');
            }
            // Don't re-throw — we handled it
            return;
          }
          // If no requestId or already complete, ignore the stream break
          if (receivedComplete) return;
          throw streamErr; // re-throw to outer catch
        }
      }

      if (sawGenerationStart && !sawGeneratedMedia && requestId) {
        try {
          const found = await syncRequestResultsFromHistory();
          if (found) receivedComplete = true;
        } catch (historyErr) {
          console.warn('[PhotoStudio] History reconciliation failed:', historyErr);
        }
      }

      if (!botAdded) {
        botContent = 'Готово.';
        addOrUpdateBot('text');
      }
    } catch (e: any) {
      console.error('[PhotoStudio] Stream error:', e);
      console.error('[PhotoStudio] Error name:', e?.name, '| message:', e?.message);
      console.error('[PhotoStudio] Stack:', e?.stack);
      const errDetail = e?.message || String(e);
      setMessages((prev) => applyStreamErrorToMessages(prev, {
        botAdded,
        botMsgId,
        errorText: `Ошибка соединения: ${errDetail}`,
        now: new Date(),
      }));
    } finally {
      setIsStreaming(false);
      setIsBotTyping(false);
      setBotIndicatorMode(null);
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
      await api.uploadUserPhotoAsset(file, {
        assetType: galleryType,
        name: file.name.replace(/\.[^.]+$/, '') || 'Sample',
      });
      await loadGalleryAssets(galleryType);
      toast.success('Образец добавлен в галерею');
    } catch (err) {
      console.error('Gallery upload error:', err);
      toast.error(err instanceof Error ? err.message : 'Не удалось загрузить образец');
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
    try {
      await api.clearPhotoChat(activeThreadId || undefined, 'all');
      setMessages([WELCOME_MSG]);
      setContextState({
        last_generated_asset_id: null,
        working_asset_ids: [],
        pending_question: null,
        last_action: null,
        locale: contextState.locale,
      });
      toast.success('История чата очищена');
    } catch (e) {
      console.error('Clear chat error', e);
      toast.error('Не удалось очистить историю чата');
    }
  };

  const startNewThread = async () => {
    try {
      const data = await api.createNewPhotoThread();
      const newThreadId = data.active_thread_id || data.thread_id;
      setActiveThreadId(newThreadId);
      if (data.context_state) setContextState(data.context_state);
      setMessages([WELCOME_MSG]);

      // Sync session-wide media library from response assets
      const assets: any[] = data.assets || [];
      const genPhotos = assets
        .map((a: any) => ({
          id: `asset-${a.asset_id}`,
          assetId: a.asset_id,
          url: toAbsoluteMediaUrl(a.file_url || ''),
          fileName: a.file_name,
          type: (/\.(mp4|mov|webm)/i.test(a.file_url || '') ? 'video' : 'image') as 'image' | 'video',
          prompt: a.prompt || a.caption || '',
        }))
        .filter((p: PhotoMedia) => !!p.url)
        .reverse();
      setGeneratedPhotos(genPhotos);

      // Track new thread
      if (newThreadId) {
        setThreadList((prev) => {
          const next = upsertThread(prev, {
            id: newThreadId,
            preview: 'Новый чат',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messageCount: 0,
            isActive: true,
          });
          saveStoredThreads(next);
          return next;
        });
        await refreshThreadList(newThreadId);
      }

      toast.success('Новый чат создан');
    } catch (e) {
      console.error('New thread error', e);
      toast.error('Не удалось создать новый чат');
    }
  };

  const deleteThread = async (threadId: number) => {
    try {
      const result = await api.deletePhotoThread(threadId);
      const mappedThreads = (Array.isArray(result?.threads) ? result.threads : [])
        .map((thread: any) => mapServerThreadMeta(thread))
        .filter((thread: ThreadMeta | null): thread is ThreadMeta => thread !== null);

      if (mappedThreads.length > 0) {
        setThreadList(mappedThreads);
        saveStoredThreads(mappedThreads);
      } else {
        setThreadList([]);
        saveStoredThreads([]);
      }

      const nextActiveThreadId = Number(result?.active_thread_id || 0) || null;
      if (threadId === activeThreadId && nextActiveThreadId) {
        const history = await api.getPhotoChatHistory(nextActiveThreadId);
        setActiveThreadId(nextActiveThreadId);
        if (history?.context_state) setContextState(history.context_state);

        const assets: any[] = history.assets || [];
        const rawMsgs: any[] = history.messages || [];
        const genPhotos = assets
          .map((a: any) => ({
            id: `asset-${a.asset_id}`,
            assetId: a.asset_id,
            url: toAbsoluteMediaUrl(a.file_url || ''),
            fileName: a.file_name,
            type: (/\.(mp4|mov|webm)/i.test(a.file_url || '') ? 'video' : 'image') as 'image' | 'video',
            prompt: a.prompt || a.caption || '',
          }))
          .filter((p: PhotoMedia) => !!p.url)
          .reverse();
        setGeneratedPhotos(genPhotos);

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

        const mappedMessages: ChatMessage[] = rawMsgs.map((m: any) => {
          const dbId = Number(m.id);
          const role: 'user' | 'assistant' = (m.role === 'model' || m.role === 'assistant') ? 'assistant' : 'user';
          const aids: number[] = (m.meta?.asset_ids || []).map(Number).filter(Boolean);
          const photos = aids.map((id) => assetMap.get(id)).filter(Boolean) as PhotoMedia[];

          if (m.msg_type === 'image' && photos.length === 0 && m.content) {
            const imgUrl = toAbsoluteMediaUrl(m.content);
            if (imgUrl) {
              photos.push({
                id: `msg-img-${dbId}`,
                url: imgUrl,
                type: /\.(mp4|mov|webm)/i.test(imgUrl) ? 'video' : 'image',
              });
            }
          }

          return {
            id: `db-${dbId}`,
            dbId,
            role,
            type: m.msg_type === 'image' ? 'image' : 'text',
            content: m.msg_type === 'image' ? '' : (m.content || ''),
            timestamp: m.created_at ? new Date(m.created_at) : new Date(),
            photos: photos.length ? photos : undefined,
            threadId: m.thread_id,
            requestId: m.request_id,
          };
        });

        setMessages(mappedMessages.length > 0 ? [WELCOME_MSG, ...mappedMessages] : [WELCOME_MSG]);
      } else if (threadId === activeThreadId) {
        setMessages([WELCOME_MSG]);
        setActiveThreadId(nextActiveThreadId);
      }
      toast.success('Чат удалён');
    } catch (e) {
      console.error('Delete thread error', e);
      toast.error('Не удалось удалить чат');
    }
  };

  const switchThread = async (threadId: number) => {
    if (threadId === activeThreadId) {
      setThreadDropdownOpen(false);
      return;
    }
    try {
      const data = await api.getPhotoChatHistory(threadId);
      const resolvedThreadId = data.thread_id || threadId;
      setActiveThreadId(resolvedThreadId);
      if (data.context_state) setContextState(data.context_state);

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

        if (m.msg_type === 'image' && photos.length === 0 && m.content) {
          const imgUrl = toAbsoluteMediaUrl(m.content);
          if (imgUrl) {
            photos.push({
              id: `msg-img-${dbId}`,
              url: imgUrl,
              type: /\.(mp4|mov|webm)/i.test(imgUrl) ? 'video' : 'image',
            });
          }
        }

        return {
          id: `db-${dbId}`,
          dbId,
          role,
          type: m.msg_type === 'image' ? 'image' : 'text',
          content: m.msg_type === 'image' ? '' : (m.content || ''),
          timestamp: m.created_at ? new Date(m.created_at) : new Date(),
          photos: photos.length ? photos : undefined,
          threadId: m.thread_id,
          requestId: m.request_id,
        };
      });

      const genPhotos = assets
        .map((a: any) => ({
          id: `asset-${a.asset_id}`,
          assetId: a.asset_id,
          url: toAbsoluteMediaUrl(a.file_url),
          fileName: a.file_name,
          type: (/\.(mp4|mov|webm)/i.test(a.file_url || '') ? 'video' : 'image') as 'image' | 'video',
          prompt: a.prompt || a.caption || '',
        }))
        .filter((p: PhotoMedia) => !!p.url)
        .reverse();
      setGeneratedPhotos(genPhotos);

      setMessages(mapped.length > 0 ? [WELCOME_MSG, ...mapped] : [WELCOME_MSG]);
      await refreshThreadList(resolvedThreadId);
      setThreadDropdownOpen(false);
    } catch (e) {
      console.error('Switch thread error', e);
      toast.error('Не удалось загрузить чат');
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
        await api.deletePhotoChatMessages(dbIds, activeThreadId || undefined);
      } catch (e) {
        console.error('Delete messages error', e);
        toast.error('Не удалось удалить выбранные сообщения');
      }
    }
    setMessages((prev) => prev.filter((m) => !ids.has(m.id)));
    setSelectedMsgIds(new Set());
    setChatSelectMode(false);
  };

  // Delete photo from history
  const deleteHistoryPhoto = async (photo: PhotoMedia) => {
    if (!photo.assetId) {
      setGeneratedPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      setMessages((prev) => prev.filter((msg) => !msg.photos?.some((item) => item.id === photo.id)));
      setGenLatestResult((prev) => (prev?.id === photo.id ? null : prev));
      setPreviewPhoto((prev) => (prev?.id === photo.id ? null : prev));
      return;
    }

    try {
      const result = await api.deletePhotoChatAssets([photo.assetId], activeThreadId || undefined);
      const deletedMessageIds = new Set<number>(
        (Array.isArray(result?.deleted_message_ids) ? result.deleted_message_ids : [])
          .map((value: any) => Number(value))
          .filter((value: number) => Number.isFinite(value)),
      );

      setGeneratedPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      setMessages((prev) => prev.reduce<ChatMessage[]>((acc, msg) => {
        if (msg.id === WELCOME_MSG.id) {
          acc.push(msg);
          return acc;
        }

        if (msg.dbId && deletedMessageIds.has(msg.dbId)) {
          return acc;
        }

        if (!msg.photos?.length) {
          acc.push(msg);
          return acc;
        }

        const remainingPhotos = msg.photos.filter((item) => item.assetId !== photo.assetId);
        if (remainingPhotos.length === msg.photos.length) {
          acc.push(msg);
          return acc;
        }

        if (msg.type === 'image' && remainingPhotos.length === 0) {
          return acc;
        }

        acc.push({
          ...msg,
          photos: remainingPhotos.length ? remainingPhotos : undefined,
        });
        return acc;
      }, []));

      if (result?.context_state) {
        setContextState(result.context_state);
      }
      if (typeof result?.message_count === 'number') {
        const threadId = Number(result?.thread_id || activeThreadId || 0);
        if (threadId > 0) {
          setThreadList((prev) => {
            const next = prev.map((item) => (
              item.id === threadId
                ? { ...item, messageCount: result.message_count }
                : item
            ));
            saveStoredThreads(next);
            return next;
          });
        }
      }
      setGenLatestResult((prev) => (prev?.id === photo.id ? null : prev));
      setPreviewPhoto((prev) => (prev?.id === photo.id ? null : prev));
    } catch (e) {
      console.error('Delete history asset error', e);
      toast.error('Не удалось удалить фото из истории');
    }
  };

  // Add generated photo to gallery (scenes or models)
  const addPhotoToGallery = async (photo: PhotoMedia, assetType: 'scene' | 'model') => {
    setGalleryAdding(true);
    try {
      await api.importUserPhotoAssetFromUrl({
        source_url: photo.url,
        asset_type: assetType,
        name: photo.prompt || photo.fileName || 'Generated',
        prompt: photo.prompt || '',
      });
      setGalleryAddPhoto(null);
      toast.success(`Добавлено в ${assetType === 'scene' ? 'Локации' : 'Модели'}`);
    } catch (e) {
      try {
        // Fallback: download and upload as file
        const imgRes = await fetch(photo.url, { mode: 'cors' });
        const blob = await imgRes.blob();
        await api.uploadUserPhotoAsset(new File([blob], photo.fileName || 'image.png', { type: blob.type || 'image/png' }), {
          assetType,
          name: photo.prompt || 'Generated',
        });
        setGalleryAddPhoto(null);
        toast.success(`Добавлено в ${assetType === 'scene' ? 'Локации' : 'Модели'}`);
      } catch (fallbackError) {
        console.error('Gallery add error:', e, fallbackError);
        toast.error('Не удалось добавить в галерею');
      }
    } finally {
      setGalleryAdding(false);
    }
  };

  // Card photo management
  const handleCardPhotoDelete = (index: number) => {
    if (selectedProductPhotos.length <= 1) {
      toast.error('Нельзя удалить последнее фото карточки');
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
      toast.error(err instanceof Error ? err.message : 'Не удалось загрузить фото');
    }
  };

  const handleSaveCardPhotoChanges = async () => {
    if (!activeStore || !selectedProduct || cardPhotosSaving) return;
    setCardPhotosSaving(true);
    setLastApplyResult(null);
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
      setSaveConfirmOpen(false);
      await loadProducts();

      // Parse verification summary if available
      const verification = updated?.media_apply_result?.verification || updated?.verification;
      if (verification && typeof verification === 'object') {
        setLastApplyResult({
          matched: Boolean(verification.matched),
          missing_urls: verification.missing_urls || [],
          unexpected_urls: verification.unexpected_urls || [],
          stabilized: verification.stabilized,
          requested_order: verification.requested_order || [],
          actual_order: verification.actual_order || [],
        });
        if (verification.matched) {
          toast.success('Фото карточки сохранены — порядок подтверждён WB');
        } else {
          toast.warning('Фото сохранены, но итоговый порядок в WB отличается от запрошенного');
        }
      } else {
        toast.success('Фото карточки сохранены');
      }
    } catch (err: any) {
      console.error('Save card photos error:', err);
      // Product-level error rendering
      const detail = err?.detail;
      if (detail && typeof detail === 'object' && detail.code) {
        toast.error(detail.message || 'Не удалось сохранить изменения');
        if (detail.retryable) {
          toast.info('Можно попробовать ещё раз');
        }
      } else {
        toast.error(err instanceof Error ? err.message : 'Не удалось сохранить изменения');
      }
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

  // ── Product picker state ──
  const [pickerTarget, setPickerTarget] = useState<'source' | 'garment' | 'model' | null>(null);
  const [pickerProduct, setPickerProduct] = useState<ProductItem | null>(null);
  const [pickerProductPhotos, setPickerProductPhotos] = useState<string[]>([]);
  const [pickerProductLoading, setPickerProductLoading] = useState(false);

  const openProductPicker = (target: 'source' | 'garment' | 'model') => {
    setPickerTarget(target);
    setPickerProduct(null);
    setPickerProductPhotos([]);
    setGenShowProductPicker(true);
  };

  const handlePickerSelectProduct = async (card: ProductItem) => {
    setPickerProduct(card);
    setPickerProductLoading(true);
    const wbPhotos = (card.photos || []).map((u) => toAbsoluteMediaUrl(u)).filter(Boolean);
    if (wbPhotos.length > 0) {
      setPickerProductPhotos(wbPhotos);
      setPickerProductLoading(false);
      return;
    }
    if (!activeStore) { setPickerProductPhotos([]); setPickerProductLoading(false); return; }
    try {
      const fallbackCards = await api.getCards(activeStore.id, 1, 1, { search: String(card.nm_id) });
      const match = (fallbackCards?.items || []).find((it: any) => Number(it?.nm_id) === Number(card.nm_id));
      if (!match?.id) { setPickerProductPhotos([]); return; }
      const detail = await api.getCard(activeStore.id, match.id);
      const photos = Array.isArray(detail?.photos) ? detail.photos : [];
      setPickerProductPhotos(photos.map((u: string) => toAbsoluteMediaUrl(u)).filter(Boolean));
    } catch { setPickerProductPhotos([]); } finally { setPickerProductLoading(false); }
  };

  const handlePickerSelectPhoto = (url: string) => {
    const photo: PhotoMedia = { id: `picker-${Date.now()}`, url, type: 'image' };
    if (pickerTarget === 'garment') setGenGarmentPhoto(photo);
    else if (pickerTarget === 'model') setGenModelPhoto(photo);
    else setGenSourcePhoto(photo);
    setGenShowProductPicker(false);
    setPickerTarget(null);
  };

  const handleZoneClick = (target: 'source' | 'garment' | 'model' = 'source', fileRef?: React.RefObject<HTMLInputElement>) => {
    if (products.length > 0) {
      openProductPicker(target);
    } else {
      (fileRef || genSourceInputRef).current?.click();
    }
  };

  const renderProductPicker = () => {
    if (!genShowProductPicker) return null;
    const fileRef = pickerTarget === 'garment' ? genFileInputRef1 : pickerTarget === 'model' ? genFileInputRef2 : genSourceInputRef;
    return (
      <div className="ps-gen-product-picker-overlay" onClick={() => setGenShowProductPicker(false)}>
        <div className="ps-gen-product-picker" onClick={e => e.stopPropagation()}>
          {!pickerProduct ? (
            <>
              <div className="ps-gen-product-picker-head">
                <span>Выберите источник</span>
                <button onClick={() => setGenShowProductPicker(false)}><X size={16} /></button>
              </div>
              <button className="ps-gen-product-picker-upload" onClick={() => { setGenShowProductPicker(false); fileRef.current?.click(); }}>
                <Upload size={18} />
                <span>Загрузить файл</span>
              </button>
              <div className="ps-gen-product-picker-label"><ShoppingBag size={14} /> Товары</div>
              <div className="ps-gen-product-picker-products">
                {filteredProducts.length === 0 && !productsLoading && (
                  <div className="ps-gen-product-picker-empty">Нет товаров</div>
                )}
                {productsLoading && <div className="ps-gen-product-picker-empty"><Loader2 size={20} className="ps-spin" /></div>}
                {filteredProducts.map((card) => (
                  <button key={card.id} className="ps-gen-product-picker-card" onClick={() => handlePickerSelectProduct(card)}>
                    {card.photos?.[0] ? (
                      <ProxiedImg src={toAbsoluteMediaUrl(card.photos[0])} alt="" crossOrigin="anonymous" className="ps-gen-product-picker-card-img" />
                    ) : (
                      <div className="ps-gen-product-picker-card-img ps-gen-product-picker-card-placeholder"><ImageIcon size={18} /></div>
                    )}
                    <div className="ps-gen-product-picker-card-info">
                      <span className="ps-gen-product-picker-card-title">{card.title || card.vendor_code || `#${card.nm_id}`}</span>
                      <span className="ps-gen-product-picker-card-sub">{card.vendor_code || ''} · {card.nm_id}</span>
                    </div>
                    <ChevronDown size={16} style={{ transform: 'rotate(-90deg)', flexShrink: 0, color: '#9ca3af' }} />
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="ps-gen-product-picker-head">
                <button onClick={() => { setPickerProduct(null); setPickerProductPhotos([]); }} style={{ background: 'none', border: 'none' }}>
                  <ArrowLeft size={18} />
                </button>
                <span style={{ flex: 1 }}>{pickerProduct.title || pickerProduct.vendor_code || `#${pickerProduct.nm_id}`}</span>
                <button onClick={() => setGenShowProductPicker(false)}><X size={16} /></button>
              </div>
              {pickerProductLoading ? (
                <div className="ps-gen-product-picker-empty"><Loader2 size={24} className="ps-spin" /></div>
              ) : pickerProductPhotos.length === 0 ? (
                <div className="ps-gen-product-picker-empty">Нет фото у товара</div>
              ) : (
                <div className="ps-gen-product-picker-grid">
                  {pickerProductPhotos.map((url, i) => (
                    <button key={i} className="ps-gen-product-picker-thumb" onClick={() => handlePickerSelectPhoto(url)}>
                      <ProxiedImg src={url} alt="" crossOrigin="anonymous" />
                      <span>{i + 1}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  const handleGenRun = async () => {
    if (genRunning || isStreaming) return;

    let photos: PhotoMedia[] = [];
    const payload: Record<string, any> = {
      locale: contextState.locale || undefined,
    };

    if (genTab === 'own-model') {
      if (!genGarmentPhoto || !genModelPhoto) {
        toast.error('Перетащите 2 фото: изделие + фотомодель');
        return;
      }
      photos = [genGarmentPhoto, genModelPhoto];
      payload.generator_type = 'normalize-own-model';
    } else if (genTab === 'new-model') {
      if (!genGarmentPhoto) {
        toast.error('Загрузите фото изделия');
        return;
      }
      if (!(genNewModelPrompt || genSelectedModel?.prompt || '').trim()) {
        toast.error('Выберите тип модели или введите свой промпт');
        return;
      }
      photos = [genGarmentPhoto];
      payload.generator_type = 'put-on-model';
      payload.prompt = (genNewModelPrompt || genSelectedModel?.prompt || '').trim() || undefined;
      payload.model_item_id = genSelectedModel?.quickAction?.model_item_id;
    } else if (genTab === 'custom-prompt') {
      if (!genCustomPrompt.trim()) {
        toast.error('Введите промпт');
        return;
      }
      if (!genSourcePhoto) {
        toast.error('Выберите исходное фото');
        return;
      }
      photos = [genSourcePhoto];
      payload.generator_type = 'custom-generation';
      payload.prompt = genCustomPrompt.trim();
    } else if (genTab === 'scenes') {
      if (!genSourcePhoto) {
        toast.error('Выберите исходное фото');
        return;
      }
      if (!genSelectedScene) {
        toast.error('Выберите сцену');
        return;
      }
      photos = [genSourcePhoto];
      payload.generator_type = 'change-background';
      payload.scene_item_id = genSelectedScene.quickAction?.scene_item_id;
      payload.prompt = genSelectedScene.quickAction?.scene_prompt || genSelectedScene.label;
    } else if (genTab === 'poses') {
      if (!genSourcePhoto) {
        toast.error('Выберите исходное фото');
        return;
      }
      if (!genSelectedPose) {
        toast.error('Выберите позу');
        return;
      }
      photos = [genSourcePhoto];
      payload.generator_type = 'change-pose';
      payload.pose_prompt_id = genSelectedPose.quickAction?.pose_prompt_id;
      payload.prompt = genSelectedPose.quickAction?.pose_prompt || genSelectedPose.label;
    } else if (genTab === 'video') {
      if (!genSourcePhoto) {
        toast.error('Выберите исходное фото');
        return;
      }
      if (!(genVideoPrompt || genSelectedVideo?.prompt || '').trim()) {
        toast.error('Выберите сценарий видео или введите свой промпт');
        return;
      }
      photos = [genSourcePhoto];
      payload.generator_type = 'generate-video';
      payload.prompt = (genVideoPrompt || genSelectedVideo?.prompt || '').trim() || undefined;
      payload.video_scenario_id = genSelectedVideo?.quickAction?.video_scenario_id;
      payload.model = genSelectedVideo?.quickAction?.model || 'hailuo/minimax-video-01-live';
      payload.duration = genSelectedVideo?.quickAction?.duration || 5;
      payload.resolution = genSelectedVideo?.quickAction?.resolution || '720p';
    }

    setGenRunning(true);
    try {
      const { assetIds } = await preparePhotoAssets(photos);
      if (assetIds.length === 0) {
        toast.error('Не удалось подготовить фото для генерации');
        return;
      }

      payload.asset_ids = assetIds;
      if (activeThreadId) payload.thread_id = activeThreadId;

      const result = await api.runPhotoGenerator(payload);
      const nextPhoto = mapGeneratorAssetToPhoto(result?.asset);
      if (!nextPhoto) {
        throw new Error('Generator result asset is missing');
      }

      if (result?.active_thread_id) setActiveThreadId(Number(result.active_thread_id));
      else if (result?.thread_id) setActiveThreadId(Number(result.thread_id));
      if (result?.context_state) setContextState(result.context_state);

      setGeneratedPhotos((prev) => [nextPhoto, ...prev.filter((item) => item.assetId !== nextPhoto.assetId)]);
      setGenLatestResult(nextPhoto);
      setHistoryTab(nextPhoto.type);
      toast.success(nextPhoto.type === 'video' ? 'Видео готово' : 'Результат готов');
    } catch (e) {
      console.error('Generator run error', e);
      toast.error('Не удалось выполнить генерацию');
    } finally {
      setGenRunning(false);
    }
  };

  const sendGeneratorResultToChat = (photo: PhotoMedia | null) => {
    if (!photo || photo.type !== 'image') return;
    attachByUrl(photo.url, photo.assetId);
    if (isMobile) setMobileTab('chat');
    toast.success('Результат добавлен в чат');
  };

  const handleGenPhotoPick = (photo: PhotoMedia, target: 'garment' | 'model' | 'source') => {
    if (target === 'garment') setGenGarmentPhoto(photo);
    else if (target === 'model') setGenModelPhoto(photo);
    else setGenSourcePhoto(photo);
  };

  const renderGeneratorResult = () => {
    if (!genLatestResult) return null;

    return (
      <div style={{
        marginTop: 16,
        padding: 12,
        borderRadius: 16,
        border: '1px solid rgba(148, 163, 184, 0.25)',
        background: 'rgba(255, 255, 255, 0.82)',
        backdropFilter: 'blur(10px)',
        display: 'grid',
        gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Последний результат генератора</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              {genLatestResult.type === 'video' ? 'Видео готово и сохранено в историю' : 'Изображение готово и можно отправить в чат'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPreviewPhoto(genLatestResult)}
            style={{
              border: '1px solid rgba(148, 163, 184, 0.35)',
              background: '#fff',
              color: '#0f172a',
              borderRadius: 999,
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Открыть
          </button>
        </div>

        <button
          type="button"
          onClick={() => setPreviewPhoto(genLatestResult)}
          style={{
            width: '100%',
            padding: 0,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            borderRadius: 14,
            overflow: 'hidden',
          }}
        >
          {genLatestResult.type === 'video' ? (
            <video src={genLatestResult.url} muted playsInline style={{ width: '100%', display: 'block', maxHeight: 320, objectFit: 'cover', background: '#0f172a' }} />
          ) : (
            <ProxiedImg src={genLatestResult.url} alt="" crossOrigin="anonymous" style={{ width: '100%', display: 'block', maxHeight: 320, objectFit: 'cover', background: '#f8fafc' }} />
          )}
        </button>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {genLatestResult.type === 'image' && (
            <button
              type="button"
              onClick={() => sendGeneratorResultToChat(genLatestResult)}
              disabled={!canAttachMore}
              style={{
                flex: '1 1 180px',
                border: 'none',
                borderRadius: 12,
                padding: '12px 14px',
                background: canAttachMore ? '#0f172a' : '#cbd5e1',
                color: '#fff',
                fontSize: 13,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                cursor: canAttachMore ? 'pointer' : 'not-allowed',
              }}
            >
              <Paperclip size={15} />
              В чат для edit
            </button>
          )}
          <button
            type="button"
            onClick={() => handleDownload(genLatestResult)}
            style={{
              flex: '1 1 160px',
              border: '1px solid rgba(148, 163, 184, 0.35)',
              borderRadius: 12,
              padding: '12px 14px',
              background: '#fff',
              color: '#0f172a',
              fontSize: 13,
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              cursor: 'pointer',
            }}
          >
            <Download size={15} />
            Скачать
          </button>
        </div>
      </div>
    );
  };

  // ===================== MOBILE LAYOUT =====================
  if (isMobile) {
    return (
      <div className="ps-mobile-root">
        {/* Mobile top bar */}
        <div className="ps-mobile-topbar">
          <Sparkles size={18} />
          <span className="ps-mobile-topbar-title">AI Фотостудия</span>
          <button className="ps-mobile-topbar-btn" onClick={() => setInstructionsOpen(true)}>
            <HelpCircle size={18} />
          </button>
        </div>

        {/* Mobile tab content */}
        <div className="ps-mobile-content">
          {/* ---- CHAT TAB ---- */}
          {mobileTab === 'chat' && (
            <div className="ps-mobile-tab-pane">
              <div className="ps-mobile-chat-top">
                <div className="ps-mobile-thread-row">
                  <div ref={threadDropdownRef} style={{ position: 'relative', flex: 1 }}>
                    <button className="ps-mobile-thread-btn" onClick={() => setThreadDropdownOpen(v => !v)}>
                      <Folder size={14} />
                      <span>{threadList.find(t => t.id === activeThreadId)?.preview || 'Новый чат'}</span>
                      <ChevronDown size={14} />
                    </button>
                    {threadDropdownOpen && (
                      <div className="ps-mobile-thread-dropdown">
                        <button className="ps-mobile-thread-item ps-mobile-thread-item--new" onClick={() => { setThreadDropdownOpen(false); void startNewThread(); }}>
                          <Plus size={14} /> Новый чат
                        </button>
                        {threadList.map(t => (
                          <div key={t.id} className={`ps-mobile-thread-item ${t.id === activeThreadId ? 'active' : ''}`}>
                            <button className="ps-mobile-thread-item-main" onClick={() => { void switchThread(t.id); setThreadDropdownOpen(false); }}>
                              <span className="ps-mobile-thread-preview">{t.preview || 'Чат'}</span>
                              <span className="ps-mobile-thread-meta">{t.messageCount} сообщ.</span>
                            </button>
                            <button className="ps-mobile-thread-delete" onClick={() => void deleteThread(t.id)}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button className="ps-mobile-new-chat-btn" onClick={() => void startNewThread()}>
                    <Plus size={16} />
                  </button>
                </div>
              </div>

              <div className="ps-messages ps-mobile-messages" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
                {messages.map(msg => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    onPhotoClick={(photo) => setPreviewPhoto(photo)}
                    onPhotoDragStart={handleChatPhotoDragStart}
                    selectMode={chatSelectMode}
                    isSelected={selectedMsgIds.has(msg.id)}
                    onToggleSelect={(id) => setSelectedMsgIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
                  />
                ))}
                {isBotTyping && botIndicatorMode && (
                  <StreamActivityIndicator mode={botIndicatorMode} />
                )}
                <div ref={bottomRef} />
              </div>

              {/* Quick actions row */}
              <div className="ps-mobile-quick-row">
                {quickMenu.map((qm) => (
                  <div key={qm.id} className="ps-mobile-quick-dropdown-wrap">
                    <button
                      className={`ps-mobile-quick-chip ${quickOpen && quickActive === qm.id ? 'active' : ''}`}
                      onClick={() => {
                        if (quickOpen && quickActive === qm.id) {
                          setQuickOpen(false);
                        } else {
                          setQuickActive(qm.id);
                          setQuickOpen(true);
                        }
                      }}
                    >
                      <qm.icon size={13} />
                      {qm.label}
                      <ChevronDown size={12} />
                    </button>
                  </div>
                ))}
                <button className="ps-mobile-quick-chip" onClick={() => setSamplesOpen(true)}>
                  <GalleryHorizontal size={13} /> Образцы
                </button>
              </div>

              {/* Bottom-sheet for selected quick action */}
              {quickOpen && (
                <div className="ps-mobile-quick-sheet-overlay" onClick={() => setQuickOpen(false)}>
                  <div className="ps-mobile-quick-sheet" onClick={e => e.stopPropagation()}>
                    <div className="ps-mobile-quick-sheet-handle" />
                    <div className="ps-mobile-quick-sheet-head">
                      {(() => { const Icon = activeQuickMenu.icon; return <Icon size={18} />; })()}
                      <span>{activeQuickMenu.label}</span>
                      <button className="ps-mobile-quick-sheet-close" onClick={() => setQuickOpen(false)}><X size={18} /></button>
                    </div>
                    <div className="ps-mobile-quick-sheet-options">
                      {activeQuickMenu.options.map((opt) => (
                        <button
                          key={`${activeQuickMenu.id}-${opt.id || opt.label}`}
                          className="ps-mobile-quick-sheet-option"
                          onClick={() => { void handleQuickPick(activeQuickMenu, opt); setQuickOpen(false); }}
                        >
                          <span className="ps-mobile-quick-sheet-option-label">{opt.label}</span>
                          <Send size={14} />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Attached photos */}
              {attachedPhotos.length > 0 && (
                <div className="ps-mobile-attached">
                  {attachedPhotos.map(p => (
                    <div key={p.id} className="ps-mobile-attached-thumb">
                      <ProxiedImg src={p.url} alt="" crossOrigin="anonymous" />
                      <button className="ps-mobile-attached-remove" onClick={() => removeAttached(p.id)}><X size={10} /></button>
                    </div>
                  ))}
                </div>
              )}

              {/* Input bar */}
              <form className="ps-mobile-input-bar" onSubmit={(e) => { e.preventDefault(); void handleSend(); }}>
                <button type="button" className="ps-mobile-input-icon" onClick={() => fileInputRef.current?.click()} disabled={isStreaming || !canAttachMore}>
                  <Paperclip size={18} />
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={handleFileSelect} />
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={attachedPhotos.length ? 'Что сделать с фото?' : 'Напишите запрос...'}
                  disabled={isStreaming}
                  className="ps-mobile-text-input"
                />
                <button
                  type="submit"
                  className={`ps-mobile-send-btn ${(inputText.trim() || attachedPhotos.length) && !isStreaming ? 'active' : ''}`}
                  disabled={(!inputText.trim() && !attachedPhotos.length) || isStreaming}
                >
                  <Send size={18} />
                </button>
              </form>
            </div>
          )}

          {/* ---- GENERATOR TAB ---- */}
          {mobileTab === 'generator' && (
            <div className="ps-mobile-tab-pane ps-mobile-tab-pane--scroll">
              <div className="ps-mgen-dropdown-wrap">
                <span className="ps-mgen-picker-label">Режим генерации:</span>
                <div className="ps-mgen-select-wrap ps-mgen-select-wrap--top">
                  <select
                    className="ps-mgen-select ps-mgen-select--top"
                    value={genTab}
                    onChange={(e) => setGenTab(e.target.value as GeneratorTab)}
                  >
                    {GEN_TABS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} className="ps-mgen-select-icon" />
                </div>
              </div>

              <div className="ps-mgen-content">
                {/* ===== Своя фотомодель ===== */}
                {genTab === 'own-model' && (
                  <div className="ps-mgen-card">
                    <div className="ps-mgen-card-head">
                      <User size={18} />
                      <div>
                        <div className="ps-mgen-card-title">Своя фотомодель</div>
                        <div className="ps-mgen-card-desc">Загрузите фото изделия и вашей фотомодели — AI совместит</div>
                      </div>
                    </div>
                    <div className="ps-mgen-zones">
                      <div className="ps-mgen-zone" onClick={() => handleZoneClick('garment', genFileInputRef1)}>
                        {genGarmentPhoto ? (
                          <div className="ps-mgen-zone-preview">
                            <ProxiedImg src={genGarmentPhoto.url} alt="" crossOrigin="anonymous" />
                            <button className="ps-mgen-zone-remove" onClick={(e) => { e.stopPropagation(); setGenGarmentPhoto(null); }}><X size={12} /></button>
                          </div>
                        ) : (
                          <div className="ps-mgen-zone-empty">
                            <Upload size={22} />
                            <span>Изделие</span>
                          </div>
                        )}
                        <input ref={genFileInputRef1} type="file" accept="image/*" hidden onChange={handleGenFileSelect(setGenGarmentPhoto)} />
                      </div>
                      <div className="ps-mgen-zone" onClick={() => handleZoneClick('model', genFileInputRef2)}>
                        {genModelPhoto ? (
                          <div className="ps-mgen-zone-preview">
                            <ProxiedImg src={genModelPhoto.url} alt="" crossOrigin="anonymous" />
                            <button className="ps-mgen-zone-remove" onClick={(e) => { e.stopPropagation(); setGenModelPhoto(null); }}><X size={12} /></button>
                          </div>
                        ) : (
                          <div className="ps-mgen-zone-empty">
                            <User size={22} />
                            <span>Фотомодель</span>
                          </div>
                        )}
                        <input ref={genFileInputRef2} type="file" accept="image/*" hidden onChange={handleGenFileSelect(setGenModelPhoto)} />
                      </div>
                    </div>
                    {availablePhotos.length > 0 && (
                      <div className="ps-mgen-available">
                        <span className="ps-mgen-available-label">Фото товара:</span>
                        <div className="ps-mgen-available-row">
                          {availablePhotos.map((p, i) => (
                            <button key={p.id} className="ps-mgen-available-thumb" onClick={() => { if (!genGarmentPhoto) setGenGarmentPhoto(p); else if (!genModelPhoto) setGenModelPhoto(p); }}>
                              <ProxiedImg src={p.url} alt="" crossOrigin="anonymous" />
                              <span>{i + 1}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ===== Новая фотомодель ===== */}
                {genTab === 'new-model' && (
                  <div className="ps-mgen-card">
                    <div className="ps-mgen-card-head">
                      <Shirt size={18} />
                      <div>
                        <div className="ps-mgen-card-title">Новая фотомодель (AI)</div>
                        <div className="ps-mgen-card-desc">AI создаст модель для вашего изделия</div>
                      </div>
                    </div>
                    <div className="ps-mgen-zones ps-mgen-zones--single">
                      <div className="ps-mgen-zone" onClick={() => handleZoneClick('garment', genFileInputRef1)}>
                        {genGarmentPhoto ? (
                          <div className="ps-mgen-zone-preview">
                            <ProxiedImg src={genGarmentPhoto.url} alt="" crossOrigin="anonymous" />
                            <button className="ps-mgen-zone-remove" onClick={(e) => { e.stopPropagation(); setGenGarmentPhoto(null); }}><X size={12} /></button>
                          </div>
                        ) : (
                          <div className="ps-mgen-zone-empty">
                            <Upload size={22} />
                            <span>Изделие</span>
                          </div>
                        )}
                        <input ref={genFileInputRef1} type="file" accept="image/*" hidden onChange={handleGenFileSelect(setGenGarmentPhoto)} />
                      </div>
                    </div>
                    {availablePhotos.length > 0 && (
                      <div className="ps-mgen-available">
                        <span className="ps-mgen-available-label">Фото товара:</span>
                        <div className="ps-mgen-available-row">
                          {availablePhotos.map((p, i) => (
                            <button key={p.id} className="ps-mgen-available-thumb" onClick={() => setGenGarmentPhoto(p)}>
                              <ProxiedImg src={p.url} alt="" crossOrigin="anonymous" />
                              <span>{i + 1}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {catalogModels.length > 0 && (
                      <div className="ps-mgen-picker">
                        <span className="ps-mgen-picker-label">Тип модели:</span>
                        <div className="ps-mgen-select-wrap">
                          <select
                            className="ps-mgen-select"
                            value={genSelectedModel?.id || ''}
                            onChange={(e) => {
                              const next = catalogModels.find((opt) => (opt.id || opt.label) === e.target.value) || null;
                              setGenSelectedModel(next);
                              setGenNewModelPrompt(next?.prompt || '');
                            }}
                          >
                            <option value="">Выберите тип</option>
                            {catalogModels.map((opt) => (
                              <option key={opt.id || opt.label} value={opt.id || opt.label}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <ChevronDown size={16} className="ps-mgen-select-icon" />
                        </div>
                      </div>
                    )}
                    <input
                      type="text"
                      className="ps-mgen-text-input"
                      value={genNewModelPrompt}
                      onChange={e => {
                        const next = e.target.value;
                        setGenNewModelPrompt(next);
                        if (genSelectedModel?.prompt !== next) setGenSelectedModel(null);
                      }}
                      placeholder="Или опишите модель вручную..."
                    />
                  </div>
                )}

                {/* ===== Свой промпт ===== */}
                {genTab === 'custom-prompt' && (
                  <div className="ps-mgen-card">
                    <div className="ps-mgen-card-head">
                      <Type size={18} />
                      <div>
                        <div className="ps-mgen-card-title">Свой промпт</div>
                        <div className="ps-mgen-card-desc">Напишите запрос — AI обработает фото</div>
                      </div>
                    </div>
                    <div className="ps-mgen-zones ps-mgen-zones--single">
                      <div className="ps-mgen-zone" onClick={() => handleZoneClick()}>
                        {genSourcePhoto ? (
                          <div className="ps-mgen-zone-preview">
                            <ProxiedImg src={genSourcePhoto.url} alt="" crossOrigin="anonymous" />
                            <button className="ps-mgen-zone-remove" onClick={(e) => { e.stopPropagation(); setGenSourcePhoto(null); }}><X size={12} /></button>
                          </div>
                        ) : (
                          <div className="ps-mgen-zone-empty">
                            <ImageIcon size={22} />
                            <span>Исходное фото</span>
                          </div>
                        )}
                        <input ref={genSourceInputRef} type="file" accept="image/*" hidden onChange={handleGenFileSelect(setGenSourcePhoto)} />
                      </div>
                    </div>
                    {availablePhotos.length > 0 && (
                      <div className="ps-mgen-available">
                        <span className="ps-mgen-available-label">Фото товара:</span>
                        <div className="ps-mgen-available-row">
                          {availablePhotos.map((p, i) => (
                            <button key={p.id} className="ps-mgen-available-thumb" onClick={() => setGenSourcePhoto(p)}>
                              <ProxiedImg src={p.url} alt="" crossOrigin="anonymous" />
                              <span>{i + 1}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <textarea className="ps-mgen-textarea" value={genCustomPrompt} onChange={e => setGenCustomPrompt(e.target.value)} placeholder="Опишите, что нужно сделать с фото..." rows={4} />
                  </div>
                )}

                {/* ===== Сцены ===== */}
                {genTab === 'scenes' && (
                  <div className="ps-mgen-card">
                    <div className="ps-mgen-card-head">
                      <Mountain size={18} />
                      <div>
                        <div className="ps-mgen-card-title">Смена сцены / фона</div>
                        <div className="ps-mgen-card-desc">Выберите фото и сцену</div>
                      </div>
                    </div>
                    <div className="ps-mgen-zones ps-mgen-zones--single">
                      <div className="ps-mgen-zone" onClick={() => handleZoneClick()}>
                        {genSourcePhoto ? (
                          <div className="ps-mgen-zone-preview">
                            <ProxiedImg src={genSourcePhoto.url} alt="" crossOrigin="anonymous" />
                            <button className="ps-mgen-zone-remove" onClick={(e) => { e.stopPropagation(); setGenSourcePhoto(null); }}><X size={12} /></button>
                          </div>
                        ) : (
                          <div className="ps-mgen-zone-empty">
                            <ImageIcon size={22} />
                            <span>Исходное фото</span>
                          </div>
                        )}
                        <input ref={genSourceInputRef} type="file" accept="image/*" hidden onChange={handleGenFileSelect(setGenSourcePhoto)} />
                      </div>
                    </div>
                    {availablePhotos.length > 0 && (
                      <div className="ps-mgen-available">
                        <span className="ps-mgen-available-label">Фото товара:</span>
                        <div className="ps-mgen-available-row">
                          {availablePhotos.map((p, i) => (
                            <button key={p.id} className="ps-mgen-available-thumb" onClick={() => setGenSourcePhoto(p)}>
                              <ProxiedImg src={p.url} alt="" crossOrigin="anonymous" />
                              <span>{i + 1}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="ps-mgen-picker">
                      <span className="ps-mgen-picker-label">Сцена:</span>
                      <div className="ps-mgen-select-wrap">
                        <select
                          className="ps-mgen-select"
                          value={genSelectedScene ? String(genSelectedScene.id) : ''}
                          onChange={(e) => {
                            const selected = catalogScenes.find((opt) => String(opt.id || opt.label) === e.target.value);
                            setGenSelectedScene(selected ? { id: selected.id || selected.label, label: selected.label, quickAction: selected.quickAction! } : null);
                          }}
                        >
                          <option value="">Выберите сцену</option>
                          {catalogScenes.map((opt) => (
                            <option key={opt.id || opt.label} value={String(opt.id || opt.label)}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={16} className="ps-mgen-select-icon" />
                      </div>
                    </div>
                  </div>
                )}

                {/* ===== Позы ===== */}
                {genTab === 'poses' && (
                  <div className="ps-mgen-card">
                    <div className="ps-mgen-card-head">
                      <Move size={18} />
                      <div>
                        <div className="ps-mgen-card-title">Смена позы</div>
                        <div className="ps-mgen-card-desc">AI изменит положение модели</div>
                      </div>
                    </div>
                    <div className="ps-mgen-zones ps-mgen-zones--single">
                      <div className="ps-mgen-zone" onClick={() => handleZoneClick()}>
                        {genSourcePhoto ? (
                          <div className="ps-mgen-zone-preview">
                            <ProxiedImg src={genSourcePhoto.url} alt="" crossOrigin="anonymous" />
                            <button className="ps-mgen-zone-remove" onClick={(e) => { e.stopPropagation(); setGenSourcePhoto(null); }}><X size={12} /></button>
                          </div>
                        ) : (
                          <div className="ps-mgen-zone-empty">
                            <ImageIcon size={22} />
                            <span>Фото с моделью</span>
                          </div>
                        )}
                        <input ref={genSourceInputRef} type="file" accept="image/*" hidden onChange={handleGenFileSelect(setGenSourcePhoto)} />
                      </div>
                    </div>
                    {availablePhotos.length > 0 && (
                      <div className="ps-mgen-available">
                        <span className="ps-mgen-available-label">Фото товара:</span>
                        <div className="ps-mgen-available-row">
                          {availablePhotos.map((p, i) => (
                            <button key={p.id} className="ps-mgen-available-thumb" onClick={() => setGenSourcePhoto(p)}>
                              <ProxiedImg src={p.url} alt="" crossOrigin="anonymous" />
                              <span>{i + 1}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="ps-mgen-picker">
                      <span className="ps-mgen-picker-label">Поза:</span>
                      <div className="ps-mgen-select-wrap">
                        <select
                          className="ps-mgen-select"
                          value={genSelectedPose ? String(genSelectedPose.id) : ''}
                          onChange={(e) => {
                            const selected = catalogPoses.find((opt) => String(opt.id || opt.label) === e.target.value);
                            setGenSelectedPose(selected ? { id: selected.id || selected.label, label: selected.label, quickAction: selected.quickAction! } : null);
                          }}
                        >
                          <option value="">Выберите позу</option>
                          {catalogPoses.map((opt) => (
                            <option key={opt.id || opt.label} value={String(opt.id || opt.label)}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={16} className="ps-mgen-select-icon" />
                      </div>
                    </div>
                  </div>
                )}

                {/* ===== Видео ===== */}
                {genTab === 'video' && (
                  <div className="ps-mgen-card">
                    <div className="ps-mgen-card-head">
                      <Video size={18} />
                      <div>
                        <div className="ps-mgen-card-title">Генерация видео</div>
                        <div className="ps-mgen-card-desc">AI создаст короткое видео из фото</div>
                      </div>
                    </div>
                    <div className="ps-mgen-zones ps-mgen-zones--single">
                      <div className="ps-mgen-zone" onClick={() => handleZoneClick()}>
                        {genSourcePhoto ? (
                          <div className="ps-mgen-zone-preview">
                            <ProxiedImg src={genSourcePhoto.url} alt="" crossOrigin="anonymous" />
                            <button className="ps-mgen-zone-remove" onClick={(e) => { e.stopPropagation(); setGenSourcePhoto(null); }}><X size={12} /></button>
                          </div>
                        ) : (
                          <div className="ps-mgen-zone-empty">
                            <Video size={22} />
                            <span>Исходное фото</span>
                          </div>
                        )}
                        <input ref={genSourceInputRef} type="file" accept="image/*" hidden onChange={handleGenFileSelect(setGenSourcePhoto)} />
                      </div>
                    </div>
                    {availablePhotos.length > 0 && (
                      <div className="ps-mgen-available">
                        <span className="ps-mgen-available-label">Фото товара:</span>
                        <div className="ps-mgen-available-row">
                          {availablePhotos.map((p, i) => (
                            <button key={p.id} className="ps-mgen-available-thumb" onClick={() => setGenSourcePhoto(p)}>
                              <ProxiedImg src={p.url} alt="" crossOrigin="anonymous" />
                              <span>{i + 1}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {catalogVideos.length > 0 && (
                      <div className="ps-mgen-picker">
                        <span className="ps-mgen-picker-label">Тип движения:</span>
                        <div className="ps-mgen-select-wrap">
                          <select
                            className="ps-mgen-select"
                            value={genSelectedVideo?.id || ''}
                            onChange={(e) => {
                              const next = catalogVideos.find((video) => video.id === e.target.value) || null;
                              setGenSelectedVideo(next);
                              setGenVideoPrompt(next?.prompt || '');
                            }}
                          >
                            <option value="">Выберите тип</option>
                            {catalogVideos.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.label}
                              </option>
                            ))}
                          </select>
                          <ChevronDown size={16} className="ps-mgen-select-icon" />
                        </div>
                      </div>
                    )}
                    <input
                      type="text"
                      className="ps-mgen-text-input"
                      value={genVideoPrompt}
                      onChange={e => {
                        const next = e.target.value;
                        setGenVideoPrompt(next);
                        if (genSelectedVideo?.prompt !== next) setGenSelectedVideo(null);
                      }}
                      placeholder="Или опишите движение вручную..."
                    />
                  </div>
                )}
              </div>


              {renderProductPicker()}
              {renderGeneratorResult()}
              {/* Run button - sticky bottom */}
              {genRunning ? (
                <div className="ps-mgen-generating-overlay">
                  <div className="ps-gen-anim">
                    <div className="ps-gen-anim-shimmer">
                      <div className="ps-gen-anim-icon"><Sparkles size={24} /></div>
                      <div className="ps-gen-anim-bars">
                        <div className="ps-gen-anim-bar" style={{ animationDelay: '0s' }} />
                        <div className="ps-gen-anim-bar" style={{ animationDelay: '0.15s' }} />
                        <div className="ps-gen-anim-bar" style={{ animationDelay: '0.3s' }} />
                      </div>
                    </div>
                    <span className="ps-mgen-generating-text">Генерация...</span>
                  </div>
                </div>
              ) : (
                <div className="ps-mgen-run-wrap">
                  <button className="ps-mgen-run-btn" onClick={handleGenRun} disabled={isStreaming}>
                    <Play size={18} /> Запустить генерацию
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ---- HISTORY TAB ---- */}
          {mobileTab === 'history' && (
            <div className="ps-mobile-tab-pane ps-mobile-tab-pane--scroll">
              <div className="ps-mobile-history-head">
                <button className={`ps-mobile-hist-tab ${historyTab === 'image' ? 'active' : ''}`} onClick={() => setHistoryTab('image')}>
                  <Camera size={14} /> Фото ({historyPhotos.length})
                </button>
                <button className={`ps-mobile-hist-tab ${historyTab === 'video' ? 'active' : ''}`} onClick={() => setHistoryTab('video')}>
                  <Video size={14} /> Видео ({historyVideos.length})
                </button>
              </div>
              {(historyTab === 'image' ? historyPhotos : historyVideos).length === 0 ? (
                <div className="ps-mobile-empty">
                  <ImageIcon size={32} />
                  <span>Нет {historyTab === 'image' ? 'фото' : 'видео'}</span>
                  <span className="ps-mobile-empty-sub">Сгенерируйте в чате или генераторе</span>
                </div>
              ) : (
                <div className="ps-mobile-history-grid">
                  {(historyTab === 'image' ? historyPhotos : historyVideos).map(p => (
                    <div key={p.id} className="ps-mobile-history-item" onClick={() => setPreviewPhoto(p)}>
                      {p.type === 'video' ? (
                        <video src={p.url} crossOrigin="anonymous" />
                      ) : (
                        <ProxiedImg src={p.url} alt="" crossOrigin="anonymous" />
                      )}
                      <div className="ps-mobile-history-actions">
                        <button onClick={(e) => { e.stopPropagation(); handleDownload(p); }}><Download size={14} /></button>
                        <button onClick={(e) => { e.stopPropagation(); attachByUrl(p.url, p.assetId); setMobileTab('chat'); }}><Paperclip size={14} /></button>
                        <button onClick={(e) => { e.stopPropagation(); void deleteHistoryPhoto(p); }}><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ---- PRODUCTS TAB ---- */}
          {mobileTab === 'products' && (
            <div className="ps-mobile-tab-pane ps-mobile-tab-pane--scroll">
              {selectedProduct ? (
                <div className="ps-mobile-product-detail">
                  <button className="ps-mobile-product-back" onClick={() => { setSelectedProduct(null); setSelectedProductPhotos([]); }}>
                    <ChevronLeft size={16} /> Назад к товарам
                  </button>
                  <div className="ps-mobile-product-title">{selectedProduct.title || `#${selectedProduct.nm_id}`}</div>
                  <div className="ps-mobile-product-photos">
                    {selectedProductPhotos.map((url, i) => (
                      <div key={i} className="ps-mobile-product-photo" onClick={() => { attachByUrl(url); setMobileTab('chat'); }}>
                        <ProxiedImg src={url} alt="" crossOrigin="anonymous" />
                        <span className="ps-mobile-product-photo-num">{i + 1}</span>
                      </div>
                    ))}
                  </div>
                  <p className="ps-mobile-product-hint">Нажмите на фото, чтобы прикрепить в чат</p>
                </div>
              ) : (
                <>
                  <div className="ps-mobile-search-wrap">
                    <Search size={16} />
                    <input
                      type="text"
                      value={productsQuery}
                      onChange={e => setProductsQuery(e.target.value)}
                      placeholder="Поиск товаров..."
                      className="ps-mobile-search-input"
                    />
                  </div>
                  {productsLoading ? (
                    <div className="ps-mobile-empty"><Loader2 size={24} className="ps-spin" /> Загрузка...</div>
                  ) : filteredProducts.length === 0 ? (
                    <div className="ps-mobile-empty"><ImageIcon size={32} /><span>Нет товаров</span></div>
                  ) : (
                    <div className="ps-mobile-products-list">
                      {filteredProducts.map(card => (
                        <button key={card.id} className="ps-mobile-product-card" onClick={() => void handleOpenProduct(card)}>
                          <div className="ps-mobile-product-thumb">
                            {card.main_photo_url ? <ProxiedImg src={card.main_photo_url} alt="" crossOrigin="anonymous" /> : <ImageIcon size={20} />}
                          </div>
                          <div className="ps-mobile-product-info">
                            <span className="ps-mobile-product-name">{card.title || `Товар #${card.nm_id}`}</span>
                            <span className="ps-mobile-product-id">#{card.nm_id}</span>
                          </div>
                          <ChevronDown size={16} style={{ transform: 'rotate(-90deg)' }} />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Bottom navigation */}
        <nav className="ps-mobile-bottom-nav">
          <button className={`ps-mobile-nav-item ${mobileTab === 'chat' ? 'active' : ''}`} onClick={() => setMobileTab('chat')}>
            <Send size={20} />
            <span>Чат</span>
            {isStreaming && <span className="ps-mobile-nav-dot" />}
          </button>
          <button className={`ps-mobile-nav-item ${mobileTab === 'generator' ? 'active' : ''}`} onClick={() => setMobileTab('generator')}>
            <Wand2 size={20} />
            <span>Генератор</span>
          </button>
          <button className={`ps-mobile-nav-item ${mobileTab === 'history' ? 'active' : ''}`} onClick={() => setMobileTab('history')}>
            <ImageIcon size={20} />
            <span>История</span>
            {generatedPhotos.length > 0 && <span className="ps-mobile-nav-badge">{generatedPhotos.length}</span>}
          </button>
          <button className={`ps-mobile-nav-item ${mobileTab === 'products' ? 'active' : ''}`} onClick={() => setMobileTab('products')}>
            <Folder size={20} />
            <span>Товары</span>
          </button>
        </nav>

        {/* Modals (shared) */}
        {samplesOpen && (
          <div className="ps-modal-overlay ps-modal-overlay--floating" onClick={() => setSamplesOpen(false)}>
            <div className="ps-modal-card ps-modal-card--gallery" onClick={e => e.stopPropagation()}>
              <div className="ps-modal-head">
                <h3>Образцы</h3>
                <button onClick={() => setSamplesOpen(false)}><X size={16} /></button>
              </div>
              <div className="ps-gallery-section">
                <div className="ps-gallery-type-tabs">
                  <button className={galleryType === 'scene' ? 'active' : ''} onClick={() => setGalleryType('scene')}>Локации</button>
                  <button className={galleryType === 'model' ? 'active' : ''} onClick={() => setGalleryType('model')}>Модели</button>
                </div>
                {galleryLoading ? (
                  <div className="ps-modal-empty"><Loader2 size={16} className="ps-spin" /> Загрузка...</div>
                ) : (
                  <div className="ps-gallery-grid">
                    {gallerySystemAssets.length === 0 ? Array.from({ length: 8 }).map((_, idx) => (
                      <div key={idx} className="ps-gallery-tile ps-gallery-tile--placeholder"><Star size={18} /></div>
                    )) : gallerySystemAssets.slice(0, 12).map(asset => (
                      <button key={`sys-${asset.id}`} className="ps-gallery-tile" onClick={() => handleGallerySelect(asset)}>
                        <ProxiedImg src={asset.url} alt={asset.name} crossOrigin="anonymous" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {instructionsOpen && (
          <div className="ps-modal-overlay" onClick={() => setInstructionsOpen(false)}>
            <div className="ps-modal-card ps-modal-card--narrow" onClick={e => e.stopPropagation()}>
              <div className="ps-modal-head"><h3>Инструкции</h3><button onClick={() => setInstructionsOpen(false)}><X size={16} /></button></div>
              <div className="ps-instructions">
                <p>1. Выберите товар в «Товары» и прикрепите фото.</p>
                <p>2. Используйте быстрые команды или напишите запрос.</p>
                <p>3. Результаты в «История».</p>
              </div>
            </div>
          </div>
        )}

        {previewPhoto && (
          <div className="ps-preview-overlay" onClick={() => setPreviewPhoto(null)}>
            <button className="ps-preview-close"><X size={24} /></button>
            <div className="ps-preview-content" onClick={e => e.stopPropagation()}>
              {previewPhoto.type === 'video' ? (
                <video src={previewPhoto.url} controls autoPlay crossOrigin="anonymous" className="ps-preview-img" />
              ) : (
                <ProxiedImg src={previewPhoto.url} alt="" crossOrigin="anonymous" className="ps-preview-img" />
              )}
              {previewPhoto.prompt && <div className="ps-preview-prompt">{previewPhoto.prompt}</div>}
              <div className="ps-preview-actions">
                <button onClick={() => handleDownload(previewPhoto)}><Download size={16} /> Скачать</button>
                <button onClick={() => { attachByUrl(previewPhoto.url, previewPhoto.assetId); setPreviewPhoto(null); setMobileTab('chat'); }} disabled={!canAttachMore}><Paperclip size={16} /> В чат</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ===================== DESKTOP LAYOUT =====================
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
                          onClick={() => {
                            if (canAttachMore) {
                              attachByUrl(u);
                              toast.success('Фото прикреплено к чату');
                            } else {
                              toast.info('Максимум 3 фото');
                            }
                          }}
                          title="Клик — прикрепить к чату"
                          style={{ cursor: 'pointer' }}
                        >
                          <ProxiedImg
                            src={u}
                            alt=""
                            crossOrigin="anonymous"
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
                              onClick={(e) => { e.stopPropagation(); setGalleryAddRect((e.currentTarget as HTMLElement).getBoundingClientRect()); setGalleryAddPhoto({ id: uid(), url: u, type: 'image' }); }}
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
                      💡 Клик — прикрепить к чату (макс. 3)
                    </div>
                    {cardPhotosDirty && (
                      <>
                        <button
                          className="ps-card-save-btn"
                          onClick={() => setSaveConfirmOpen(true)}
                          disabled={cardPhotosSaving}
                        >
                          {cardPhotosSaving ? (
                            <><Loader2 size={14} className="ps-spin" /> Сохраняю...</>
                          ) : (
                            <><Save size={14} /> Сохранить в WB</>
                          )}
                        </button>
                        {saveConfirmOpen && (
                          <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
                            <p className="font-semibold">Применить изменения к карточке WB?</p>
                            <p className="mt-1 text-amber-700">Текущие фото карточки будут заменены на новый порядок. Это действие повлияет на живую карточку в WB.</p>
                            <div className="mt-2 flex gap-2">
                              <button
                                className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
                                onClick={handleSaveCardPhotoChanges}
                                disabled={cardPhotosSaving}
                              >
                                Подтвердить
                              </button>
                              <button
                                className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                                onClick={() => setSaveConfirmOpen(false)}
                              >
                                Отмена
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    {/* Last apply result */}
                    {lastApplyResult && (
                      <div className={`mt-2 rounded-xl border px-3 py-2 text-xs ${
                        lastApplyResult.matched
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          : 'border-amber-200 bg-amber-50 text-amber-800'
                      }`}>
                        <p className="font-semibold">
                          {lastApplyResult.matched ? '✓ Фото сохранены успешно' : '⚠ Порядок фото отличается'}
                        </p>
                        {!lastApplyResult.matched && (
                          <div className="mt-1">
                            <p className="text-amber-700">Итоговый порядок фото в WB отличается от запрошенного.</p>
                            {(lastApplyResult.missing_urls?.length ?? 0) > 0 && (
                              <p className="mt-0.5">Не применены: {lastApplyResult.missing_urls!.length} фото</p>
                            )}
                            {(lastApplyResult.unexpected_urls?.length ?? 0) > 0 && (
                              <p className="mt-0.5">Неожиданные: {lastApplyResult.unexpected_urls!.length} фото</p>
                            )}
                          </div>
                        )}
                        {lastApplyResult.stabilized === false && (
                          <p className="mt-1 text-amber-600 italic">WB ещё не стабилизировал порядок — проверьте позже.</p>
                        )}
                      </div>
                    )}
                    {/* Rollback placeholder */}
                    <div className="mt-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-3 py-2 text-[10px] text-slate-400">
                      Откат к предыдущему состоянию будет доступен после подключения backend-эндпоинта.
                    </div>
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
                          <ProxiedImg src={card.main_photo_url} alt="" crossOrigin="anonymous" />
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
            <div className="ps-chat-header-right" style={{ display: 'flex', gap: '6px', alignItems: 'center', position: 'relative' }}>
              <div ref={threadDropdownRef} style={{ position: 'relative' }}>
                <button
                  className="ps-choose-btn"
                  onClick={() => setThreadDropdownOpen((v) => !v)}
                  title="Чаты"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  <Folder size={14} />
                  Чаты
                  <ChevronDown size={12} style={{ transform: threadDropdownOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
                </button>
                {threadDropdownOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      right: 0,
                      marginTop: '4px',
                      width: '280px',
                      maxHeight: '320px',
                      overflowY: 'auto',
                      borderRadius: '10px',
                      boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
                      zIndex: 100,
                    }}
                    className="bg-card border border-border"
                  >
                    <div style={{ padding: '8px', borderBottom: '1px solid var(--border)' }}>
                      <button
                        className="ps-choose-btn"
                        onClick={() => { setThreadDropdownOpen(false); void startNewThread(); }}
                        style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '4px' }}
                      >
                        <Plus size={14} />
                        Новый чат
                      </button>
                    </div>
                    {threadList.length === 0 ? (
                      <div style={{ padding: '16px', textAlign: 'center', fontSize: '13px' }} className="text-muted-foreground">
                        Нет сохранённых чатов
                      </div>
                    ) : (
                      threadList.map((t) => (
                        <div
                          key={t.id}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            borderBottom: '1px solid var(--border)',
                            background: t.id === activeThreadId ? 'var(--accent)' : 'transparent',
                            transition: 'background 0.1s',
                          }}
                          className="hover:bg-accent"
                        >
                          <button
                            onClick={() => void switchThread(t.id)}
                            style={{
                              flex: 1,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'flex-start',
                              padding: '10px 8px 10px 12px',
                              cursor: 'pointer',
                              border: 'none',
                              borderRadius: 0,
                              background: 'transparent',
                              minWidth: 0,
                            }}
                          >
                            <span style={{
                              fontSize: '13px',
                              fontWeight: t.id === activeThreadId ? 600 : 400,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              width: '100%',
                              textAlign: 'left',
                            }} className="text-foreground">
                              {t.preview || 'Новый чат'}
                            </span>
                            <span style={{ fontSize: '11px', marginTop: '2px' }} className="text-muted-foreground">
                              {t.messageCount > 0 ? `${t.messageCount} сообщений` : 'Пустой чат'}
                              {' · '}
                              {new Date(t.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                            </span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void deleteThread(t.id);
                            }}
                            title="Удалить чат"
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: '6px 10px',
                              color: 'var(--muted-foreground)',
                              borderRadius: '6px',
                              transition: 'color 0.15s, background 0.15s',
                              flexShrink: 0,
                            }}
                            className="hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
              <button
                className="ps-choose-btn"
                onClick={() => void startNewThread()}
                title="Новый чат"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                <Plus size={14} />
                Новый
              </button>
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
                    onPhotoClick={(photo) => {
                      setPreviewPhoto(photo);
                    }}
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
                {isBotTyping && botIndicatorMode && (
                  <StreamActivityIndicator mode={botIndicatorMode} />
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
                    <QuickCommandsPanel
                      quickMenu={quickMenu}
                      quickActive={quickActive}
                      setQuickActive={setQuickActive}
                      activeQuickMenu={activeQuickMenu}
                      onPick={handleQuickPick}
                    />
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
                        <ProxiedImg src={attachedPhotos[0].url} alt="" crossOrigin="anonymous" />
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
                          <ProxiedImg src={p.url} alt="" crossOrigin="anonymous" />
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
                      <div className="ps-gen-dropzone" onClick={() => handleZoneClick('garment', genFileInputRef1)}>
                        {genGarmentPhoto ? (
                          <div className="ps-gen-dropzone-preview">
                            <ProxiedImg src={genGarmentPhoto.url} alt="" crossOrigin="anonymous" />
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

                      <div className="ps-gen-dropzone" onClick={() => handleZoneClick('model', genFileInputRef2)}>
                        {genModelPhoto ? (
                          <div className="ps-gen-dropzone-preview">
                            <ProxiedImg src={genModelPhoto.url} alt="" crossOrigin="anonymous" />
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
                              <ProxiedImg src={p.url} alt="" crossOrigin="anonymous" />
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
                      <div className="ps-gen-dropzone" onClick={() => handleZoneClick('garment', genFileInputRef1)}>
                        {genGarmentPhoto ? (
                          <div className="ps-gen-dropzone-preview">
                            <ProxiedImg src={genGarmentPhoto.url} alt="" crossOrigin="anonymous" />
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
                              <ProxiedImg src={p.url} alt="" crossOrigin="anonymous" />
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
                              className={`ps-gen-catalog-option ${genSelectedModel?.id === opt.id ? 'active' : ''}`}
                              onClick={() => {
                                const next = genSelectedModel?.id === opt.id ? null : opt;
                                setGenSelectedModel(next);
                                setGenNewModelPrompt(next?.prompt || '');
                              }}
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
                      onChange={(e) => {
                        const next = e.target.value;
                        setGenNewModelPrompt(next);
                        if (genSelectedModel?.prompt !== next) setGenSelectedModel(null);
                      }}
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
                      <div className="ps-gen-dropzone" onClick={() => handleZoneClick()}>
                        {genSourcePhoto ? (
                          <div className="ps-gen-dropzone-preview">
                            <ProxiedImg src={genSourcePhoto.url} alt="" crossOrigin="anonymous" />
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
                              <ProxiedImg src={p.url} alt="" crossOrigin="anonymous" />
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
                      <div className="ps-gen-dropzone" onClick={() => handleZoneClick()}>
                        {genSourcePhoto ? (
                          <div className="ps-gen-dropzone-preview">
                            <ProxiedImg src={genSourcePhoto.url} alt="" crossOrigin="anonymous" />
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
                              <ProxiedImg src={p.url} alt="" crossOrigin="anonymous" />
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
                      <div className="ps-gen-dropzone" onClick={() => handleZoneClick()}>
                        {genSourcePhoto ? (
                          <div className="ps-gen-dropzone-preview">
                            <ProxiedImg src={genSourcePhoto.url} alt="" crossOrigin="anonymous" />
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
                              <ProxiedImg src={p.url} alt="" crossOrigin="anonymous" />
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
                      <div className="ps-gen-dropzone" onClick={() => handleZoneClick()}>
                        {genSourcePhoto ? (
                          <div className="ps-gen-dropzone-preview">
                            <ProxiedImg src={genSourcePhoto.url} alt="" crossOrigin="anonymous" />
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
                              <ProxiedImg src={p.url} alt="" crossOrigin="anonymous" />
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
                              className={`ps-gen-catalog-option ${genSelectedVideo?.id === v.id ? 'active' : ''}`}
                              onClick={() => {
                                const next = genSelectedVideo?.id === v.id ? null : v;
                                setGenSelectedVideo(next);
                                setGenVideoPrompt(next?.prompt || '');
                              }}
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
                      onChange={(e) => {
                        const next = e.target.value;
                        setGenVideoPrompt(next);
                        if (genSelectedVideo?.prompt !== next) setGenSelectedVideo(null);
                      }}
                      placeholder="Или введите своё описание движения..."
                    />
                  </div>
                )}
              </div>

              {renderGeneratorResult()}

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
          {renderProductPicker()}

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
                          title="Клик — просмотр | Перетащите в чат для прикрепления"
                        >
                          {p.type === 'video' ? (
                            <video src={p.url} crossOrigin="anonymous" />
                          ) : (
                            <ProxiedImg src={p.url} alt="" crossOrigin="anonymous" />
                          )}
                        </button>
                        {/* Hover actions overlay */}
                        <div className={`ps-history-hover-actions ${hoveredHistoryId === p.id ? 'visible' : ''}`}>
                          <button onClick={() => handleDownload(p)} title="Скачать">
                            <Download size={13} />
                          </button>
                          <button onClick={() => { void deleteHistoryPhoto(p); }} title="Удалить">
                            <Trash2 size={13} />
                          </button>
                          <button onClick={(e) => { setGalleryAddRect((e.currentTarget as HTMLElement).getBoundingClientRect()); setGalleryAddPhoto(p); setGalleryAddType('scene'); }} title="В галерею">
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
                      <button
                        key={`sys-${asset.id}`}
                        className="ps-gallery-tile"
                        onClick={() => handleGallerySelect(asset)}
                        onMouseEnter={(e) => {
                          const el = e.currentTarget as HTMLElement;
                          if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                          hoverTimerRef.current = setTimeout(() => {
                            setHoverPreview({ photo: { id: String(asset.id), url: asset.url, type: 'image' }, rect: el.getBoundingClientRect() });
                          }, 350);
                        }}
                        onMouseLeave={() => {
                          if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
                          setHoverPreview(null);
                        }}
                      >
                        <ProxiedImg src={asset.url} alt={asset.name} crossOrigin="anonymous" />
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
                  <button
                    key={`my-${asset.id}`}
                    className="ps-gallery-tile"
                    onClick={() => handleGallerySelect(asset)}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget as HTMLElement;
                      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                      hoverTimerRef.current = setTimeout(() => {
                        setHoverPreview({ photo: { id: String(asset.id), url: asset.url, type: 'image' }, rect: el.getBoundingClientRect() });
                      }, 350);
                    }}
                    onMouseLeave={() => {
                      if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
                      setHoverPreview(null);
                    }}
                  >
                    <ProxiedImg src={asset.url} alt={asset.name} crossOrigin="anonymous" />
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
              <ProxiedImg src={previewPhoto.url} alt="" crossOrigin="anonymous" className="ps-preview-img" />
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

      {/* Gallery add popover */}
      {galleryAddPhoto && (
        <div className="ps-modal-overlay ps-modal-overlay--transparent" onClick={() => setGalleryAddPhoto(null)}>
          <div
            className="ps-gallery-add-popover"
            onClick={(e) => e.stopPropagation()}
            style={galleryAddRect ? {
              top: Math.min(galleryAddRect.top, window.innerHeight - 200),
              left: Math.min(galleryAddRect.right + 8, window.innerWidth - 220),
            } : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
          >
            <div className="ps-gallery-add-popover-head">
              <span>В галерею</span>
              <button onClick={() => setGalleryAddPhoto(null)}><X size={12} /></button>
            </div>
            <div className="ps-gallery-add-popover-body">
              <div className="ps-gallery-add-popover-thumb">
                <ProxiedImg src={galleryAddPhoto.url} alt="" crossOrigin="anonymous" />
              </div>
              <div className="ps-gallery-add-popover-options">
                <button
                  className={`ps-gallery-add-popover-type ${galleryAddType === 'scene' ? 'active' : ''}`}
                  onClick={() => setGalleryAddType('scene')}
                >
                  <Mountain size={12} /> Локация
                </button>
                <button
                  className={`ps-gallery-add-popover-type ${galleryAddType === 'model' ? 'active' : ''}`}
                  onClick={() => setGalleryAddType('model')}
                >
                  <User size={12} /> Модель
                </button>
              </div>
              <button
                className="ps-gallery-add-popover-confirm"
                onClick={() => galleryAddPhoto && addPhotoToGallery(galleryAddPhoto, galleryAddType)}
                disabled={galleryAdding}
              >
                {galleryAdding ? <Loader2 size={12} className="ps-spin" /> : <Plus size={12} />}
                {galleryAdding ? 'Добавляю...' : 'Добавить'}
              </button>
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
            <ProxiedImg src={hoverPreview.photo.url} alt="" crossOrigin="anonymous" className="ps-hover-enlarge-img" />
          )}
          {hoverPreview.photo.prompt && (
            <div className="ps-hover-enlarge-prompt">{hoverPreview.photo.prompt}</div>
          )}
        </div>
      )}
    </div>
  );
}

const QuickCommandsPanel = React.memo(function QuickCommandsPanel({
  quickMenu,
  quickActive,
  setQuickActive,
  activeQuickMenu,
  onPick,
}: {
  quickMenu: QuickMenuAction[];
  quickActive: QuickActionId;
  setQuickActive: (id: QuickActionId) => void;
  activeQuickMenu: QuickMenuAction;
  onPick: (action: QuickMenuAction, option: QuickMenuAction['options'][number]) => void;
}) {
  return (
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
              onClick={() => { void onPick(activeQuickMenu, opt); }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});

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
        {/* Generation animation placeholder */}
        {msg.isLoading && msg.type === 'action-progress' && (
          <div className="ps-gen-anim">
            <div className="ps-gen-anim-shimmer">
              <div className="ps-gen-anim-icon">
                <Sparkles size={24} />
              </div>
              <div className="ps-gen-anim-bars">
                <div className="ps-gen-anim-bar" style={{ animationDelay: '0s' }} />
                <div className="ps-gen-anim-bar" style={{ animationDelay: '0.15s' }} />
                <div className="ps-gen-anim-bar" style={{ animationDelay: '0.3s' }} />
              </div>
            </div>
          </div>
        )}
        {msg.photos && msg.photos.length > 0 && (
          <div className={`ps-msg-photos ps-msg-photos--${Math.min(msg.photos.length, 4)}`}>
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
                  <ProxiedImg src={p.url} alt="" crossOrigin="anonymous" />
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
