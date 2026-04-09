import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import api from '../api/client';
import {
  Clock, BarChart3, Users, RefreshCw, ChevronDown, ChevronRight,
  Search, Filter, ArrowUpDown, Wrench, Eye, SkipForward, Pause,
  FileEdit, CheckCircle2, MousePointerClick,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Cell, Tooltip,
} from 'recharts';

/* ─── Types ─────────────────────────────────────────── */

interface ActionEntry {
  id: string;
  type: string;
  label: string;
  timestamp: string;
  meta?: { nmId?: number; field?: string; oldValue?: string; newValue?: string };
}

interface SessionEntry {
  id: string;
  startedAt: string;
  endedAt: string | null;
  activeTimeMs: number;
  actions: ActionEntry[];
}

interface MemberWorkDay {
  date: string;
  minutes: number;
  sessions: number;
  fixes: number;
}

interface MemberWorkStats {
  id: number;
  name: string;
  email: string;
  role: string;
  is_online: boolean;
  today_minutes: number;
  week_minutes: number;
  month_minutes: number;
  fixes_today: number;
  fixes_week: number;
  actions_today: number;
  work_start_today: string | null;
  work_end_today: string | null;
  daily_breakdown: MemberWorkDay[];
  sessions: SessionEntry[];
}

interface TeamWorkData {
  members: MemberWorkStats[];
  total_today_minutes: number;
  total_week_minutes: number;
  team_daily: MemberWorkDay[];
}

/* ─── Constants ─────────────────────────────────────── */

const ROLE_LABELS: Record<string, string> = {
  owner: 'Владелец',
  head_manager: 'Ст. менеджер',
  manager: 'Менеджер',
  viewer: 'Наблюдатель',
  user: 'Пользователь',
};

const ACTION_ICONS: Record<string, React.ReactNode> = {
  problem_resolved: <CheckCircle2 size={12} className="text-green-500" />,
  problem_skipped: <SkipForward size={12} className="text-muted-foreground" />,
  problem_deferred: <Pause size={12} className="text-amber-500" />,
  field_edited: <FileEdit size={12} className="text-blue-400" />,
  section_confirmed: <CheckCircle2 size={12} className="text-primary" />,
  card_opened: <Eye size={12} className="text-muted-foreground" />,
};

const SORT_OPTIONS = [
  { value: 'time_desc', label: 'По времени ↓' },
  { value: 'time_asc', label: 'По времени ↑' },
  { value: 'fixes_desc', label: 'По исправлениям ↓' },
  { value: 'name_asc', label: 'По имени А-Я' },
];

/* ─── Utils ─────────────────────────────────────────── */

function formatWorkTime(minutes: number): string {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}ч ${m}м`;
  return `${m} мин`;
}

function formatDurationMs(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return '<1 мин';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}ч ${m}м`;
  return `${m} мин`;
}

function formatTimeShort(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
}

function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

const MONTHS_SHORT = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июня', 'июля', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];

function formatSessionDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/* ─── Session Card (per employee) ───────────────────── */

