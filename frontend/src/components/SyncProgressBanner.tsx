import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Loader2, CheckCircle2, XCircle, RefreshCw, X } from 'lucide-react';
import api from '../api/client';

interface SyncTask {
  task_id: string;
  store_id: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  step: string;
  progress: number;
  result?: {
    total_wb: number;
    changed: number;
    analyzed: number;
    issues_found: number;
    ai_tokens?: {
      prompt_tokens: number;
      completion_tokens: number;
      thinking_tokens: number;
      total_tokens: number;
      api_calls: number;
    };
  } | null;
  error?: string | null;
  completed_at?: string | null;
}

const STORAGE_KEY_PREFIX = 'syncTask_';

export function getSyncTaskKey(storeId: number) {
  return `${STORAGE_KEY_PREFIX}${storeId}`;
}

export function saveSyncTask(storeId: number, taskId: string) {
  localStorage.setItem(getSyncTaskKey(storeId), taskId);
  // Notify the banner so it starts polling immediately
  window.dispatchEvent(new CustomEvent('syncTaskStarted', { detail: { storeId, taskId } }));
}

export function clearSyncTask(storeId: number) {
  localStorage.removeItem(getSyncTaskKey(storeId));
}

export function getSavedTaskId(storeId: number): string | null {
  return localStorage.getItem(getSyncTaskKey(storeId));
}

interface SyncProgressBannerProps {
  storeId: number | null;
  onComplete?: () => void;
}

