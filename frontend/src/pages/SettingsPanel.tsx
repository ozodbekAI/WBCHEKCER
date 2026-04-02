import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import {
  Settings, Activity, Clock, MousePointerClick, ChevronRight, ChevronDown,
  Trash2, BarChart3, X,
} from 'lucide-react';
import {
  useWorkTracker,
  formatDuration,
  plural,
  type WorkSession,
  type WorkAction,
} from '../hooks/useWorkTracker';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Cell,
} from 'recharts';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

const MONTHS_SHORT = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июня', 'июля', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];

function formatSessionDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
}

const SYSTEM_TYPES = new Set(['session_started', 'session_ended']);

function SessionCard({ session, onNavigate }: { session: WorkSession; onNavigate: (nmId: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const visibleActions = session.actions.filter(a => !SYSTEM_TYPES.has(a.type));

  return (
    <div className="rounded-lg border border-border bg-card hover:border-muted-foreground/30 transition-colors overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-foreground">
            {formatSessionDate(session.startedAt)} · {formatTime(session.startedAt)} — {session.endedAt ? formatTime(session.endedAt) : 'сейчас'}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
            <span className="inline-flex items-center gap-1"><Clock size={12} /> {formatDuration(session.activeTimeMs)}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1"><MousePointerClick size={12} /> {visibleActions.length} {plural(visibleActions.length, 'действие', 'действия', 'действий')}</span>
            {session.isManualEnd && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 ml-1">вручную</Badge>
            )}
          </div>
        </div>
        {visibleActions.length > 0 && (
          expanded
            ? <ChevronDown size={16} className="text-muted-foreground/40 flex-shrink-0" />
            : <ChevronRight size={16} className="text-muted-foreground/40 flex-shrink-0" />
        )}
      </button>

      {expanded && visibleActions.length > 0 && (
        <div className="border-t border-border px-3.5 py-2 space-y-1 bg-muted/30">
          {visibleActions.map(action => {
            const time = formatTime(action.timestamp);
            const nmId = action.meta?.nmId;
            const isClickable = !!nmId;
            return (
              <div
                key={action.id}
                className={`flex items-center gap-2 text-[12px] py-0.5 ${isClickable ? 'cursor-pointer hover:text-primary transition-colors group' : ''}`}
                onClick={isClickable ? () => onNavigate(nmId) : undefined}
              >
                <span className="text-muted-foreground w-10 flex-shrink-0 font-mono">{time}</span>
                <span className="text-foreground flex-1 truncate">{action.label}</span>
                {nmId && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-mono flex-shrink-0 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                    {nmId}
                  </Badge>
                )}
                {isClickable && <ChevronRight size={12} className="text-muted-foreground/50 flex-shrink-0" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ActivityContent() {
  const { activeStore } = useStore();
  const navigate = useNavigate();
  const {
    sessions, todayStats, isActive, activeSession,
    clearHistory, getDailyStats,
  } = useWorkTracker();

  const [chartRange, setChartRange] = useState<7 | 30>(7);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const dailyStats = useMemo(() => getDailyStats(chartRange), [getDailyStats, chartRange]);

  const totalHours = useMemo(() => {
    const total = dailyStats.reduce((a, d) => a + d.timeHours, 0);
    return Math.round(total * 10) / 10;
  }, [dailyStats]);

  const totalActions = useMemo(() => dailyStats.reduce((a, d) => a + d.actions, 0), [dailyStats]);

  const allSessions = useMemo(() => {
    const list = [...sessions];
    if (activeSession) list.unshift(activeSession);
    return list.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }, [sessions, activeSession]);

  const filteredSessions = useMemo(() => {
    if (!selectedDate) return allSessions;
    return allSessions.filter(s => s.startedAt.slice(0, 10) === selectedDate);
  }, [allSessions, selectedDate]);

  const handleClear = useCallback(() => {
    if (confirm('Очистить всю историю активности?')) {
      clearHistory();
    }
  }, [clearHistory]);

  const handleBarClick = useCallback((data: any) => {
    if (!data?.date) return;
    setSelectedDate(prev => prev === data.date ? null : data.date);
  }, []);

  const handleNavigate = useCallback((nmId: number) => {
    navigate(`/editor-v2/${nmId}`);
  }, [navigate]);

  return (
    <div className="space-y-5">
      {/* Stats row — 3 cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center rounded-xl border border-border bg-muted/50 py-3">
          <div className="text-xl font-extrabold text-foreground">{todayStats.sessionsCount}</div>
          <div className="text-[11px] text-muted-foreground">{plural(todayStats.sessionsCount, 'сессия', 'сессии', 'сессий')}</div>
        </div>
        <div className="text-center rounded-xl border border-border bg-muted/50 py-3">
          <div className="text-xl font-extrabold text-foreground">{formatDuration(todayStats.totalTimeMs)}</div>
          <div className="text-[11px] text-muted-foreground">рабочее время</div>
        </div>
        <div className="text-center rounded-xl border border-border bg-muted/50 py-3">
          <div className="text-xl font-extrabold text-foreground">{todayStats.totalActions}</div>
          <div className="text-[11px] text-muted-foreground">{plural(todayStats.totalActions, 'действие', 'действия', 'действий')}</div>
        </div>
      </div>

      {/* Chart */}
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <BarChart3 size={15} className="text-muted-foreground" />
            Рабочее время
          </div>
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
        </div>

        <div className="h-[140px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyStats} barCategoryGap="20%" onClick={(state) => {
              if (state?.activePayload?.[0]?.payload) handleBarClick(state.activePayload[0].payload);
            }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
                interval={chartRange === 30 ? 4 : 0}
              />
              <YAxis
                width={28}
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${v}ч`}
              />
              <Bar
                dataKey="timeHours"
                radius={[4, 4, 0, 0]}
                maxBarSize={chartRange === 30 ? 12 : 24}
                cursor="pointer"
              >
                {dailyStats.map((entry) => (
                  <Cell
                    key={entry.date}
                    fill={selectedDate === entry.date ? 'hsl(var(--primary))' : 'hsl(var(--primary) / 0.6)'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="border-t border-border mt-2 pt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>Всего за {chartRange === 7 ? 'неделю' : 'месяц'}</span>
          <span className="text-foreground">
            <strong className="font-extrabold">{totalHours}ч</strong>
            &nbsp;&nbsp;{totalActions} {plural(totalActions, 'действие', 'действия', 'действий')}
          </span>
        </div>
      </div>

      {/* Sessions list */}
      <div className="flex items-center justify-between mt-6">
        <div className="text-sm font-semibold text-foreground">
          {selectedDate ? `Сессии за ${formatSessionDate(selectedDate + 'T00:00:00')}` : 'Последние сессии'}
        </div>
        {selectedDate && (
          <Button variant="ghost" size="sm" className="text-xs h-6 px-2" onClick={() => setSelectedDate(null)}>
            Показать все
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {filteredSessions.length === 0 && (
          <div className="text-center py-6 text-sm text-muted-foreground">Нет записей активности</div>
        )}
        {filteredSessions.slice(0, 20).map(session => (
          <SessionCard key={session.id} session={session} onNavigate={handleNavigate} />
        ))}
      </div>

      {allSessions.length > 0 && (
        <Button variant="ghost" size="sm" className="mx-auto mt-4 text-muted-foreground hover:text-destructive gap-2" onClick={handleClear}>
          <Trash2 size={14} />
          Очистить историю
        </Button>
      )}
    </div>
  );
}

export default function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-[400px] sm:w-[540px] p-0 flex flex-col overflow-hidden">
        <SheetHeader className="px-6 pt-5 pb-0">
          <SheetTitle className="flex items-center gap-2 text-base font-semibold">
            <Settings size={18} className="text-muted-foreground" />
            Моя активность
          </SheetTitle>
        </SheetHeader>
        <ScrollArea className="flex-1 px-6 py-5">
          <ActivityContent />
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
