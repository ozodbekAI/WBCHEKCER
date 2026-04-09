/**
 * Work Activity Tracker — full spec implementation.
 *
 * Auto-start on first logAction(), delta-based active time,
 * typed actions, 5-min idle.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import api from '../api/client';

// ── Types ────────────────────────────────────────────────────────────────────

export type ActionType =
  | 'section_confirmed'
  | 'field_edited'
  | 'problem_resolved'
  | 'problem_skipped'
  | 'problem_deferred'
  | 'card_opened'
  | 'card_completed'
  | 'master_started'
  | 'master_completed'
  | 'session_started'
  | 'session_ended';

export interface WorkAction {
  id: string;
  type: ActionType;
  label: string;
  timestamp: string;
  meta?: Record<string, any>;
}

export interface WorkSession {
  id: string;
  startedAt: string;
  endedAt: string | null;
  activeTimeMs: number;
  lastActivityAt: string;
  actions: WorkAction[];
  isManualEnd: boolean;
}

export interface TodayStats {
  sessionsCount: number;
  totalTimeMs: number;
  totalActions: number;
}

export interface DailyStats {
  date: string;
  label: string;
  timeHours: number;
  actions: number;
  sessions: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const IDLE_MS = 5 * 60 * 1000;
const SESSIONS_KEY = 'work_tracker_sessions';
const ACTIVE_KEY = 'work_tracker_active';
const MAX_SESSIONS = 50;
const HEARTBEAT_MS = 60_000;
const TICK_MS = 10_000;
const ACTIVE_STORE_KEY = 'avemod_active_store_id';

const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS_SHORT = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июня', 'июля', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 1) return '0мин';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}мин`;
  if (m === 0) return `${h}ч`;
  return `${h}ч ${m}мин`;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Storage ──────────────────────────────────────────────────────────────────

function loadSessions(): WorkSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveSessions(sessions: WorkSession[]) {
  const trimmed = sessions.slice(-MAX_SESSIONS);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(trimmed));
}

function loadActive(): WorkSession | null {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveActive(session: WorkSession | null) {
  if (session) localStorage.setItem(ACTIVE_KEY, JSON.stringify(session));
  else localStorage.removeItem(ACTIVE_KEY);
}

async function syncActivityToBackend(type: ActionType, label: string, timestamp: string, meta?: Record<string, any>) {
  const storeId = Number(localStorage.getItem(ACTIVE_STORE_KEY) || 0);
  if (!storeId) return;
  try {
    await api.logTeamActivity(storeId, { action: type, label, timestamp, meta });
  } catch {
    /* ignore */
  }
}

function fireActivity(type: ActionType, label: string, timestamp: string, meta?: Record<string, any>) {
  void syncActivityToBackend(type, label, timestamp, meta);
}

// ── Recovery on reload ──────────────────────────────────────────────────────

function recoverStaleSession(): void {
  const active = loadActive();
  if (!active) return;
  const lastAt = new Date(active.lastActivityAt).getTime();
  if (Date.now() - lastAt > IDLE_MS) {
    // Close stale session backdated to lastActivityAt + IDLE_MS
    active.endedAt = new Date(lastAt + IDLE_MS).toISOString();
    active.isManualEnd = false;
    active.actions.push({
      id: uid(), type: 'session_ended', label: 'Сессия завершена (idle)',
      timestamp: active.endedAt,
    });
    const sessions = loadSessions();
    sessions.push(active);
    saveSessions(sessions);
    saveActive(null);
    fireActivity('session_ended', 'Сессия завершена (idle)', active.endedAt);
  }
}

// ── Heartbeat ────────────────────────────────────────────────────────────────

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(async () => {
  const active = loadActive();
  if (!active) return;
  const last = new Date(active.lastActivityAt).getTime();
  if (Date.now() - last > IDLE_MS) return;
  try {
      await api.heartbeat();
  } catch { /* ignore */ }
  }, HEARTBEAT_MS);
}

// ── Activity listeners (init once from App.tsx) ──────────────────────────────

export function initWorkTrackerListeners(): () => void {
  recoverStaleSession();
  startHeartbeat();

  const handleUnload = () => {
    const active = loadActive();
    if (!active) return;
    const now = Date.now();
    const lastAt = new Date(active.lastActivityAt).getTime();
    const delta = Math.min(now - lastAt, IDLE_MS);
    active.activeTimeMs += delta;
    active.endedAt = new Date().toISOString();
    active.actions.push({ id: uid(), type: 'session_ended', label: 'Сессия завершена', timestamp: active.endedAt });
    const sessions = loadSessions();
    sessions.push(active);
    saveSessions(sessions);
    saveActive(null);
    fireActivity('session_ended', 'Сессия завершена', active.endedAt);
  };

  window.addEventListener('beforeunload', handleUnload);

  return () => {
    window.removeEventListener('beforeunload', handleUnload);
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  };
}

// ── Standalone logAction (for use outside React components) ─────────────────

