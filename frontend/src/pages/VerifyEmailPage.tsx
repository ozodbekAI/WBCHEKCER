import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function VerifyEmailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { resendRegisterCode, verifyRegisterCode } = useAuth();

  const initialEmail =
    (location.state as any)?.email ||
    searchParams.get('email') ||
    localStorage.getItem('pending_verify_email') ||
    '';

  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  const secondsLeft = useMemo(
    () => Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000)),
    [cooldownUntil, tick],
  );

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!email) {
      setError('Введите email');
      return;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Введите 6-значный код');
      return;
    }
    setLoading(true);
    try {
      await verifyRegisterCode(email.trim(), code.trim());
      localStorage.removeItem('pending_verify_email');
      navigate('/onboard');
    } catch (err: any) {
      setError(err.message || 'Ошибка подтверждения');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (secondsLeft > 0 || loading) return;
    setError('');
    setSuccess('');
    if (!email) {
      setError('Введите email');
      return;
    }
    setLoading(true);
    try {
      const res = await resendRegisterCode(email.trim());
      setSuccess(res.message || 'Код отправлен повторно');
      setCooldownUntil(Date.now() + (res.cooldown_seconds || 120) * 1000);
      localStorage.setItem('pending_verify_email', email.trim());
    } catch (err: any) {
      setError(err.message || 'Не удалось отправить код');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card auth-card--wide">
        <h2>Активация аккаунта</h2>
        <p className="auth-subtitle">Введите код из письма, чтобы активировать аккаунт</p>

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        <form onSubmit={handleVerify}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input type="email" className="form-input" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="form-group">
            <label className="form-label">Код подтверждения</label>
            <input
              type="text"
              className="form-input auth-code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              maxLength={6}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
            {loading ? 'Проверка...' : 'Активировать аккаунт'}
          </button>
        </form>

        <button
          type="button"
          className="btn btn-secondary btn-block"
          onClick={handleResend}
          disabled={secondsLeft > 0 || loading}
          style={{ marginTop: 10 }}
        >
          {secondsLeft > 0
            ? `Отправить повторно через ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
            : 'Отправить код повторно'}
        </button>

        <div className="auth-footer">
          <Link to="/login">Назад ко входу</Link>
        </div>
      </div>
    </div>
  );
}
