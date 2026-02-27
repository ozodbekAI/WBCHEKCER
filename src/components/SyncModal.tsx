import React, { useEffect, useState, useCallback } from 'react';
import {
  RefreshCw, Zap, CheckSquare, Square, Search, X,
  AlertCircle, CheckCircle2, Loader2, ArrowRight, Tag,
} from 'lucide-react';
import api from '../api/client';
import { saveSyncTask } from './SyncProgressBanner';

interface WbCardPreview {
  nm_id: number;
  title: string;
  vendor_code: string;
  subject: string;
  photos: number;
  wb_updated_at: string;
  db_updated_at: string | null;
  status: 'new' | 'changed' | 'ok';
}

interface PreviewData {
  total_wb: number;
  changed_count: number;
  unchanged_count: number;
  changed: WbCardPreview[];
  all_cards: WbCardPreview[];
}

interface SyncModalProps {
  storeId: number;
  onClose: () => void;
  onStarted: () => void;
}

export default function SyncModal({ storeId, onClose, onStarted }: SyncModalProps) {
  const [mode, setMode] = useState<'incremental' | 'manual'>('incremental');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [starting, setStarting] = useState(false);

  const loadPreview = useCallback(async () => {
    setLoadingPreview(true);
    setPreviewError('');
    try {
      const data = await api.getSyncPreview(storeId);
      setPreview(data);
      // Pre-select changed cards
      setSelectedIds(new Set(data.changed.map((c: WbCardPreview) => c.nm_id)));
    } catch (e: any) {
      setPreviewError(e.message || 'Не удалось загрузить данные');
    } finally {
      setLoadingPreview(false);
    }
  }, [storeId]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  const filteredCards = preview?.all_cards.filter(c => {
    const q = search.toLowerCase();
    return (
      !q ||
      c.title.toLowerCase().includes(q) ||
      c.vendor_code.toLowerCase().includes(q) ||
      String(c.nm_id).includes(q) ||
      c.subject.toLowerCase().includes(q)
    );
  }) ?? [];

  const toggleCard = (nmId: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(nmId)) next.delete(nmId);
      else next.add(nmId);
      return next;
    });
  };

  const toggleAll = () => {
    const visible = filteredCards.map(c => c.nm_id);
    const allSelected = visible.every(id => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        visible.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        visible.forEach(id => next.add(id));
        return next;
      });
    }
  };

  const handleStart = async () => {
    if (starting) return;
    setStarting(true);
    try {
      let data;
      if (mode === 'manual') {
        if (selectedIds.size === 0) {
          alert('Выберите хотя бы одну карточку');
          setStarting(false);
          return;
        }
        data = await api.startSync(storeId, 'manual', Array.from(selectedIds));
      } else {
        data = await api.startSync(storeId, 'incremental');
      }
      saveSyncTask(storeId, data.task_id);
      onStarted();
      onClose();
    } catch (e: any) {
      alert(e.message || 'Не удалось запустить синхронизацию');
    } finally {
      setStarting(false);
    }
  };

  const handleAnalyzeAll = async () => {
    if (starting) return;
    setStarting(true);
    try {
      const data = await api.startAnalyzeAll(storeId);
      saveSyncTask(storeId, data.task_id);
      onStarted();
      onClose();
    } catch (e: any) {
      alert(e.message || 'Не удалось запустить анализ');
    } finally {
      setStarting(false);
    }
  };

  const changedCount = preview?.changed_count ?? 0;
  const totalWb = preview?.total_wb ?? 0;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(15,15,35,0.45)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: '#fff', borderRadius: 20, width: '100%', maxWidth: 680,
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px', borderBottom: '1px solid #f0f0f6',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: 'linear-gradient(135deg,#6366f1,#4338ca)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 10px rgba(99,102,241,0.3)',
          }}>
            <RefreshCw size={18} color="#fff" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1e1b4b' }}>Синхронизация с Wildberries</div>
            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 1 }}>
              {loadingPreview ? 'Загрузка данных...' : preview
                ? `${totalWb} карточек в WB · ${changedCount} требуют обновления`
                : 'Выберите режим синхронизации'}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: '#f3f4f6', border: 'none', borderRadius: 8,
            width: 32, height: 32, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280',
          }}>
            <X size={16} />
          </button>
        </div>

        {/* Mode selector */}
        <div style={{ padding: '16px 24px 0', display: 'flex', gap: 10 }}>
          <button
            onClick={() => setMode('incremental')}
            style={{
              flex: 1, padding: '12px 16px', borderRadius: 12, cursor: 'pointer',
              border: `2px solid ${mode === 'incremental' ? '#6366f1' : '#e5e7eb'}`,
              background: mode === 'incremental' ? '#eef2ff' : '#fff',
              display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
              transition: 'all 0.15s',
            }}
          >
            <Zap size={18} color={mode === 'incremental' ? '#6366f1' : '#9ca3af'} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: mode === 'incremental' ? '#4338ca' : '#374151' }}>
                Умная синхронизация
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>
                Только изменённые карточки по дате
              </div>
            </div>
            {mode === 'incremental' && (
              <CheckCircle2 size={16} color="#6366f1" style={{ marginLeft: 'auto', flexShrink: 0 }} />
            )}
          </button>
          <button
            onClick={() => setMode('manual')}
            style={{
              flex: 1, padding: '12px 16px', borderRadius: 12, cursor: 'pointer',
              border: `2px solid ${mode === 'manual' ? '#6366f1' : '#e5e7eb'}`,
              background: mode === 'manual' ? '#eef2ff' : '#fff',
              display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
              transition: 'all 0.15s',
            }}
          >
            <CheckSquare size={18} color={mode === 'manual' ? '#6366f1' : '#9ca3af'} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: mode === 'manual' ? '#4338ca' : '#374151' }}>
                Выбрать вручную
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>
                Выбрать конкретные карточки
              </div>
            </div>
            {mode === 'manual' && (
              <CheckCircle2 size={16} color="#6366f1" style={{ marginLeft: 'auto', flexShrink: 0 }} />
            )}
          </button>
        </div>

        {/* Incremental mode summary */}
        {mode === 'incremental' && (
          <div style={{ padding: '16px 24px 0' }}>
            {loadingPreview ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', fontSize: 13 }}>
                <Loader2 size={15} style={{ animation: 'spin 0.8s linear infinite' }} />
                Анализ изменений...
              </div>
            ) : previewError ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#dc2626', fontSize: 13 }}>
                <AlertCircle size={15} /> {previewError}
              </div>
            ) : preview ? (
              <div style={{ display: 'flex', gap: 10 }}>
                {[
                  { label: 'Всего в WB', val: totalWb, color: '#6366f1', bg: '#eef2ff' },
                  { label: 'Новых', val: preview.changed.filter(c => c.status === 'new').length, color: '#059669', bg: '#ecfdf5' },
                  { label: 'Изменено', val: preview.changed.filter(c => c.status === 'changed').length, color: '#d97706', bg: '#fffbeb' },
                  { label: 'Актуальных', val: preview.unchanged_count, color: '#9ca3af', bg: '#f9fafb' },
                ].map(item => (
                  <div key={item.label} style={{
                    flex: 1, background: item.bg, borderRadius: 10,
                    padding: '10px 12px', textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: item.color }}>{item.val}</div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{item.label}</div>
                  </div>
                ))}
              </div>
            ) : null}
            {preview && changedCount === 0 && (
              <div style={{ marginTop: 10, padding: '10px 14px', background: '#f0fdf4', borderRadius: 10, fontSize: 13, color: '#166534', display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={15} /> Все карточки уже актуальны. Синхронизация не требуется.
                <button
                  onClick={handleAnalyzeAll}
                  disabled={starting}
                  style={{
                    marginLeft: 'auto', padding: '5px 12px', borderRadius: 8, border: '1px solid #166534',
                    background: '#dcfce7', color: '#166534', fontSize: 12, fontWeight: 600,
                    cursor: starting ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  {starting ? 'Запуск...' : '🔄 Переанализировать всё'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Manual mode: card list */}
        {mode === 'manual' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '12px 24px 0' }}>
            {/* Search + select all */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Поиск по названию, артикулу..."
                  style={{
                    width: '100%', padding: '8px 10px 8px 30px',
                    border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13,
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
              <button
                onClick={toggleAll}
                style={{
                  padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8,
                  background: '#fff', cursor: 'pointer', fontSize: 12, color: '#6366f1',
                  fontWeight: 600, whiteSpace: 'nowrap',
                }}
              >
                {filteredCards.every(c => selectedIds.has(c.nm_id)) ? 'Снять все' : 'Выбрать все'}
              </button>
              <span style={{ alignSelf: 'center', fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>
                {selectedIds.size} выбрано
              </span>
            </div>

            {loadingPreview ? (
              <div style={{ textAlign: 'center', padding: 30, color: '#9ca3af', fontSize: 13 }}>
                <Loader2 size={20} style={{ animation: 'spin 0.8s linear infinite', marginBottom: 8 }} />
                <br />Загрузка карточек...
              </div>
            ) : (
              <div style={{ overflowY: 'auto', flex: 1, marginRight: -24, paddingRight: 24 }}>
                {filteredCards.map(card => {
                  const isSelected = selectedIds.has(card.nm_id);
                  const statusColor = card.status === 'new' ? '#059669' : card.status === 'changed' ? '#d97706' : '#9ca3af';
                  const statusLabel = card.status === 'new' ? 'Новая' : card.status === 'changed' ? 'Изменена' : 'Актуальн��';
                  return (
                    <div
                      key={card.nm_id}
                      onClick={() => toggleCard(card.nm_id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px',
                        borderRadius: 10, cursor: 'pointer', marginBottom: 4,
                        background: isSelected ? '#eef2ff' : '#f9fafb',
                        border: `1.5px solid ${isSelected ? '#c7d2fe' : 'transparent'}`,
                        transition: 'all 0.12s',
                      }}
                    >
                      <div style={{ flexShrink: 0, color: isSelected ? '#6366f1' : '#d1d5db' }}>
                        {isSelected ? <CheckSquare size={17} /> : <Square size={17} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {card.title || `Карточка #${card.nm_id}`}
                        </div>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2, display: 'flex', gap: 8 }}>
                          <span>#{card.nm_id}</span>
                          {card.vendor_code && <span>{card.vendor_code}</span>}
                          {card.subject && <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}><Tag size={9} />{card.subject}</span>}
                        </div>
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 600, color: statusColor,
                        background: `${statusColor}18`, padding: '3px 8px', borderRadius: 99,
                        whiteSpace: 'nowrap', flexShrink: 0,
                      }}>
                        {statusLabel}
                      </span>
                    </div>
                  );
                })}
                {filteredCards.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '24px 0', color: '#9ca3af', fontSize: 13 }}>
                    Карточки не найдены
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{
          padding: '16px 24px', borderTop: '1px solid #f0f0f6',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          background: '#fafafa',
        }}>
          <div style={{ fontSize: 12, color: '#9ca3af' }}>
            {mode === 'incremental'
              ? `Будет обновлено: ${changedCount} карточек`
              : `Выбрано: ${selectedIds.size} карточек`
            }
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                padding: '9px 18px', border: '1px solid #e5e7eb', borderRadius: 10,
                background: '#fff', cursor: 'pointer', fontSize: 13, color: '#6b7280', fontWeight: 500,
              }}
            >
              Отмена
            </button>
            <button
              onClick={handleStart}
              disabled={starting || loadingPreview || (mode === 'incremental' && !!preview && changedCount === 0)}
              style={{
                padding: '9px 22px', border: 'none', borderRadius: 10,
                background: 'linear-gradient(135deg,#6366f1,#4338ca)',
                cursor: starting || (mode === 'incremental' && !!preview && changedCount === 0) ? 'not-allowed' : 'pointer',
                fontSize: 13, color: '#fff', fontWeight: 700,
                display: 'flex', alignItems: 'center', gap: 7,
                opacity: starting ? 0.8 : 1,
                boxShadow: '0 2px 10px rgba(99,102,241,0.3)',
                transition: 'all 0.15s',
              }}
            >
              {starting
                ? <><Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> Запуск...</>
                : <><ArrowRight size={14} /> Начать синхронизацию</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
