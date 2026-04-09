import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Users, RefreshCw, Clock, CheckCircle,
  TrendingUp, Star, Wifi, WifiOff, BarChart3, Target,
  Zap, Activity
} from 'lucide-react';
import api from '../api/client';
import { useStore } from '../contexts/StoreContext';

interface MemberActivity {
  id: number;
  name: string;
  email: string;
  role: string;
  fixes_week: number;
  fixes_today: number;
  fixes_all_time: number;
  work_start_today: string | null;
  work_end_today: string | null;
  work_minutes_today: number;
  last_action: { title: string; at: string } | null;
  last_login: string | null;
  last_active_at: string | null;
  is_online: boolean;
  progress_pct: number;
}

interface StoreStats {
  avg_score: number;
  completion_pct: number;
  total_issues: number;
  fixed_issues: number;
  pending_issues: number;
}

interface TeamActivity {
  members: MemberActivity[];
  pending_approvals: number;
  issues_summary: Record<string, number>;
  total_members: number;
  store_stats: StoreStats;
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Владелец',
  head_manager: 'Ст. менеджер',
  manager: 'Менеджер',
  viewer: 'Наблюдатель',
  user: 'Пользователь',
};

const ROLE_COLORS: Record<string, string> = {
  owner: '#7c3aed',
  head_manager: '#0ea5e9',
  manager: '#10b981',
  viewer: '#6b7280',
  user: '#6b7280',
};

function formatWorkTime(minutes: number): string {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}ч ${m}м`;
  return `${m} мин`;
}

function formatLastSeen(iso: string | null): string {
  if (!iso) return 'никогда';
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин. назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч. назад`;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function getInitials(name: string, email: string): string {
  if (name && name.trim() && name !== 'None None') {
    const parts = name.trim().split(' ');
    return parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function ProgressBar({ value, max = 100, color = '#6366f1', height = 6, label }: {
  value: number; max?: number; color?: string; height?: number; label?: string
}) {
  const pct = Math.min(100, max > 0 ? Math.round(value / max * 100) : 0);
  return (
    <div style={{ width: '100%' }}>
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6b7280', marginBottom: 3 }}>
          <span>{label}</span>
          <span style={{ fontWeight: 600, color: '#374151' }}>{pct}%</span>
        </div>
      )}
      <div style={{ background: '#f3f4f6', borderRadius: height, height, overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: color,
          borderRadius: height,
          transition: 'width 0.5s ease',
        }} />
      </div>
    </div>
  );
}

