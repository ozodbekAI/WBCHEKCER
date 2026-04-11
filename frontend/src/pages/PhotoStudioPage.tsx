import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useStore } from '../contexts/StoreContext';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api, { API_ORIGIN } from '../api/client';
import type {
  PhotoChatAsset,
  PhotoChatClearMode,
  PhotoChatHistoryResponse,
  PhotoChatSsePayload,
  PhotoChatThreadContext,
  PhotoChatUploadResponse,
} from '../features/photo-studio/contract';
import { createPhotoChatSseDecoder } from '../features/photo-studio/contract';
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
import { toast } from 'sonner';

interface PhotoMedia {
  id: string;
  assetId?: number;
  url: string;
  fileName?: string;
  type: 'image' | 'video';
  prompt?: string;
  localFile?: File;
  source?: string;
  caption?: string;
}

interface ChatMessage {
  id: string;
  dbId?: number;
  role: 'user' | 'assistant';
  type: 'text' | 'image' | 'question' | 'action-progress' | 'action-complete' | 'action-error';
  content: string;
  timestamp: Date;
  photos?: PhotoMedia[];
  isLoading?: boolean;
  requestId?: string;
  threadId?: number;
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

type AppLocale = 'ru' | 'uz' | 'en';

interface StreamRequestDraft {
  text: string;
  photos: PhotoMedia[];
  quickAction?: Record<string, any>;
}

interface PreparedStreamRequest extends StreamRequestDraft {
  payload: {
    message: string;
    asset_ids?: number[];
    quick_action?: Record<string, any>;
    thread_id?: number;
    request_id: string;
    locale: string;
  };
}

interface UiText {
  studioTitle: string;
  newChat: string;
  clearMessages: string;
  select: string;
  cancel: string;
  chooseAll: string;
  deleteSelected: string;
  deleteAll: string;
  activeThread: string;
  activeThreadShort: string;
  activeImages: string;
  noActiveImages: string;
  activeHint: string;
  pendingQuestion: string;
  localeLabel: string;
  relatedMedia: string;
  persistentLibraryHint: string;
  emptyMedia: string;
  emptyMediaSub: string;
  retry: string;
  dismiss: string;
  sendPlaceholder: string;
  sendPlaceholderWithAttachments: string;
  sendPlaceholderWithActiveContext: string;
  loadingHistory: string;
  emptyConversationTitle: string;
  emptyConversationBody: string;
  generationStarted: string;
  imagesStarted: string;
  imageStarted: string;
  generationComplete: string;
  genericError: string;
  retryBannerTitle: string;
  retryBannerBody: string;
  limitReachedTitle: string;
  limitReachedBody: string;
  questionBadge: string;
  activeBadge: string;
  lastGeneratedBadge: string;
  clearSuccess: string;
  newChatSuccess: string;
  restoreHistoryError: string;
  unsupportedAssetError: string;
  libraryTabImages: string;
  libraryTabVideos: string;
}

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

function normalizeUiLocale(raw?: string | null): AppLocale {
  const value = String(raw || '').trim().toLowerCase();
  if (value.startsWith('uz')) return 'uz';
  if (value.startsWith('en')) return 'en';
  return 'ru';
}

function detectBrowserLocale(): string {
  if (typeof navigator === 'undefined') return 'ru';
  return navigator.languages?.[0] || navigator.language || 'ru';
}

function getUiText(locale: AppLocale): UiText {
  if (locale === 'uz') {
    return {
      studioTitle: 'AI Foto studiya',
      newChat: 'Yangi chat',
      clearMessages: 'Xabarlarni tozalash',
      select: 'Tanlash',
      cancel: 'Bekor qilish',
      chooseAll: 'Barchasini tanlash',
      deleteSelected: 'Tanlanganlarni o‘chirish',
      deleteAll: 'Barchasini o‘chirish',
      activeThread: 'Faol chat',
      activeThreadShort: 'Chat',
      activeImages: 'Faol ishchi rasmlar',
      noActiveImages: 'Bu chat uchun faol rasm tanlanmagan',
      activeHint: 'Yangi tahrirlar ushbu faol rasm(lar)ga qo‘llanadi.',
      pendingQuestion: 'Aniqlashtirish savoli',
      localeLabel: 'Til',
      relatedMedia: 'Media kutubxonasi',
      persistentLibraryHint: 'Bu doimiy kutubxona. Chatni tozalash media fayllarni o‘chirmaydi.',
      emptyMedia: 'Media hali yo‘q',
      emptyMediaSub: 'Rasm yuklang yoki generatsiyani ishga tushiring',
      retry: 'Qayta urinish',
      dismiss: 'Yopish',
      sendPlaceholder: 'Nima qilmoqchi ekaningizni yozing...',
      sendPlaceholderWithAttachments: 'Rasm bilan nima qilish kerak?',
      sendPlaceholderWithActiveContext: 'Faol rasmga qanday o‘zgartirish kiritamiz?',
      loadingHistory: 'Chat yuklanmoqda...',
      emptyConversationTitle: 'Yangi suhbat',
      emptyConversationBody: 'Media biriktiring yoki topshiriq yozing. Kontekst chat ichida saqlanadi.',
      generationStarted: 'Generatsiya boshlandi...',
      imagesStarted: 'Bir nechta rasm yaratilmoqda...',
      imageStarted: 'Rasm yaratilmoqda...',
      generationComplete: 'Tayyor',
      genericError: 'Ulanishda xato yuz berdi. Qaytadan urinib ko‘ring.',
      retryBannerTitle: 'So‘rov yakunlanmadi',
      retryBannerBody: 'Xuddi shu topshiriqni yana yuborishingiz mumkin.',
      limitReachedTitle: 'Chat limiti tugadi',
      limitReachedBody: 'Yana yuborish uchun xabarlarni tozalang yoki yangi chat boshlang.',
      questionBadge: 'Aniqlashtirish',
      activeBadge: 'Faol',
      lastGeneratedBadge: 'Oxirgi natija',
      clearSuccess: 'Chat xabarlari tozalandi',
      newChatSuccess: 'Yangi chat boshlandi',
      restoreHistoryError: 'Foto studiya tarixini yuklab bo‘lmadi',
      unsupportedAssetError: 'Rasmni chatga tayyorlab bo‘lmadi',
      libraryTabImages: 'Rasmlar',
      libraryTabVideos: 'Videolar',
    };
  }

  if (locale === 'en') {
    return {
      studioTitle: 'AI Photo Studio',
      newChat: 'New chat',
      clearMessages: 'Clear messages',
      select: 'Select',
      cancel: 'Cancel',
      chooseAll: 'Select all',
      deleteSelected: 'Delete selected',
      deleteAll: 'Delete all',
      activeThread: 'Active thread',
      activeThreadShort: 'Thread',
      activeImages: 'Active working images',
      noActiveImages: 'No active image is selected for this thread',
      activeHint: 'Follow-up edits will target these active images.',
      pendingQuestion: 'Clarification needed',
      localeLabel: 'Locale',
      relatedMedia: 'Media library',
      persistentLibraryHint: 'This library is persistent. Clearing chat does not delete media assets.',
      emptyMedia: 'No media yet',
      emptyMediaSub: 'Upload an image or start a generation',
      retry: 'Retry',
      dismiss: 'Dismiss',
      sendPlaceholder: 'Describe what you want to do...',
      sendPlaceholderWithAttachments: 'What should I do with these images?',
      sendPlaceholderWithActiveContext: 'What should I change in the active image?',
      loadingHistory: 'Loading chat...',
      emptyConversationTitle: 'Start a new conversation',
      emptyConversationBody: 'Attach media or type a request. Thread context will carry follow-up edits.',
      generationStarted: 'Starting generation...',
      imagesStarted: 'Generating images...',
      imageStarted: 'Generating image...',
      generationComplete: 'Done',
      genericError: 'Connection error. Please try again.',
      retryBannerTitle: 'The request did not finish',
      retryBannerBody: 'You can retry the same task.',
      limitReachedTitle: 'Chat limit reached',
      limitReachedBody: 'Clear messages or start a new chat to continue.',
      questionBadge: 'Clarification',
      activeBadge: 'Active',
      lastGeneratedBadge: 'Latest result',
      clearSuccess: 'Chat messages cleared',
      newChatSuccess: 'Started a new chat',
      restoreHistoryError: 'Could not restore Photo Studio history',
      unsupportedAssetError: 'Could not prepare an image for chat',
      libraryTabImages: 'Images',
      libraryTabVideos: 'Videos',
    };
  }

  return {
    studioTitle: 'AI Фотостудия',
    newChat: 'Новый чат',
    clearMessages: 'Очистить сообщения',
    select: 'Выбрать',
    cancel: 'Отмена',
    chooseAll: 'Выбрать все',
    deleteSelected: 'Удалить выбранные',
    deleteAll: 'Удалить все',
    activeThread: 'Активный чат',
    activeThreadShort: 'Чат',
    activeImages: 'Активные рабочие изображения',
    noActiveImages: 'Для этого чата пока нет активного изображения',
    activeHint: 'Последующие правки будут применяться к активному изображению выше.',
    pendingQuestion: 'Уточнение от ассистента',
    localeLabel: 'Язык',
    relatedMedia: 'Медиатека',
    persistentLibraryHint: 'Это постоянная библиотека. Очистка чата не удаляет медиафайлы.',
    emptyMedia: 'Пока нет медиа',
    emptyMediaSub: 'Загрузите фото или запустите генерацию',
    retry: 'Повторить',
    dismiss: 'Закрыть',
    sendPlaceholder: 'Напишите, что хотите сделать...',
    sendPlaceholderWithAttachments: 'Что сделать с фото?',
    sendPlaceholderWithActiveContext: 'Что изменить в активном изображении?',
    loadingHistory: 'Загружаю чат...',
    emptyConversationTitle: 'Новый диалог',
    emptyConversationBody: 'Прикрепите медиа или напишите задачу. Контекст будет храниться внутри чата.',
    generationStarted: 'Запускаю генерацию...',
    imagesStarted: 'Генерирую изображения...',
    imageStarted: 'Генерирую изображение...',
    generationComplete: 'Готово',
    genericError: 'Ошибка соединения. Попробуйте ещё раз.',
    retryBannerTitle: 'Запрос не завершился',
    retryBannerBody: 'Можно отправить ту же задачу повторно.',
    limitReachedTitle: 'Достигнут лимит чата',
    limitReachedBody: 'Очистите сообщения или начните новый чат, чтобы продолжить.',
    questionBadge: 'Уточнение',
    activeBadge: 'Активно',
    lastGeneratedBadge: 'Последний результат',
    clearSuccess: 'Сообщения чата очищены',
    newChatSuccess: 'Новый чат создан',
    restoreHistoryError: 'Не удалось восстановить историю фотостудии',
    unsupportedAssetError: 'Не удалось подготовить изображение для чата',
    libraryTabImages: 'Фото',
    libraryTabVideos: 'Видео',
  };
}

function normalizeThreadContext(context?: Partial<PhotoChatThreadContext> | null): PhotoChatThreadContext {
  const workingIds = Array.isArray(context?.working_asset_ids)
    ? context?.working_asset_ids.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
    : [];

  return {
    last_generated_asset_id: context?.last_generated_asset_id ? Number(context.last_generated_asset_id) : null,
    working_asset_ids: workingIds,
    pending_question: context?.pending_question ? String(context.pending_question) : null,
    last_action: context?.last_action ?? null,
    locale: context?.locale ? String(context.locale) : null,
  };
}

function assetToPhotoMedia(asset: PhotoChatAsset): PhotoMedia | null {
  const assetId = Number(asset.asset_id || 0);
  const url = toAbsoluteMediaUrl(asset.file_url || '');
  if (!assetId || !url) return null;
  return {
    id: `asset-${assetId}`,
    assetId,
    url,
    fileName: asset.file_name || fileNameFromUrl(url),
    type: /\.(mp4|mov|webm)$/i.test(asset.file_url || asset.file_name || '') || asset.kind === 'video' ? 'video' : 'image',
    prompt: asset.prompt || asset.caption || '',
    source: asset.source,
    caption: asset.caption || '',
  };
}

function buildAssetMap(assets: PhotoChatAsset[]): Map<number, PhotoMedia> {
  const map = new Map<number, PhotoMedia>();
  for (const asset of assets) {
    const media = assetToPhotoMedia(asset);
    if (media?.assetId) {
      map.set(media.assetId, media);
    }
  }
  return map;
}

function historyMessageToChatMessage(record: PhotoChatHistoryResponse['messages'][number], assetMap: Map<number, PhotoMedia>): ChatMessage {
  const role: 'user' | 'assistant' = record.role === 'model' || record.role === 'assistant' ? 'assistant' : 'user';
  const metaAssetIds = Array.isArray(record.meta?.asset_ids)
    ? (record.meta?.asset_ids as unknown[]).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
    : [];
  const photos = metaAssetIds.map((assetId) => assetMap.get(assetId)).filter(Boolean) as PhotoMedia[];
  const msgType: ChatMessage['type'] = record.msg_type === 'image'
    ? 'image'
    : role === 'assistant' && record.meta && typeof record.meta === 'object' && (record.meta as Record<string, unknown>).question
      ? 'question'
      : 'text';

  return {
    id: `db-${record.id}`,
    dbId: Number(record.id),
    role,
    type: msgType,
    content: record.content || '',
    timestamp: record.created_at ? new Date(record.created_at) : new Date(),
    photos: photos.length > 0 ? photos : undefined,
    requestId: record.request_id || undefined,
    threadId: record.thread_id || undefined,
  };
}

export default function PhotoStudioPage() {
  const { activeStore, loadStores } = useStore();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const browserLocale = useMemo(() => detectBrowserLocale(), []);
  const [threadContext, setThreadContext] = useState<PhotoChatThreadContext>(() => normalizeThreadContext());
  const locale = normalizeUiLocale(threadContext.locale || browserLocale);
  const t = useMemo(() => getUiText(locale), [locale]);
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

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
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
  const [libraryMedia, setLibraryMedia] = useState<PhotoMedia[]>([]);
  const [threadId, setThreadId] = useState<number | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [messageCount, setMessageCount] = useState(0);
  const [messageLimit, setMessageLimit] = useState<number | null>(null);
  const [isThreadLocked, setIsThreadLocked] = useState(false);
  const [streamError, setStreamError] = useState<{ title: string; message: string; retryable: boolean } | null>(null);

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
  const lastStreamDraftRef = useRef<PreparedStreamRequest | null>(null);

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
      const data = await api.getPhotoCatalogAll();

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

  useEffect(() => {
    if (!samplesOpen) return;
    void loadGalleryAssets(galleryType);
  }, [samplesOpen, galleryType]);

  const upsertLibraryMedia = useCallback((media: PhotoMedia) => {
    setLibraryMedia((prev) => {
      const next = prev.filter((item) => {
        if (media.assetId && item.assetId) return item.assetId !== media.assetId;
        return item.id !== media.id;
      });
      return [media, ...next];
    });
  }, []);

  const hydrateHistory = useCallback((data: PhotoChatHistoryResponse, options?: { preserveLibraryIfEmpty?: boolean }) => {
    const assets = Array.isArray(data.assets) ? data.assets : [];
    const library = assets.map(assetToPhotoMedia).filter(Boolean) as PhotoMedia[];
    const assetMap = buildAssetMap(assets);
    const nextMessages = (Array.isArray(data.messages) ? data.messages : []).map((message) => historyMessageToChatMessage(message, assetMap));

    setMessages(nextMessages);
    setThreadId(Number(data.thread_id || 0) || null);
    setActiveThreadId(Number(data.active_thread_id || 0) || null);
    setSessionKey(data.session_key || null);
    setThreadContext(normalizeThreadContext(data.context_state));
    setMessageCount(Number(data.message_count || 0));
    setMessageLimit(data.limit ?? null);
    setIsThreadLocked(Boolean(data.locked));
    setStreamError(null);

    if (library.length > 0 || !options?.preserveLibraryIfEmpty) {
      setLibraryMedia(library);
    }
  }, []);

  const loadChatHistory = useCallback(async (requestedThreadId?: number) => {
    setIsHistoryLoading(true);
    try {
      const data = await api.getPhotoChatHistory(requestedThreadId);
      hydrateHistory(data);
    } catch (e) {
      console.warn('Failed to load chat history', e);
      toast.error(t.restoreHistoryError);
    } finally {
      setIsHistoryLoading(false);
    }
  }, [hydrateHistory, t.restoreHistoryError]);

  useEffect(() => {
    void loadChatHistory();
  }, [loadChatHistory]);

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

  const uploadFile = async (file: File): Promise<PhotoChatUploadResponse> => {
    const data = await api.uploadPhotoChatAsset(file);
    const media: PhotoMedia = {
      id: `asset-${data.asset_id}`,
      assetId: data.asset_id,
      url: toAbsoluteMediaUrl(data.file_url),
      fileName: data.file_name,
      type: /\.(mp4|mov|webm)$/i.test(data.file_url || data.file_name || '') ? 'video' : 'image',
      caption: data.caption || '',
    };
    upsertLibraryMedia(media);
    return data;
  };

  const importUrlAsAsset = async (url: string): Promise<PhotoChatUploadResponse> => {
    const data = await api.importPhotoChatAsset(url);
    const media: PhotoMedia = {
      id: `asset-${data.asset_id}`,
      assetId: data.asset_id,
      url: toAbsoluteMediaUrl(data.file_url),
      fileName: data.file_name,
      type: /\.(mp4|mov|webm)$/i.test(data.file_url || data.file_name || '') ? 'video' : 'image',
      caption: data.caption || '',
      source: 'import',
    };
    upsertLibraryMedia(media);
    return data;
  };

  const resolveAssetIds = useCallback(async (photos: PhotoMedia[]): Promise<number[]> => {
    const assetIds: number[] = [];

    for (const photo of photos) {
      if (photo.assetId) {
        assetIds.push(photo.assetId);
        continue;
      }

      if (photo.localFile) {
        const uploaded = await uploadFile(photo.localFile);
        assetIds.push(uploaded.asset_id);
        continue;
      }

      if (photo.url) {
        const imported = await importUrlAsAsset(photo.url);
        assetIds.push(imported.asset_id);
      }
    }

    return Array.from(new Set(assetIds.filter((assetId) => Number.isFinite(assetId) && assetId > 0)));
  }, [upsertLibraryMedia]);

  const applyStreamPayload = useCallback((
    payload: PhotoChatSsePayload,
    state: {
      userMessageId: string;
      botMessageId: string;
      botAdded: boolean;
      botContent: string;
      botPhotos: PhotoMedia[];
    },
  ) => {
    const syncThread = (nextThreadId: number) => {
      if (Number.isFinite(nextThreadId) && nextThreadId > 0) {
        setThreadId(nextThreadId);
        setActiveThreadId(nextThreadId);
      }
    };

    const upsertBot = (type: ChatMessage['type'], loading = false) => {
      if (!state.botAdded) {
        state.botAdded = true;
        setMessages((prev) => [
          ...prev,
          {
            id: state.botMessageId,
            role: 'assistant',
            type,
            content: state.botContent,
            timestamp: new Date(),
            photos: state.botPhotos.length > 0 ? [...state.botPhotos] : undefined,
            isLoading: loading,
            requestId: payload.request_id,
            threadId: payload.thread_id,
          },
        ]);
        return;
      }

      setMessages((prev) => prev.map((message) => (
        message.id === state.botMessageId
          ? {
            ...message,
            type,
            content: state.botContent,
            photos: state.botPhotos.length > 0 ? [...state.botPhotos] : undefined,
            isLoading: loading,
            requestId: payload.request_id,
            threadId: payload.thread_id,
          }
          : message
      )));
    };

    syncThread(payload.thread_id);

    switch (payload.type) {
      case 'ack':
        if (payload.user_message_id) {
          setMessages((prev) => prev.map((message) => (
            message.id === state.userMessageId
              ? { ...message, dbId: Number(payload.user_message_id) }
              : message
          )));
        }
        setMessageCount((prev) => prev + 1);
        break;
      case 'chat':
        state.botContent = payload.content || payload.message || '';
        setThreadContext((prev) => ({ ...prev, pending_question: null }));
        upsertBot('text');
        break;
      case 'question':
        state.botContent = payload.content || payload.message || '';
        setThreadContext((prev) => ({ ...prev, pending_question: state.botContent || null }));
        upsertBot('question');
        break;
      case 'generation_start':
        state.botContent = payload.prompt || t.generationStarted;
        upsertBot('action-progress', true);
        break;
      case 'images_start':
        state.botContent = payload.total && payload.total > 1 ? `${t.imagesStarted} ${payload.total}` : t.imagesStarted;
        upsertBot('action-progress', true);
        break;
      case 'image_started':
        state.botContent = payload.index && payload.total
          ? `${t.imageStarted} ${payload.index}/${payload.total}`
          : t.imageStarted;
        upsertBot('action-progress', true);
        break;
      case 'generation_complete': {
        const url = toAbsoluteMediaUrl(payload.image_url || '');
        if (url) {
          const media: PhotoMedia = {
            id: payload.asset_id ? `asset-${payload.asset_id}` : uid(),
            assetId: payload.asset_id || undefined,
            url,
            fileName: payload.file_name || fileNameFromUrl(url),
            type: 'image',
            prompt: payload.prompt || '',
            source: 'generated',
          };
          state.botPhotos = [
            ...state.botPhotos.filter((photo) => {
              if (media.assetId && photo.assetId) return photo.assetId !== media.assetId;
              return photo.url !== media.url;
            }),
            media,
          ];
          upsertLibraryMedia(media);
        }
        state.botContent = payload.prompt || t.generationComplete;
        {
          const total = Number(payload.total || 1);
          const index = Number(payload.index || total);
          upsertBot('action-complete', total > 1 && index < total);
        }
        break;
      }
      case 'context_state':
        setThreadContext(normalizeThreadContext(payload.context_state));
        break;
      case 'limit_reached': {
        const message = payload.message || payload.content || t.limitReachedBody;
        setIsThreadLocked(true);
        setStreamError({ title: t.limitReachedTitle, message, retryable: false });
        state.botContent = message;
        upsertBot('action-error');
        break;
      }
      case 'error': {
        const message = payload.message || payload.error?.message || payload.content || t.genericError;
        setStreamError({
          title: t.retryBannerTitle,
          message,
          retryable: payload.retryable !== false,
        });
        state.botContent = message;
        upsertBot('action-error');
        break;
      }
    }
  }, [t, upsertLibraryMedia]);

  const runPreparedStream = useCallback(async (prepared: PreparedStreamRequest, userMessageId: string) => {
    const res = await api.streamPhotoChat(prepared.payload);
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error(t.genericError);
    }

    const decoder = createPhotoChatSseDecoder();
    const textDecoder = new TextDecoder();
    const state = {
      userMessageId,
      botMessageId: uid(),
      botAdded: false,
      botContent: '',
      botPhotos: [] as PhotoMedia[],
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = textDecoder.decode(value, { stream: true });
      for (const payload of decoder.push(chunk)) {
        applyStreamPayload(payload, state);
      }
    }

    for (const payload of decoder.flush()) {
      applyStreamPayload(payload, state);
    }

    if (state.botAdded) {
      setMessages((prev) => prev.map((message) => (
        message.id === state.botMessageId
          ? { ...message, isLoading: false }
          : message
      )));
    }
  }, [applyStreamPayload, t.genericError]);

