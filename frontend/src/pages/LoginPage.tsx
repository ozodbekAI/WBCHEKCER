import React, { useMemo, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useIsMobile } from '../hooks/use-mobile';
import { Eye, EyeOff, Sparkles, LogIn } from 'lucide-react';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const nextPath = useMemo(() => {
    const raw = (searchParams.get('next') || '').trim();
    if (!raw.startsWith('/')) return null;
    if (raw.startsWith('//')) return null;
    if (raw === '/login') return null;
    return raw;
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      const target = nextPath || (window.innerWidth < 768 ? '/photo-studio' : '/workspace');
      navigate(target, { replace: true });
    } catch (err: any) {
      if (err?.code === 'ACCOUNT_NOT_VERIFIED' || /не активирован/i.test(String(err?.message || ''))) {
        localStorage.setItem('pending_verify_email', err?.email || email);
        navigate(`/verify-email?email=${encodeURIComponent(err?.email || email)}`);
        return;
      }
      setError(err.message || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  if (isMobile) {
    return (
      <div className="login-mobile">
        <div className="login-mobile-top">
          <div className="login-mobile-logo">
            <Sparkles size={32} />
          </div>
          <h1 className="login-mobile-title">AI Фотостудия</h1>
          <p className="login-mobile-desc">Войдите, чтобы начать работу</p>
        </div>

        <div className="login-mobile-form-wrap">
          {error && <div className="login-mobile-error">{error}</div>}

          <form onSubmit={handleSubmit} className="login-mobile-form">
            <div className="login-mobile-field">
              <label>Email</label>
              <input
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoCapitalize="off"
              />
            </div>

            <div className="login-mobile-field">
              <label>Пароль</label>
              <div className="login-mobile-pw-wrap">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Введите пароль"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="login-mobile-pw-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="login-mobile-submit"
              disabled={loading}
            >
              {loading ? (
                <span className="login-mobile-spinner" />
              ) : (
                <>
                  <LogIn size={18} />
                  Войти
                </>
              )}
            </button>
          </form>

          <div className="login-mobile-footer">
            Нет аккаунта? <Link to="/register">Зарегистрироваться</Link>
          </div>
        </div>
      </div>
    );
  }

  // Desktop layout (unchanged)
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>Вход в аккаунт</h2>
        <p className="auth-subtitle">Войдите для управления карточками</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-input"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Пароль</label>
            <input
              type="password"
              className="form-input"
              placeholder="Введите пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block btn-lg"
            disabled={loading}
          >
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>

        <div className="auth-footer">
          Нет аккаунта? <Link to="/register">Зарегистрироваться</Link>
        </div>
      </div>
    </div>
  );
}
