import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import type { FixedFileEntry, FixedFileMismatch } from '../types';
import { Upload, Download, Trash2, Pencil, Check, X, RefreshCw, AlertTriangle, FileCheck, ChevronLeft, ChevronRight, Search } from 'lucide-react';

const CARDS_PER_PAGE = 15;

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function FixedFilePage() {
  const { activeStore } = useStore();
  const { user, isRole } = useAuth();
  const navigate = useNavigate();

  const canManage = isRole('admin', 'owner', 'head_manager');

  const [entries, setEntries] = useState<FixedFileEntry[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasFile, setHasFile] = useState<boolean | null>(null);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [replaceAll, setReplaceAll] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Inline edit state
  const [editId, setEditId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Search / filter
  const [searchNm, setSearchNm] = useState('');
  const [filterNmId, setFilterNmId] = useState<number | undefined>(undefined);

  // Recheck state
  const [recheckNmId, setRecheckNmId] = useState<number | null>(null);
  const [recheckResult, setRecheckResult] = useState<{ nm_id: number; mismatches: FixedFileMismatch[]; total: number } | null>(null);
  const [rechecking, setRechecking] = useState(false);

  const load = useCallback(async () => {
    if (!activeStore) return;
    setLoading(true);
    try {
      const [listRes, statusRes] = await Promise.all([
        api.getFixedFileEntries(activeStore.id, { nm_id: filterNmId, limit: 50000 }),
        api.getFixedFileStatus(activeStore.id),
      ]);
      setEntries(listRes.items);
      setTotalEntries(listRes.total);
      setHasFile(statusRes.has_fixed_file);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [activeStore, filterNmId]);

  useEffect(() => { load(); }, [load]);

  const handleUpload = async (file: File) => {
    if (!activeStore) return;
    setUploading(true);
    setUploadMsg(null);
    setUploadError(null);
    try {
      const res = await api.uploadFixedFile(activeStore.id, file, replaceAll);
      setUploadMsg(res.message || `Загружено ${res.upserted} записей`);
      setPage(1);
      await load();
    } catch (e: any) {
      setUploadError(e.message || 'Ошибка загрузки');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleTemplate = async () => {
    if (!activeStore) return;
    try {
      const blob = await api.downloadFixedTemplate(activeStore.id);
      triggerDownload(blob, 'fixed_values_template.xlsx');
    } catch (e) {
      alert('Ошибка скачивания шаблона');
    }
  };

  const handleEdit = (entry: FixedFileEntry) => {
    setEditId(entry.id);
    setEditValue(entry.fixed_value);
    setRecheckResult(null);
  };

  const handleSave = async (entry: FixedFileEntry) => {
    if (!activeStore || !editValue.trim()) return;
    setSaving(true);
    try {
      const updated = await api.updateFixedEntry(activeStore.id, entry.id, editValue.trim());
      setEntries(prev => prev.map(e => e.id === updated.id ? updated : e));
      setEditId(null);
      // Offer recheck for this card
      setRecheckNmId(entry.nm_id);
    } catch (e) {
      alert('Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (entry: FixedFileEntry) => {
    if (!activeStore || !confirm(`Удалить эталонное значение "${entry.char_name}" для карточки Артикул ${entry.nm_id}?`)) return;
    setDeletingId(entry.id);
    try {
      await api.deleteFixedEntry(activeStore.id, entry.id);
      setEntries(prev => prev.filter(e => e.id !== entry.id));
      setTotalEntries(t => t - 1);
    } catch {
      alert('Ошибка удаления');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteAll = async () => {
    if (!activeStore || !confirm('Удалить ВСЕ эталонные значения для этого магазина?')) return;
    try {
      await api.deleteAllFixedEntries(activeStore.id);
      setEntries([]);
      setTotalEntries(0);
      setHasFile(false);
      setUploadMsg(null);
    } catch {
      alert('Ошибка удаления');
    }
  };

  const handleRecheck = async (nmId: number) => {
    if (!activeStore) return;
    setRechecking(true);
    setRecheckResult(null);
    try {
      const res = await api.recheckCardFixed(activeStore.id, nmId);
      setRecheckResult(res);
    } catch {
      alert('Ошибка проверки');
    } finally {
      setRechecking(false);
      setRecheckNmId(null);
    }
  };

  const handleSearch = () => {
    const nm = parseInt(searchNm.trim(), 10);
    setFilterNmId(isNaN(nm) ? undefined : nm);
    setPage(1);
  };

  // Group ALL entries by nm_id
  const grouped: Record<number, FixedFileEntry[]> = {};
  for (const e of entries) {
    if (!grouped[e.nm_id]) grouped[e.nm_id] = [];
    grouped[e.nm_id].push(e);
  }

  // Paginate cards (groups) on the frontend
  const allNmIds = Object.keys(grouped);
  const totalCards = allNmIds.length;
  const totalPages = Math.ceil(totalCards / CARDS_PER_PAGE);
  const pagedNmIds = allNmIds.slice((page - 1) * CARDS_PER_PAGE, page * CARDS_PER_PAGE);

  // Collect all unique char_names (columns) from visible page only to keep columns tight
  const META_SKIP = new Set(['артикул', 'бренд', 'категория', 'nmid', 'brand', 'subjectname']);
  const allCharNames: string[] = [];
  for (const nmIdStr of pagedNmIds) {
    for (const e of grouped[parseInt(nmIdStr)]) {
      if (!allCharNames.includes(e.char_name) && !META_SKIP.has(e.char_name.toLowerCase())) {
        allCharNames.push(e.char_name);
      }
    }
  }

  return (
    <div style={{ padding: '24px', maxWidth: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <button
            onClick={() => navigate('/workspace')}
            style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 13, padding: '0 0 8px 0', marginBottom: 2 }}
          >
            <ChevronLeft size={15} /> Рабочий стол
          </button>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Эталонные значения</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            Загрузите Excel-файл с правильными значениями для состава, сертификатов и других характеристик.
            При анализе карточек эти значения имеют приоритет над AI.
          </p>
        </div>
        {canManage && (
          <button
            onClick={handleTemplate}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: '1px solid var(--border)', borderRadius: 8, background: 'white', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' }}
          >
            <Download size={15} /> Скачать шаблон
          </button>
        )}
      </div>

      {/* No fixed file warning */}
      {hasFile === false && (
        <div style={{ background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 10, padding: '14px 18px', marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <AlertTriangle size={20} style={{ color: '#d97706', flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 600, color: '#92400e', marginBottom: 3 }}>Эталонный файл не загружен</div>
            <div style={{ fontSize: 13, color: '#78350f' }}>
              Без эталонного файла AI может предложить неправильные значения для состава, сертификатов и деклараций.
              Загрузите файл ниже, чтобы анализ всегда использовал верные значения.
            </div>
          </div>
        </div>
      )}

      {/* Upload section */}
      {canManage && (
        <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Загрузить файл</h3>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14, opacity: uploading ? 0.6 : 1 }}
            >
              <Upload size={15} />
              {uploading ? 'Загрузка...' : 'Выбрать Excel файл'}
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={replaceAll} onChange={e => setReplaceAll(e.target.checked)} />
              Заменить все существующие записи
            </label>
            {entries.length > 0 && (
              <button
                onClick={handleDeleteAll}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, marginLeft: 'auto' }}
              >
                <Trash2 size={14} /> Удалить все
              </button>
            )}
          </div>
          {uploadMsg && (
            <div style={{ marginTop: 10, color: '#065f46', background: '#d1fae5', padding: '8px 12px', borderRadius: 6, fontSize: 13, display: 'flex', gap: 6 }}>
              <FileCheck size={15} /> {uploadMsg}
            </div>
          )}
          {uploadError && (
            <div style={{ marginTop: 10, color: '#991b1b', background: '#fee2e2', padding: '8px 12px', borderRadius: 6, fontSize: 13 }}>
              ⚠ {uploadError}
            </div>
          )}
        </div>
      )}

      {/* Recheck result */}
      {recheckResult && (
        <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: 18, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600 }}>
              Результат проверки Артикул {recheckResult.nm_id}
              {recheckResult.total === 0
                ? <span style={{ background: '#d1fae5', color: '#065f46', fontSize: 12, padding: '2px 8px', borderRadius: 4, marginLeft: 8 }}>✓ Всё в порядке</span>
                : <span style={{ background: '#fee2e2', color: '#dc2626', fontSize: 12, padding: '2px 8px', borderRadius: 4, marginLeft: 8 }}>{recheckResult.total} расхождений</span>
              }
            </h3>
            <button onClick={() => setRecheckResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={16} /></button>
          </div>
          {recheckResult.mismatches.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Характеристика</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>В карточке</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Эталонное значение</th>
                </tr>
              </thead>
              <tbody>
                {recheckResult.mismatches.map((m, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 500 }}>{m.char_name}</td>
                    <td style={{ padding: '8px 12px', color: '#dc2626' }}>{m.card_value || '—'}</td>
                    <td style={{ padding: '8px 12px', color: '#059669', fontWeight: 500 }}>{m.fixed_value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Offer recheck after edit */}
      {recheckNmId && !recheckResult && (
        <div style={{ background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 10, padding: '12px 18px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#1e40af' }}>
            Вы изменили эталонное значение для карточки <b>{recheckNmId}</b>. Хотите проверить её прямо сейчас?
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => handleRecheck(recheckNmId)}
              disabled={rechecking}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
            >
              <RefreshCw size={13} /> {rechecking ? 'Проверка...' : 'Проверить'}
            </button>
            <button onClick={() => setRecheckNmId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}><X size={15} /></button>
          </div>
        </div>
      )}

      {/* Search */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Поиск по Артикулу..."
          value={searchNm}
          onChange={e => setSearchNm(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, width: 200 }}
        />
        <button onClick={handleSearch} style={{ padding: '8px 12px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 13 }}>
          <Search size={14} /> Найти
        </button>
        {filterNmId && (
          <button onClick={() => { setFilterNmId(undefined); setSearchNm(''); setPage(1); }}
            style={{ padding: '7px 12px', background: '#f3f4f6', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
            Сбросить фильтр
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-muted)' }}>
          Всего: {totalCards} карточек ({totalEntries} записей)
        </span>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Загрузка...</div>
      ) : entries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', background: 'white', borderRadius: 12, border: '1px dashed var(--border)' }}>
          <FileCheck size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
          <div>Нет эталонных значений</div>
          {canManage && <div style={{ fontSize: 13, marginTop: 6 }}>Загрузите Excel файл выше</div>}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid var(--border)', background: 'white' }}>
          <table style={{ borderCollapse: 'collapse', tableLayout: 'auto', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f0f9ff', borderBottom: '2px solid #bae6fd' }}>
                <th style={{ padding: '10px 14px', fontWeight: 700, textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', left: 0, background: '#f0f9ff', zIndex: 1, borderRight: '2px solid #bae6fd' }}>Артикул</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap', borderRight: '1px solid #e5e7eb', color: '#374151' }}>Бренд</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap', borderRight: '2px solid #bae6fd', color: '#374151' }}>Категория</th>
                {allCharNames.map(cn => (
                  <th key={cn} style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap', borderRight: '1px solid #e5e7eb', color: '#374151' }}>{cn}</th>
                ))}
                {canManage && <th style={{ padding: '10px 14px', width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {pagedNmIds.map((nmIdStr, rowIdx) => {
                const groupEntries = grouped[parseInt(nmIdStr)];
                const nmId = parseInt(nmIdStr, 10);
                const first = groupEntries[0];
                // index by char_name for quick lookup
                const byChar: Record<string, FixedFileEntry> = {};
                for (const e of groupEntries) byChar[e.char_name] = e;
                return (
                  <tr key={nmIdStr} style={{ borderBottom: '1px solid #e5e7eb', background: rowIdx % 2 === 0 ? 'white' : '#fafafa' }}>
                    {/* Sticky Артикул */}
                    <td style={{ padding: '9px 14px', fontWeight: 700, whiteSpace: 'nowrap', position: 'sticky', left: 0, background: rowIdx % 2 === 0 ? 'white' : '#fafafa', zIndex: 1, borderRight: '2px solid #bae6fd' }}>
                      {nmId}
                    </td>
                    <td style={{ padding: '9px 14px', whiteSpace: 'nowrap', borderRight: '1px solid #e5e7eb', color: '#6b7280' }}>{first.brand || '—'}</td>
                    <td style={{ padding: '9px 14px', whiteSpace: 'nowrap', borderRight: '2px solid #bae6fd' }}>
                      {first.subject_name
                        ? <span style={{ background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>{first.subject_name}</span>
                        : '—'}
                    </td>
                    {allCharNames.map(cn => {
                      const entry = byChar[cn];
                      return (
                        <td key={cn} style={{ padding: '9px 14px', borderRight: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>
                          {entry ? (
                            editId === entry.id ? (
                              <div style={{ display: 'flex', gap: 5 }}>
                                <input
                                  autoFocus
                                  value={editValue}
                                  onChange={e => setEditValue(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') handleSave(entry); if (e.key === 'Escape') setEditId(null); }}
                                  style={{ width: 140, padding: '4px 8px', border: '1px solid #93c5fd', borderRadius: 6, fontSize: 13 }}
                                />
                                <button onClick={() => handleSave(entry)} disabled={saving} style={{ padding: '3px 7px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 5, cursor: 'pointer' }}><Check size={12} /></button>
                                <button onClick={() => setEditId(null)} style={{ padding: '3px 7px', background: '#f3f4f6', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer' }}><X size={12} /></button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontWeight: 500 }}>{entry.fixed_value}</span>
                                {canManage && (
                                  <div style={{ display: 'flex', gap: 3, opacity: 0, flexShrink: 0, transition: 'opacity 0.15s' }} className="row-actions">
                                    <button onClick={() => handleEdit(entry)} title="Ред." style={{ padding: '3px 6px', background: 'none', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', color: '#6b7280' }}><Pencil size={11} /></button>
                                    <button onClick={() => handleDelete(entry)} disabled={deletingId === entry.id} title="Удалить" style={{ padding: '3px 6px', background: 'none', border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer', color: '#dc2626' }}><Trash2 size={11} /></button>
                                  </div>
                                )}
                              </div>
                            )
                          ) : (
                            <span style={{ color: '#d1d5db' }}>—</span>
                          )}
                        </td>
                      );
                    })}
                    {canManage && (
                      <td style={{ padding: '9px 10px' }}>
                        <button
                          onClick={() => handleRecheck(nmId)}
                          disabled={rechecking}
                          title="Проверить карточку"
                          style={{ padding: '4px 7px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-secondary)' }}
                        >
                          <RefreshCw size={12} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            style={{ padding: '7px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'white', cursor: 'pointer' }}>
            <ChevronLeft size={15} />
          </button>
          <span style={{ padding: '7px 14px', fontSize: 14, color: 'var(--text-secondary)' }}>
            {page} / {totalPages}
          </span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            style={{ padding: '7px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'white', cursor: 'pointer' }}>
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
