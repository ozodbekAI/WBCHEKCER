import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function RegisterPage() {
  const navigate = useNavigate();
  const { registerStart, resendRegisterCode, verifyRegisterCode } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'register' | 'verify'>('register');
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
  const canResend = secondsLeft <= 0;

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (password.length < 6) {
      setError('Пароль должен быть минимум 6 символов');
      return;
    }
    if (password !== confirmPassword) {
      setError('Подтверждение пароля не совпадает');
      return;
    }
    setLoading(true);
    try {
      const res = await registerStart(email, password, firstName || undefined, lastName || undefined);
      setSuccess(res.message || 'Код отправлен на email');
      setStep('verify');
      setCooldownUntil(Date.now() + (res.cooldown_seconds || 120) * 1000);
      localStorage.setItem('pending_verify_email', email);
    } catch (err: any) {
      setError(err.message || 'Ошибка регистрации');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Введите 6-значный код');
      return;
    }
    setLoading(true);
    try {
      await verifyRegisterCode(email, code.trim());
      localStorage.removeItem('pending_verify_email');
      navigate('/onboard');
    } catch (err: any) {
      setError(err.message || 'Неверный код');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!canResend || loading) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await resendRegisterCode(email);
      setSuccess(res.message || 'Код отправлен повторно');
      setCooldownUntil(Date.now() + (res.cooldown_seconds || 120) * 1000);
    } catch (err: any) {
      setError(err.message || 'Не удалось отправить код');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card auth-card--wide">
        <h2>{step === 'register' ? 'Регистрация' : 'Подтверждение Email'}</h2>
        <p className="auth-subtitle">
          {step === 'register'
            ? 'Введите email и пароль, затем подтвердите аккаунт кодом из письма'
            : `Код отправлен на ${email}`}
        </p>

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        {step === 'register' ? (
          <form onSubmit={handleStart}>
            <div className="form-group">
              <label className="form-label">Имя</label>
              <input className="form-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Фамилия</label>
              <input className="form-input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input type="email" className="form-input" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Пароль</label>
              <input type="password" className="form-input" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </div>
            <div className="form-group">
              <label className="form-label">Подтверждение пароля</label>
              <input type="password" className="form-input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={6} />
            </div>
            <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
              {loading ? 'Отправка...' : 'Создать аккаунт'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify}>
            <div className="form-group">
              <label className="form-label">Код из email</label>
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
              {loading ? 'Проверка...' : 'Подтвердить и войти'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-block"
              disabled={!canResend || loading}
              onClick={handleResend}
              style={{ marginTop: 10 }}
            >
              {canResend
                ? 'Отправить код повторно'
                : `Повторная отправка через ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`}
            </button>
          </form>
        )}

        <div className="auth-footer">
          Уже есть аккаунт? <Link to="/login">Войти</Link>
        </div>
      </div>
    </div>
  );
}