export function StaffContent() {
  const { activeStore } = useStore();
  const [data, setData] = useState<TeamActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    if (!activeStore) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await api.getTeamActivity(activeStore.id);
      setData(res);
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [activeStore]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => { if (tick > 0) load(); }, [tick]);

  const store = data?.store_stats;
  const members = data?.members || [];
  const onlineCount = members.filter(m => m.is_online).length;
  const todayFixers = members.filter(m => m.fixes_today > 0).length;

  return (
    <div>
        {loading && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#6b7280' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />
            Загрузка...
          </div>
        )}
        {error && (
          <div style={{ padding: 16, background: '#fef2f2', borderRadius: 12, color: '#dc2626', marginBottom: 20 }}>
            ⚠️ {error}
            <button onClick={load} style={{ marginLeft: 12, color: '#dc2626', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}>Повторить</button>
          </div>
        )}

        {!loading && data && (
          <>
            {/* ── Store performance ─────────────────────── */}
            <div style={{
              background: 'white', borderRadius: 16, padding: 24,
              boxShadow: '0 1px 4px rgba(0,0,0,.06)', marginBottom: 24
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <BarChart3 size={18} color="#6366f1" />
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Показатели магазина</h2>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 24 }}>
                {[
                  { icon: <Star size={16} />, label: 'Рейтинг карточек', value: `${store?.avg_score ?? 0}%`, color: '#f59e0b', sub: 'средний балл' },
                  { icon: <CheckCircle size={16} />, label: 'Исправлено задач', value: store?.fixed_issues ?? 0, color: '#10b981', sub: `из ${store?.total_issues ?? 0}` },
                  { icon: <Target size={16} />, label: 'Ожидают решения', value: store?.pending_issues ?? 0, color: '#ef4444', sub: 'задач' },
                  { icon: <Clock size={16} />, label: 'На проверке', value: data.pending_approvals, color: '#f59e0b', sub: 'заявок' },
                ].map((s, i) => (
                  <div key={i} style={{ padding: '12px 14px', background: '#f9fafb', borderRadius: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: s.color, marginBottom: 6 }}>
                      {s.icon}
                      <span style={{ fontSize: 11, color: '#6b7280' }}>{s.label}</span>
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: '#111827' }}>{s.value}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>{s.sub}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <ProgressBar
                  value={store?.avg_score ?? 0}
                  max={100}
                  color="#6366f1"
                  height={10}
                  label="Рейтинг магазина"
                />
                <ProgressBar
                  value={store?.fixed_issues ?? 0}
                  max={(store?.total_issues ?? 0) || 1}
                  color="#10b981"
                  height={10}
                  label="Выполнено задач"
                />
              </div>
            </div>

            {/* ── Summary row ───────────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
              {[
                { icon: <Wifi size={16} />, label: 'Онлайн сейчас', value: onlineCount, color: '#10b981' },
                { icon: <Zap size={16} />, label: 'Работают сегодня', value: todayFixers, color: '#f59e0b' },
                { icon: <Activity size={16} />, label: 'Исправлений сегодня', value: members.reduce((a, m) => a + m.fixes_today, 0), color: '#6366f1' },
              ].map((s, i) => (
                <div key={i} style={{ background: 'white', borderRadius: 14, padding: '16px', boxShadow: '0 1px 4px rgba(0,0,0,.05)', textAlign: 'center' }}>
                  <div style={{ color: s.color, display: 'flex', justifyContent: 'center', marginBottom: 8 }}>{s.icon}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: '#111827' }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* ── Members list ──────────────────────────── */}
            <div style={{ background: 'white', borderRadius: 16, boxShadow: '0 1px 4px rgba(0,0,0,.06)', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 8 }}>
                <TrendingUp size={16} color="#6366f1" />
                <span style={{ fontWeight: 700, fontSize: 15 }}>Активность сотрудников</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9ca3af' }}>обновляется каждые 30с</span>
              </div>

              {members.length === 0 ? (
                <div style={{ padding: '40px 24px', textAlign: 'center', color: '#9ca3af' }}>
                  <Users size={40} />
                  <p>Нет сотрудников</p>
                </div>
              ) : (
                members.map((m) => {
                  const initials = getInitials(m.name, m.email);
                  const roleColor = ROLE_COLORS[m.role] || '#6b7280';
                  const lastSeen = m.is_online ? 'онлайн' : formatLastSeen(m.last_active_at || m.last_login);

                  return (
                    <div key={m.id} style={{
                      padding: '16px 20px',
                      borderBottom: '1px solid #f9fafb',
                      display: 'grid',
                      gridTemplateColumns: '44px 1fr 140px 120px',
                      gap: 16,
                      alignItems: 'center',
                    }}>
                      {/* Avatar + online dot */}
                      <div style={{ position: 'relative', width: 44, height: 44 }}>
                        <div style={{
                          width: 44, height: 44, borderRadius: '50%',
                          background: `${roleColor}20`,
                          color: roleColor,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 700, fontSize: 15,
                        }}>{initials}</div>
                        <div style={{
                          position: 'absolute', bottom: 1, right: 1,
                          width: 11, height: 11, borderRadius: '50%',
                          background: m.is_online ? '#10b981' : '#d1d5db',
                          border: '2px solid white',
                        }} />
                      </div>

                      {/* Name + activity */}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <span style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>
                            {m.name && m.name !== 'None None' ? m.name : m.email}
                          </span>
                          <span style={{
                            fontSize: 10, padding: '2px 7px', borderRadius: 6,
                            background: `${roleColor}15`, color: roleColor, fontWeight: 600
                          }}>{ROLE_LABELS[m.role] || m.role}</span>
                          {m.is_online && (
                            <span style={{ fontSize: 10, color: '#10b981', fontWeight: 600 }}>● онлайн</span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>
                          {m.last_action
                            ? <>Последнее: <span style={{ color: '#6b7280' }}>{m.last_action.title}</span></>
                            : <span>Нет активности</span>
                          }
                        </div>
                        <ProgressBar
                          value={m.fixes_week}
                          max={Math.max(...members.map(x => x.fixes_week), 1)}
                          color={roleColor}
                          height={5}
                        />
                      </div>

                      {/* Fixes stats */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                          <span style={{ color: '#9ca3af' }}>Сегодня</span>
                          <span style={{ fontWeight: 700, color: m.fixes_today > 0 ? '#10b981' : '#9ca3af' }}>
                            {m.fixes_today} исправ.
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                          <span style={{ color: '#9ca3af' }}>Неделя</span>
                          <span style={{ fontWeight: 700, color: '#374151' }}>{m.fixes_week}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                          <span style={{ color: '#9ca3af' }}>Всего</span>
                          <span style={{ color: '#6b7280' }}>{m.fixes_all_time}</span>
                        </div>
                      </div>

                      {/* Work time + last seen */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                          <Clock size={12} color="#9ca3af" />
                          <span style={{ color: '#6b7280' }}>{formatWorkTime(m.work_minutes_today)}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                          {m.is_online ? <Wifi size={12} color="#10b981" /> : <WifiOff size={12} color="#9ca3af" />}
                          <span style={{ color: '#6b7280' }}>{lastSeen}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
    </div>
  );
}

export default function StaffPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[900px] mx-auto px-4 py-6">
        <StaffContent />
      </div>
    </div>
  );
}
