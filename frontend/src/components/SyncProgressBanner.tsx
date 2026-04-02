import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Loader2, CheckCircle2, XCircle, X } from 'lucide-react';
import api from '../api/client';

interface SyncTask {
  task_id: string;
  store_id: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  step: string;
  progress: number;
  result?: { total_wb: number; changed: number; analyzed: number; issues_found: number; ai_tokens?: { prompt_tokens: number; completion_tokens: number; thinking_tokens: number; total_tokens: number; api_calls: number; }; } | null;
  error?: string | null;
  completed_at?: string | null;
}

const STORAGE_KEY_PREFIX = 'syncTask_';

export function getSyncTaskKey(storeId: number) { return `${STORAGE_KEY_PREFIX}${storeId}`; }
export function saveSyncTask(storeId: number, taskId: string) { localStorage.setItem(getSyncTaskKey(storeId), taskId); window.dispatchEvent(new CustomEvent('syncTaskStarted', { detail: { storeId, taskId } })); }
export function clearSyncTask(storeId: number) { localStorage.removeItem(getSyncTaskKey(storeId)); }
export function getSavedTaskId(storeId: number): string | null { return localStorage.getItem(getSyncTaskKey(storeId)); }

interface SyncProgressBannerProps { storeId: number | null; onComplete?: () => void; }

export default function SyncProgressBanner({ storeId, onComplete }: SyncProgressBannerProps) {
  const [task, setTask] = useState<SyncTask | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onCompleteRef = useRef<(() => void) | undefined>(onComplete);
  const completeNotifiedRef = useRef<string | null>(null);

  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  const stopPolling = useCallback(() => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }, []);

  const pollStatus = useCallback(async (sid: number, tid: string) => {
    try {
      const data = await api.getSyncStatus(sid, tid);
      setTask(data);
      if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
        stopPolling(); clearSyncTask(sid);
        if (data.status === 'completed' && completeNotifiedRef.current !== tid) { completeNotifiedRef.current = tid; onCompleteRef.current?.(); }
      }
    } catch { stopPolling(); clearSyncTask(sid); setTask(null); }
  }, [stopPolling]);

  const startPolling = useCallback((sid: number, tid: string) => { stopPolling(); pollStatus(sid, tid); pollRef.current = setInterval(() => pollStatus(sid, tid), 2500); }, [stopPolling, pollStatus]);

  useEffect(() => {
    if (!storeId) return;
    setDismissed(false);
    const savedTaskId = getSavedTaskId(storeId);
    if (savedTaskId) startPolling(storeId, savedTaskId); else { setTask(null); stopPolling(); }
    return () => stopPolling();
  }, [storeId, startPolling, stopPolling]);

  useEffect(() => {
    if (!storeId) return;
    const handler = (e: Event) => { const detail = (e as CustomEvent).detail; if (detail?.storeId === storeId && detail?.taskId) { setDismissed(false); startPolling(storeId, detail.taskId); } };
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
  const titleColor = isDone ? '#166534' : isFailed ? '#991b1b' : '#1e1b4b';

  return (
    <div style={{ position: 'fixed', bottom: 28, right: 28, zIndex: 9999, background: bgColor, border: `1.5px solid ${borderColor}`, borderRadius: 18, boxShadow: '0 8px 32px rgba(99,102,241,0.15)', padding: '16px 20px', width: 360, display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: isRunning ? 'linear-gradient(135deg,#6366f1,#4338ca)' : isDone ? 'linear-gradient(135deg,#22c55e,#16a34a)' : 'linear-gradient(135deg,#ef4444,#dc2626)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {isRunning && <Loader2 size={16} style={{ color: '#fff', animation: 'spin 0.8s linear infinite' }} />}
          {isDone && <CheckCircle2 size={16} style={{ color: '#fff' }} />}
          {isFailed && <XCircle size={16} style={{ color: '#fff' }} />}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: titleColor }}>{isDone ? 'Синхронизация завершена' : isFailed ? 'Ошибка синхронизации' : 'Синхронизация WB...'}</div>
          {isRunning && <div style={{ fontSize: 11, color: '#6366f1', fontWeight: 500 }}>{task.progress}%</div>}
        </div>
        {(isDone || isFailed) && <button onClick={() => { setDismissed(true); if (storeId) clearSyncTask(storeId); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 2 }}><X size={15} /></button>}
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: isRunning ? 8 : 0 }}>{task.step}</div>
      {isRunning && <div style={{ height: 5, background: '#e0e3ff', borderRadius: 99, overflow: 'hidden' }}><div style={{ height: '100%', width: `${task.progress}%`, background: 'linear-gradient(90deg,#6366f1,#4338ca)', borderRadius: 99, transition: 'width 0.6s ease' }} /></div>}
    </div>
  );
}
