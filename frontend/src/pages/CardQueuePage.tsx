import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import { ArrowLeft, ExternalLink, Search, Package, ChevronRight, Settings2 } from 'lucide-react';
import api from '../api/client';
import './CardQueuePage.css';

interface QueueCard {
  id: number;
  nm_id: number;
  vendor_code: string | null;
  title: string | null;
  main_photo_url: string | null;
  score: number;
  critical_issues_count: number;
  warnings_count: number;
  pending_issues_count: number;
}

function statusText(card: QueueCard): string {
  if (card.critical_issues_count > 0) return 'Есть критические ошибки';
  if (card.warnings_count > 0) return 'Карточка требует улучшения';
  if (card.pending_issues_count > 0) return 'Не заполнены обязательные поля';
  return 'Карточка в порядке';
}

function dotColor(card: QueueCard): string {
  if (card.critical_issues_count > 0) return '#EF4444';
  if (card.warnings_count > 0) return '#F59E0B';
  if (card.pending_issues_count > 0) return '#F59E0B';
  return '#10B981';
}

function scoreImpact(card: QueueCard): number {
  return (card.critical_issues_count || 0) * 5 + (card.warnings_count || 0) * 3;
}

export default function CardQueuePage() {
  const navigate = useNavigate();
  const { activeStore } = useStore();
  const [cards, setCards] = useState<QueueCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (activeStore) loadQueue();
  }, [activeStore]);

  const loadQueue = async () => {
    if (!activeStore) return;
    setLoading(true);
    try {
      const data = await api.getCardsQueue(activeStore.id, 100);
      setCards(data || []);
    } catch (err) {
      console.error('Failed to load queue:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredCards = cards.filter((card) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      card.title?.toLowerCase().includes(q) ||
      card.vendor_code?.toLowerCase().includes(q) ||
      String(card.nm_id).includes(q)
    );
  });

  return (
    <div className="cq-page">
      {/* ── Top bar ── */}
      <div className="cq-topbar">
        <button className="cq-back" onClick={() => navigate('/workspace')}>
          <ArrowLeft size={14} />
          <span>Рабочее пространство</span>
        </button>

        <div className="cq-topbar-right">
          <span className="cq-mode-pill cq-mode-pill--active">Пошаговый</span>
          <button className="cq-mode-link" onClick={() => navigate('/workspace/cards')}>
            <Settings2 size={14} />
            <span>Расширенный режим</span>
          </button>
        </div>
      </div>

      <div className="cq-body">
        {/* ── Header ── */}
        <h1 className="cq-title">Очередь карточек</h1>
        <p className="cq-subtitle">
          {filteredCards.length} карточек · отсортировано по приоритету
        </p>

        {/* ── Search ── */}
        <div className="cq-search">
          <Search size={16} className="cq-search-icon" />
          <input
            className="cq-search-input"
            type="text"
            placeholder="Поиск по артикулу ВБ или поставщика..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* ── List ── */}
        {loading ? (
          <div className="cq-loading">
            <div className="cq-spinner" />
            <span>Загрузка очереди...</span>
          </div>
        ) : filteredCards.length === 0 ? (
          <div className="cq-empty">
            <Package size={40} />
            <p>Карточки не найдены</p>
          </div>
        ) : (
          <div className="cq-list">
            {filteredCards.map((card) => {
              const hasIssues = card.pending_issues_count > 0;
              const impact = scoreImpact(card);
              return (
                <div
                  key={card.id}
                  className={`cq-row ${hasIssues ? 'cq-row--clickable' : ''}`}
                  onClick={() => hasIssues && navigate(`/workspace/fix/card/${card.id}`)}
                >
                  {/* dot */}
                  <span className="cq-dot" style={{ background: dotColor(card) }} />

                  {/* photo */}
                  <div className="cq-photo">
                    {card.main_photo_url ? (
                      <img src={card.main_photo_url} alt="" />
                    ) : (
                      <Package size={18} color="#94a3b8" />
                    )}
                  </div>

                  {/* info */}
                  <div className="cq-info">
                    <span className="cq-info-title">
                      {card.title || `Карточка ${card.nm_id}`}
                      <a
                        href={`https://www.wildberries.ru/catalog/${card.nm_id}/detail.aspx`}
                        target="_blank"
                        rel="noreferrer"
                        className="cq-ext"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink size={12} />
                      </a>
                    </span>
                    <span className="cq-info-meta">
                      <span>📋 {card.nm_id}</span>
                      {card.vendor_code && (
                        <>
                          <span className="cq-sep">·</span>
                          <span>📦 {card.vendor_code}</span>
                        </>
                      )}
                      <span className="cq-sep">·</span>
                      <span className="cq-status-label">{statusText(card)}</span>
                    </span>
                  </div>

                  {/* right */}
                  <div className="cq-right">
                    <div className="cq-errors">
                      <span>Ошибок: {card.pending_issues_count}</span>
                      <span>Score: {card.score}</span>
                    </div>

                    {impact > 0 && (
                      <span className="cq-impact">+{impact}</span>
                    )}

                    {hasIssues && (
                      <button
                        className="cq-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/workspace/fix/card/${card.id}`);
                        }}
                      >
                        Начать исправление
                        <ChevronRight size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
