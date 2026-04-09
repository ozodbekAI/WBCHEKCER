import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  CircleAlert,
  KeyRound,
  RefreshCcw,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import api from '../api/client';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import type { Store, StoreWbFeatureAccess, StoreWbKeySlot } from '../types';
import { getStoreFeatureAccess, type StoreFeatureKey } from '../lib/storeAccess';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';

interface StoreKeyUpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store?: Store | null;
  featureKey?: StoreFeatureKey | null;
  featureLabel?: string | null;
}

const SLOT_META: Array<{
  slot_key: string;
  short_label: string;
  label: string;
  feature_labels: string[];
  is_default?: boolean;
}> = [
  {
    slot_key: 'default',
    short_label: 'Основной',
    label: 'Основной ключ магазина',
    feature_labels: ['Базовый доступ магазина'],
    is_default: true,
  },
  {
    slot_key: 'content',
    short_label: 'Content',
    label: 'Content / Карточки',
    feature_labels: ['Карточки', 'Изменение карточек', 'Photo Studio'],
  },
  {
    slot_key: 'ab_tests',
    short_label: 'A/B',
    label: 'A/B тесты',
    feature_labels: ['A/B тесты'],
  },
  {
    slot_key: 'ad_analysis',
    short_label: 'Экономика',
    label: 'Экономика',
    feature_labels: ['Экономика'],
  },
  {
    slot_key: 'documents',
    short_label: 'Документы',
    label: 'Документы',
    feature_labels: ['Документы'],
  },
];

function formatDateLabel(value: string | null | undefined): string {
  if (!value) return 'Не указан';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Не указан';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function buildSlots(store?: Store | null): StoreWbKeySlot[] {
  const incoming = store?.wb_token_access?.key_slots || [];
  const byKey = new Map(incoming.map((slot) => [slot.slot_key, slot]));

  return SLOT_META.map((meta) => {
    const existing = byKey.get(meta.slot_key);
    if (existing) return existing;
    return {
      slot_key: meta.slot_key,
      label: meta.label,
      configured: false,
      is_default: !!meta.is_default,
      feature_keys: [],
      feature_labels: meta.feature_labels,
      token_access: {
        decoded: false,
        decode_error: null,
        token_type: null,
        scope_mask: null,
        categories: [],
        category_labels: [],
        read_only: false,
        expires_at: null,
      },
      updated_at: null,
    };
  });
}

function getSlotMeta(slotKey: string) {
  return SLOT_META.find((item) => item.slot_key === slotKey) || SLOT_META[0];
}

function getSlotPurpose(slot: StoreWbKeySlot): string {
  const labels = (slot.feature_labels?.length ? slot.feature_labels : getSlotMeta(slot.slot_key).feature_labels)
    .filter(Boolean);
  return labels.join(', ');
}

function getSlotCurrentRights(slot: StoreWbKeySlot): string {
  const labels = slot.token_access?.category_labels || [];
  if (labels.length > 0) {
    return labels.join(', ');
  }
  if (slot.configured) {
    return slot.token_access?.decode_error || 'Ключ сохранён, права уточняются.';
  }
  return 'Ключ ещё не добавлен.';
}

function getGuidedOptionTitle(slot: StoreWbKeySlot): string {
  return slot.is_default ? 'Заменить основной ключ' : `Добавить отдельный ключ`;
}

function getGuidedOptionDescription(slot: StoreWbKeySlot): string {
  if (slot.is_default) {
    return 'Один новый ключ заменит текущий базовый доступ магазина.';
  }
  return `Откроет только нужный раздел: ${getSlotPurpose(slot)}.`;
}

function getStatusTone(access: StoreWbFeatureAccess | null | undefined) {
  if (access?.allowed) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  }
  return 'border-amber-200 bg-amber-50 text-amber-900';
}

