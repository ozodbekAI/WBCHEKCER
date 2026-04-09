import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, User } from 'lucide-react';
import api, { API_ORIGIN } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

function toAbsoluteMediaUrl(url?: string | null): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`;
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [profileMsg, setProfileMsg] = useState('');
  const [profileError, setProfileError] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => {
    setFirstName(user?.first_name || '');
    setLastName(user?.last_name || '');
  }, [user]);

  const avatarUrl = useMemo(() => toAbsoluteMediaUrl(user?.avatar_url), [user?.avatar_url]);

  const handleSaveProfile = async () => {
    setProfileSaving(true);
    setProfileMsg('');
    setProfileError('');
    try {
      await api.updateMe({
        first_name: firstName.trim() || undefined,
        last_name: lastName.trim() || undefined,
      });
      await refreshUser();
      setProfileMsg('Профиль обновлён');
    } catch (e: any) {
      setProfileError(e?.message || 'Не удалось обновить профиль');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    setProfileMsg('');
    setProfileError('');
    try {
      await api.uploadMyAvatar(file);
      await refreshUser();
      setProfileMsg('Фото профиля обновлено');
    } catch (err: any) {
      setProfileError(err?.message || 'Не удалось загрузить фото');
    } finally {
      setAvatarUploading(false);
      e.target.value = '';
    }
  };

  const handleChangePassword = async () => {
    setPasswordMsg('');
    setPasswordError('');
    if (!currentPassword || !newPassword) {
      setPasswordError('Заполните текущий и новый пароль');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('Новый пароль должен быть минимум 6 символов');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Подтверждение пароля не совпадает');
      return;
    }

    setPasswordSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMsg('Пароль успешно изменён');
    } catch (e: any) {
      setPasswordError(e?.message || 'Не удалось изменить пароль');
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <div className="profile-page">
      <div className="profile-card">
        <div className="profile-head">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/workspace')}>
            <ArrowLeft size={14} /> Назад
          </button>
          <h2>Profile</h2>
        </div>

        {profileError && <div className="alert alert-error">{profileError}</div>}
        {profileMsg && <div className="alert alert-success">{profileMsg}</div>}

        <div className="profile-avatar-block">
          <div className="profile-avatar-large">
            {avatarUrl ? (
              <img src={avatarUrl} alt="avatar" />
            ) : (
              user?.first_name?.[0]?.toUpperCase() || <User size={24} />
            )}
          </div>
          <label className="btn btn-secondary btn-sm profile-avatar-upload">
            <Camera size={14} /> {avatarUploading ? 'Загрузка...' : 'Сменить фото'}
            <input type="file" accept="image/*" onChange={handleAvatarFile} disabled={avatarUploading} />
          </label>
        </div>

        <div className="form-group">
          <label className="form-label">Email</label>
          <input type="email" className="form-input" value={user?.email || ''} disabled />
        </div>
        <div className="form-group">
          <label className="form-label">Имя</label>
          <input type="text" className="form-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Фамилия</label>
          <input type="text" className="form-input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <button className="btn btn-primary btn-block" onClick={handleSaveProfile} disabled={profileSaving}>
          {profileSaving ? 'Сохранение...' : 'Сохранить профиль'}
        </button>

        <div className="profile-divider" />
        <h3>Смена пароля</h3>
        {passwordError && <div className="alert alert-error">{passwordError}</div>}
        {passwordMsg && <div className="alert alert-success">{passwordMsg}</div>}

        <div className="form-group">
          <label className="form-label">Текущий пароль</label>
          <input
            type="password"
            className="form-input"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Новый пароль</label>
          <input
            type="password"
            className="form-input"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Подтверждение</label>
          <input
            type="password"
            className="form-input"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        <button className="btn btn-primary btn-block" onClick={handleChangePassword} disabled={passwordSaving}>
          {passwordSaving ? 'Сохранение...' : 'Изменить пароль'}
        </button>
      </div>
    </div>
  );
}