  const prepareStreamRequest = useCallback(async (draft: StreamRequestDraft): Promise<PreparedStreamRequest> => {
    const normalizedText = draft.text.trim();
    const assetIds = await resolveAssetIds(draft.photos);
    const requestId = crypto.randomUUID?.() || `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      ...draft,
      payload: {
        message: normalizedText || '',
        ...(assetIds.length > 0 ? { asset_ids: assetIds } : {}),
        ...(draft.quickAction ? { quick_action: draft.quickAction } : {}),
        ...(threadId ? { thread_id: threadId } : {}),
        request_id: requestId,
        locale: threadContext.locale || browserLocale,
      },
    };
  }, [browserLocale, resolveAssetIds, threadContext.locale, threadId]);

  const sendMessage = async ({ text, photos, quickAction }: StreamRequestDraft) => {
    const normalizedText = (text || '').trim();
    if ((!normalizedText && photos.length === 0 && !quickAction) || isStreaming || isThreadLocked) {
      return;
    }

    setIsStreaming(true);
    setStreamError(null);

    try {
      const prepared = await prepareStreamRequest({ text: normalizedText, photos, quickAction });
      lastStreamDraftRef.current = prepared;

      const userMsgId = uid();
      setInputText('');
      setAttachedPhotos([]);
      setMessages((prev) => [
        ...prev,
        {
          id: userMsgId,
          role: 'user',
          type: photos.length > 0 && !normalizedText ? 'image' : 'text',
          content: normalizedText,
          timestamp: new Date(),
          photos: photos.length > 0 ? photos : undefined,
          requestId: prepared.payload.request_id,
          threadId: threadId || undefined,
        },
      ]);

      await runPreparedStream(prepared, userMsgId);
    } catch (e) {
      const message = e instanceof Error ? e.message : t.unsupportedAssetError;
      setStreamError({
        title: t.retryBannerTitle,
        message,
        retryable: true,
      });
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: 'assistant',
          type: 'action-error',
          content: message,
          timestamp: new Date(),
        },
      ]);
      toast.error(message || t.unsupportedAssetError);
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
  const libraryPhotos = useMemo(() => libraryMedia.filter((p) => p.type === 'image'), [libraryMedia]);
  const libraryVideos = useMemo(() => libraryMedia.filter((p) => p.type === 'video'), [libraryMedia]);
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
  const libraryAssetMap = useMemo(() => {
    const map = new Map<number, PhotoMedia>();
    for (const media of libraryMedia) {
      if (media.assetId) {
        map.set(media.assetId, media);
      }
    }
    return map;
  }, [libraryMedia]);
  const activeWorkingAssetIds = useMemo(() => {
    const ids = [...threadContext.working_asset_ids];
    if (threadContext.last_generated_asset_id && !ids.includes(threadContext.last_generated_asset_id)) {
      ids.unshift(threadContext.last_generated_asset_id);
    }
    return Array.from(new Set(ids.filter((value) => Number.isFinite(value) && value > 0)));
  }, [threadContext.last_generated_asset_id, threadContext.working_asset_ids]);
  const activeWorkingMedia = useMemo(
    () => activeWorkingAssetIds.map((assetId) => libraryAssetMap.get(assetId)).filter(Boolean) as PhotoMedia[],
    [activeWorkingAssetIds, libraryAssetMap],
  );
  const messageUsageLabel = useMemo(() => {
    if (messageLimit === null || messageLimit <= 0) return null;
    return `${messageCount}/${messageLimit}`;
  }, [messageCount, messageLimit]);
  const chatPlaceholder = attachedPhotos.length > 0
    ? t.sendPlaceholderWithAttachments
    : activeWorkingMedia.length > 0
      ? t.sendPlaceholderWithActiveContext
      : t.sendPlaceholder;

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

  const clearChat = async (clearMode: PhotoChatClearMode = 'messages') => {
    try {
      const data = await api.clearPhotoChat({
        threadId: threadId || undefined,
        clearMode,
      });
      setThreadId(data.thread_id);
      setActiveThreadId(data.active_thread_id);
      setThreadContext(normalizeThreadContext(data.context_state));
      setMessageCount(data.message_count || 0);
      setMessageLimit(data.limit ?? null);
      setIsThreadLocked(Boolean(data.locked));
      setStreamError(null);
      if (clearMode !== 'context') {
        setMessages([]);
        setSelectedMsgIds(new Set());
        setChatSelectMode(false);
      }
      toast.success(t.clearSuccess);
    } catch (e) {
      console.error('Clear chat error', e);
      toast.error(t.genericError);
    }
  };

  const handleNewChat = async () => {
    if (isStreaming) return;
    try {
      const data = await api.createPhotoChatThread();
      hydrateHistory(data, { preserveLibraryIfEmpty: true });
      setAttachedPhotos([]);
      setInputText('');
      setSelectedMsgIds(new Set());
      setChatSelectMode(false);
      toast.success(t.newChatSuccess);
    } catch (e) {
      console.error('New chat error', e);
      toast.error(t.genericError);
    }
  };

  const retryLastRequest = async () => {
    const lastDraft = lastStreamDraftRef.current;
    if (!lastDraft || isStreaming || isThreadLocked) return;
    await sendMessage({
      text: lastDraft.text,
      photos: lastDraft.photos,
      quickAction: lastDraft.quickAction,
    });
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
        await api.deletePhotoChatMessages(dbIds, threadId || undefined);
      } catch (e) {
        console.error('Delete messages error', e);
        toast.error(t.genericError);
      }
    }
    setMessages((prev) => prev.filter((m) => !ids.has(m.id)));
    setSelectedMsgIds(new Set());
    setChatSelectMode(false);
    setMessageCount((prev) => Math.max(0, prev - dbIds.length));
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
      toast.success('Фото карточки сохранены');
    } catch (err) {
      console.error('Save card photos error:', err);
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить изменения');
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
        toast.error('Перетащите 2 фото: изделие + фотомодель');
        return;
      }
      photos = [genGarmentPhoto, genModelPhoto];
      quickAction = { type: 'normalize-own-model' };
      text = 'Нормализация: своя фотомодель';
    } else if (genTab === 'new-model') {
      if (!genGarmentPhoto) {
        toast.error('Загрузите фото изделия');
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
        toast.error('Введите промпт');
        return;
      }
      if (genSourcePhoto) photos = [genSourcePhoto];
      quickAction = genSourcePhoto
        ? { type: 'custom-generation', prompt: genCustomPrompt }
        : undefined;
      text = genCustomPrompt;
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
      quickAction = genSelectedScene.quickAction;
      text = `Сцена: ${genSelectedScene.label}`;
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
      quickAction = genSelectedPose.quickAction;
      text = `Поза: ${genSelectedPose.label}`;
    } else if (genTab === 'video') {
      if (!genSourcePhoto) {
        toast.error('Выберите исходное фото');
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
              <h2>{t.studioTitle}</h2>
              {selectedProduct ? (
                <span className="ps-chat-product-badge">
                  {selectedProduct.title || `#${selectedProduct.nm_id}`}
                </span>
              ) : null}
              {messageUsageLabel ? (
                <span className={`ps-msg-count ${isThreadLocked ? 'ps-msg-count--limit' : ''}`}>
                  {messageUsageLabel}
                </span>
              ) : null}
            </div>
            <div className="ps-chat-header-center">
              <div className="ps-mode-toggle">
                <button className={`ps-mode-btn ${mode === 'chat' ? 'active' : ''}`} onClick={() => setMode('chat')}>
                  {locale === 'ru' ? 'Чат' : 'Chat'}
                </button>
                <button className={`ps-mode-btn ${mode === 'generator' ? 'active' : ''}`} onClick={() => setMode('generator')}>
                  {locale === 'uz' ? 'Generator' : locale === 'en' ? 'Generator' : 'Генератор'}
                </button>
              </div>
            </div>
            <div className="ps-chat-header-right">
              <button className="ps-choose-btn" onClick={() => void handleNewChat()} disabled={isStreaming}>
                <Plus size={14} />
                {t.newChat}
              </button>
              <button className="ps-choose-btn" onClick={() => void clearChat('messages')} disabled={isStreaming || (messages.length === 0 && !isThreadLocked)}>
                <Trash2 size={14} />
                {t.clearMessages}
              </button>
              {chatSelectMode ? (
                <button className="ps-choose-btn ps-choose-btn--cancel" onClick={() => { setChatSelectMode(false); setSelectedMsgIds(new Set()); }}>
                  {t.cancel}
                </button>
              ) : (
                <button className="ps-choose-btn" onClick={() => setChatSelectMode(true)} disabled={messages.length === 0}>
                  <CheckCircle2 size={14} />
                  {t.select}
                </button>
              )}
            </div>
          </div>

