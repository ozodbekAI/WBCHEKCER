import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Users, Shield, UserPlus, ChevronDown,
  Check, X, MoreVertical, Eye, Edit3, Crown, Star, Settings
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useStore } from '../contexts/StoreContext';
import type { TeamMember, RoleInfo, PermissionInfo, PermissionsListOut } from '../types';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  owner: 'Владелец',
  head_manager: 'Старший менеджер',
  manager: 'Менеджер',
  viewer: 'Наблюдатель',
  user: 'Пользователь',
};

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-100 text-red-700 border-red-200',
  owner: 'bg-violet-100 text-violet-700 border-violet-200',
  head_manager: 'bg-blue-100 text-blue-700 border-blue-200',
  manager: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  viewer: 'bg-muted text-muted-foreground border-border',
  user: 'bg-muted text-muted-foreground border-border',
};

const ROLE_AVATAR_COLORS: Record<string, string> = {
  admin: 'bg-red-600',
  owner: 'bg-violet-600',
  head_manager: 'bg-blue-600',
  manager: 'bg-emerald-600',
  viewer: 'bg-muted-foreground',
  user: 'bg-muted-foreground',
};

const ROLE_ICONS: Record<string, React.ReactNode> = {
  admin: <Crown size={14} />,
  owner: <Crown size={14} />,
  head_manager: <Star size={14} />,
  manager: <Edit3 size={14} />,
  viewer: <Eye size={14} />,
  user: <Eye size={14} />,
};

