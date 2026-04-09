import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import api, { API_ORIGIN } from '../api/client';
import type { WorkspaceDashboard, StoreStats, TeamActivity } from '../types';
import { useWorkTracker, formatDuration } from '../hooks/useWorkTracker';
import SettingsPanel from './SettingsPanel';
import {
  ClipboardList, Circle, CheckSquare, LayoutGrid, FlaskConical, Camera,
  MessageCircle, TrendingUp, Activity, ChevronDown, Settings, Clock,
  ChevronRight, AlertTriangle, CheckCircle2, Info, SlidersHorizontal,
  Sparkles, X, Check, Users, ClipboardCheck, Shield, LogOut, User,
  Crown, Briefcase, Eye, Wrench, Zap, FileCheck, KeyRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getStoreFeatureMessage, isStoreFeatureAllowed, type StoreFeatureKey } from '../lib/storeAccess';
import StoreKeyUpdateDialog from '../components/StoreKeyUpdateDialog';

export default function WorkspacePage() {
  const navigate = useNavigate();
  const { activeStore, stores, selectStore } = useStore();
  const { user, logout, hasPermission, hasAnyPermission, isRole } = useAuth();
  const [dashboard, setDashboard] = useState<WorkspaceDashboard | null>(null);
  const [stats, setStats] = useState<StoreStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showStoreMenu, setShowStoreMenu] = useState(false);
  const [modeModalOpen, setModeModalOpen] = useState(false);
  const [workMode, setWorkMode] = useState<'guided' | 'advanced'>('guided');
  const [startTarget, setStartTarget] = useState<'critical' | 'incoming' | 'cards' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [keyDialogFeature, setKeyDialogFeature] = useState<StoreFeatureKey | null>(null);
  const { todayStats, isActive, currentSessionTimeMs, logAction: doLogAction } = useWorkTracker();
  const [teamActivity, setTeamActivity] = useState<TeamActivity | null>(null);
  const [myPendingCount, setMyPendingCount] = useState(0);
  const [hasFixedFile, setHasFixedFile] = useState<boolean | null>(null);

  const avatarUrl = user?.avatar_url
    ? (/^https?:\/\//i.test(user.avatar_url) ? user.avatar_url : `${API_ORIGIN}${user.avatar_url.startsWith('/') ? '' : '/'}${user.avatar_url}`)
    : '';

  // Activity tracking removed — useWorkTracker handles sessions automatically

  useEffect(() => {
    if (activeStore) loadDashboard();
    else if (!activeStore && stores.length === 0) setLoading(false);
  }, [activeStore, stores.length]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (activeStore && detail?.storeId === activeStore.id) loadDashboard();
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
      if (hasAnyPermission('team.view', 'team.manage')) {
        try { setTeamActivity(await api.getTeamActivity(activeStore.id)); } catch {}
      }
      if (isRole('admin', 'owner', 'head_manager')) {
        try {
          const fs = await api.getFixedFileStatus(activeStore.id);
          setHasFixedFile(fs.has_fixed_file);
        } catch { setHasFixedFile(null); }
      }
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
  const canManageStoreKey = isRole('owner', 'admin');

  if (!activeStore && !loading && stores.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-center px-10">
        <LayoutGrid size={48} className="text-muted-foreground" />
        <h3 className="text-xl font-bold text-foreground">Нет подключённых магазинов</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          {canConnectStore
            ? 'Подключите магазин Wildberries, чтобы начать оптимизацию карточек'
            : 'Подключать магазин может только пользователь с ролью Owner'}
        </p>
        {canConnectStore && (
          <Button size="lg" onClick={() => navigate('/onboard')}>Подключить магазин</Button>
        )}
        <Button variant="outline" size="lg" onClick={() => logout()}>Выйти из аккаунта</Button>
      </div>
    );
  }

  if (loading || !dashboard) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3 text-muted-foreground">
        <div className="w-8 h-8 border-3 border-border border-t-primary rounded-full animate-spin" />
        <span className="text-sm">Загрузка рабочего пространства...</span>
      </div>
    );
  }

  const criticalCount = stats?.critical_issues || 0;
  const warningsCount = stats?.warnings_count || 0;

  const handleBlockedFeature = (featureKey: StoreFeatureKey) => {
    toast.error(getStoreFeatureMessage(activeStore, featureKey));
    if (canManageStoreKey) {
      setKeyDialogFeature(featureKey);
      setKeyDialogOpen(true);
    }
  };

  const openFeature = (path: string, featureKey?: StoreFeatureKey) => {
    if (featureKey && !isStoreFeatureAllowed(activeStore, featureKey)) {
      handleBlockedFeature(featureKey);
      return;
    }
    navigate(path);
  };

  const openModeModal = (target: 'critical' | 'incoming' | 'cards') => {
    if (!isStoreFeatureAllowed(activeStore, 'cards')) {
      handleBlockedFeature('cards');
      return;
    }
    doLogAction('card_opened', `Открыт раздел: ${target}`);
    if (target === 'critical') { navigate('/workspace/fix/critical'); return; }
    if (target === 'incoming') { navigate('/workspace/incoming'); return; }
    setStartTarget(target);
    setWorkMode('guided');
    setModeModalOpen(true);
  };

  const startByMode = () => {
    if (!startTarget) return;
    navigate(workMode === 'guided' ? '/workspace/cards/queue' : '/workspace/cards');
    setModeModalOpen(false);
  };

  const roleLabels: Record<string, string> = {
    admin: 'Администратор', owner: 'Владелец', head_manager: 'Старший менеджер',
    manager: 'Менеджер', viewer: 'Наблюдатель', user: 'Пользователь',
  };

  const roleIcons: Record<string, React.ReactNode> = {
    admin: <Crown size={14} />, owner: <Crown size={14} />,
    head_manager: <Shield size={14} />, manager: <Briefcase size={14} />,
    viewer: <Eye size={14} />,
  };

  return (
    <div className="min-h-screen bg-background">
      {/* ═══════════ Header ═══════════ */}
      <header className="h-14 flex items-center justify-between px-6 bg-card border-b border-border sticky top-0 z-50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-primary to-primary/80 text-primary-foreground font-extrabold text-sm flex items-center justify-center">
            WB
          </div>

          {/* Store selector */}
          <DropdownMenu open={showStoreMenu} onOpenChange={setShowStoreMenu}>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground px-2 py-1 rounded-lg hover:bg-muted transition-colors">
                Магазин &quot;{activeStore?.name || '...'}&quot;
                <ChevronDown size={16} className="text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[240px]">
              {stores.map(s => (
                <DropdownMenuItem
                  key={s.id}
                  className={s.id === activeStore?.id ? 'bg-primary/10 font-semibold' : ''}
                  onClick={() => { selectStore(s.id); setShowStoreMenu(false); }}
                >
                  <div>
                    <span>{s.name}</span>
                    <span className="block text-xs text-muted-foreground font-normal mt-0.5">{s.total_cards} карточек</span>
                  </div>
                </DropdownMenuItem>
              ))}
              {(canManageStoreKey || canConnectStore) && (
                <>
                  <DropdownMenuSeparator />
                  {activeStore && canManageStoreKey && (
                    <DropdownMenuItem onClick={() => setKeyDialogOpen(true)} className="gap-2">
                      <KeyRound size={14} />
                      Настройки WB-ключей
                    </DropdownMenuItem>
                  )}
                  {canConnectStore && (
                    <DropdownMenuItem onClick={() => navigate('/onboard')} className="text-primary font-medium">
                      + Добавить магазин
                    </DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-3">
          <button
            className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-full border border-border hover:border-muted-foreground/40 transition-colors cursor-pointer"
            onClick={() => setSettingsOpen(true)}
            title="Моя активность"
          >
            {isActive ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
                {formatDuration(currentSessionTimeMs)}
              </>
            ) : (
              <>
                <Clock size={14} />
                Сегодня: {formatDuration(todayStats.totalTimeMs)}
              </>
            )}
          </button>



          {/* Profile dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="relative rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar className="h-9 w-9 shadow-sm">
                  {avatarUrl && <AvatarImage src={avatarUrl} alt="avatar" />}
                  <AvatarFallback className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground font-bold text-sm">
                    {user?.first_name ? user.first_name.charAt(0).toUpperCase() : <User size={16} />}
                  </AvatarFallback>
                </Avatar>
                {hasFixedFile === false && isRole('admin', 'owner', 'head_manager') && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-zone-yellow opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-zone-yellow border-2 border-background" />
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[280px] p-1.5 rounded-xl">
              {user && (
                <>
                  {/* User card */}
                  <div className="flex items-center gap-3 px-3.5 py-3 mb-1">
                    <Avatar className="h-10 w-10 ring-2 ring-border">
                      {avatarUrl && <AvatarImage src={avatarUrl} alt="avatar" />}
                      <AvatarFallback className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground font-bold text-base">
                        {user.first_name ? user.first_name.charAt(0).toUpperCase() : <User size={18} />}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-foreground truncate">
                        {user.first_name || 'Пользователь'} {user.last_name || ''}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{user.email}</div>
                    </div>
                    <Badge variant="secondary" className="gap-1 text-[11px] h-6 flex-shrink-0">
                      {roleIcons[user.role] || <User size={12} />}
                      {roleLabels[user.role] || user.role}
                    </Badge>
                  </div>

                  <DropdownMenuSeparator className="mx-1.5" />

                  <DropdownMenuItem onClick={() => navigate('/workspace/profile')} className="gap-2.5 px-3.5 py-2.5 rounded-lg mx-0.5 cursor-pointer">
                    <User size={16} className="text-muted-foreground" /> Профиль
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSettingsOpen(true)} className="gap-2.5 px-3.5 py-2.5 rounded-lg mx-0.5 cursor-pointer">
                    <Activity size={16} className="text-muted-foreground" /> Моя активность
                  </DropdownMenuItem>
                  {hasAnyPermission('team.view', 'team.manage') && (
                    <DropdownMenuItem onClick={() => navigate('/management')} className="gap-2.5 px-3.5 py-2.5 rounded-lg mx-0.5 cursor-pointer">
                      <Users size={16} className="text-muted-foreground" /> Управление
                    </DropdownMenuItem>
                  )}
                  {isRole('admin', 'owner', 'head_manager') && (
                    <DropdownMenuItem onClick={() => navigate('/workspace/fixed-file')} className="gap-2.5 px-3.5 py-2.5 rounded-lg mx-0.5 cursor-pointer">
                      <FileCheck size={16} className={hasFixedFile === false ? 'text-zone-yellow' : 'text-muted-foreground'} />
                      <span className="flex-1">Эталонные значения</span>
                      {hasFixedFile === false && (
                        <Badge variant="outline" className="ml-auto text-[10px] h-5 px-1.5 border-zone-yellow/30 bg-zone-yellow/10 text-zone-yellow font-medium">
                          <AlertTriangle size={10} className="mr-1" />
                          Не загружен
                        </Badge>
                      )}
                    </DropdownMenuItem>
                  )}

                  <DropdownMenuSeparator className="mx-1.5" />

                  <DropdownMenuItem onClick={() => logout()} className="gap-2.5 px-3.5 py-2.5 rounded-lg mx-0.5 text-destructive focus:text-destructive cursor-pointer">
                    <LogOut size={16} /> Выйти
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* ═══════════ Content ═══════════ */}
      <main className="max-w-[1100px] mx-auto px-6 py-7">



        {/* ═══════════ Tasks ═══════════ */}
        <div className="flex items-center gap-2.5 mb-1.5">
          <ClipboardList size={22} className="text-foreground" />
          <h1 className="text-xl font-bold text-foreground">Ваши задачи на сегодня</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-6">Выберите категорию для начала работы</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <TaskCard
            borderHover="hover:border-destructive"
            iconBg="bg-destructive"
            icon={<Circle size={20} />}
            stats={[
              { value: dashboard.critical.issues_count, label: 'проблем', color: 'text-destructive' },
              { value: dashboard.critical.cards_count, label: 'карточек' },
            ]}
            title="Критичные"
            desc="Блокируют показы или продажи"
            btnVariant="destructive"
            onStart={() => openModeModal('critical')}
          />
          <TaskCard
            borderHover="hover:border-primary"
            iconBg="bg-primary"
            icon={<CheckSquare size={20} />}
            stats={[
              { value: dashboard.incoming.issues_count, label: 'проблем', color: 'text-primary' },
              { value: dashboard.incoming.cards_count, label: 'карточек' },
            ]}
            title="Входящие"
            desc="Новые задачи на проверку"
            btnVariant="default"
            onStart={() => openModeModal('incoming')}
          />
          <TaskCard
            borderHover="hover:border-[#8b5cf6]"
            iconBg="bg-[#8b5cf6]"
            icon={<LayoutGrid size={20} />}
            stats={[
              { value: dashboard.by_cards.cards_count, label: 'карточек' },
            ]}
            title="По карточкам"
            desc="Улучшения для каждой карточки"
            btnVariant="default"
            btnClassName="bg-gradient-to-r from-[#8b5cf6] to-[#7c3aed] hover:shadow-lg"
            onStart={() => openModeModal('cards')}
          />
        </div>

        {/* ═══════════ Tools ═══════════ */}
        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          ИНСТРУМЕНТЫ
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-7">
          <ToolItem icon={<FlaskConical size={20} />} name="A/B тесты" desc="Эксперименты с контентом"
            badge={dashboard.active_tests > 0 ? `${dashboard.active_tests} активных` : undefined}
            storeFeature="ab_tests"
            onClick={() => openFeature('/ab-tests', 'ab_tests')} />
          <ToolItem icon={<Camera size={20} />} name="Фотостудия" desc="Генерация и улучшение фото"
            storeFeature="photo_studio"
            onClick={() => openFeature('/photo-studio', 'photo_studio')} />
          <ToolItem icon={<MessageCircle size={20} />} name="Отзывы и вопросы" desc="Работа с обратной связью"
            badge={`${Math.max(warningsCount, 4)} новых`} />
          <ToolItem icon={<TrendingUp size={20} />} name="Анализ рекламы" desc="Оценка эффективности РК"
            storeFeature="ad_analysis"
            onClick={() => openFeature('/workspace/ad-analysis', 'ad_analysis')} />
        </div>

        {/* ═══════════ Team Summary (compact) ═══════════ */}
        {teamActivity && hasAnyPermission('team.view', 'team.manage') && (
          <div
            className="flex items-center gap-3 bg-card border border-border rounded-xl px-5 py-3.5 cursor-pointer transition-all hover:shadow-sm hover:border-muted-foreground/30"
            onClick={() => navigate('/management')}
          >
            <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
              <Users size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-semibold text-foreground">Команда</span>
              <span className="text-[13px] text-muted-foreground ml-2">
                {teamActivity.members.filter(m => m.is_online).length} онлайн из {teamActivity.total_members}
                {' · '}
                {teamActivity.issues_summary.fixed || 0} исправлений сегодня
                {teamActivity.pending_approvals > 0 && ` · ${teamActivity.pending_approvals} на проверке`}
              </span>
            </div>
            <Button variant="ghost" size="sm" className="gap-1 text-xs flex-shrink-0">
              Подробнее <ChevronRight size={14} />
            </Button>
          </div>
        )}
      </main>

      {/* ═══════════ Mode Modal ═══════════ */}
      <Dialog open={modeModalOpen} onOpenChange={setModeModalOpen}>
        <DialogContent className="max-w-[580px] p-6">
          <DialogHeader>
            <DialogTitle className="text-xl">Выберите режим работы</DialogTitle>
            <DialogDescription>Как вам удобнее прорабатывать карточки товаров</DialogDescription>
          </DialogHeader>

          <div className="space-y-2.5 mt-2">
            <button
              className={`w-full flex items-start gap-3 p-4 rounded-xl border transition-all text-left ${
                workMode === 'guided'
                  ? 'border-primary shadow-[0_0_0_2px] shadow-primary/20 bg-primary/5'
                  : 'border-border hover:border-muted-foreground/40'
              }`}
              onClick={() => setWorkMode('guided')}
            >
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                <Sparkles size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 font-semibold text-[15px]">
                  Пошаговый режим
                  <Badge className="text-[10px] h-5">Рекомендуется</Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Система проведёт вас по карточкам в оптимальном порядке.
                </p>
                <div className="flex gap-2 mt-2.5">
                  {['Поэтапно', 'Без лишних решений', 'Фокус на результате'].map(f => (
                    <span key={f} className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded">{f}</span>
                  ))}
                </div>
              </div>
              {workMode === 'guided' && <Check size={16} className="text-primary mt-1 flex-shrink-0" />}
            </button>

            <button
              className={`w-full flex items-start gap-3 p-4 rounded-xl border transition-all text-left ${
                workMode === 'advanced'
                  ? 'border-primary shadow-[0_0_0_2px] shadow-primary/20 bg-primary/5'
                  : 'border-border hover:border-muted-foreground/40'
              }`}
              onClick={() => setWorkMode('advanced')}
            >
              <div className="w-10 h-10 rounded-xl bg-muted text-muted-foreground flex items-center justify-center flex-shrink-0">
                <SlidersHorizontal size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[15px]">Расширенный режим</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Полный контроль: все карточки, навигация, ручной выбор действий.
                </p>
                <div className="flex gap-2 mt-2.5">
                  {['Все проблемы', 'Навигация', 'Ручной ввод'].map(f => (
                    <span key={f} className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded">{f}</span>
                  ))}
                </div>
              </div>
              {workMode === 'advanced' && <Check size={16} className="text-primary mt-1 flex-shrink-0" />}
            </button>
          </div>

          <DialogFooter className="mt-4 gap-2">
            <Button variant="ghost" onClick={() => setModeModalOpen(false)}>Отмена</Button>
            <Button onClick={startByMode}>Начать работу</Button>
          </DialogFooter>
          <p className="text-center text-xs text-muted-foreground mt-1">Вы сможете изменить режим позже</p>
        </DialogContent>
      </Dialog>

      <StoreKeyUpdateDialog
        open={keyDialogOpen}
        onOpenChange={(open) => {
          setKeyDialogOpen(open);
          if (!open) setKeyDialogFeature(null);
        }}
        store={activeStore}
        featureKey={keyDialogFeature}
      />

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

/* ── Sub-components ── */

function TaskCard({ borderHover, iconBg, icon, stats, title, desc, btnVariant, btnClassName, onStart }: {
  borderHover: string;
  iconBg: string;
  icon: React.ReactNode;
  stats: Array<{ value: number; label: string; color?: string }>;
  title: string;
  desc: string;
  btnVariant: 'default' | 'destructive';
  btnClassName?: string;
  onStart: () => void;
}) {
  return (
    <div className={`bg-card border border-border rounded-xl p-5 flex flex-col transition-all hover:shadow-md ${borderHover}`}>
      <div className="flex items-start justify-between mb-3.5">
        <div className={`w-10 h-10 rounded-xl ${iconBg} text-white flex items-center justify-center`}>
          {icon}
        </div>
        <div className="flex gap-4">
          {stats.map((s, i) => (
            <div key={i} className="text-right">
              <span className={`block text-xl font-bold leading-tight ${s.color || 'text-foreground'}`}>{s.value}</span>
              <span className="text-[11px] text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </div>
      </div>
      <h3 className="text-base font-semibold mb-1">{title}</h3>
      <p className="text-[13px] text-muted-foreground mb-4 flex-1">{desc}</p>
      <Button variant={btnVariant} className={`w-full ${btnClassName || ''}`} onClick={onStart}>
        Начать
      </Button>
    </div>
  );
}

function ToolItem({ icon, iconClassName, name, desc, badge, badgeClassName, onClick, storeFeature }: {
  icon: React.ReactNode;
  iconClassName?: string;
  name: string;
  desc: string;
  badge?: string;
  badgeClassName?: string;
  onClick?: () => void;
  storeFeature?: StoreFeatureKey;
}) {
  const { activeStore } = useStore();
  const blocked = storeFeature ? !isStoreFeatureAllowed(activeStore, storeFeature) : false;
  const deniedMessage = storeFeature ? getStoreFeatureMessage(activeStore, storeFeature) : '';

  return (
    <div
      className={`flex items-center gap-3.5 bg-card border border-border rounded-xl px-5 py-4 cursor-pointer transition-all hover:shadow-sm hover:border-muted-foreground/30 ${blocked ? 'opacity-70' : ''}`}
      onClick={onClick}
      title={blocked ? deniedMessage : undefined}
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${iconClassName || 'bg-muted text-muted-foreground'}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{name}</span>
          {badge && (
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg ${badgeClassName || 'bg-primary/10 text-primary'}`}>
              {badge}
            </span>
          )}
          {blocked && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-amber-100 text-amber-800">
              Нет доступа
            </span>
          )}
        </div>
        <span className="text-[13px] text-muted-foreground mt-0.5 block truncate">{desc}</span>
      </div>
      <ChevronRight size={18} className="text-muted-foreground/50 flex-shrink-0" />
    </div>
  );
}