          {mode === 'chat' ? (
            <>
              <div className="ps-thread-panel">
                <div className="ps-thread-panel-head">
                  <div>
                    <div className="ps-thread-label">
                      {t.activeThread}: {threadId ? `#${threadId}` : '...'}
                    </div>
                    {sessionKey ? (
                      <div className="ps-thread-subtitle">
                        session {sessionKey}
                        {activeThreadId && activeThreadId !== threadId ? ` • active #${activeThreadId}` : ''}
                      </div>
                    ) : null}
                  </div>
                  <div className="ps-thread-meta">
                    <span className="ps-thread-chip">
                      {t.localeLabel}: {(threadContext.locale || browserLocale).split('-')[0]}
                    </span>
                    {threadContext.last_action ? (
                      <span className="ps-thread-chip">
                        {typeof threadContext.last_action === 'string'
                          ? threadContext.last_action
                          : String((threadContext.last_action as Record<string, unknown>)?.type || 'action')}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="ps-thread-active-row">
                  <div className="ps-thread-active-copy">
                    <span className="ps-thread-active-title">{t.activeImages}</span>
                    <span className="ps-thread-active-hint">{t.activeHint}</span>
                  </div>
                  {activeWorkingMedia.length > 0 ? (
                    <div className="ps-thread-active-grid">
                      {activeWorkingMedia.map((photo) => (
                        <button
                          key={photo.id}
                          className="ps-thread-active-card"
                          onClick={() => setPreviewPhoto(photo)}
                          title={photo.prompt || photo.fileName || ''}
                        >
                          <img src={photo.url} alt="" crossOrigin="anonymous" />
                          <span className="ps-thread-active-badge">{t.activeBadge}</span>
                          {threadContext.last_generated_asset_id && photo.assetId === threadContext.last_generated_asset_id ? (
                            <span className="ps-thread-active-badge ps-thread-active-badge--accent">
                              {t.lastGeneratedBadge}
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="ps-thread-empty">{t.noActiveImages}</div>
                  )}
                </div>

                {threadContext.pending_question ? (
                  <div className="ps-thread-question">
                    <HelpCircle size={14} />
                    <span>{t.pendingQuestion}: {threadContext.pending_question}</span>
                  </div>
                ) : null}
              </div>

              {streamError ? (
                <div className={`ps-stream-banner ${isThreadLocked ? 'ps-stream-banner--limit' : ''}`}>
                  <div className="ps-stream-banner-copy">
                    <strong>{streamError.title}</strong>
                    <span>{streamError.message}</span>
                  </div>
                  <div className="ps-stream-banner-actions">
                    {streamError.retryable && !isThreadLocked ? (
                      <button className="ps-stream-banner-btn" onClick={() => void retryLastRequest()} disabled={isStreaming}>
                        {t.retry}
                      </button>
                    ) : null}
                    {isThreadLocked ? (
                      <>
                        <button className="ps-stream-banner-btn" onClick={() => void clearChat('messages')} disabled={isStreaming}>
                          {t.clearMessages}
                        </button>
                        <button className="ps-stream-banner-btn ps-stream-banner-btn--primary" onClick={() => void handleNewChat()} disabled={isStreaming}>
                          {t.newChat}
                        </button>
                      </>
                    ) : (
                      <button className="ps-stream-banner-btn" onClick={() => setStreamError(null)}>
                        {t.dismiss}
                      </button>
                    )}
                  </div>
                </div>
              ) : null}

              <div className="ps-messages">
                {chatSelectMode && (
                  <div className="ps-select-bar">
                    <button className="ps-select-bar-btn" onClick={() => {
                      const allIds = new Set(messages.map((m) => m.id));
                      setSelectedMsgIds(allIds);
                    }}>{t.chooseAll}</button>
                    <button
                      className="ps-select-bar-btn ps-select-bar-btn--danger"
                      disabled={selectedMsgIds.size === 0}
                      onClick={() => void deleteSelectedMessages(selectedMsgIds)}
                    >
                      {t.deleteSelected} ({selectedMsgIds.size})
                    </button>
                    <button
                      className="ps-select-bar-btn ps-select-bar-btn--danger"
                      onClick={() => {
                        const allIds = new Set(messages.map((m) => m.id));
                        void deleteSelectedMessages(allIds);
                      }}
                    >{t.deleteAll}</button>
                  </div>
                )}
                {isHistoryLoading ? (
                  <div className="ps-chat-empty">
                    <Loader2 size={20} className="ps-spin" />
                    <strong>{t.loadingHistory}</strong>
                  </div>
                ) : null}
                {!isHistoryLoading && messages.length === 0 ? (
                  <div className="ps-chat-empty">
                    <Sparkles size={20} />
                    <strong>{t.emptyConversationTitle}</strong>
                    <span>{t.emptyConversationBody}</span>
                  </div>
                ) : null}
                {messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    locale={locale}
                    questionBadgeLabel={t.questionBadge}
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
                {isStreaming && messages[messages.length - 1]?.role !== 'assistant' && !isHistoryLoading && (
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
                    {locale === 'uz' ? 'Tez buyruqlar' : locale === 'en' ? 'Quick actions' : 'Быстрые команды'}
                    <ChevronDown size={14} />
                  </button>
                  {quickOpen ? (
                    <div className="ps-dropdown-menu ps-dropdown-menu--matrix">
                      <div className="ps-quick-col">
                        <div className="ps-quick-col-title">
                          {locale === 'uz' ? 'Amalni tanlang' : locale === 'en' ? 'Choose action' : 'Выберите действие'}
                        </div>
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
                        <div className="ps-quick-col-title">
                          {locale === 'uz' ? 'Variantni tanlang' : locale === 'en' ? 'Choose option' : 'Выберите вариант'}
                        </div>
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
                  {locale === 'uz' ? 'Namunalar galereyasi' : locale === 'en' ? 'Sample gallery' : 'Галерея образцов'}
                  {attachedPhotos.length > 0 ? (
                    <span className="ps-chip-badge">{attachedPhotos.length}</span>
                  ) : null}
                  <ChevronDown size={14} />
                </button>

                <button className="ps-action-chip" onClick={() => setInstructionsOpen(true)}>
                  <HelpCircle size={14} />
                  {locale === 'uz' ? 'Ko‘rsatmalar' : locale === 'en' ? 'Instructions' : 'Инструкции'}
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
                        <span className="ps-attached-label-text">
                          {locale === 'uz' ? 'Rasm biriktirildi' : locale === 'en' ? 'Image attached' : 'Фото прикреплено'}
                        </span>
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
                <button type="button" className="ps-icon-btn" onClick={() => fileInputRef.current?.click()} disabled={isStreaming || isThreadLocked || !canAttachMore}>
                  <Paperclip size={18} />
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={handleFileSelect} />

                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={chatPlaceholder}
                  disabled={isStreaming || isThreadLocked}
                  className="ps-text-input"
                />

                <button
                  type="submit"
                  className={`ps-send-btn ps-send-btn--pill ${(inputText.trim() || attachedPhotos.length) && !isStreaming ? 'ps-send-btn--active' : ''}`}
                  disabled={(!inputText.trim() && !attachedPhotos.length) || isStreaming || isThreadLocked}
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
                <span>{t.relatedMedia}</span>
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
                {t.persistentLibraryHint}
              </div>

              <div className="ps-history-counters">
                <span className={`ps-history-counter ${historyTab === 'image' ? 'ps-history-counter--active' : ''}`} onClick={() => setHistoryTab('image')}>
                  <Camera size={12} />
                  {libraryPhotos.length}
                </span>
                <span className={`ps-history-counter ${historyTab === 'video' ? 'ps-history-counter--active' : ''}`} onClick={() => setHistoryTab('video')}>
                  <Video size={12} />
                  {libraryVideos.length}
                </span>
              </div>

              <div className="ps-history-subtitle">
                {historyTab === 'image'
                  ? `${t.libraryTabImages.toUpperCase()} (${libraryPhotos.length})`
                  : `${t.libraryTabVideos.toUpperCase()} (${libraryVideos.length})`}
              </div>

              {(historyTab === 'image' ? libraryPhotos : libraryVideos).length === 0 ? (
                <div className="ps-sidebar-empty">
                  <ImageIcon size={24} />
                  <span>{t.emptyMedia}</span>
                  <span className="ps-empty-sub">{t.emptyMediaSub}</span>
                </div>
              ) : (
                <div className="ps-history-grid">
                  {(historyTab === 'image' ? libraryPhotos : libraryVideos).map((p) => (
                    <div
                      key={p.id}
                      className={`ps-history-item ${p.assetId && activeWorkingAssetIds.includes(p.assetId) ? 'ps-history-item--active' : ''}`}
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
                        {p.assetId && activeWorkingAssetIds.includes(p.assetId) ? (
                          <div className="ps-history-active-pill">{t.activeBadge}</div>
                        ) : null}
                        {/* Hover actions overlay */}
                        <div className={`ps-history-hover-actions ${hoveredHistoryId === p.id ? 'visible' : ''}`}>
                          <button onClick={() => handleDownload(p)} title="Скачать">
                            <Download size={13} />
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
  locale,
  questionBadgeLabel,
  onPhotoClick,
  onPhotoDragStart,
  selectMode = false,
  isSelected = false,
  onToggleSelect,
}: {
  msg: ChatMessage;
  locale: AppLocale;
  questionBadgeLabel: string;
  onPhotoClick: (photo: PhotoMedia) => void;
  onPhotoDragStart: (e: React.DragEvent, photo: PhotoMedia) => void;
  selectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const isUser = msg.role === 'user';
  const isQuestion = msg.type === 'question';
  const isSelectable = selectMode;

  return (
    <div
      className={`ps-msg ${isUser ? 'ps-msg--user' : 'ps-msg--bot'} ${isQuestion ? 'ps-msg--question' : ''} ${isSelectable ? 'ps-msg--selectable' : ''} ${isSelected ? 'ps-msg--selected' : ''}`}
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
        {isQuestion ? (
          <div className="ps-msg-badge">{questionBadgeLabel}</div>
        ) : null}
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
          {msg.timestamp.toLocaleTimeString(locale === 'uz' ? 'uz-UZ' : locale === 'en' ? 'en-US' : 'ru-RU', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}
