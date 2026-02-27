import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useStore } from '../contexts/StoreContext';
import {
  Settings,
  X,
  Activity,
  Clock,
  MousePointerClick,
  ChevronRight,
  Trash2,
  BarChart3,
} from 'lucide-react';
import {
  getSessions,
  getDailyTotals,
  getStats,
  clearActivity,
  formatDuration,
  formatDurationSec,
  type ActivitySession,
} from '../hooks/useActivityTracker';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MONTHS_SHORT = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июня', 'июля', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];

function formatSessionDate(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const month = MONTHS_SHORT[d.getMonth()];
  return `${day} ${month}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
}

function getWeekdayLabel(iso: string): string {
  const d = new Date(iso);
  const day = d.getDay(); // 0=Sun
  return WEEKDAYS_SHORT[day === 0 ? 6 : day - 1];
}

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export default function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const { activeStore } = useStore();
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [tick, setTick] = useState(0);

  // Refresh stats every 30s
  useEffect(() => {
    if (!open) return;
    setTick(t => t + 1);
    const iv = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(iv);
  }, [open]);

  const days = period === 'week' ? 7 : 30;
  const stats = useMemo(() => getStats(days), [tick, days]);
  const dailyTotals = useMemo(() => getDailyTotals(days), [tick, days]);
  const allSessions = useMemo(() => getSessions(), [tick]);

  const maxMinutes = useMemo(() => Math.max(...dailyTotals.map(d => d.minutes), 1), [dailyTotals]);

  const totalWeekMin = useMemo(() => dailyTotals.reduce((a, d) => a + d.minutes, 0), [dailyTotals]);

  const totalWeekActions = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return allSessions
      .filter(s => new Date(s.startedAt) >= cutoff)
      .reduce((a, s) => a + s.actions, 0);
  }, [allSessions, days]);

  const handleClear = useCallback(() => {
    if (confirm('Очистить всю историю активности?')) {
      clearActivity();
      setTick(t => t + 1);
    }
  }, []);

  if (!open) return null;

  return (
    <div className="stg-overlay" onClick={onClose}>
      <div className="stg-panel" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="stg-header">
          <div className="stg-header-title">
            <Settings size={18} />
            <span>Настройки</span>
          </div>
          <button className="stg-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="stg-subtitle">
          Персональные настройки для магазина "{activeStore?.name || '—'}"
        </div>

        <div className="stg-scroll">
          {/* Activity header */}
          <div className="stg-section-title">
            <Activity size={16} />
            <span>Рабочая активность</span>
          </div>

          {/* Stats row */}
          <div className="stg-stats-row">
            <div className="stg-stat">
              <div className="stg-stat-value">{stats.sessionCount}</div>
              <div className="stg-stat-label">{plural(stats.sessionCount, 'сессия', 'сессии', 'сессий')}</div>
            </div>
            <div className="stg-stat">
              <div className="stg-stat-value">{formatDuration(stats.totalMinutes)}</div>
              <div className="stg-stat-label">рабочее время</div>
            </div>
            <div className="stg-stat">
              <div className="stg-stat-value">{stats.totalActions}</div>
              <div className="stg-stat-label">{plural(stats.totalActions, 'действие', 'действия', 'действий')}</div>
            </div>
          </div>

          {/* Chart */}
          <div className="stg-chart-card">
            <div className="stg-chart-header">
              <div className="stg-chart-title">
                <BarChart3 size={15} />
                <span>Рабочее время</span>
              </div>
              <div className="stg-chart-tabs">
                <button
                  className={period === 'week' ? 'active' : ''}
                  onClick={() => setPeriod('week')}
                >Неделя</button>
                <button
                  className={period === 'month' ? 'active' : ''}
                  onClick={() => setPeriod('month')}
                >Месяц</button>
              </div>
            </div>

            <div className="stg-chart-area">
              {/* Y-axis labels */}
              <div className="stg-chart-yaxis">
                {[...Array(5)].map((_, i) => {
                  const step = Math.ceil(maxMinutes / 60 / 4);
                  const val = (4 - i) * step;
                  return <span key={i}>{val}ч</span>;
                })}
                <span>0ч</span>
              </div>

              {/* Bars */}
              <div className="stg-chart-bars">
                {dailyTotals.map((d) => {
                  const pct = maxMinutes > 0 ? (d.minutes / maxMinutes) * 100 : 0;
                  return (
                    <div key={d.date} className="stg-chart-bar-wrap" title={`${d.date}: ${formatDuration(d.minutes)}`}>
                      <div className="stg-chart-bar-track">
                        <div
                          className="stg-chart-bar"
                          style={{ height: `${Math.max(pct, 0)}%` }}
                        />
                      </div>
                      <span className="stg-chart-bar-label">
                        {period === 'week' ? getWeekdayLabel(d.date) : new Date(d.date).getDate().toString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="stg-chart-footer">
              <span>Всего за {period === 'week' ? 'неделю' : 'месяц'}</span>
              <span className="stg-chart-footer-val">
                <strong>{formatDuration(totalWeekMin)}</strong>
                &nbsp;&nbsp;{totalWeekActions} {plural(totalWeekActions, 'действие', 'действия', 'действий')}
              </span>
            </div>
          </div>

          {/* Sessions list */}
          <div className="stg-section-title stg-section-title--mt">
            Последние сессии
          </div>

          <div className="stg-sessions">
            {allSessions.length === 0 && (
              <div className="stg-empty">Нет записей активности</div>
            )}
            {allSessions.slice(0, 20).map(session => (
              <div key={session.id} className="stg-session-card">
                <div className="stg-session-main">
                  <div className="stg-session-date">
                    {formatSessionDate(session.startedAt)} · {formatTime(session.startedAt)} — {session.endedAt ? formatTime(session.endedAt) : 'сейчас'}
                  </div>
                  <div className="stg-session-meta">
                    <span><Clock size={12} /> {formatDurationSec(session.durationSec)}</span>
                    <span>·</span>
                    <span><MousePointerClick size={12} /> {session.actions} {plural(session.actions, 'действие', 'действия', 'действий')}</span>
                  </div>
                </div>
                <ChevronRight size={16} className="stg-session-arrow" />
              </div>
            ))}
          </div>

          {/* Clear */}
          {allSessions.length > 0 && (
            <button className="stg-clear-btn" onClick={handleClear}>
              <Trash2 size={14} />
              Очистить историю
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
