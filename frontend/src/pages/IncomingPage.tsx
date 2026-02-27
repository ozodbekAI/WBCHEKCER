import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import api from '../api/client';
import { AlertCircle, AlertTriangle, Eye, MoveUpRight, Zap } from 'lucide-react';
import type { IssuesGrouped } from '../types';

export default function IncomingPage() {
  const navigate = useNavigate();
  const { activeStore } = useStore();
  const [grouped, setGrouped] = useState<IssuesGrouped | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (activeStore) loadGrouped();
  }, [activeStore]);

  const loadGrouped = async () => {
    if (!activeStore) return;
    setLoading(true);
    try {
      const data = await api.getIssuesGrouped(activeStore.id);
      setGrouped(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !grouped) {
    return (
      <div className="loading-page">
        <div className="loading-center">
          <div className="spinner" />
          <div className="loading-text">Загрузка задач...</div>
        </div>
      </div>
    );
  }

  const criticalCards = new Set(grouped.critical.map(i => i.card_id)).size;
  const criticalProblems = new Set(grouped.critical.map(i => i.code)).size;
  const warningCards = new Set(grouped.warnings.map(i => i.card_id)).size;
  const warningProblems = new Set(grouped.warnings.map(i => i.code)).size;
  const improvementCards = new Set(grouped.improvements.map(i => i.card_id)).size;
  const improvementProblems = new Set(grouped.improvements.map(i => i.code)).size;

  return (
    <div className="incoming-page">
      <div className="incoming-headline-wrap">
        <div className="page-back" onClick={() => navigate('/workspace')}>
          ← Рабочее пространство
        </div>
        <h1 className="page-title">Входящие задачи</h1>
      </div>

      {/* Critical */}
      <div
        className="severity-group critical"
        onClick={() => navigate('/workspace/fix/critical')}
        style={{ cursor: 'pointer' }}
      >
        <div className="severity-info">
          <h3>Критические ошибки</h3>
          <div className="severity-desc">Блокируют показы или продажи</div>
        </div>
        <div className="severity-stats">
          <div className="ss">
            <div className="ss-ico"><Eye size={12} /></div>
            <div className="ss-num critical">{grouped.critical_count}</div>
            <div>ошибок</div>
          </div>
          <div className="ss">
            <div className="ss-num">{criticalCards}</div>
            <div>карточек</div>
          </div>
          <div className="ss">
            <div className="ss-num">{criticalProblems}</div>
            <div>проблем</div>
          </div>
        </div>
        <div className="severity-action">
          <button className="btn btn-danger btn-sm">
            <Zap size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> Начать исправление
          </button>
        </div>
      </div>

      {/* Warnings */}
      <div
        className="severity-group warning"
        onClick={() => navigate('/workspace/fix/warning')}
        style={{ cursor: 'pointer' }}
      >
        <div className="severity-info">
          <h3>Предупреждения</h3>
          <div className="severity-desc">Снижают конверсию</div>
        </div>
        <div className="severity-stats">
          <div className="ss">
            <div className="ss-ico"><AlertTriangle size={12} /></div>
            <div className="ss-num warning">{grouped.warnings_count}</div>
            <div>ошибок</div>
          </div>
          <div className="ss">
            <div className="ss-num">{warningCards}</div>
            <div>карточек</div>
          </div>
          <div className="ss">
            <div className="ss-num">{warningProblems}</div>
            <div>проблем</div>
          </div>
        </div>
        <div className="severity-action">
          <button className="btn btn-primary btn-sm">
            <Zap size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> Начать исправление
          </button>
        </div>
      </div>

      {/* Improvements */}
      <div
        className="severity-group improvement"
        onClick={() => navigate('/workspace/fix/improvement')}
        style={{ cursor: 'pointer' }}
      >
        <div className="severity-info">
          <h3>Точки роста</h3>
          <div className="severity-desc">Возможности улучшения показателей</div>
        </div>
        <div className="severity-stats">
          <div className="ss">
            <div className="ss-ico"><MoveUpRight size={12} /></div>
            <div className="ss-num success">{grouped.improvements_count}</div>
            <div>ошибок</div>
          </div>
          <div className="ss">
            <div className="ss-num">{improvementCards}</div>
            <div>карточек</div>
          </div>
          <div className="ss">
            <div className="ss-num">{improvementProblems}</div>
            <div>проблем</div>
          </div>
        </div>
        <div className="severity-action">
          <button className="btn btn-success btn-sm">
                        <Zap size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> Начать улучшение
          </button>
        </div>
      </div>

      {/* Postponed */}
      {grouped.postponed_count > 0 && (
        <div
          className="severity-group postponed"
          onClick={() => navigate('/workspace/fix/postponed')}
          style={{ cursor: 'pointer' }}
        >
          <div className="severity-info">
            <h3>Отложенные</h3>
            <div className="severity-desc">Задачи, отмеченные для обработки позже</div>
          </div>
          <div className="severity-stats">
            <div className="ss">
              <div className="ss-ico"><AlertCircle size={12} /></div>
              <div className="ss-num">{grouped.postponed_count}</div>
              <div>задач</div>
            </div>
          </div>
          <div className="severity-action">
            <button className="btn btn-secondary btn-sm">
              Продолжить работу
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
