/**
 * Activity tracker — tracks user sessions and actions in localStorage.
 * Each "session" starts when the page loads and ends on unload/visibility-hidden.
 * An "action" is any meaningful click (navigating, fixing an issue, etc.).
 * Idle detection: 2 min no mouse/keyboard = pause session + stop heartbeat.
 */

export interface ActivitySession {
  id: string;
  storeId: number | null;
  startedAt: string;          // ISO
  endedAt: string | null;     // ISO, null = still active
  durationSec: number;
  actions: number;
}

export interface ActivityData {
  sessions: ActivitySession[];
}

const STORAGE_KEY = 'wb_activity';
const SESSION_KEY = 'wb_active_session';
const ACTION_KEY  = 'wb_session_actions';
const IDLE_MS = 2 * 60 * 1000; // 2 minutes
const IDLE_KEY = 'wb_last_activity';
const HEARTBEAT_INTERVAL_MS = 60_000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let isIdle = false;

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Reset idle timer on any user activity */
function resetIdle() {
  localStorage.setItem(IDLE_KEY, Date.now().toString());
  if (isIdle) {
    isIdle = false;
    // Resume session on activity after idle
    startSessionTimer();
  }
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    isIdle = true;
    // Flush and pause — don't count idle time
    flushActiveSession();
  }, IDLE_MS);
}

function startSessionTimer() {
  // No-op: session start time is tracked per-session, idle just flushes early
}

/** Start heartbeat to backend */
function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(async () => {
    if (isIdle) return;
    try {
      const { default: api } = await import('../api/client');
      await api.heartbeat();
    } catch { /* ignore */ }
  }, HEARTBEAT_INTERVAL_MS);
}

/** Setup idle/activity event listeners (call once on app mount) */
export function initActivityListeners() {
  const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
  const handler = () => resetIdle();
  events.forEach(e => window.addEventListener(e, handler, { passive: true }));
  resetIdle(); // init
  startHeartbeat();
  return () => {
    events.forEach(e => window.removeEventListener(e, handler));
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (idleTimer) clearTimeout(idleTimer);
  };
}

/** Returns true if user has been idle for 2+ minutes */
export function getIsIdle(): boolean {
  const last = parseInt(localStorage.getItem(IDLE_KEY) || '0', 10);
  return Date.now() - last > IDLE_MS;
}

function load(): ActivityData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { sessions: [] };
}

function save(data: ActivityData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/* ─── public helpers ─── */

/** Start a new session (called once on app mount) */
export function startSession(storeId: number | null) {
  flushActiveSession();           // close any stale one

  const session: ActivitySession = {
    id: uid(),
    storeId,
    startedAt: new Date().toISOString(),
    endedAt: null,
    durationSec: 0,
    actions: 0,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  localStorage.setItem(ACTION_KEY, '0');
}

/** Mark one "action" in the current session */
export function trackAction() {
  const count = parseInt(localStorage.getItem(ACTION_KEY) || '0', 10);
  localStorage.setItem(ACTION_KEY, String(count + 1));
}

/** Close the active session and persist it */
export function flushActiveSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return;
  try {
    const session: ActivitySession = JSON.parse(raw);
    const now = new Date();
    const start = new Date(session.startedAt);
    session.endedAt = now.toISOString();
    session.durationSec = Math.round((now.getTime() - start.getTime()) / 1000);
    session.actions = parseInt(localStorage.getItem(ACTION_KEY) || '0', 10);

    // Only save sessions longer than 10 seconds
    if (session.durationSec >= 10) {
      const data = load();
      data.sessions.push(session);
      // keep last 200 sessions max
      if (data.sessions.length > 200) {
        data.sessions = data.sessions.slice(-200);
      }
      save(data);
    }
  } catch { /* ignore */ }

  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(ACTION_KEY);
}

/** Get all saved sessions */
export function getSessions(): ActivitySession[] {
  // include current active session as a "live" entry
  const data = load();
  const sessions = [...data.sessions];

  const raw = localStorage.getItem(SESSION_KEY);
  if (raw) {
    try {
      const live: ActivitySession = JSON.parse(raw);
      const now = new Date();
      const start = new Date(live.startedAt);
      live.durationSec = Math.round((now.getTime() - start.getTime()) / 1000);
      live.actions = parseInt(localStorage.getItem(ACTION_KEY) || '0', 10);
      live.endedAt = null;  // still active
      sessions.push(live);
    } catch { /* ignore */ }
  }

  return sessions.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

/** Get daily totals for the last N days */
export function getDailyTotals(days: number): { date: string; minutes: number }[] {
  const sessions = getSessions();
  const map = new Map<string, number>();

  // Prepare last N days
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    map.set(key, 0);
  }

  for (const s of sessions) {
    const day = s.startedAt.slice(0, 10);
    if (map.has(day)) {
      map.set(day, (map.get(day) || 0) + Math.round(s.durationSec / 60));
    }
  }

  return Array.from(map.entries())
    .map(([date, minutes]) => ({ date, minutes }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Get total stats for a period (last N days) */
export function getStats(days: number) {
  const sessions = getSessions();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const filtered = sessions.filter(s => new Date(s.startedAt) >= cutoff);
  const totalSec = filtered.reduce((acc, s) => acc + s.durationSec, 0);
  const totalActions = filtered.reduce((acc, s) => acc + s.actions, 0);

  return {
    sessionCount: filtered.length,
    totalMinutes: Math.round(totalSec / 60),
    totalActions,
    sessions: filtered,
  };
}

/** Clear all history */
export function clearActivity() {
  localStorage.removeItem(STORAGE_KEY);
}

/** Format minutes as "Xч Yмин" */
export function formatDuration(minutes: number): string {
  if (minutes < 1) return '0мин';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}мин`;
  if (m === 0) return `${h}ч`;
  return `${h}ч ${m}мин`;
}

/** Format seconds as "Xч Yмин" or "Xмин" */
export function formatDurationSec(sec: number): string {
  return formatDuration(Math.round(sec / 60));
}
