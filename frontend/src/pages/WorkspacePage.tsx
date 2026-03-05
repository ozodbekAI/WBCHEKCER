import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import api, { API_ORIGIN } from '../api/client';
import type { WorkspaceDashboard, StoreStats, TeamActivity } from '../types';
import { startSession, flushActiveSession, trackAction, getStats, formatDuration } from '../hooks/useActivityTracker';
import SettingsPanel from './SettingsPanel';
import {
  ClipboardList,
  Circle,
  CheckSquare,
  LayoutGrid,
  FlaskConical,
  Camera,
  MessageCircle,
  TrendingUp,
  Activity,
  ChevronDown,
  Settings,
  Clock,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Info,
  SlidersHorizontal,
  Sparkles,
  X,
  Check,
  Users,
  ClipboardCheck,
  Shield,
  LogOut,
  User,
  Crown,
  Briefcase,
  Eye,
  Wrench,
  Zap,
  FileCheck,
} from 'lucide-react';

export default function WorkspacePage() {
  const navigate = useNavigate();
  const { activeStore, stores, selectStore } = useStore();
  const { user, logout, hasPermission, hasAnyPermission, isRole } = useAuth();
  const [dashboard, setDashboard] = useState<WorkspaceDashboard | null>(null);
  const [stats, setStats] = useState<StoreStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showStoreMenu, setShowStoreMenu] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const [modeModalOpen, setModeModalOpen] = useState(false);
  const [workMode, setWorkMode] = useState<'guided' | 'advanced'>('guided');
  const [startTarget, setStartTarget] = useState<'critical' | 'incoming' | 'cards' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [todayMin, setTodayMin] = useState(0);
  const [teamActivity, setTeamActivity] = useState<TeamActivity | null>(null);
  const [myPendingCount, setMyPendingCount] = useState(0);

  const avatarUrl = user?.avatar_url
    ? (/^https?:\/\//i.test(user.avatar_url) ? user.avatar_url : `${API_ORIGIN}${user.avatar_url.startsWith('/') ? '' : '/'}${user.avatar_url}`)
    : '';

  // Activity tracking
  useEffect(() => {
    startSession(activeStore?.id ?? null);
    const updateToday = () => {
      const s = getStats(1);
      setTodayMin(s.totalMinutes);
    };
    updateToday();
    const iv = setInterval(updateToday, 30_000);

    const handleUnload = () => flushActiveSession();
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') flushActiveSession();
      else startSession(activeStore?.id ?? null);
    };
    window.addEventListener('beforeunload', handleUnload);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(iv);
      window.removeEventListener('beforeunload', handleUnload);
      document.removeEventListener('visibilitychange', handleVisibility);
      flushActiveSession();
    };
  }, [activeStore]);

  // Close profile dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setShowProfile(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (activeStore) loadDashboard();
    else if (!activeStore && stores.length === 0) setLoading(false);
  }, [activeStore, stores.length]);

  // Reload dashboard when background sync completes
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (activeStore && detail?.storeId === activeStore.id) {
        loadDashboard();
      }
    };
    window.addEventListener('syncCompleted', handler);
    return () => window.removeEventListener('syncCompleted', handler);
  }, [activeStore]);

  const loadDashboard = async () => {
    if (!activeStore) return;
    setLoading(true);
    try {
      const [dashData, statsData] = await Promise.all([
        api.getStoreDashboard(activeStore.id),
        api.getStoreStats(activeStore.id),
      ]);
      setDashboard(dashData);
      setStats(statsData);
      // Load team activity for owners/managers
      if (hasAnyPermission('team.view', 'team.manage')) {
        try {
          const ta = await api.getTeamActivity(activeStore.id);
          setTeamActivity(ta);
        } catch {}
      }
      // Load manager's own pending approvals count
      if (!hasPermission('cards.approve')) {
        try {
          const approvalData = await api.getApprovals(activeStore.id, { status: 'pending', limit: 1 });
          setMyPendingCount(approvalData.total || 0);
        } catch {}
      }
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const canConnectStore = isRole('owner');

  if (!activeStore && !loading && stores.length === 0) {
    return (
      <div className="ws-empty-state">
        <LayoutGrid size={48} className="ws-empty-icon" />
        <h3>Нет подключённых магазинов</h3>
        <p>
          {canConnectStore
            ? 'Подключите магазин Wildberries, чтобы начать оптимизацию карточек'
            : 'Подключать магазин может только пользователь с ролью Owner'}
        </p>
        {canConnectStore && (
          <button className="ws-btn ws-btn-primary ws-btn-lg" onClick={() => navigate('/onboard')}>
            Подключить магазин
          </button>
        )}
        <button
          className="ws-btn ws-btn-lg"
          style={{ marginTop: canConnectStore ? 10 : 0, color: '#6b7280', background: 'none', border: '1px solid #e5e7eb' }}
          onClick={() => logout()}
        >
          Выйти из аккаунта
        </button>
      </div>
    );
  }

  if (loading || !dashboard) {
    return (
      <div className="ws-loading">
        <div className="ws-spinner" />
        <span>Загрузка рабочего пространства...</span>
      </div>
    );
  }

  const criticalCount = stats?.critical_issues || 0;
  const warningsCount = stats?.warnings_count || 0;

  const openModeModal = (target: 'critical' | 'incoming' | 'cards') => {
    trackAction();
    // Для критичных и входящих — сразу переходим без модалки
    if (target === 'critical') {
      navigate('/workspace/fix/critical');
      return;
    }
    if (target === 'incoming') {
      navigate('/workspace/incoming');
      return;
    }
    // Только для "По карточкам" показываем выбор режима
    setStartTarget(target);
    setWorkMode('guided');
    setModeModalOpen(true);
  };

  const startByMode = () => {
    if (!startTarget) return;
    if (workMode === 'guided') {
      navigate('/workspace/cards/queue');
    } else {
      navigate('/workspace/cards');
    }
    setModeModalOpen(false);
  };

  return (
    <div className="ws-root">
      {/* ═══════════ Header ═══════════ */}
      <header className="ws-header">
        <div className="ws-header-left">
          <div className="ws-logo">WB</div>

          {/* Store selector */}
          <div className="ws-store-selector" onClick={() => setShowStoreMenu(!showStoreMenu)}>
            <span className="ws-store-name">Магазин &quot;{activeStore?.name || '...'}&quot;</span>
            <ChevronDown size={16} />

            {showStoreMenu && (
              <div className="ws-store-dropdown" onClick={e => e.stopPropagation()}>
                {stores.map(s => (
                  <div
                    key={s.id}
                    className={`ws-store-item ${s.id === activeStore?.id ? 'ws-store-item--active' : ''}`}
                    onClick={() => { selectStore(s.id); setShowStoreMenu(false); }}
                  >
                    <span>{s.name}</span>
                    <span className="ws-store-meta">{s.total_cards} карточек</span>
                  </div>
                ))}
                {canConnectStore && (
                  <div
                    className="ws-store-add"
                    onClick={() => {
                      setShowStoreMenu(false);
                      navigate('/onboard');
                    }}
                  >
                    + Добавить магазин
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="ws-header-right">
          <div className="ws-header-time">
            <Clock size={14} />
            <span>Сегодня: {formatDuration(todayMin)}</span>
          </div>
          <button className="ws-header-btn ws-header-btn--text" title="Profile" onClick={() => navigate('/workspace/profile')}>
            <User size={16} />
            <span>Profile</span>
          </button>
          <button className="ws-header-btn" title="Настройки" onClick={() => setSettingsOpen(true)}>
            <Settings size={18} />
          </button>

          {/* Profile */}
          <div className="ws-profile" ref={profileRef}>
            <button
              className="ws-profile-trigger"
              onClick={() => setShowProfile(!showProfile)}
              title={user?.first_name || user?.email || 'Профиль'}
            >
              <div className="ws-profile-avatar">
                {avatarUrl ? <img src={avatarUrl} alt="avatar" className="ws-profile-avatar-img" /> : (user?.first_name ? user.first_name.charAt(0).toUpperCase() : <User size={16} />)}
              </div>
            </button>

            {showProfile && user && (
              <div className="ws-profile-dropdown">
                {/* User info */}
                <div className="ws-profile-info">
                  <div className="ws-profile-avatar-lg">
                    {avatarUrl ? <img src={avatarUrl} alt="avatar" className="ws-profile-avatar-img" /> : (user.first_name ? user.first_name.charAt(0).toUpperCase() : <User size={22} />)}
                  </div>
                  <div className="ws-profile-details">
                    <span className="ws-profile-name">
                      {user.first_name || 'Пользователь'} {user.last_name || ''}
                    </span>
                    <span className="ws-profile-email">{user.email}</span>
                  </div>
                </div>

                {/* Role badge */}
                <div className="ws-profile-role-section">
                  <span className="ws-profile-role-label">Роль</span>
                  <div className={`ws-profile-role-badge ws-profile-role--${user.role}`}>
                    {user.role === 'admin' || user.role === 'owner' ? <Crown size={14} /> :
                     user.role === 'head_manager' ? <Shield size={14} /> :
                     user.role === 'manager' ? <Briefcase size={14} /> :
                     user.role === 'viewer' ? <Eye size={14} /> :
                     <User size={14} />}
                    <span>{{
                      admin: 'Администратор',
                      owner: 'Владелец',
                      head_manager: 'Старший менеджер',
                      manager: 'Менеджер',
                      viewer: 'Наблюдатель',
                      user: 'Пользователь',
                    }[user.role] || user.role}</span>
                  </div>
                  {hasPermission('team.manage') && (
                    <button
                      className="ws-profile-role-manage"
                      onClick={() => { setShowProfile(false); navigate('/workspace/team'); }}
                      title="Управление ролями"
                    >
                      <Settings size={12} />
                    </button>
                  )}
                </div>

                {/* Permissions summary */}
                <div className="ws-profile-perms">
                  <span className="ws-profile-perms-label">Доступ</span>
                  <div className="ws-profile-perms-list">
                    {(user.permissions || []).includes('*') ? (
                      <span className="ws-profile-perm-tag ws-profile-perm--full">Полный доступ</span>
                    ) : (
                      <>
                        {hasPermission('cards.edit') && <span className="ws-profile-perm-tag">Карточки</span>}
                        {hasPermission('cards.approve') && <span className="ws-profile-perm-tag">Одобрение</span>}
                        {hasPermission('issues.fix') && <span className="ws-profile-perm-tag">Исправления</span>}
                        {hasPermission('photos.manage') && <span className="ws-profile-perm-tag">Фото</span>}
                        {hasPermission('team.manage') && <span className="ws-profile-perm-tag">Команда</span>}
                        {hasPermission('dashboard.view') && <span className="ws-profile-perm-tag">Дашборд</span>}
                      </>
                    )}
                  </div>
                </div>

                <div className="ws-profile-divider" />

                {/* Quick links */}
                <button className="ws-profile-action" onClick={() => { setShowProfile(false); navigate('/workspace/profile'); }}>
                  <User size={16} />
                  <span>Profile</span>
                </button>
                {hasAnyPermission('team.view', 'team.manage') && (
                  <button className="ws-profile-action" onClick={() => { setShowProfile(false); navigate('/workspace/staff'); }}>
                    <Users size={16} />
                    <span>Сотрудники</span>
                  </button>
                )}
                {hasAnyPermission('team.view', 'team.manage') && (
                  <button className="ws-profile-action" onClick={() => { setShowProfile(false); navigate('/workspace/team'); }}>
                    <Settings size={16} />
                    <span>Управление командой</span>
                  </button>
                )}
                <button className="ws-profile-action" onClick={() => { setShowProfile(false); setSettingsOpen(true); }}>
                  <Activity size={16} />
                  <span>Моя активность</span>
                </button>

                <div className="ws-profile-divider" />

                <button className="ws-profile-action ws-profile-action--danger" onClick={() => { setShowProfile(false); logout(); }}>
                  <LogOut size={16} />
                  <span>Выйти</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ═══════════ Content ═══════════ */}
      <main className="ws-main">
        {/* Section title */}
        <div className="ws-section-title">
          <ClipboardList size={22} />
          <h1>Ваши задачи на сегодня</h1>
        </div>
        <p className="ws-section-sub">Выберите категорию для начала работы</p>

        {/* ═══════════ Task Cards ═══════════ */}
        <div className="ws-tasks">
          {/* Critical */}
          <div className="ws-task-card ws-task-card--critical">
            <div className="ws-task-top">
              <div className="ws-task-icon ws-task-icon--critical">
                <Circle size={20} />
              </div>
              <div className="ws-task-nums">
                <div className="ws-task-num">
                  <span className="ws-task-val ws-task-val--critical">{dashboard.critical.issues_count}</span>
                  <span className="ws-task-label">проблем</span>
                </div>
                <div className="ws-task-num">
                  <span className="ws-task-val">{dashboard.critical.cards_count}</span>
                  <span className="ws-task-label">карточек</span>
                </div>
              </div>
            </div>
            <h3 className="ws-task-title">Критичные</h3>
            <p className="ws-task-desc">Блокируют показы или продажи</p>
            <button className="ws-btn ws-btn-danger" onClick={() => openModeModal('critical')}>
              Начать
            </button>
          </div>

          {/* Incoming */}
          <div className="ws-task-card ws-task-card--incoming">
            <div className="ws-task-top">
              <div className="ws-task-icon ws-task-icon--incoming">
                <CheckSquare size={20} />
              </div>
              <div className="ws-task-nums">
                <div className="ws-task-num">
                  <span className="ws-task-val ws-task-val--incoming">{dashboard.incoming.issues_count}</span>
                  <span className="ws-task-label">проблем</span>
                </div>
                <div className="ws-task-num">
                  <span className="ws-task-val">{dashboard.incoming.cards_count}</span>
                  <span className="ws-task-label">карточек</span>
                </div>
              </div>
            </div>
            <h3 className="ws-task-title">Входящие</h3>
            <p className="ws-task-desc">Новые задачи на проверку</p>
            <button className="ws-btn ws-btn-primary" onClick={() => openModeModal('incoming')}>
              Начать
            </button>
          </div>

          {/* By cards */}
          <div className="ws-task-card ws-task-card--cards">
            <div className="ws-task-top">
              <div className="ws-task-icon ws-task-icon--cards">
                <LayoutGrid size={20} />
              </div>
              <div className="ws-task-nums">
                <div className="ws-task-num">
                  <span className="ws-task-val">{dashboard.by_cards.cards_count}</span>
                  <span className="ws-task-label">карточек</span>
                </div>
              </div>
            </div>
            <h3 className="ws-task-title">По карточкам</h3>
            <p className="ws-task-desc">Улучшения для каждой карточки</p>
            <button className="ws-btn ws-btn-purple" onClick={() => openModeModal('cards')}>
              Начать
            </button>
          </div>
        </div>

        {/* ═══════════ Tools ═══════════ */}
        <div className="ws-tools-label">ИНСТРУМЕНТЫ</div>
        <div className="ws-tools">
          <div className="ws-tool" onClick={() => navigate('/ab-tests')}>
            <div className="ws-tool-icon">
              <FlaskConical size={20} />
            </div>
            <div className="ws-tool-body">
              <div className="ws-tool-row">
                <span className="ws-tool-name">A/B тесты</span>
                {dashboard.active_tests > 0 && (
                  <span className="ws-tool-badge">{dashboard.active_tests} активных</span>
                )}
              </div>
              <span className="ws-tool-desc">Эксперименты с контентом</span>
            </div>
            <ChevronRight size={18} className="ws-tool-arrow" />
          </div>

          <div className="ws-tool" onClick={() => navigate('/photo-studio')}>
            <div className="ws-tool-icon">
              <Camera size={20} />
            </div>
            <div className="ws-tool-body">
              <span className="ws-tool-name">Фотостудия</span>
              <span className="ws-tool-desc">Генерация и улучшение фото</span>
            </div>
            <ChevronRight size={18} className="ws-tool-arrow" />
          </div>

          <div className="ws-tool">
            <div className="ws-tool-icon">
              <MessageCircle size={20} />
            </div>
            <div className="ws-tool-body">
              <div className="ws-tool-row">
                <span className="ws-tool-name">Отзывы и вопросы</span>
                <span className="ws-tool-badge">{Math.max(warningsCount, 4)} новых</span>
              </div>
              <span className="ws-tool-desc">Работа с обратной связью</span>
            </div>
            <ChevronRight size={18} className="ws-tool-arrow" />
          </div>

          {hasAnyPermission('team.view', 'team.manage') && (
            <div className="ws-tool" onClick={() => navigate('/workspace/staff')}>
              <div className="ws-tool-icon" style={{ background: 'rgba(99,102,241,.12)' }}>
                <Activity size={20} style={{ color: '#6366f1' }} />
              </div>
              <div className="ws-tool-body">
                <span className="ws-tool-name">Сотрудники</span>
                <span className="ws-tool-desc">Активность команды и прогресс магазина</span>
              </div>
              <ChevronRight size={18} className="ws-tool-arrow" />
            </div>
          )}

          {hasAnyPermission('team.view', 'team.manage') && (
            <div className="ws-tool" onClick={() => navigate('/workspace/team')}>
              <div className="ws-tool-icon">
                <Users size={20} />
              </div>
              <div className="ws-tool-body">
                <span className="ws-tool-name">Команда</span>
                <span className="ws-tool-desc">Управление ролями и сотрудниками</span>
              </div>
              <ChevronRight size={18} className="ws-tool-arrow" />
            </div>
          )}

          <div className="ws-tool" onClick={() => navigate('/workspace/fixed-file')}>
            <div className="ws-tool-icon" style={{ background: 'rgba(5,150,105,.12)' }}>
              <FileCheck size={20} style={{ color: '#059669' }} />
            </div>
            <div className="ws-tool-body">
              <span className="ws-tool-name">Эталонные значения</span>
              <span className="ws-tool-desc">Excel-файл с правильными составами, сертификатами и декларациями</span>
            </div>
            <ChevronRight size={18} className="ws-tool-arrow" />
          </div>

          <div className="ws-tool" onClick={() => navigate('/workspace/approvals')}>
            <div className="ws-tool-icon">
              <ClipboardCheck size={20} />
            </div>
            <div className="ws-tool-body">
              <div className="ws-tool-row">
                <span className="ws-tool-name">Проверка карточек</span>
                {myPendingCount > 0 && (
                  <span className="ws-tool-badge" style={{ background: '#fef3c7', color: '#d97706' }}>{myPendingCount} на проверке</span>
                )}
              </div>
              <span className="ws-tool-desc">
                {hasPermission('cards.approve')
                  ? 'Одобрение и отклонение подготовленных карточек'
                  : myPendingCount > 0
                    ? `${myPendingCount} карт. ожидают проверки старшего менеджера`
                    : 'Статус отправленных карточек'}
              </span>
            </div>
            <ChevronRight size={18} className="ws-tool-arrow" />
          </div>
        </div>

        {/* ═══════════ Team Activity Widget ═══════════ */}
        {teamActivity && hasAnyPermission('team.view', 'team.manage') && (
          <div className="ws-team-activity">
            <div className="ws-team-activity-header">
              <div className="ws-team-activity-title">
                <Users size={18} />
                <h3>Команда</h3>
                <span className="ws-team-activity-count">
                  {teamActivity.members.filter(m => m.is_online).length} онлайн / {teamActivity.total_members}
                </span>
              </div>
              <button className="ws-team-activity-link" onClick={() => navigate('/workspace/team')}>
                Управление <ChevronRight size={14} />
              </button>
            </div>

            <div className="ws-team-summary">
              <div className="ws-team-summary-card">
                <Wrench size={16} className="ws-tsc-icon--blue" />
                <div>
                  <div className="ws-tsc-val">{Object.values(teamActivity.issues_summary).reduce((a, b) => a + b, 0)}</div>
                  <div className="ws-tsc-label">Всего проблем</div>
                </div>
              </div>
              <div className="ws-team-summary-card">
                <CheckCircle2 size={16} className="ws-tsc-icon--green" />
                <div>
                  <div className="ws-tsc-val">{teamActivity.issues_summary.fixed || 0}</div>
                  <div className="ws-tsc-label">Исправлено</div>
                </div>
              </div>
              <div className="ws-team-summary-card">
                <Clock size={16} className="ws-tsc-icon--orange" />
                <div>
                  <div className="ws-tsc-val">{teamActivity.pending_approvals}</div>
                  <div className="ws-tsc-label">На проверке</div>
                </div>
              </div>
              <div className="ws-team-summary-card">
                <Zap size={16} className="ws-tsc-icon--purple" />
                <div>
                  <div className="ws-tsc-val">{teamActivity.members.filter(m => m.is_online).length}</div>
                  <div className="ws-tsc-label">Онлайн сейчас</div>
                </div>
              </div>
            </div>

            <div className="ws-team-members-list">
              {teamActivity.members.map((m, idx) => {
                const roleLabel = m.role === 'owner' ? 'Владелец' : m.role === 'head_manager' ? 'Ст. менеджер' : m.role === 'manager' ? 'Менеджер' : m.role === 'viewer' ? 'Наблюдатель' : 'Пользователь';
                const lastSeen = m.last_active_at || m.last_login;
                const lastSeenLabel = (() => {
                  if (!lastSeen) return 'Не заходил';
                  const diff = Math.floor((Date.now() - new Date(lastSeen).getTime()) / 1000);
                  if (diff < 120) return 'только что';
                  if (diff < 3600) return `${Math.floor(diff / 60)} мин. назад`;
                  if (diff < 86400) return `${Math.floor(diff / 3600)} ч. назад`;
                  return `${Math.floor(diff / 86400)} д. назад`;
                })();
                return (
                  <div key={m.id} className="ws-team-member-row">
                    <div className="ws-team-member-rank">{idx + 1}</div>
                    <div className="ws-team-member-avatar">
                      {(m.name || '?')[0].toUpperCase()}
                      <span className={`ws-team-online-dot ${m.is_online ? 'ws-team-online-dot--on' : 'ws-team-online-dot--off'}`} />
                    </div>
                    <div className="ws-team-member-info">
                      <div className="ws-team-member-name">{m.name}</div>
                      <div className="ws-team-member-role">
                        {roleLabel}
                        <span className={`ws-team-status-badge ${m.is_online ? 'ws-team-status-badge--on' : 'ws-team-status-badge--off'}`}>
                          {m.is_online ? '● онлайн' : `● ${lastSeenLabel}`}
                        </span>
                      </div>
                    </div>
                    <div className="ws-team-member-stats">
                      <div className="ws-team-member-stat">
                        <span className="ws-tms-val">{m.fixes_week}</span>
                        <span className="ws-tms-label">за неделю</span>
                      </div>
                      <div className="ws-team-member-stat">
                        <span className={`ws-tms-val ${m.fixes_today > 0 ? 'ws-tms-val--today' : ''}`}>{m.fixes_today}</span>
                        <span className="ws-tms-label">сегодня</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {teamActivity.members.length === 0 && (
                <div className="ws-team-empty">Нет данных об активности</div>
              )}
            </div>
          </div>
        )}

        {/* ═══════════ Bottom Stats ═══════════ */}
        <div className="ws-stats">
          {/* Growth potential */}
          <div className="ws-stat-card">
            <div className="ws-stat-head">
              <TrendingUp size={18} className="ws-stat-icon--green" />
              <span>Потенциал роста</span>
            </div>
            <div className="ws-stat-big">{dashboard.potential_revenue}</div>
            <div className="ws-stat-row">
              <div className="ws-stat-item">
                <CheckCircle2 size={14} className="ws-stat-dot--green" />
                <span>Исправлено сегодня</span>
              </div>
              <span className="ws-stat-val">{dashboard.fixed_today}</span>
            </div>
            <div className="ws-stat-row">
              <div className="ws-stat-item">
                <TrendingUp size={14} className="ws-stat-dot--blue" />
                <span>Активных A/B тестов</span>
              </div>
              <span className="ws-stat-val">{dashboard.active_tests}</span>
            </div>
          </div>

          {/* Recent activity */}
          <div className="ws-stat-card">
            <div className="ws-stat-head">
              <Activity size={18} className="ws-stat-icon--purple" />
              <span>Недавняя активность</span>
            </div>
            <div className="ws-activity-list">
              <div className="ws-activity-item">
                <AlertTriangle size={14} className="ws-act-red" />
                <span>Новых критических ошибок: {criticalCount}</span>
              </div>
              <div className="ws-activity-item">
                <CheckCircle2 size={14} className="ws-act-green" />
                <span>Исправлено {dashboard.fixed_today} карточек сегодня</span>
              </div>
              <div className="ws-activity-item">
                <Info size={14} className="ws-act-blue" />
                <span>A/B тест завершён (+12% CTR)</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {modeModalOpen ? (
        <div className="ws-mode-overlay" onClick={() => setModeModalOpen(false)}>
          <div className="ws-mode-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ws-mode-head">
              <div>
                <h3>Выберите режим работы</h3>
                <p>Как вам удобнее прорабатывать карточки товаров</p>
              </div>
              <button type="button" className="ws-mode-close" onClick={() => setModeModalOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <button
              className={`ws-mode-option ${workMode === 'guided' ? 'active' : ''}`}
              onClick={() => setWorkMode('guided')}
            >
              <div className="ws-mode-icon">
                <Sparkles size={18} />
              </div>
              <div className="ws-mode-body">
                <div className="ws-mode-title">
                  <span>Пошаговый режим</span>
                  <span className="ws-mode-tag">Рекомендуется</span>
                </div>
                <div className="ws-mode-desc">
                  Система проведёт вас по карточкам в оптимальном порядке.
                </div>
                <div className="ws-mode-features">
                  <span>Поэтапно</span>
                  <span>Без лишних решений</span>
                  <span>Фокус на результате</span>
                </div>
              </div>
              {workMode === 'guided' ? <Check size={16} className="ws-mode-check" /> : null}
            </button>

            <button
              className={`ws-mode-option ${workMode === 'advanced' ? 'active' : ''}`}
              onClick={() => setWorkMode('advanced')}
            >
              <div className="ws-mode-icon ws-mode-icon--advanced">
                <SlidersHorizontal size={18} />
              </div>
              <div className="ws-mode-body">
                <div className="ws-mode-title">
                  <span>Расширенный режим</span>
                </div>
                <div className="ws-mode-desc">
                  Полный контроль: все карточки, навигация, ручной выбор действий.
                </div>
                <div className="ws-mode-features">
                  <span>Все проблемы</span>
                  <span>Навигация</span>
                  <span>Ручной ввод</span>
                </div>
              </div>
              {workMode === 'advanced' ? <Check size={16} className="ws-mode-check" /> : null}
            </button>

            <div className="ws-mode-actions">
              <button className="btn btn-ghost" onClick={() => setModeModalOpen(false)}>Отмена</button>
              <button className="btn btn-primary" onClick={startByMode}>Начать работу</button>
            </div>
            <div className="ws-mode-note">Вы сможете изменить режим позже</div>
          </div>
        </div>
      ) : null}

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