export default function SyncProgressBanner({ storeId, onComplete }: SyncProgressBannerProps) {
  const [task, setTask] = useState<SyncTask | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onCompleteRef = useRef<(() => void) | undefined>(onComplete);
  const completeNotifiedRef = useRef<string | null>(null);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(async (sid: number, tid: string) => {
    try {
      const data = await api.getSyncStatus(sid, tid);
      setTask(data);
      if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
        stopPolling();
        clearSyncTask(sid);
        if (data.status === 'completed') {
          if (completeNotifiedRef.current !== tid) {
            completeNotifiedRef.current = tid;
            onCompleteRef.current?.();
          }
        }
      }
    } catch {
      // Task expired or server restarted
      stopPolling();
      clearSyncTask(sid);
      setTask(null);
    }
  }, [stopPolling]);

  const startPolling = useCallback((sid: number, tid: string) => {
    stopPolling();
    pollStatus(sid, tid);
    pollRef.current = setInterval(() => pollStatus(sid, tid), 2500);
  }, [stopPolling, pollStatus]);

  // On storeId change, check localStorage for existing task
  useEffect(() => {
    if (!storeId) return;
    setDismissed(false);
    const savedTaskId = getSavedTaskId(storeId);
    if (savedTaskId) {
      startPolling(storeId, savedTaskId);
    } else {
      setTask(null);
      stopPolling();
    }
    return () => stopPolling();
  }, [storeId, startPolling, stopPolling]);

  // Listen for new tasks started anywhere in the app
  useEffect(() => {
    if (!storeId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.storeId === storeId && detail?.taskId) {
        setDismissed(false);
        startPolling(storeId, detail.taskId);
      }
    };
    window.addEventListener('syncTaskStarted', handler);
    return () => window.removeEventListener('syncTaskStarted', handler);
  }, [storeId, startPolling]);

  if (!task || dismissed) return null;
  if (task.status === 'pending' && !task.step) return null;

  const isDone = task.status === 'completed';
  const isFailed = task.status === 'failed';
  const isRunning = task.status === 'running' || task.status === 'pending';

  const bgColor = isDone ? '#f0fdf4' : isFailed ? '#fef2f2' : '#fff';
  const borderColor = isDone ? '#86efac' : isFailed ? '#fca5a5' : '#e0e3ff';
  const accentColor = isDone ? '#16a34a' : isFailed ? '#dc2626' : '#6366f1';
  const titleColor = isDone ? '#166534' : isFailed ? '#991b1b' : '#1e1b4b';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 28,
        right: 28,
        zIndex: 9999,
        background: bgColor,
        border: `1.5px solid ${borderColor}`,
        borderRadius: 18,
        boxShadow: '0 8px 32px rgba(99,102,241,0.15), 0 2px 8px rgba(0,0,0,0.08)',
        padding: '16px 20px',
        width: 360,
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        overflow: 'hidden',
      }}
    >
      {/* Top row: icon + title + dismiss */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          background: isRunning ? 'linear-gradient(135deg,#6366f1,#4338ca)' : isDone ? 'linear-gradient(135deg,#22c55e,#16a34a)' : 'linear-gradient(135deg,#ef4444,#dc2626)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          boxShadow: `0 2px 8px ${isRunning ? 'rgba(99,102,241,0.3)' : isDone ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
        }}>
          {isRunning && <Loader2 size={16} style={{ color: '#fff', animation: 'spin 0.8s linear infinite' }} />}
          {isDone && <CheckCircle2 size={16} style={{ color: '#fff' }} />}
          {isFailed && <XCircle size={16} style={{ color: '#fff' }} />}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: titleColor, lineHeight: 1.3 }}>
            {isDone ? 'Синхронизация завершена' : isFailed ? 'Ошибка синхронизации' : 'Синхронизация WB...'}
          </div>
          {isRunning && (
            <div style={{ fontSize: 11, color: '#6366f1', fontWeight: 500 }}>
              {task.progress}%
            </div>
          )}
        </div>
        {(isDone || isFailed) && (
          <button
            onClick={() => {
              setDismissed(true);
              if (storeId) clearSyncTask(storeId);
            }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 2, flexShrink: 0, display: 'flex', alignItems: 'center' }}
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* Step text */}
      <div style={{ fontSize: 12, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: isRunning ? 8 : (isDone && task.result ? 8 : 0) }}>
        {task.step}
      </div>

      {/* Progress bar */}
      {isRunning && (
        <div style={{ height: 5, background: '#e0e3ff', borderRadius: 99, overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${task.progress}%`,
              background: 'linear-gradient(90deg,#6366f1,#4338ca)',
              borderRadius: 99,
              transition: 'width 0.6s ease',
            }}
          />
        </div>
      )}

      {/* Result stats */}
      {isDone && task.result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            {[
              { label: 'Всего WB', val: task.result.total_wb },
              { label: 'Изменено', val: task.result.changed },
              { label: 'Анализ', val: task.result.analyzed },
              { label: 'Проблем', val: task.result.issues_found },
            ].map(item => (
              <div key={item.label} style={{ textAlign: 'center', flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: titleColor }}>{item.val}</div>
                <div style={{ fontSize: 10, color: '#9ca3af', whiteSpace: 'nowrap' }}>{item.label}</div>
              </div>
            ))}
          </div>
          {task.result.ai_tokens && task.result.ai_tokens.total_tokens > 0 && (() => {
            const t = task.result!.ai_tokens!;
            const analyzed = task.result!.analyzed || 1;
            const perCard = Math.round(t.total_tokens / analyzed);
            const fmt = (n: number) => n.toLocaleString('ru-RU');
            return (
              <div style={{
                marginTop: 2,
                padding: '8px 10px',
                background: '#dcfce7',
                borderRadius: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 13 }}>🤖</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: titleColor }}>
                    AI: {fmt(t.total_tokens)} токенов
                  </span>
                  <span style={{ fontSize: 10, color: '#9ca3af' }}>
                    · {t.api_calls} запросов
                  </span>
                  {analyzed > 0 && (
                    <span style={{ fontSize: 10, color: '#9ca3af' }}>
                      · ~{fmt(perCard)}/карт
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#6b7280' }}>
                  <span>📥 {fmt(t.prompt_tokens)} вход</span>
                  <span>📤 {fmt(t.completion_tokens)} выход</span>
                  {t.thinking_tokens > 0 && (
                    <span>💭 {fmt(t.thinking_tokens)} думал</span>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
