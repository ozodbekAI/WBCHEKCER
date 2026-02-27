import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import api from '../api/client';
import { AlertTriangle } from 'lucide-react';

type Step = 1 | 2 | 3;

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { loadStores, setActiveStore } = useStore();
  const [step, setStep] = useState<Step>(1);
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Step 2 progress
  const [progress, setProgress] = useState(0);
  const progressInterval = useRef<number>();

  // Step 3 results
  const [result, setResult] = useState<any>(null);

  const startOnboarding = async () => {
    if (!apiKey.trim() || apiKey.length < 10) {
      setError('Введите корректный API-ключ');
      return;
    }

    setError('');
    setLoading(true);
    setStep(2);
    setProgress(0);

    // Simulate progress while API call runs
    let p = 0;
    progressInterval.current = window.setInterval(() => {
      p += Math.random() * 8 + 2;
      if (p > 90) p = 90;
      setProgress(Math.round(p));
    }, 800);

    try {
      const data = await api.onboard(apiKey);
      clearInterval(progressInterval.current);
      setProgress(100);

      // Small delay to show 100%
      await new Promise((r) => setTimeout(r, 500));

      setResult(data);
      setStep(3);

      // Reload stores
      await loadStores();
    } catch (err: any) {
      clearInterval(progressInterval.current);
      setError(err.message || 'Ошибка подключения');
      setStep(1);
      setLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      if (progressInterval.current) clearInterval(progressInterval.current);
    };
  }, []);

  const goToWorkspace = () => {
    if (result?.store_id) {
      navigate('/workspace');
    }
  };

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

          <h2>Анализируем карточки</h2>
          <p className="subtitle">Ищем точки роста и критические проблемы</p>

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

          <h2>Анализ завершён</h2>
          <p className="subtitle">
            Мы проанализировали весь ваш магазин. Выберите, как хотите продолжить.
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
