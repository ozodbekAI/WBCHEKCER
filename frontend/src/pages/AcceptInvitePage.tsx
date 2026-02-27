import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { KeyRound, Eye, EyeOff, CheckCircle, AlertCircle } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';

const ROLE_LABELS: Record<string, string> = {
  owner: 'Владелец',
  head_manager: 'Старший менеджер',
  manager: 'Менеджер',
  viewer: 'Наблюдатель',
  user: 'Пользователь',
};

export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuth();
  const token = params.get('token') || '';

  const [inviteInfo, setInviteInfo] = useState<{ email: string; first_name: string | null; role: string } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const [firstName, setFirstName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('Ссылка недействительна');
      setLoading(false);
      return;
    }
    api.getInviteInfo(token)
      .then((info) => {
        setInviteInfo(info);
        if (info.first_name) setFirstName(info.first_name);
      })
      .catch(() => setError('Ссылка недействительна или срок действия истёк'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPass) {
      setError('Пароли не совпадают');
      return;
    }
    if (password.length < 6) {
      setError('Пароль должен быть не менее 6 символов');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const data = await api.acceptInvite(token, password, firstName || undefined);
      // Auto-login
      api.setToken(data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      setDone(true);
      setTimeout(() => navigate('/workspace'), 1800);
    } catch (e: any) {
      setError(e.message || 'Ошибка при активации');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-page"><div className="loading-center"><div className="spinner" /></div></div>
    );
  }

  return (
    <div className="accept-invite-page">
      <div className="accept-invite-card">
        <div className="accept-invite-logo">
          <KeyRound size={32} color="#2563eb" />
          <h1>WB Optimizer</h1>
        </div>

        {done ? (
          <div className="accept-invite-success">
            <CheckCircle size={48} color="#059669" />
            <h2>Добро пожаловать!</h2>
            <p>Аккаунт создан. Перенаправляем...</p>
          </div>
        ) : error && !inviteInfo ? (
          <div className="accept-invite-error">
            <AlertCircle size={40} color="#dc2626" />
            <h2>Ссылка недействительна</h2>
            <p>{error}</p>
            <button className="btn-primary" onClick={() => navigate('/login')}>
              Войти
            </button>
          </div>
        ) : (
          <>
            <div className="accept-invite-header">
              <h2>Принять приглашение</h2>
              {inviteInfo && (
                <p>
                  Вас приглашают как <strong>{ROLE_LABELS[inviteInfo.role] || inviteInfo.role}</strong>
                </p>
              )}
            </div>

            <form onSubmit={handleSubmit} className="accept-invite-form">
              <div className="form-field">
                <label>Email</label>
                <input
                  type="email"
                  value={inviteInfo?.email || ''}
                  disabled
                  className="input-disabled"
                />
              </div>

              <div className="form-field">
                <label>Имя (необязательно)</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Ваше имя"
                />
              </div>

              <div className="form-field">
                <label>Пароль</label>
                <div className="input-with-icon">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Минимум 6 символов"
                    required
                    minLength={6}
                  />
                  <button type="button" className="input-icon-btn" onClick={() => setShowPass(!showPass)}>
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="form-field">
                <label>Повторите пароль</label>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={confirmPass}
                  onChange={(e) => setConfirmPass(e.target.value)}
                  placeholder="Повторите пароль"
                  required
                />
              </div>

              {error && (
                <div className="accept-invite-err-msg">
                  <AlertCircle size={14} /> {error}
                </div>
              )}

              <button
                type="submit"
                className="btn-primary btn-full"
                disabled={submitting || !password || !confirmPass}
              >
                {submitting ? 'Создаём аккаунт...' : 'Создать аккаунт'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
