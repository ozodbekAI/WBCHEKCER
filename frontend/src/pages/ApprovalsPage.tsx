import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ClipboardCheck, Check, X, Send,
  Clock, CheckCircle, XCircle, Rocket, Eye,
  ChevronDown, ChevronUp, MessageSquare, RefreshCw
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useStore } from '../contexts/StoreContext';
import type { CardApproval } from '../types';

const STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:  { label: 'На проверке', color: '#f59e0b', icon: <Clock size={14} /> },
  approved: { label: 'Одобрено',   color: '#10b981', icon: <CheckCircle size={14} /> },
  rejected: { label: 'Отклонено',  color: '#ef4444', icon: <XCircle size={14} /> },
  applied:  { label: 'Применено',  color: '#6366f1', icon: <Rocket size={14} /> },
};

type TabKey = 'pending' | 'approved' | 'rejected' | 'applied' | 'all';

export default function ApprovalsPage() {
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const { activeStore } = useStore();
  const storeId = activeStore?.id;

  const [allApprovals, setAllApprovals] = useState<CardApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('pending');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [acting, setActing] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canApprove = hasPermission('cards.approve');
  const canSync = hasPermission('cards.sync');

  const loadApprovals = useCallback(async () => {
    if (!storeId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.getApprovals(storeId, { limit: 200 });
      setAllApprovals(data.items || []);
    } catch (e: any) {
      console.error('Failed to load approvals:', e);
      setLoadError(e?.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { loadApprovals(); }, [loadApprovals]);

  const approvals = activeTab === 'all'
    ? allApprovals
    : allApprovals.filter(a => a.status === activeTab);

  const handleReview = async (approvalId: number, action: 'approve' | 'reject') => {
    if (!storeId) return;
    setActing(approvalId);
    setActionError(null);
    try {
      await api.reviewApproval(storeId, approvalId, action, reviewComment || undefined);
      setReviewComment('');
      setExpandedId(null);
      await loadApprovals();
    } catch (e: any) {
      setActionError(e.message || 'Ошибка');
    } finally {
      setActing(null);
    }
  };

  const handleApply = async (approvalId: number) => {
    if (!storeId) return;
    setActing(approvalId);
    setActionError(null);
    try {
      await api.applyApproval(storeId, approvalId);
      await loadApprovals();
    } catch (e: any) {
      setActionError(e.message || 'Ошибка при отправке на WB');
    } finally {
      setActing(null);
    }
  };

  const handleResubmit = async (a: CardApproval) => {
    if (!storeId) return;
    setActing(a.id);
    setActionError(null);
    try {
      await api.submitForReview(storeId, a.card_id);
      await loadApprovals();
    } catch (e: any) {
      setActionError(e.message || 'Ошибка');
    } finally {
      setActing(null);
    }
  };

  const handleCancelAndEdit = async (a: CardApproval) => {
    if (!storeId) return;
    setActing(a.id);
    setActionError(null);
    try {
      await api.cancelApproval(storeId, a.id);
      navigate(`/workspace/fix/critical`);
    } catch (e: any) {
      setActionError(e.message || 'Ошибка');
      setActing(null);
    }
  };

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });
  };

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: 'pending',  label: 'На проверке', count: allApprovals.filter(a => a.status === 'pending').length },
    { key: 'approved', label: 'Одобрено',   count: allApprovals.filter(a => a.status === 'approved').length },
    { key: 'rejected', label: 'Отклонено',  count: allApprovals.filter(a => a.status === 'rejected').length },
    { key: 'applied',  label: 'Применено',  count: allApprovals.filter(a => a.status === 'applied').length },
    { key: 'all',      label: 'Все',        count: allApprovals.length },
  ];

  if (loading) {
    return (
      <div className="loading-page"><div className="loading-center"><div className="spinner" /></div></div>
    );
  }

  if (loadError) {
    return (
      <div className="approvals-page">
        <div className="approvals-header">
          <button className="btn-back" onClick={() => navigate('/workspace')}><ArrowLeft size={18} /></button>
          <div className="approvals-header-info">
            <h1><ClipboardCheck size={22} /> Проверка карточек</h1>
          </div>
        </div>
        <div style={{ padding: '40px 24px', textAlign: 'center', color: '#dc2626' }}>
          <p>Ошибка загрузки: {loadError}</p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={loadApprovals}>Попробовать снова</button>
        </div>
      </div>
    );
  }

  return (
    <div className="approvals-page">
      {/* Header */}
      <div className="approvals-header">
        <button className="btn-back" onClick={() => navigate('/workspace')}>
          <ArrowLeft size={18} />
        </button>
        <div className="approvals-header-info">
          <h1><ClipboardCheck size={22} /> Проверка карточек</h1>
          <span className="approvals-subtitle">
            {canApprove ? 'Проверьте и одобрите подготовленные карточки' : 'Статус ваших карточек'}
          </span>
        </div>
        <button className="btn-icon" onClick={loadApprovals} title="Обновить" style={{ marginLeft: 'auto' }}>
          <RefreshCw size={16} />
        </button>
      </div>

      {actionError && (
        <div style={{ margin: '0 24px 12px', padding: '10px 16px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, color: '#dc2626', fontSize: 14 }}>
          ⚠️ {actionError}
        </div>
      )}

      {/* Tabs */}
      <div className="approvals-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`approvals-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`approvals-tab-badge ${tab.key === 'rejected' ? 'approvals-tab-badge--red' : ''}`}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="approvals-list">
        {approvals.length === 0 ? (
          <div className="approvals-empty">
            <ClipboardCheck size={48} />
            <p>{activeTab === 'pending' ? 'Нет карточек на проверке' : 'Нет карточек в этой категории'}</p>
          </div>
        ) : (
          approvals.map((a) => {
            const meta = STATUS_META[a.status] || STATUS_META.pending;
            const isExpanded = expandedId === a.id;
            const isMyCard = a.prepared_by_id === user?.id;

            return (
              <div key={a.id} className={`approval-card ${a.status}`}>
                {/* Card header */}
                <div className="approval-card-header" onClick={() => setExpandedId(isExpanded ? null : a.id)}>
                  <div className="approval-card-photo">
                    {a.card_photo ? (
                      <img src={a.card_photo} alt="" />
                    ) : (
                      <div className="approval-card-no-photo">📦</div>
                    )}
                  </div>
                  <div className="approval-card-info">
                    <div className="approval-card-title">
                      {a.card_title || `Карточка #${a.card_nm_id}`}
                    </div>
                    <div className="approval-card-meta">
                      <span>NM: {a.card_nm_id}</span>
                      {a.card_vendor_code && <span>Арт: {a.card_vendor_code}</span>}
                      <span>{a.total_fixes} исправлений</span>
                      {canApprove && a.prepared_by_name && (
                        <span style={{ color: '#6b7280' }}>от {a.prepared_by_name}</span>
                      )}
                    </div>
                    {/* Rejected comment preview */}
                    {a.status === 'rejected' && a.reviewer_comment && (
                      <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>
                        ✗ {a.reviewer_comment}
                      </div>
                    )}
                  </div>
                  <div className="approval-card-right">
                    <span className="approval-status-badge" style={{ background: `${meta.color}15`, color: meta.color }}>
                      {meta.icon} {meta.label}
                    </span>
                    <div className="approval-card-date">{formatDate(a.created_at)}</div>
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="approval-card-details">
                    {/* Changes list */}
                    <div className="approval-changes">
                      <h4>Изменения ({a.changes.length})</h4>
                      <div className="approval-changes-list">
                        {a.changes.map((ch, idx) => (
                          <div key={idx} className="approval-change-row">
                            <div className="approval-change-field">{ch.title || ch.field_path || '—'}</div>
                            <div className="approval-change-values">
                              <span className="approval-val-old">{ch.old_value || '(пусто)'}</span>
                              <span className="approval-val-arrow">→</span>
                              <span className="approval-val-new">{ch.new_value || '(очистка)'}</span>
                            </div>
                            {ch.severity && (
                              <span className={`approval-sev-badge ${ch.severity}`}>{ch.severity}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Submit note */}
                    {a.submit_note && (
                      <div className="approval-note">
                        <MessageSquare size={14} /> <strong>Комментарий:</strong> {a.submit_note}
                      </div>
                    )}

                    {/* Reviewer comment */}
                    {a.reviewer_comment && (
                      <div className={`approval-note ${a.status === 'rejected' ? 'approval-note--rejected' : 'reviewer'}`}>
                        <MessageSquare size={14} />
                        <div>
                          <strong>{a.status === 'rejected' ? 'Причина отклонения:' : 'Рецензент:'}</strong> {a.reviewer_comment}
                        </div>
                      </div>
                    )}

                    {/* Review info */}
                    {a.reviewed_by_name && (
                      <div className="approval-reviewed-info">
                        Проверил: <strong>{a.reviewed_by_name}</strong> — {formatDate(a.reviewed_at)}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="approval-actions">
                      {a.status === 'pending' && canApprove && (
                        <>
                          <div className="approval-comment-input">
                            <input
                              type="text"
                              placeholder="Комментарий (необязательно)..."
                              value={expandedId === a.id ? reviewComment : ''}
                              onChange={(e) => setReviewComment(e.target.value)}
                            />
                          </div>
                          <button
                            className="btn-approve"
                            disabled={acting === a.id}
                            onClick={() => handleReview(a.id, 'approve')}
                          >
                            <Check size={16} /> Одобрить
                          </button>
                          <button
                            className="btn-reject"
                            disabled={acting === a.id}
                            onClick={() => handleReview(a.id, 'reject')}
                          >
                            <X size={16} /> Отклонить
                          </button>
                        </>
                      )}
                      {a.status === 'pending' && !canApprove && isMyCard && (
                        <button
                          className="btn-cancel-pending"
                          disabled={acting === a.id}
                          onClick={() => handleCancelAndEdit(a)}
                          title="Отозвать и исправить заново"
                        >
                          <X size={16} /> {acting === a.id ? 'Отзываем...' : 'Изменить'}
                        </button>
                      )}
                      {a.status === 'approved' && canSync && (
                        <button
                          className="btn-apply-wb"
                          disabled={acting === a.id}
                          onClick={() => handleApply(a.id)}
                        >
                          <Rocket size={16} /> Применить на WB
                        </button>
                      )}
                      {a.status === 'rejected' && isMyCard && (
                        <button
                          className="btn-resubmit"
                          disabled={acting === a.id}
                          onClick={() => handleResubmit(a)}
                        >
                          <Send size={16} /> {acting === a.id ? 'Отправляем...' : 'Отправить снова'}
                        </button>
                      )}
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => navigate(`/workspace/cards/${a.card_id}`)}
                      >
                        <Eye size={14} /> Открыть карточку
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
