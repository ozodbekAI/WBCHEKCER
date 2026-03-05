import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function LandingPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const handleConnect = () => {
    if (isAuthenticated) {
      navigate('/workspace');
    } else {
      navigate('/login');
    }
  };

  return (
    <div className="landing">
      <div className="landing-login-link">
        {isAuthenticated ? (
          <button className="btn btn-ghost" onClick={() => navigate('/workspace')}>
            Рабочее пространство →
          </button>
        ) : (
          <button className="btn btn-ghost" onClick={() => navigate('/login')}>
            Войти
          </button>
        )}
      </div>

      <div className="landing-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      </div>

      <h1>Оптимизация карточек Wildberries без ручной рутины</h1>

      <p className="landing-subtitle">
        Находим ошибки, улучшаем контент, тестируем фото и видео
      </p>

      <div className="landing-cta">
        <button className="btn btn-primary" onClick={handleConnect}>
          Подключить магазин →
        </button>

        <span className="landing-note">
          Без списаний и платных операций на этапе анализа
        </span>

        <div className="landing-divider">или</div>

        <button className="landing-alt-btn" onClick={() => navigate('/workspace')}>
          <div className="icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6C5CE7" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
          </div>
          <div className="text">
            <div className="title">Рабочее пространство</div>
            <div className="desc">Перейти к управлению карточками</div>
          </div>
          <span style={{ marginLeft: 'auto', color: '#9CA3AF' }}>→</span>
        </button>
      </div>
    </div>
  );
}