function SessionCard({ session }: { session: SessionEntry }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const visibleActions = session.actions.filter(a => a.type !== 'session_started' && a.type !== 'session_ended');

  const handleActionClick = (nmId: number) => {
    navigate(`/workspace/cards/${nmId}`);
  };

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button className="w-full flex items-center gap-3 px-3 py-2 text-left" onClick={() => setExpanded(!expanded)}>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-foreground">
            {formatTimeShort(session.startedAt)} — {session.endedAt ? formatTimeShort(session.endedAt) : 'сейчас'}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
            <span className="inline-flex items-center gap-0.5"><Clock size={10} /> {formatDurationMs(session.activeTimeMs)}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-0.5"><MousePointerClick size={10} /> {visibleActions.length} {plural(visibleActions.length, 'действие', 'действия', 'действий')}</span>
          </div>
        </div>
        {visibleActions.length > 0 && (
          expanded ? <ChevronDown size={14} className="text-muted-foreground/40" /> : <ChevronRight size={14} className="text-muted-foreground/40" />
        )}
      </button>
      {expanded && visibleActions.length > 0 && (
        <div className="border-t border-border px-3 py-2 space-y-1 bg-muted/30 max-h-[200px] overflow-y-auto">
          {visibleActions.map(action => {
            const nmId = action.meta?.nmId;
            const isClickable = !!nmId;
            return (
              <div
                key={action.id}
                className={`flex items-start gap-2 text-[11px] py-0.5 ${isClickable ? 'cursor-pointer hover:text-primary transition-colors group' : ''}`}
                onClick={isClickable ? () => handleActionClick(nmId!) : undefined}
              >
                <span className="text-muted-foreground w-9 flex-shrink-0 font-mono">{formatTimeShort(action.timestamp)}</span>
                <span className="flex-shrink-0 mt-0.5">{ACTION_ICONS[action.type] || <Wrench size={12} className="text-muted-foreground" />}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-foreground truncate block">{action.label}</span>
                  {action.meta?.oldValue != null && action.meta?.newValue != null && (
                    <div className="mt-0.5 text-[10px]">
                      <span className="text-red-400 line-through">{action.meta.oldValue || '(пусто)'}</span>
                      <span className="text-muted-foreground mx-1">→</span>
                      <span className="text-green-400">{action.meta.newValue}</span>
                    </div>
                  )}
                </div>
                {nmId && (
                  <span className="inline-flex items-center gap-0.5 flex-shrink-0">
                    <span className="text-[10px] px-1.5 py-0 h-4 rounded bg-secondary text-secondary-foreground font-mono group-hover:bg-primary/10 group-hover:text-primary transition-colors inline-flex items-center">
                      {nmId}
                    </span>
                    <ChevronRight size={10} className="text-muted-foreground/50" />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Member Row ────────────────────────────────────── */

function MemberRow({ member, expanded, onToggle }: {
  member: MemberWorkStats;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [showAllSessions, setShowAllSessions] = useState(false);
  const todaySessions = member.sessions.filter(s => {
    const d = new Date(s.startedAt);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  });
  const olderSessions = member.sessions.filter(s => !todaySessions.includes(s));
  const visibleOlder = showAllSessions ? olderSessions : olderSessions.slice(0, 3);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden transition-colors hover:border-muted-foreground/30">
      <button className="w-full flex items-center gap-3 px-4 py-3 text-left" onClick={onToggle}>
        <div className="relative flex-shrink-0">
          <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-foreground">
            {member.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          {member.is_online && (
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-card" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground truncate">{member.name}</div>
          <div className="text-[11px] text-muted-foreground">{ROLE_LABELS[member.role] || member.role}</div>
        </div>

        <div className="text-right flex-shrink-0 mr-1 space-y-0.5">
          <div className="text-sm font-bold text-foreground">{formatWorkTime(member.today_minutes)}</div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground justify-end">
            <span>{member.fixes_today} {plural(member.fixes_today, 'исправление', 'исправления', 'исправлений')}</span>
            <span>·</span>
            <span>{member.actions_today} {plural(member.actions_today, 'действие', 'действия', 'действий')}</span>
          </div>
        </div>

        {expanded
          ? <ChevronDown size={16} className="text-muted-foreground/40 flex-shrink-0" />
          : <ChevronRight size={16} className="text-muted-foreground/40 flex-shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-3 bg-muted/30 space-y-4">
          {/* Time stats grid */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { val: member.today_minutes, label: 'Сегодня' },
              { val: member.week_minutes, label: 'За неделю' },
              { val: member.month_minutes, label: 'За месяц' },
            ].map(item => (
              <div key={item.label} className="text-center rounded-lg border border-border bg-card py-2">
                <div className="text-sm font-bold text-foreground">{formatWorkTime(item.val)}</div>
                <div className="text-[10px] text-muted-foreground">{item.label}</div>
              </div>
            ))}
          </div>

          {/* Fixes & actions row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
              <Wrench size={14} className="text-green-500" />
              <div>
                <div className="text-sm font-bold text-foreground">{member.fixes_today} / {member.fixes_week}</div>
                <div className="text-[10px] text-muted-foreground">исправлений сегодня / за неделю</div>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
              <MousePointerClick size={14} className="text-primary" />
              <div>
                <div className="text-sm font-bold text-foreground">{member.actions_today}</div>
                <div className="text-[10px] text-muted-foreground">{plural(member.actions_today, 'действие', 'действия', 'действий')} сегодня</div>
              </div>
            </div>
          </div>

          {/* Work schedule */}
          {member.work_start_today && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock size={12} />
              Рабочий день: {formatTimeShort(member.work_start_today)}
              {member.work_end_today ? ` — ${formatTimeShort(member.work_end_today)}` : ' — сейчас'}
            </div>
          )}

          {/* Weekly chart */}
          {member.daily_breakdown.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-foreground mb-1.5">Активность за неделю</div>
              <div className="h-[90px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={member.daily_breakdown} barCategoryGap="25%">
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(d) => {
                        const date = new Date(d + 'T00:00:00');
                        return `${date.getDate()}.${String(date.getMonth() + 1).padStart(2, '0')}`;
                      }}
                    />
                    <YAxis
                      width={24}
                      tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `${Math.round(v / 60)}ч`}
                    />
                    <Tooltip
                      contentStyle={{ fontSize: 11, background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
                      formatter={(value: number) => [formatWorkTime(value), 'Время']}
                      labelFormatter={(d) => {
                        const date = new Date(d + 'T00:00:00');
                        return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
                      }}
                    />
                    <Bar dataKey="minutes" radius={[3, 3, 0, 0]} maxBarSize={18} fill="hsl(var(--primary) / 0.6)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Sessions */}
          <div>
            <div className="text-xs font-semibold text-foreground mb-2">
              Сессии сегодня ({todaySessions.length})
            </div>
            {todaySessions.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">Нет сессий сегодня</div>
            ) : (
              <div className="space-y-1.5">
                {todaySessions.map(s => <SessionCard key={s.id} session={s} />)}
              </div>
            )}
          </div>

          {olderSessions.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-foreground mb-2">
                Предыдущие сессии ({olderSessions.length})
              </div>
              <div className="space-y-1.5">
                {visibleOlder.map(s => <SessionCard key={s.id} session={s} />)}
              </div>
              {olderSessions.length > 3 && !showAllSessions && (
                <Button
                  variant="ghost" size="sm"
                  className="text-xs h-7 mt-1.5 w-full text-muted-foreground"
                  onClick={() => setShowAllSessions(true)}
                >
                  Показать ещё {olderSessions.length - 3}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Custom Tooltip for team chart ─────────────────── */

function TeamChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload as MemberWorkDay;
  const date = new Date(data.date + 'T00:00:00');
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg text-xs">
      <div className="font-semibold text-foreground mb-1">{date.getDate()} {MONTHS_SHORT[date.getMonth()]}</div>
      <div className="text-muted-foreground">Время: <span className="text-foreground font-medium">{formatWorkTime(data.minutes)}</span></div>
      <div className="text-muted-foreground">Исправления: <span className="text-foreground font-medium">{data.fixes}</span></div>
    </div>
  );
}

/* ─── Main Component ────────────────────────────────── */

export default function TeamTimeTracking() {
  const { activeStore } = useStore();
  const [data, setData] = useState<TeamWorkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [chartRange, setChartRange] = useState<7 | 30>(7);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState('time_desc');

  const load = useCallback(async () => {
    if (!activeStore) { setLoading(false); return; }
    setLoading(true);
    try {
      const worklog = await api.getTeamWorklog(activeStore.id, 30);
      setData(worklog as TeamWorkData);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [activeStore]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, [load]);

  const members = data?.members || [];
  const onlineCount = members.filter(m => m.is_online).length;
  const totalFixes = members.reduce((s, m) => s + m.fixes_today, 0);
  const totalActions = members.reduce((s, m) => s + m.actions_today, 0);

  // Filters & sort
  const filteredMembers = useMemo(() => {
    let list = [...members];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(m => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q));
    }
    if (roleFilter !== 'all') {
      list = list.filter(m => m.role === roleFilter);
    }
    switch (sortBy) {
      case 'time_asc': list.sort((a, b) => a.today_minutes - b.today_minutes); break;
      case 'fixes_desc': list.sort((a, b) => b.fixes_today - a.fixes_today); break;
      case 'name_asc': list.sort((a, b) => a.name.localeCompare(b.name)); break;
      default: list.sort((a, b) => b.today_minutes - a.today_minutes);
    }
    return list;
  }, [members, searchQuery, roleFilter, sortBy]);

  // Team chart data
  const teamChartData = useMemo(() => {
    if (!data) return [];
    return data.team_daily.slice(-chartRange);
  }, [data, chartRange]);

  const chartTotalHours = useMemo(() => {
    const mins = teamChartData.reduce((s, d) => s + d.minutes, 0);
    return Math.round(mins / 6) / 10;
  }, [teamChartData]);

  const chartTotalFixes = useMemo(() => teamChartData.reduce((s, d) => s + d.fixes, 0), [teamChartData]);

  const roles = useMemo(() => {
    const unique = new Set(members.map(m => m.role));
    return Array.from(unique);
  }, [members]);

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="text-center rounded-xl border border-border bg-muted/50 py-3">
          <div className="text-xl font-extrabold text-foreground">{members.length}</div>
          <div className="text-[11px] text-muted-foreground">{plural(members.length, 'сотрудник', 'сотрудника', 'сотрудников')}</div>
        </div>
        <div className="text-center rounded-xl border border-border bg-muted/50 py-3">
          <div className="text-xl font-extrabold text-foreground">
            <span className="inline-flex items-center gap-1">{onlineCount} <span className="w-2 h-2 rounded-full bg-green-500 inline-block" /></span>
          </div>
          <div className="text-[11px] text-muted-foreground">сейчас онлайн</div>
        </div>
        <div className="text-center rounded-xl border border-border bg-muted/50 py-3">
          <div className="text-xl font-extrabold text-foreground">{formatWorkTime(data?.total_today_minutes || 0)}</div>
          <div className="text-[11px] text-muted-foreground">время команды сегодня</div>
        </div>
        <div className="text-center rounded-xl border border-border bg-muted/50 py-3">
          <div className="text-xl font-extrabold text-foreground">{totalFixes}</div>
          <div className="text-[11px] text-muted-foreground">{plural(totalFixes, 'исправление', 'исправления', 'исправлений')} сегодня</div>
        </div>
      </div>

      {/* Team chart */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <BarChart3 size={15} className="text-muted-foreground" />
            Общая активность команды
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-muted rounded-lg p-0.5">
              <button
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${chartRange === 7 ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => { setChartRange(7); setSelectedDate(null); }}
              >Неделя</button>
              <button
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${chartRange === 30 ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => { setChartRange(30); setSelectedDate(null); }}
              >Месяц</button>
            </div>
            <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-xs" onClick={load} disabled={loading}>
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </Button>
          </div>
        </div>

        <div className="h-[160px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={teamChartData}
              barCategoryGap="20%"
              onClick={(state) => {
                if (state?.activePayload?.[0]?.payload) {
                  const d = state.activePayload[0].payload.date;
                  setSelectedDate(prev => prev === d ? null : d);
                }
              }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(d) => {
                  const date = new Date(d + 'T00:00:00');
                  return `${date.getDate()}.${String(date.getMonth() + 1).padStart(2, '0')}`;
                }}
              />
              <YAxis
                width={32}
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${Math.round(v / 60)}ч`}
              />
              <Tooltip content={<TeamChartTooltip />} />
              <Bar dataKey="minutes" radius={[4, 4, 0, 0]} maxBarSize={28} cursor="pointer">
                {teamChartData.map((entry) => (
                  <Cell
                    key={entry.date}
                    fill={selectedDate === entry.date ? 'hsl(var(--primary))' : 'hsl(var(--primary) / 0.5)'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="border-t border-border mt-2 pt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>Итого за {chartRange === 7 ? 'неделю' : 'месяц'}</span>
          <span className="text-foreground">
            <strong className="font-extrabold">{chartTotalHours}ч</strong>
            &nbsp;&nbsp;{chartTotalFixes} {plural(chartTotalFixes, 'исправление', 'исправления', 'исправлений')}
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-[280px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Поиск по имени..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-8 w-[150px] text-xs">
            <Filter size={13} className="mr-1.5 text-muted-foreground" />
            <SelectValue placeholder="Все роли" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все роли</SelectItem>
            {roles.map(r => (
              <SelectItem key={r} value={r}>{ROLE_LABELS[r] || r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="h-8 w-[170px] text-xs">
            <ArrowUpDown size={13} className="mr-1.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="text-xs text-muted-foreground ml-auto">
          {filteredMembers.length} из {members.length}
        </div>
      </div>

      {/* Loading */}
      {loading && !data && (
        <div className="text-center py-10 text-sm text-muted-foreground">Загрузка...</div>
      )}

      {/* Members list */}
      {!loading && filteredMembers.length === 0 && (
        <div className="text-center py-10 text-sm text-muted-foreground">
          {searchQuery || roleFilter !== 'all' ? 'Нет результатов по фильтру' : 'Нет данных по сотрудникам'}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {filteredMembers.map(member => (
          <MemberRow
            key={member.id}
            member={member}
            expanded={expandedId === member.id}
            onToggle={() => setExpandedId(prev => prev === member.id ? null : member.id)}
          />
        ))}
      </div>
    </div>
  );
}
