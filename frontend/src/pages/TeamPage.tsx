import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Users, Shield, UserPlus, ChevronDown,
  Check, X, MoreVertical, Eye, Edit3, Crown, Star, Settings, ToggleLeft, ToggleRight
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useStore } from '../contexts/StoreContext';
import type { TeamMember, RoleInfo, PermissionInfo, PermissionsListOut } from '../types';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  owner: 'Владелец',
  head_manager: 'Старший менеджер',
  manager: 'Менеджер',
  viewer: 'Наблюдатель',
  user: 'Пользователь',
};

const ROLE_COLORS: Record<string, string> = {
  admin: '#dc2626',
  owner: '#7c3aed',
  head_manager: '#2563eb',
  manager: '#059669',
  viewer: '#6b7280',
  user: '#6b7280',
};

const ROLE_ICONS: Record<string, React.ReactNode> = {
  admin: <Crown size={14} />,
  owner: <Crown size={14} />,
  head_manager: <Star size={14} />,
  manager: <Edit3 size={14} />,
  viewer: <Eye size={14} />,
  user: <Eye size={14} />,
};

export default function TeamPage() {
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const { activeStore, loading: storeLoading, loadStores } = useStore();
  const storeId = activeStore?.id;

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite modal state
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('manager');
  const [inviteCustomPerms, setInviteCustomPerms] = useState<string[]>([]);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  // Role edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRole, setEditRole] = useState('');

  // Permission editor modal state
  const [permTarget, setPermTarget] = useState<TeamMember | null>(null);
  const [permRole, setPermRole] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [selectedPerms, setSelectedPerms] = useState<string[]>([]);
  const [permsList, setPermsList] = useState<PermissionsListOut | null>(null);
  const [savingPerms, setSavingPerms] = useState(false);

  const canManage = hasPermission('team.manage');

  const loadData = useCallback(async () => {
    if (!storeId) {
      if (!storeLoading) setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [m, r] = await Promise.all([
        api.getTeamMembers(storeId),
        api.getRoles(storeId),
      ]);
      setMembers(m);
      setRoles(r);
      // Load permissions list for editor
      if (canManage) {
        try {
          const p = await api.getPermissionsList(storeId);
          setPermsList(p);
        } catch {}
      }
    } catch (e) {
      console.error('Failed to load team:', e);
    } finally {
      setLoading(false);
    }
  }, [storeId, storeLoading, canManage]);

  useEffect(() => {
    if (!activeStore) loadStores();
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleInvite = async () => {
    if (!storeId || !inviteEmail) return;
    setInviting(true);
    setInviteError(null);
    try {
      const isCustom = inviteRole === 'custom';
      await api.inviteTeamMember(storeId, {
        email: inviteEmail,
        role: isCustom ? 'manager' : inviteRole,
        first_name: inviteName || undefined,
        custom_permissions: isCustom ? inviteCustomPerms : undefined,
      });
      setInviteSuccess(inviteEmail);
      await loadData();
    } catch (e: any) {
      setInviteError(e.message || 'Ошибка при отправке приглашения');
    } finally {
      setInviting(false);
    }
  };

  const toggleInviteCustomPerm = (pid: string) => {
    setInviteCustomPerms(prev =>
      prev.includes(pid) ? prev.filter(p => p !== pid) : [...prev, pid]
    );
  };

  const handleRoleChange = async (userId: number, newRole: string) => {
    if (!storeId) return;
    try {
      await api.updateTeamMember(storeId, userId, { role: newRole });
      setEditingId(null);
      await loadData();
    } catch (e: any) {
      alert(e.message || 'Ошибка при обновлении');
    }
  };

  const handleToggleActive = async (userId: number, isActive: boolean) => {
    if (!storeId) return;
    try {
      await api.updateTeamMember(storeId, userId, { is_active: !isActive });
      await loadData();
    } catch (e: any) {
      alert(e.message || 'Ошибка');
    }
  };

  const openPermEditor = (member: TeamMember) => {
    setPermTarget(member);
    setPermRole(member.role);
    const hasCustom = member.custom_permissions && member.custom_permissions.length > 0;
    setUseCustom(!!hasCustom);
    if (hasCustom) {
      setSelectedPerms([...member.custom_permissions!]);
    } else {
      // Load role default permissions
      const roleInfo = roles.find(r => r.id === member.role);
      setSelectedPerms(roleInfo ? [...roleInfo.permissions] : [...(member.permissions || [])]);
    }
  };

  const handlePermToggle = (permId: string) => {
    setSelectedPerms(prev =>
      prev.includes(permId) ? prev.filter(p => p !== permId) : [...prev, permId]
    );
  };

  const handlePermSave = async () => {
    if (!storeId || !permTarget) return;
    setSavingPerms(true);
    try {
      const data: { role?: string; custom_permissions?: string[] | null } = {};
      if (permRole !== permTarget.role) data.role = permRole;
      if (useCustom) {
        data.custom_permissions = selectedPerms;
      } else {
        data.custom_permissions = []; // empty array = reset to role defaults
      }
      await api.updateTeamMember(storeId, permTarget.id, data);
      setPermTarget(null);
      await loadData();
    } catch (e: any) {
      alert(e.message || 'Ошибка при сохранении');
    } finally {
      setSavingPerms(false);
    }
  };

  // When role changes in perm editor, update default perms
  const handlePermRoleChange = (newRole: string) => {
    setPermRole(newRole);
    if (!useCustom) {
      const roleInfo = roles.find(r => r.id === newRole);
      setSelectedPerms(roleInfo ? [...roleInfo.permissions] : []);
    }
  };

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const formatTime = (d: string | null) => {
    if (!d) return 'Никогда';
    const dt = new Date(d);
    const now = new Date();
    const diff = now.getTime() - dt.getTime();
    if (diff < 60000) return 'Только что';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} мин назад`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} ч назад`;
    return dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  };

  if (loading) {
    return (
      <div className="loading-page"><div className="loading-center"><div className="spinner" /></div></div>
    );
  }

  return (
    <div className="team-page">
      {/* Header */}
      <div className="team-header">
        <button className="btn-back" onClick={() => navigate('/workspace')}>
          <ArrowLeft size={18} />
        </button>
        <div className="team-header-info">
          <h1><Users size={22} /> Команда</h1>
          <span className="team-count">{members.length} участников</span>
        </div>
        {canManage && (
          <button className="btn-primary" onClick={() => setShowInvite(true)}>
            <UserPlus size={16} /> Пригласить
          </button>
        )}
      </div>

      {/* Roles overview */}
      <div className="team-roles-grid">
        {roles.map((role) => (
          <div key={role.id} className="team-role-card" style={{ borderColor: ROLE_COLORS[role.id] || '#d1d5db' }}>
            <div className="team-role-card-icon" style={{ color: ROLE_COLORS[role.id] }}>
              {ROLE_ICONS[role.id]}
            </div>
            <div className="team-role-card-info">
              <div className="team-role-card-name">{role.name}</div>
              <div className="team-role-card-desc">{role.description}</div>
            </div>
            <div className="team-role-card-count">{role.user_count}</div>
          </div>
        ))}
      </div>

      {/* Members table */}
      <div className="team-table-wrap">
        <table className="team-table">
          <thead>
            <tr>
              <th>Пользователь</th>
              <th>Роль</th>
              <th>Исправлений</th>
              <th>На проверке</th>
              <th>Одобрено</th>
              <th>Последний вход</th>
              {canManage && <th></th>}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className={!m.is_active ? 'team-row-disabled' : ''}>
                <td>
                  <div className="team-member-info">
                    <div className="team-avatar" style={{ background: ROLE_COLORS[m.role] || '#6b7280' }}>
                      {(m.first_name?.[0] || m.email[0]).toUpperCase()}
                    </div>
                    <div>
                      <div className="team-member-name">
                        {m.first_name || m.email.split('@')[0]}
                        {m.id === user?.id && <span className="team-you-badge">Вы</span>}
                      </div>
                      <div className="team-member-email">{m.email}</div>
                    </div>
                  </div>
                </td>
                <td>
                  {editingId === m.id ? (
                    <div className="team-role-edit">
                      <select
                        value={editRole}
                        onChange={(e) => setEditRole(e.target.value)}
                        className="team-role-select"
                      >
                        <option value="owner">Владелец</option>
                        <option value="head_manager">Старший менеджер</option>
                        <option value="manager">Менеджер</option>
                        <option value="viewer">Наблюдатель</option>
                      </select>
                      <button className="team-role-save" onClick={() => handleRoleChange(m.id, editRole)}>
                        <Check size={14} />
                      </button>
                      <button className="team-role-cancel" onClick={() => setEditingId(null)}>
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <span
                      className={`team-role-badge ${canManage && m.id !== user?.id ? 'team-role-badge--editable' : ''}`}
                      style={{ background: `${ROLE_COLORS[m.role] || '#6b7280'}15`, color: ROLE_COLORS[m.role] }}
                      onClick={() => { if (canManage && m.id !== user?.id) openPermEditor(m); }}
                    >
                      {ROLE_ICONS[m.role]} {ROLE_LABELS[m.role] || m.role}
                      {m.custom_permissions && m.custom_permissions.length > 0 && (
                        <span className="team-custom-badge" title="Кастомные права">✦</span>
                      )}
                      {canManage && m.id !== user?.id && <ChevronDown size={12} style={{ marginLeft: 2, opacity: 0.5 }} />}
                    </span>
                  )}
                </td>
                <td>
                  <div className="team-stat">
                    <span className="team-stat-big">{m.fixes_total}</span>
                    {m.fixes_today > 0 && <span className="team-stat-today">+{m.fixes_today} сегодня</span>}
                  </div>
                </td>
                <td>
                  {m.approvals_pending > 0 ? (
                    <span className="team-pending-badge">{m.approvals_pending}</span>
                  ) : (
                    <span className="team-stat-zero">0</span>
                  )}
                </td>
                <td>
                  <span className="team-approved-count">{m.approvals_approved}</span>
                </td>
                <td>
                  <span className="team-last-login">{formatTime(m.last_login)}</span>
                </td>
                {canManage && (
                  <td>
                    {m.id !== user?.id && (
                      <div className="team-actions">
                        <button
                          className="team-action-btn"
                          title="Настройки доступа"
                          onClick={() => openPermEditor(m)}
                        >
                          <Settings size={14} />
                        </button>
                        <button
                          className="team-action-btn"
                          title={m.is_active ? 'Деактивировать' : 'Активировать'}
                          onClick={() => handleToggleActive(m.id, m.is_active)}
                        >
                          {m.is_active ? <X size={14} /> : <Check size={14} />}
                        </button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showInvite && (
        <div className="team-modal-overlay" onClick={() => { setShowInvite(false); setInviteError(null); setInviteSuccess(null); }}>
          <div className="invite-modal" onClick={(e) => e.stopPropagation()}>
            <div className="invite-modal-header">
              <div className="invite-modal-title">
                <div className="invite-modal-icon"><UserPlus size={20} /></div>
                <div>
                  <h2>Пригласить участника</h2>
                  <p>Ссылка придёт на почту, пользователь сам установит пароль</p>
                </div>
              </div>
              <button className="invite-modal-close" onClick={() => { setShowInvite(false); setInviteError(null); setInviteSuccess(null); }}><X size={18} /></button>
            </div>

            <div className="invite-modal-body">
              {inviteSuccess ? (
                <div className="invite-success">
                  <div className="invite-success-icon">✉️</div>
                  <h3>Приглашение отправлено!</h3>
                  <p>Письмо со ссылкой отправлено на</p>
                  <div className="invite-success-email">{inviteSuccess}</div>
                  <p className="invite-success-note">Ссылка действительна 72 часа</p>
                  <div className="invite-success-actions">
                    <button className="btn-secondary" onClick={() => {
                      setInviteSuccess(null);
                      setInviteEmail(''); setInviteName('');
                      setInviteRole('manager'); setInviteCustomPerms([]);
                    }}>
                      Пригласить ещё
                    </button>
                    <button className="btn-primary" onClick={() => {
                      setShowInvite(false); setInviteSuccess(null);
                      setInviteEmail(''); setInviteName('');
                      setInviteRole('manager'); setInviteCustomPerms([]);
                    }}>
                      Готово
                    </button>
                  </div>
                </div>
              ) : (
                <>
              {/* Email */}
              <div className="invite-field">
                <label>Email *</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="user@example.com"
                  autoFocus
                />
              </div>

              {/* Name */}
              <div className="invite-field">
                <label>Имя <span className="invite-optional">(необязательно)</span></label>
                <input
                  type="text"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="Имя участника"
                />
              </div>

              {/* Role */}
              <div className="invite-field">
                <label>Роль</label>
                <div className="invite-roles">
                  {[
                    { value: 'manager',      label: 'Менеджер',      desc: 'Исправляет ошибки' },
                    { value: 'head_manager', label: 'Ст. менеджер',  desc: 'Утверждает правки' },
                    { value: 'viewer',       label: 'Наблюдатель',   desc: 'Только просмотр' },
                    { value: 'custom',       label: '✦ Кастомные',   desc: 'Выбрать вручную' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`invite-role-card ${inviteRole === opt.value ? 'invite-role-card--active' : ''}`}
                      onClick={() => { setInviteRole(opt.value); setInviteCustomPerms([]); }}
                    >
                      <span className="invite-role-card-name">{opt.label}</span>
                      <span className="invite-role-card-desc">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom permissions */}
              {inviteRole === 'custom' && permsList && (
                <div className="invite-perms">
                  <div className="invite-perms-header">
                    <Shield size={14} />
                    Выберите права доступа
                    {inviteCustomPerms.length > 0 && (
                      <span className="invite-perms-count">{inviteCustomPerms.length} выбрано</span>
                    )}
                  </div>
                  {Object.entries(permsList.groups).map(([groupName, permIds]) => (
                    <div key={groupName} className="invite-perm-section">
                      <div className="invite-perm-section-title">{groupName}</div>
                      <div className="invite-perm-chips">
                        {permIds.map(pid => {
                          const info = permsList.permissions.find(p => p.id === pid);
                          const checked = inviteCustomPerms.includes(pid);
                          return (
                            <button
                              key={pid}
                              type="button"
                              className={`invite-perm-chip ${checked ? 'invite-perm-chip--on' : ''}`}
                              onClick={() => toggleInviteCustomPerm(pid)}
                            >
                              {checked && <Check size={11} />}
                              {info?.label || pid}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
                </>
              )}
            </div>

            {!inviteSuccess && (
            <div className="invite-modal-footer">
              {inviteError && (
                <div className="invite-error-bar">
                  <X size={14} /> {inviteError}
                </div>
              )}
              <div className="invite-footer-btns">
                <button className="btn-secondary" onClick={() => { setShowInvite(false); setInviteError(null); setInviteSuccess(null); }}>Отмена</button>
                <button
                  className="btn-primary"
                  onClick={handleInvite}
                  disabled={!inviteEmail || (inviteRole === 'custom' && inviteCustomPerms.length === 0) || inviting}
                >
                  {inviting ? 'Отправляем...' : <>Отправить приглашение</>}
                </button>
              </div>
            </div>
            )}
          </div>
        </div>
      )}

      {/* Permission Editor Modal */}
      {permTarget && permsList && (
        <div className="team-modal-overlay" onClick={() => setPermTarget(null)}>
          <div className="team-modal perm-editor-modal" onClick={(e) => e.stopPropagation()}>
            <div className="team-modal-header">
              <h2><Shield size={18} /> Настройки доступа</h2>
              <button onClick={() => setPermTarget(null)}><X size={18} /></button>
            </div>
            <div className="perm-editor-user">
              <div className="team-avatar" style={{ background: ROLE_COLORS[permTarget.role] || '#6b7280' }}>
                {(permTarget.first_name?.[0] || permTarget.email[0]).toUpperCase()}
              </div>
              <div>
                <div className="perm-editor-name">{permTarget.first_name || permTarget.email.split('@')[0]}</div>
                <div className="perm-editor-email">{permTarget.email}</div>
              </div>
            </div>

            <div className="team-modal-body">
              {/* Role selector */}
              <label className="perm-editor-label">
                Роль
                <select value={permRole} onChange={(e) => handlePermRoleChange(e.target.value)} className="perm-editor-select">
                  <option value="owner">Владелец</option>
                  <option value="head_manager">Старший менеджер</option>
                  <option value="manager">Менеджер</option>
                  <option value="viewer">Наблюдатель</option>
                </select>
              </label>

              {/* Custom toggle */}
              <div className="perm-custom-toggle" onClick={() => {
                const next = !useCustom;
                setUseCustom(next);
                if (!next) {
                  const roleInfo = roles.find(r => r.id === permRole);
                  setSelectedPerms(roleInfo ? [...roleInfo.permissions] : []);
                }
              }}>
                {useCustom ? <ToggleRight size={22} className="perm-toggle-on" /> : <ToggleLeft size={22} className="perm-toggle-off" />}
                <span>Кастомные права</span>
                {useCustom && <span className="perm-custom-hint">Права не зависят от роли</span>}
              </div>

              {/* Permission groups */}
              <div className={`perm-groups ${!useCustom ? 'perm-groups--disabled' : ''}`}>
                {Object.entries(permsList.groups).map(([groupName, permIds]) => (
                  <div key={groupName} className="perm-group">
                    <div className="perm-group-title">{groupName}</div>
                    <div className="perm-group-items">
                      {permIds.map(pid => {
                        const info = permsList.permissions.find(p => p.id === pid);
                        const checked = selectedPerms.includes(pid);
                        return (
                          <label key={pid} className={`perm-item ${checked ? 'perm-item--checked' : ''}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!useCustom}
                              onChange={() => handlePermToggle(pid)}
                            />
                            <span className="perm-item-check">{checked ? <Check size={12} /> : null}</span>
                            <span className="perm-item-label">{info?.label || pid}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="team-modal-footer">
              <button className="btn-secondary" onClick={() => setPermTarget(null)}>Отмена</button>
              <button className="btn-primary" onClick={handlePermSave} disabled={savingPerms}>
                {savingPerms ? 'Сохраняем...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