export function logAction(type: ActionType, label: string, meta?: Record<string, any>): void {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  let active = loadActive();

  // Auto-start session
  if (!active) {
    active = {
      id: uid(),
      startedAt: nowIso,
      endedAt: null,
      activeTimeMs: 0,
      lastActivityAt: nowIso,
      actions: [{ id: uid(), type: 'session_started', label: 'Сессия начата', timestamp: nowIso }],
      isManualEnd: false,
    };
    fireActivity('session_started', 'Сессия начата', nowIso);
  } else {
    // Delta active time
    const lastAt = new Date(active.lastActivityAt).getTime();
    const delta = Math.min(now - lastAt, IDLE_MS);

    // If idle too long, close old session and start new
    if (now - lastAt > IDLE_MS) {
      active.endedAt = new Date(lastAt + IDLE_MS).toISOString();
      active.actions.push({ id: uid(), type: 'session_ended', label: 'Сессия завершена (idle)', timestamp: active.endedAt });
      const sessions = loadSessions();
      sessions.push(active);
      saveSessions(sessions);
      fireActivity('session_ended', 'Сессия завершена (idle)', active.endedAt);

      active = {
        id: uid(),
        startedAt: nowIso,
        endedAt: null,
        activeTimeMs: 0,
        lastActivityAt: nowIso,
        actions: [{ id: uid(), type: 'session_started', label: 'Сессия начата', timestamp: nowIso }],
        isManualEnd: false,
      };
      fireActivity('session_started', 'Сессия начата', nowIso);
    } else {
      active.activeTimeMs += delta;
    }
  }

  active.lastActivityAt = nowIso;
  active.actions.push({ id: uid(), type, label, timestamp: nowIso, meta });
  saveActive(active);
  fireActivity(type, label, nowIso, meta);
}

// ── React Hook ───────────────────────────────────────────────────────────────

export function useWorkTracker() {
  const [tick, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Periodic refresh for live timer
  useEffect(() => {
    tickRef.current = setInterval(() => setTick(t => t + 1), TICK_MS);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  const activeSession = useMemo(() => loadActive(), [tick]);
  const sessions = useMemo(() => loadSessions(), [tick]);

  const isActive = useMemo(() => {
    if (!activeSession) return false;
    const last = new Date(activeSession.lastActivityAt).getTime();
    return Date.now() - last <= IDLE_MS;
  }, [activeSession, tick]);

  const todayStats = useMemo((): TodayStats => {
    const today = todayKey();
    const todaySessions = sessions.filter(s => s.startedAt.slice(0, 10) === today);
    let totalTimeMs = todaySessions.reduce((a, s) => a + s.activeTimeMs, 0);
    let totalActions = todaySessions.reduce((a, s) => a + s.actions.filter(a2 => a2.type !== 'session_started' && a2.type !== 'session_ended').length, 0);
    let sessionsCount = todaySessions.length;

    // Include active session if today
    if (activeSession && activeSession.startedAt.slice(0, 10) === today) {
      const last = new Date(activeSession.lastActivityAt).getTime();
      const liveDelta = Math.min(Date.now() - last, IDLE_MS);
      totalTimeMs += activeSession.activeTimeMs + (isActive ? liveDelta : 0);
      totalActions += activeSession.actions.filter(a => a.type !== 'session_started' && a.type !== 'session_ended').length;
      sessionsCount += 1;
    }

    return { sessionsCount, totalTimeMs, totalActions };
  }, [sessions, activeSession, isActive, tick]);

  const doLogAction = useCallback((type: ActionType, label: string, meta?: Record<string, any>) => {
    logAction(type, label, meta);
    setTick(t => t + 1);
  }, []);

  const endShift = useCallback(() => {
    const active = loadActive();
    if (!active) return;
    const now = Date.now();
    const lastAt = new Date(active.lastActivityAt).getTime();
    const delta = Math.min(now - lastAt, IDLE_MS);
    active.activeTimeMs += delta;
    active.endedAt = new Date().toISOString();
    active.isManualEnd = true;
    active.actions.push({ id: uid(), type: 'session_ended', label: 'Смена завершена вручную', timestamp: active.endedAt });
    const all = loadSessions();
    all.push(active);
    saveSessions(all);
    saveActive(null);
    fireActivity('session_ended', 'Смена завершена вручную', active.endedAt);
    setTick(t => t + 1);
  }, []);

  const clearHistory = useCallback(() => {
    localStorage.removeItem(SESSIONS_KEY);
    saveActive(null);
    setTick(t => t + 1);
  }, []);

  const getDailyStats = useCallback((days: number): DailyStats[] => {
    const allSessions = [...sessions];
    if (activeSession) allSessions.push(activeSession);

    const result: DailyStats[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().slice(0, 10);
      const dayName = WEEKDAYS_SHORT[d.getDay()];
      const label = days <= 7
        ? dayName
        : `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;

      const daySessions = allSessions.filter(s => s.startedAt.slice(0, 10) === dateKey);
      const timeMs = daySessions.reduce((a, s) => a + s.activeTimeMs, 0);
      const actions = daySessions.reduce((a, s) => a + s.actions.filter(a2 => a2.type !== 'session_started' && a2.type !== 'session_ended').length, 0);

      result.push({
        date: dateKey,
        label,
        timeHours: Math.round(timeMs / 60_000) / 60, // hours with decimal
        actions,
        sessions: daySessions.length,
      });
    }
    return result;
  }, [sessions, activeSession]);

  const currentSessionTimeMs = useMemo((): number => {
    if (!activeSession) return 0;
    const last = new Date(activeSession.lastActivityAt).getTime();
    const liveDelta = Math.min(Date.now() - last, IDLE_MS);
    return activeSession.activeTimeMs + (isActive ? liveDelta : 0);
  }, [activeSession, isActive, tick]);

  return {
    activeSession,
    sessions,
    todayStats,
    isActive,
    currentSessionTimeMs,
    logAction: doLogAction,
    endShift,
    clearHistory,
    formatDuration,
    getDailyStats,
  };
}

// ── Plural helper (re-exported for SettingsPanel) ────────────────────────────

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