export function TeamContent() {
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
      await loadData();
    } catch (e: any) {
      toast.error(e.message || 'Ошибка при обновлении');
    }
  };

  const handleToggleActive = async (userId: number, isActive: boolean) => {
    if (!storeId) return;
    try {
      await api.updateTeamMember(storeId, userId, { is_active: !isActive });
      await loadData();
    } catch (e: any) {
      toast.error(e.message || 'Ошибка');
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
        data.custom_permissions = [];
      }
      await api.updateTeamMember(storeId, permTarget.id, data);
      setPermTarget(null);
      await loadData();
    } catch (e: any) {
      toast.error(e.message || 'Ошибка при сохранении');
    } finally {
      setSavingPerms(false);
    }
  };

  const handlePermRoleChange = (newRole: string) => {
    setPermRole(newRole);
    if (!useCustom) {
      const roleInfo = roles.find(r => r.id === newRole);
      setSelectedPerms(roleInfo ? [...roleInfo.permissions] : []);
    }
  };

  const resetInviteForm = () => {
    setInviteEmail(''); setInviteName('');
    setInviteRole('manager'); setInviteCustomPerms([]);
    setInviteError(null); setInviteSuccess(null);
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
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Users size={20} /> Команда
          </h2>
          <span className="text-sm text-muted-foreground">{members.length} участников</span>
        </div>
        {canManage && (
          <Button onClick={() => setShowInvite(true)}>
            <UserPlus size={16} /> Пригласить
          </Button>
        )}
      </div>

      {/* Roles overview */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6">
        {roles.map((role) => (
          <div
            key={role.id}
            className={`flex items-center gap-3 rounded-xl border p-3 bg-card ${ROLE_COLORS[role.id]?.split(' ').find(c => c.startsWith('border-')) || 'border-border'}`}
          >
            <div className="flex items-center justify-center">
              {ROLE_ICONS[role.id]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{role.name}</div>
              <div className="text-xs text-muted-foreground truncate">{role.description}</div>
            </div>
            <span className="text-lg font-bold text-foreground">{role.user_count}</span>
          </div>
        ))}
      </div>

      {/* Members table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Пользователь</TableHead>
              <TableHead>Роль</TableHead>
              <TableHead>Исправлений</TableHead>
              <TableHead>На проверке</TableHead>
              <TableHead>Одобрено</TableHead>
              <TableHead>Последний вход</TableHead>
              {canManage && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.id} className={!m.is_active ? 'opacity-50' : ''}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className={`${ROLE_AVATAR_COLORS[m.role] || 'bg-muted-foreground'} text-white text-xs`}>
                        {(m.first_name?.[0] || m.email[0]).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="font-medium text-sm flex items-center gap-1.5">
                        {m.first_name || m.email.split('@')[0]}
                        {m.id === user?.id && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Вы</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{m.email}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <button
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${ROLE_COLORS[m.role] || 'bg-muted text-muted-foreground border-border'} ${canManage && m.id !== user?.id ? 'cursor-pointer hover:opacity-80' : ''}`}
                    onClick={() => { if (canManage && m.id !== user?.id) openPermEditor(m); }}
                    disabled={!canManage || m.id === user?.id}
                  >
                    {ROLE_ICONS[m.role]} {ROLE_LABELS[m.role] || m.role}
                    {m.custom_permissions && m.custom_permissions.length > 0 && (
                      <span title="Кастомные права">✦</span>
                    )}
                    {canManage && m.id !== user?.id && <ChevronDown size={12} className="opacity-50" />}
                  </button>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold">{m.fixes_total}</span>
                    {m.fixes_today > 0 && (
                      <span className="text-xs text-emerald-600">+{m.fixes_today}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {m.approvals_pending > 0 ? (
                    <Badge variant="destructive" className="text-xs">{m.approvals_pending}</Badge>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="text-foreground">{m.approvals_approved}</span>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">{formatTime(m.last_login)}</span>
                </TableCell>
                {canManage && (
                  <TableCell>
                    {m.id !== user?.id && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical size={14} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openPermEditor(m)}>
                            <Settings size={14} className="mr-2" /> Настройки доступа
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleToggleActive(m.id, m.is_active)}>
                            {m.is_active ? (
                              <><X size={14} className="mr-2" /> Деактивировать</>
                            ) : (
                              <><Check size={14} className="mr-2" /> Активировать</>
                            )}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ═══ Invite Modal ═══ */}
      <Dialog open={showInvite} onOpenChange={(open) => { if (!open) { setShowInvite(false); resetInviteForm(); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10">
                <UserPlus size={18} className="text-primary" />
              </div>
              Пригласить участника
            </DialogTitle>
            <DialogDescription>
              Ссылка придёт на почту, пользователь сам установит пароль
            </DialogDescription>
          </DialogHeader>

          {inviteSuccess ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="text-4xl">✉️</div>
              <h3 className="text-lg font-semibold">Приглашение отправлено!</h3>
              <p className="text-sm text-muted-foreground">Письмо со ссылкой отправлено на</p>
              <span className="font-medium text-primary">{inviteSuccess}</span>
              <p className="text-xs text-muted-foreground">Ссылка действительна 72 часа</p>
              <div className="flex gap-2 mt-2">
                <Button variant="outline" onClick={() => { setInviteSuccess(null); resetInviteForm(); }}>
                  Пригласить ещё
                </Button>
                <Button onClick={() => { setShowInvite(false); resetInviteForm(); }}>
                  Готово
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                {/* Email */}
                <div className="space-y-2">
                  <Label>Email *</Label>
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="user@example.com"
                    autoFocus
                  />
                </div>

                {/* Name */}
                <div className="space-y-2">
                  <Label>
                    Имя <span className="text-muted-foreground text-xs">(необязательно)</span>
                  </Label>
                  <Input
                    type="text"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="Имя участника"
                  />
                </div>

                {/* Role */}
                <div className="space-y-2">
                  <Label>Роль</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: 'manager', label: 'Менеджер', desc: 'Исправляет ошибки' },
                      { value: 'head_manager', label: 'Ст. менеджер', desc: 'Утверждает правки' },
                      { value: 'viewer', label: 'Наблюдатель', desc: 'Только просмотр' },
                      { value: 'custom', label: '✦ Кастомные', desc: 'Выбрать вручную' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`flex flex-col items-start rounded-lg border p-3 text-left transition-colors ${
                          inviteRole === opt.value
                            ? 'border-primary bg-primary/5 ring-1 ring-primary'
                            : 'border-border hover:border-primary/40'
                        }`}
                        onClick={() => { setInviteRole(opt.value); setInviteCustomPerms([]); }}
                      >
                        <span className="text-sm font-medium">{opt.label}</span>
                        <span className="text-xs text-muted-foreground">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom permissions */}
                {inviteRole === 'custom' && permsList && (
                  <div className="space-y-3 rounded-lg border border-border p-4 bg-muted/30">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Shield size={14} />
                      Выберите права доступа
                      {inviteCustomPerms.length > 0 && (
                        <Badge variant="secondary" className="text-xs">{inviteCustomPerms.length} выбрано</Badge>
                      )}
                    </div>
                    {Object.entries(permsList.groups).map(([groupName, permIds]) => (
                      <div key={groupName} className="space-y-2">
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{groupName}</div>
                        <div className="space-y-1">
                          {permIds.map(pid => {
                            const info = permsList.permissions.find(p => p.id === pid);
                            const checked = inviteCustomPerms.includes(pid);
                            return (
                              <label
                                key={pid}
                                className="flex items-center gap-2.5 rounded-md border border-border bg-card px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors"
                              >
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={() => toggleInviteCustomPerm(pid)}
                                />
                                <span className="text-sm text-foreground">{info?.label || pid}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {inviteError && (
                <div className="flex items-center gap-2 rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
                  <X size={14} /> {inviteError}
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => { setShowInvite(false); resetInviteForm(); }}>
                  Отмена
                </Button>
                <Button
                  onClick={handleInvite}
                  disabled={!inviteEmail || (inviteRole === 'custom' && inviteCustomPerms.length === 0) || inviting}
                >
                  {inviting ? 'Отправляем...' : 'Отправить приглашение'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ═══ Permission Editor Modal ═══ */}
      <Dialog open={!!permTarget && !!permsList} onOpenChange={(open) => { if (!open) setPermTarget(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield size={18} /> Настройки доступа
            </DialogTitle>
            <DialogDescription>Настройте роль и права пользователя</DialogDescription>
          </DialogHeader>

          {permTarget && (
            <>
              {/* User info */}
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
                <Avatar className="h-9 w-9">
                  <AvatarFallback className={`${ROLE_AVATAR_COLORS[permTarget.role] || 'bg-muted-foreground'} text-white text-xs`}>
                    {(permTarget.first_name?.[0] || permTarget.email[0]).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="text-sm font-medium">{permTarget.first_name || permTarget.email.split('@')[0]}</div>
                  <div className="text-xs text-muted-foreground">{permTarget.email}</div>
                </div>
              </div>

              <div className="space-y-4">
                {/* Role selector */}
                <div className="space-y-2">
                  <Label>Роль</Label>
                  <Select value={permRole} onValueChange={handlePermRoleChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="owner">Владелец</SelectItem>
                      <SelectItem value="head_manager">Старший менеджер</SelectItem>
                      <SelectItem value="manager">Менеджер</SelectItem>
                      <SelectItem value="viewer">Наблюдатель</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Custom toggle */}
                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div className="space-y-0.5">
                    <Label className="text-sm">Кастомные права</Label>
                    {useCustom && (
                      <p className="text-xs text-muted-foreground">Права не зависят от роли</p>
                    )}
                  </div>
                  <Switch
                    checked={useCustom}
                    onCheckedChange={(checked) => {
                      setUseCustom(checked);
                      if (!checked) {
                        const roleInfo = roles.find(r => r.id === permRole);
                        setSelectedPerms(roleInfo ? [...roleInfo.permissions] : []);
                      }
                    }}
                  />
                </div>

                {/* Permission groups */}
                {permsList && (
                  <div className={`space-y-4 ${!useCustom ? 'opacity-50 pointer-events-none' : ''}`}>
                    {Object.entries(permsList.groups).map(([groupName, permIds]) => (
                      <div key={groupName} className="space-y-2">
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          {groupName}
                        </div>
                        <div className="space-y-1">
                          {permIds.map(pid => {
                            const info = permsList.permissions.find(p => p.id === pid);
                            const checked = selectedPerms.includes(pid);
                            return (
                              <label
                                key={pid}
                                className="flex items-center gap-2.5 rounded-md border border-border bg-card px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors"
                              >
                                <Checkbox
                                  checked={checked}
                                  disabled={!useCustom}
                                  onCheckedChange={() => handlePermToggle(pid)}
                                />
                                <span className="text-sm text-foreground">{info?.label || pid}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setPermTarget(null)}>Отмена</Button>
                <Button onClick={handlePermSave} disabled={savingPerms}>
                  {savingPerms ? 'Сохраняем...' : 'Сохранить'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function TeamPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1100px] mx-auto px-6 py-6">
        <TeamContent />
      </div>
    </div>
  );
}