export default function StoreKeyUpdateDialog({
  open,
  onOpenChange,
  store,
  featureKey,
  featureLabel,
}: StoreKeyUpdateDialogProps) {
  const { loadStores } = useStore();
  const { isRole } = useAuth();
  const canManageKeys = isRole('owner', 'admin');
  const guidedMode = !!featureKey;

  const [selectedSlot, setSelectedSlot] = useState('default');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingSlot, setSavingSlot] = useState<string | null>(null);
  const [removingSlot, setRemovingSlot] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const slots = useMemo(() => buildSlots(store), [store]);
  const featureAccess = useMemo(
    () => (featureKey ? getStoreFeatureAccess(store, featureKey) : null),
    [featureKey, store],
  );

  const quickSlotKeys = useMemo(() => {
    if (!guidedMode) {
      return slots.map((slot) => slot.slot_key);
    }

    const ordered: string[] = [];
    for (const slotKey of featureAccess?.recommended_slots || []) {
      if (!ordered.includes(slotKey)) {
        ordered.push(slotKey);
      }
    }

    const activeSpecificSlot =
      featureAccess?.source_slot && featureAccess.source_slot !== 'default'
        ? featureAccess.source_slot
        : null;
    if (activeSpecificSlot && !ordered.includes(activeSpecificSlot)) {
      ordered.push(activeSpecificSlot);
    }

    if (!ordered.includes('default')) {
      ordered.push('default');
    }

    return ordered.filter((slotKey) => slots.some((slot) => slot.slot_key === slotKey));
  }, [featureAccess, guidedMode, slots]);

  const selectedSlotInfo = useMemo(
    () => slots.find((slot) => slot.slot_key === selectedSlot) || slots[0] || null,
    [selectedSlot, slots],
  );

  const guidedSlots = useMemo(
    () => quickSlotKeys
      .map((slotKey) => slots.find((slot) => slot.slot_key === slotKey) || null)
      .filter((slot): slot is StoreWbKeySlot => !!slot),
    [quickSlotKeys, slots],
  );

  useEffect(() => {
    if (!open) {
      setDrafts({});
      setSavingSlot(null);
      setRemovingSlot(null);
      setShowAdvanced(false);
      return;
    }

    const preferred = quickSlotKeys[0] || 'default';
    setSelectedSlot(preferred);
    setShowAdvanced(false);
  }, [open, quickSlotKeys]);

  const setDraftValue = (slotKey: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [slotKey]: value }));
  };

  const handleSave = async (slot: StoreWbKeySlot) => {
    if (!store) {
      toast.error('Сначала выберите магазин');
      return;
    }
    if (!canManageKeys) {
      toast.error('Только владелец или администратор может управлять ключами');
      return;
    }

    const apiKey = (drafts[slot.slot_key] || '').trim();
    if (apiKey.length < 10) {
      toast.error('Введите корректный WB API-ключ');
      return;
    }

    setSavingSlot(slot.slot_key);
    try {
      if (slot.is_default) {
        await api.updateStore(store.id, { api_key: apiKey });
      } else {
        await api.updateStoreFeatureKey(store.id, slot.slot_key, apiKey);
      }
      await loadStores();
      setDraftValue(slot.slot_key, '');
      toast.success(slot.is_default ? 'Основной ключ обновлён' : 'Отдельный ключ сохранён');
    } catch (err: any) {
      toast.error(err?.message || 'Не удалось сохранить ключ');
    } finally {
      setSavingSlot(null);
    }
  };

  const handleRemove = async (slot: StoreWbKeySlot) => {
    if (!store || slot.is_default) return;
    if (!canManageKeys) {
      toast.error('Только владелец или администратор может управлять ключами');
      return;
    }

    setRemovingSlot(slot.slot_key);
    try {
      await api.deleteStoreFeatureKey(store.id, slot.slot_key);
      await loadStores();
      setDraftValue(slot.slot_key, '');
      toast.success('Отдельный ключ удалён');
    } catch (err: any) {
      toast.error(err?.message || 'Не удалось удалить ключ');
    } finally {
      setRemovingSlot(null);
    }
  };

  const renderGuidedChoice = (slot: StoreWbKeySlot) => {
    const meta = getSlotMeta(slot.slot_key);
    const isSelected = selectedSlot === slot.slot_key;
    const isRecommended = !!featureAccess?.recommended_slots?.includes(slot.slot_key);
    return (
      <button
        key={slot.slot_key}
        type="button"
        onClick={() => setSelectedSlot(slot.slot_key)}
        className={cn(
          'rounded-xl border px-3 py-2 text-left transition-all',
          isSelected
            ? 'border-primary bg-primary/5 shadow-sm'
            : 'border-border bg-card hover:border-muted-foreground/30',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">{getGuidedOptionTitle(slot)}</div>
            <div className="text-[11px] text-muted-foreground">{meta.label}</div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {isRecommended ? (
              <Badge className="border-amber-200 bg-amber-50 text-amber-800">Рекомендуется</Badge>
            ) : null}
            {slot.configured ? <Badge variant="secondary">Ключ есть</Badge> : <Badge variant="outline">Пусто</Badge>}
          </div>
        </div>
      </button>
    );
  };

  const renderSlotTab = (slot: StoreWbKeySlot) => {
    const meta = getSlotMeta(slot.slot_key);
    const isSelected = selectedSlot === slot.slot_key;
    return (
      <button
        key={slot.slot_key}
        type="button"
        onClick={() => setSelectedSlot(slot.slot_key)}
        className={cn(
          'rounded-full border px-3 py-2 text-left transition-colors',
          isSelected
            ? 'border-primary bg-primary/5 text-primary'
            : 'border-border bg-card text-foreground hover:border-muted-foreground/30',
        )}
      >
        <div className="text-sm font-medium">{meta.short_label}</div>
        <div className="text-[11px] text-muted-foreground">
          {slot.configured ? 'Ключ настроен' : 'Слот пустой'}
        </div>
      </button>
    );
  };

  const renderEditor = (slot: StoreWbKeySlot) => {
    const draftValue = drafts[slot.slot_key] || '';
    const token = slot.token_access;
    const isSaving = savingSlot === slot.slot_key;
    const isRemoving = removingSlot === slot.slot_key;
    const isRecommended = !!featureAccess?.recommended_slots?.includes(slot.slot_key);

    return (
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-base font-semibold text-foreground">{slot.label}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {getGuidedOptionDescription(slot)}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {slot.is_default ? <Badge variant="outline">Основной</Badge> : null}
            {isRecommended ? (
              <Badge className="border-amber-200 bg-amber-50 text-amber-800">Для текущего раздела</Badge>
            ) : null}
            {slot.configured ? <Badge variant="secondary">Ключ сохранён</Badge> : <Badge variant="outline">Ключ не добавлен</Badge>}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Что есть сейчас</div>
            <div className="mt-1 text-sm font-medium text-foreground">{getSlotCurrentRights(slot)}</div>
          </div>
          <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Параметры ключа</div>
            <div className="mt-1 text-sm text-foreground">
              {token.read_only ? 'Read only, без записи' : 'Чтение и запись разрешены'}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Обновлён: {formatDateLabel(slot.updated_at)}. Срок действия: {formatDateLabel(token.expires_at)}.
            </div>
          </div>
        </div>

        {!canManageKeys ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Только владелец или администратор может менять ключи магазина.
          </div>
        ) : null}

        <div className="mt-4 space-y-2">
          <label className="text-sm font-medium text-foreground">WB API-ключ</label>
          <Input
            type="password"
            value={draftValue}
            onChange={(e) => setDraftValue(slot.slot_key, e.target.value)}
            placeholder={`Вставьте ключ для «${slot.label}»`}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            После сохранения ключ сразу проверяется по правам и через официальный WB ping endpoint.
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {!slot.is_default && slot.configured ? (
              <Button variant="outline" onClick={() => handleRemove(slot)} disabled={!canManageKeys || isRemoving}>
                {isRemoving ? (
                  <RefreshCcw size={14} className="mr-2 animate-spin" />
                ) : (
                  <Trash2 size={14} className="mr-2" />
                )}
                Удалить отдельный ключ
              </Button>
            ) : null}
          </div>

          <Button onClick={() => handleSave(slot)} disabled={!canManageKeys || isSaving}>
            {isSaving ? (
              <RefreshCcw size={14} className="mr-2 animate-spin" />
            ) : (
              <Save size={14} className="mr-2" />
            )}
            {slot.configured ? 'Сохранить новый ключ' : 'Проверить и сохранить'}
          </Button>
        </div>
      </div>
    );
  };

  const dialogTitle = guidedMode
    ? `Доступ для «${featureLabel || featureAccess?.label || 'раздела'}»`
    : 'Настройки WB-ключей магазина';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[calc(100dvh-16px)] max-h-[calc(100dvh-16px)] w-[calc(100vw-16px)] max-w-[720px] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-2xl p-0 sm:h-[min(92dvh,760px)] sm:w-full sm:max-w-[720px]">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <KeyRound size={18} />
            {dialogTitle}
          </DialogTitle>
          <DialogDescription>
            {guidedMode
              ? 'Выберите один понятный вариант: добавить отдельный ключ только для этого раздела или заменить основной ключ магазина.'
              : 'Здесь можно обновить основной WB-ключ и при необходимости добавить отдельные ключи для конкретных разделов.'}
          </DialogDescription>
        </DialogHeader>

        {!store ? (
          <div className="px-5 py-8 text-sm text-muted-foreground">
            Выберите магазин, чтобы управлять ключами.
          </div>
        ) : (
          <>
            <ScrollArea className="min-h-0">
              <div className="space-y-4 px-5 py-4">
                <div className="rounded-2xl border border-border bg-muted/30 px-4 py-3">
                  <div className="text-sm font-semibold text-foreground">{store.name}</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Основной ключ сейчас имеет категории:{' '}
                    {(store.wb_token_access?.category_labels || []).join(', ') || 'не определены'}
                  </div>
                </div>

                {featureAccess ? (
                  <div className={cn('rounded-2xl border px-4 py-3 text-sm', getStatusTone(featureAccess))}>
                    <div className="flex items-start gap-2">
                      {featureAccess.allowed ? (
                        <ShieldCheck size={16} className="mt-0.5 shrink-0" />
                      ) : (
                        <CircleAlert size={16} className="mt-0.5 shrink-0" />
                      )}
                      <div>
                        <div className="font-medium">
                          {featureLabel || featureAccess.label}
                          {featureAccess.allowed ? ' доступен' : ' пока недоступен'}
                        </div>
                        <div className="mt-1">{featureAccess.message}</div>
                        {!!featureAccess.recommended_slot_labels?.length && !featureAccess.allowed ? (
                          <div className="mt-2">
                            Самый быстрый путь: добавить отдельный ключ в слот {featureAccess.recommended_slot_labels.join(', ')}.
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                {guidedMode ? (
                  <>
                    <div className="space-y-3">
                      <div className="text-sm font-medium text-foreground">Что сделать сейчас</div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {guidedSlots.map((slot) => renderGuidedChoice(slot))}
                      </div>
                    </div>

                    {selectedSlotInfo ? renderEditor(selectedSlotInfo) : null}

                    <div className="rounded-2xl border border-dashed border-border bg-muted/10 px-4 py-3">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between text-left text-sm font-medium text-foreground"
                        onClick={() => setShowAdvanced((prev) => !prev)}
                      >
                        <span>Все слоты и расширенные настройки</span>
                        {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Если хотите заранее настроить и другие разделы магазина, откройте полный список слотов.
                      </p>
                    </div>

                    {showAdvanced ? (
                      <div className="space-y-4">
                        <div className="flex flex-wrap gap-2">
                          {slots.map((slot) => renderSlotTab(slot))}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {slots.map((slot) => renderSlotTab(slot))}
                    </div>
                    {selectedSlotInfo ? renderEditor(selectedSlotInfo) : null}
                  </>
                )}
              </div>
            </ScrollArea>

            <div className="flex justify-end border-t border-border px-5 py-3">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Закрыть
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
