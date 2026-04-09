import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import { AlertTriangle } from 'lucide-react';
import type { OnboardResult, OnboardingTaskStatus } from '../types';
import { getDeniedStoreFeatures } from '../lib/storeAccess';

type Step = 1 | 2 | 3;
const ONBOARDING_TASK_KEY = 'wb_onboarding_task_id';
const DEFAULT_PROGRESS_STEP = 'Ищем точки роста и критические проблемы';

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { loadStores } = useStore();
  const { isRole } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Step 2 progress
  const [progress, setProgress] = useState(0);
  const [progressStep, setProgressStep] = useState(DEFAULT_PROGRESS_STEP);
  const [cancelling, setCancelling] = useState(false);
  const pollRef = useRef<number>();
  const activeTaskRef = useRef<string | null>(null);

  // Step 3 results
  const [result, setResult] = useState<OnboardResult | null>(null);

  const stopPolling = useCallback(() => {
    activeTaskRef.current = null;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = undefined;
    }
  }, []);

  const resetToStepOne = useCallback((message: string) => {
    stopPolling();
    localStorage.removeItem(ONBOARDING_TASK_KEY);
    setLoading(false);
    setCancelling(false);
    setProgress(0);
    setProgressStep(DEFAULT_PROGRESS_STEP);
    setResult(null);
    setError(message);
    setStep(1);
  }, [stopPolling]);

  const finishOnboarding = useCallback(async (task: OnboardingTaskStatus) => {
    stopPolling();
    localStorage.removeItem(ONBOARDING_TASK_KEY);
    setLoading(false);
    setCancelling(false);
    setProgress(100);
    setProgressStep(task.step || 'Подключение завершено');

    if (!task.result) {
      setError('Подключение завершилось без итогового результата');
      setStep(1);
      return;
    }

    setResult(task.result);
    setStep(3);

    try {
      await loadStores();
    } catch {
      // Result screen can still be shown even if store refresh fails.
    }
  }, [loadStores, stopPolling]);

  const pollTask = useCallback(async (taskId: string) => {
    try {
      const data = await api.getOnboardingStatus(taskId);
      if (activeTaskRef.current !== taskId) return;

      setProgress(Math.max(0, Math.min(data.progress ?? 0, 100)));
      setProgressStep(data.step || DEFAULT_PROGRESS_STEP);

      if (data.status === 'completed') {
        await finishOnboarding(data);
        return;
      }

      if (data.status === 'cancelling') {
        setCancelling(true);
        return;
      }

      if (data.status === 'failed' || data.status === 'cancelled') {
        resetToStepOne(data.error || data.step || 'Ошибка подключения');
      }
    } catch (err: any) {
      if (activeTaskRef.current !== taskId) return;
      resetToStepOne(err.message || 'Не удалось получить статус подключения');
    }
  }, [finishOnboarding, resetToStepOne]);

  const startPolling = useCallback((taskId: string) => {
    stopPolling();
    activeTaskRef.current = taskId;
    setLoading(true);
    setCancelling(false);
    setStep(2);
    void pollTask(taskId);
    pollRef.current = window.setInterval(() => {
      void pollTask(taskId);
    }, 2500);
  }, [pollTask, stopPolling]);

  const startOnboarding = async () => {
    if (!apiKey.trim() || apiKey.length < 10) {
      setError('Введите корректный API-ключ');
      return;
    }

    setError('');
    setResult(null);
    setLoading(true);
    setCancelling(false);
    setStep(2);
    setProgress(0);
    setProgressStep('Проверяем ключ Wildberries...');

    try {
      const data = await api.startOnboarding(apiKey);
      localStorage.setItem(ONBOARDING_TASK_KEY, data.task_id);
      startPolling(data.task_id);
    } catch (err: any) {
      resetToStepOne(err.message || 'Ошибка подключения');
    }
  };

  useEffect(() => {
    const savedTaskId = localStorage.getItem(ONBOARDING_TASK_KEY);
    if (savedTaskId) {
      setError('');
      setResult(null);
      setProgress(0);
      setProgressStep('Восстанавливаем статус подключения...');
      startPolling(savedTaskId);
    }

    return () => {
      stopPolling();
    };
  }, [startPolling, stopPolling]);

  const goToWorkspace = () => {
    if (result?.store_id) {
      navigate('/workspace');
    }
  };

  const cancelOnboarding = async () => {
    const taskId = activeTaskRef.current;
    if (!taskId || cancelling) return;

    setCancelling(true);
    try {
      const next = await api.cancelOnboarding(taskId);
      setProgress(Math.max(0, Math.min(next.progress ?? progress, 100)));
      setProgressStep(next.step || 'Останавливаем подключение...');
      if (next.status === 'cancelled') {
        resetToStepOne(next.step || 'Подключение отменено');
      }
    } catch (err: any) {
      setCancelling(false);
      setError(err.message || 'Не удалось остановить подключение');
    }
  };

  const deniedFeatures = getDeniedStoreFeatures(result?.wb_token_access);
  const suggestedSeparateKeys = Array.from(new Set(
    deniedFeatures.flatMap((feature) => feature.recommended_slot_labels || []),
  ));
  const cardsAccessAllowed = !!result?.wb_token_access?.features?.cards?.allowed;
  const analysisSkipped = !!result && !cardsAccessAllowed && result.cards_synced === 0;

  if (!isRole('owner')) {
    return (
      <div className="onboarding">
        <div className="onboard-card">
          <h2>Доступ ограничен</h2>
          <p className="subtitle">
            Подключать новый магазин может только пользователь с ролью Owner.
          </p>
          <button className="btn btn-primary btn-block btn-lg" onClick={() => navigate('/workspace')}>
            В рабочее пространство
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="onboarding">
      {/* Steps indicator */}
      <div className="steps-indicator">
        <span>Шаг {step} из 3</span>
        <div className={`step-dot ${step === 1 ? 'active' : 'done'}`} />
        <div className={`step-dot ${step === 2 ? 'active' : step > 2 ? 'done' : ''}`} />
        <div className={`step-dot ${step === 3 ? 'active' : ''}`} />
      </div>

      {/* ===================== Step 1: API Key ===================== */}
      {step === 1 && (
        <div className="onboard-card">
          <div className="icon-circle purple">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6C5CE7" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9,22 9,12 15,12 15,22" />
            </svg>
          </div>

          <h2>Подключение магазина</h2>
          <p className="subtitle">Введите API-ключ от вашего кабинета Wildberries</p>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="form-group" style={{ textAlign: 'left' }}>
            <label className="form-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
              API-ключ
            </label>
            <input
              type="text"
              className="form-input"
              placeholder="Вставьте ключ сюда..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoFocus
            />
            <p className="form-hint">
              Ключ используется для чтения данных и применения изменений только по вашему подтверждению
            </p>
          </div>

          <div className="api-key-help">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Где взять API-ключ?
          </div>

          <button
            className="btn btn-primary btn-block btn-lg"
            onClick={startOnboarding}
            disabled={loading}
            style={{ opacity: apiKey.length < 10 ? 0.6 : 1 }}
          >
            Проверить и подключить
          </button>

          <div className="back-link" onClick={() => navigate('/')}>
            ← Назад
          </div>
        </div>
      )}

      {/* ===================== Step 2: Analysis Progress ===================== */}
      {step === 2 && (
        <div className="onboard-card">
          <div style={{ margin: '0 auto 24px', width: 56, height: 56 }}>
            <div className="spinner" style={{ width: 56, height: 56, borderWidth: 4 }} />
          </div>

          <h2>Проверяем ключ и подключаем магазин</h2>
          <p className="subtitle">{progressStep}</p>

          <div className="progress-container">
            <div className="progress-bar-bg">
              <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="progress-info">
              <span>{progress}%</span>
              <span className="time">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12,6 12,12 16,14" />
                </svg>
                1–3 минуты
              </span>
            </div>
          </div>

          <div className="can-close-note">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            Можно закрыть вкладку — анализ продолжится
          </div>

          <button
            className="btn btn-secondary btn-block"
            onClick={() => void cancelOnboarding()}
            disabled={cancelling}
            style={{ marginTop: 16 }}
          >
            {cancelling ? 'Останавливаем...' : 'Отменить подключение'}
          </button>
        </div>
      )}

      {/* ===================== Step 3: Results ===================== */}
      {step === 3 && result && (
        <div className="onboard-card">
          <div className="icon-circle green">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22,4 12,14.01 9,11.01" />
            </svg>
          </div>

          <h2>{analysisSkipped ? 'Магазин подключён' : 'Анализ завершён'}</h2>
          <p className="subtitle">
            {analysisSkipped
              ? 'Основной ключ проверен и магазин подключён. Для анализа карточек и закрытых разделов добавьте отдельные ключи в настройках магазина.'
              : 'Мы проанализировали весь ваш магазин. Выберите, как хотите продолжить.'}
          </p>

          <div className="results-row">
            <div className="result-stat">
              <div className="value">{result.cards_synced}</div>
              <div className="label">Всего карточек</div>
            </div>
            <div className="result-stat">
              <div className="value critical">
                                <AlertTriangle size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> {result.issues_found}
              </div>
              <div className="label">Проблем найдено</div>
            </div>
            <div className="result-stat">
              <div className="value growth">
                ~+{Math.min(Math.round(result.issues_found * 1.5), 40)}%
              </div>
              <div className="label">Потенциал</div>
            </div>
          </div>

          <div className="choice-section">
            <p>Как вы хотите работать?</p>

            {deniedFeatures.length > 0 && (
              <div className="alert" style={{ textAlign: 'left', marginBottom: 16, background: '#FFF7ED', border: '1px solid #FDBA74', color: '#9A3412' }}>
                <strong>Часть разделов будет недоступна с текущим ключом.</strong>
                <div style={{ marginTop: 8 }}>
                  Недоступно: {deniedFeatures.map((feature) => feature.label).join(', ')}.
                </div>
                <div style={{ marginTop: 6 }}>
                  Обновите ключ или подключите отдельный ключ для этих разделов.
                </div>
                {suggestedSeparateKeys.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    Подойдут отдельные ключи: {suggestedSeparateKeys.join(', ')}.
                  </div>
                )}
              </div>
            )}

            <button className="choice-btn primary" onClick={goToWorkspace}>
              <div className="choice-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
              </div>
              <div className="choice-text">
                <div className="choice-title">Я не знаю, что делать — сделайте за меня</div>
                <div className="choice-desc">Пошаговый мастер оптимизации</div>
              </div>
            </button>

            <button className="choice-btn secondary" onClick={goToWorkspace}>
              <div className="choice-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
              </div>
              <div className="choice-text">
                <div className="choice-title">Я хочу работать сам</div>
                <div className="choice-desc">Рабочее пространство с полным контролем</div>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
