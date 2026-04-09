import * as React from "react"

import { AdminAccessDenied, AdminError, AdminKpi } from "@/components/admin/admin-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useToast } from "@/components/ui/use-toast"
import {
  adminListUsers,
  adminSetUserRole,
  adminSetUserActive,
  adminResetPassword,
  adminGetUserDetail,
  getMe,
  type AdminUserDetail,
} from "@/lib/api"
import { fmtDate } from "@/lib/admin-formatters"
import { cn } from "@/lib/utils"
import {
  KeyRound,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Store,
  UserCheck,
  UserX,
  Users,
  Wallet,
} from "lucide-react"

type UserRow = {
  id: number
  email: string
  role: string
  is_active: boolean
  last_login?: string | null
  created_at?: string | null
}

const ROLE_OPTIONS = [
  { value: "super_admin", label: "Суперадмин", color: "text-destructive", bg: "bg-destructive/10" },
  { value: "support_admin", label: "Поддержка", color: "text-primary", bg: "bg-primary/10" },
  { value: "user", label: "Пользователь", color: "text-muted-foreground", bg: "bg-muted" },
]

function getRoleMeta(role: string) {
  return ROLE_OPTIONS.find((r) => r.value === role) || ROLE_OPTIONS[2]
}


export default function AdminUsersPage() {
  const { toast } = useToast()
  const [allowed, setAllowed] = React.useState<boolean | null>(null)
  const [meId, setMeId] = React.useState<number | null>(null)
  const [meRole, setMeRole] = React.useState<string | null>(null)
  const [users, setUsers] = React.useState<UserRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [savingId, setSavingId] = React.useState<number | null>(null)
  const [search, setSearch] = React.useState("")
  const [roleFilter, setRoleFilter] = React.useState("all")
  const [statusFilter, setStatusFilter] = React.useState("all")

  // Detail drawer
  const [detailUser, setDetailUser] = React.useState<AdminUserDetail | null>(null)
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [detailLoading, setDetailLoading] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const me = await getMe()
      const canView = me?.role === "super_admin" || me?.role === "support_admin"
      setAllowed(canView)
      setMeId(me?.id ?? null)
      setMeRole(me?.role ?? null)
      if (!canView) { setUsers([]); return }
      const data = await adminListUsers()
      setUsers(Array.isArray(data) ? data : [])
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить пользователей")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load])

  const canEditRoles = meRole === "super_admin"

  const changeRole = async (userId: number, role: string) => {
    if (!canEditRoles || (meId !== null && userId === meId)) return
    setSavingId(userId)
    setError(null)
    try {
      await adminSetUserRole(userId, role)
      await load()
    } catch (e: any) {
      setError(e?.message || "Не удалось обновить роль")
    } finally {
      setSavingId(null)
    }
  }

  const toggleActive = async (user: UserRow) => {
    setSavingId(user.id)
    try {
      await adminSetUserActive(user.id, !user.is_active)
      toast({
        title: user.is_active ? "Заблокирован" : "Разблокирован",
        description: `${user.email} ${user.is_active ? "заблокирован" : "разблокирован"}`,
      })
      await load()
    } catch (e: any) {
      toast({ title: "Ошибка", description: e?.message || "Не удалось обновить статус", variant: "destructive" })
    } finally {
      setSavingId(null)
    }
  }

  const resetPassword = async (user: UserRow) => {
    setSavingId(user.id)
    try {
      const res = await adminResetPassword(user.id)
      toast({
        title: "Пароль сброшен",
        description: res.message || `Ссылка для сброса отправлена на ${user.email}`,
      })
    } catch (e: any) {
      toast({ title: "Ошибка", description: e?.message || "Не удалось сбросить пароль", variant: "destructive" })
    } finally {
      setSavingId(null)
    }
  }

  const openDetail = async (userId: number) => {
    setDetailLoading(true)
    setDetailOpen(true)
    try {
      const data = await adminGetUserDetail(userId)
      setDetailUser(data)
    } catch (e: any) {
      toast({ title: "Ошибка", description: e?.message || "Не удалось загрузить детали", variant: "destructive" })
      setDetailOpen(false)
    } finally {
      setDetailLoading(false)
    }
  }

  if (allowed === false) {
    return <AdminAccessDenied description="Управление пользователями доступно только администраторам." />
  }

  const filtered = users.filter((u) => {
    if (roleFilter !== "all" && u.role !== roleFilter) return false
    if (statusFilter === "active" && !u.is_active) return false
    if (statusFilter === "inactive" && u.is_active) return false
    if (search) {
      const q = search.toLowerCase()
      return u.email.toLowerCase().includes(q) || String(u.id).includes(q)
    }
    return true
  })

  const activeCount = users.filter((u) => u.is_active).length
  const adminCount = users.filter((u) => u.role === "super_admin" || u.role === "support_admin").length

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-foreground">Пользователи</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">Управление ролями и доступом</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="h-8 gap-1.5 text-[13px] shrink-0">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Обновить
        </Button>
      </div>

      <AdminError message={error} />

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-2.5">
        <AdminKpi label="Всего" value={users.length} icon={<Users className="h-3.5 w-3.5" />} tone="accent" />
        <AdminKpi label="Активных" value={activeCount} icon={<UserCheck className="h-3.5 w-3.5" />} tone="success" />
        <AdminKpi label="Администраторов" value={adminCount} icon={<ShieldCheck className="h-3.5 w-3.5" />} />
      </div>

      {/* Table card */}
      <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по email или ID…"
              className="h-8 pl-8 text-[13px]"
            />
          </div>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="h-8 w-[140px] text-[13px]">
              <SelectValue placeholder="Роль" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все роли</SelectItem>
              {ROLE_OPTIONS.map((r) => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-[120px] text-[13px]">
              <SelectValue placeholder="Статус" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все</SelectItem>
              <SelectItem value="active">Активные</SelectItem>
              <SelectItem value="inactive">Неактивные</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table header */}
        <div className="grid grid-cols-[1fr_1fr_150px_90px_130px_48px] gap-1 border-b border-border/30 bg-muted/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>Пользователь</span>
          <span>Email</span>
          <span>Роль</span>
          <span>Статус</span>
          <span>Создан</span>
          <span />
        </div>

        {/* Rows */}
        <div className="max-h-[calc(100vh-340px)] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-[13px] text-muted-foreground">
              <Users className="h-4 w-4 mr-2 opacity-40" />
              {search || roleFilter !== "all" || statusFilter !== "all" ? "Ничего не найдено" : "Нет пользователей"}
            </div>
          ) : (
            filtered.map((user) => {
              const isSelf = meId !== null && user.id === meId
              const roleMeta = getRoleMeta(user.role)
              const isBusy = savingId === user.id

              return (
                <div
                  key={user.id}
                  className="grid grid-cols-[1fr_1fr_150px_90px_130px_48px] gap-1 items-center px-3 py-2.5 text-[13px] border-b border-border/20 transition-colors hover:bg-muted/40"
                >
                  {/* User */}
                  <div className="min-w-0 flex items-center gap-2.5">
                    <div className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold uppercase",
                      roleMeta.bg, roleMeta.color
                    )}>
                      {user.email.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">{user.email.split("@")[0]}</div>
                      <div className="text-[11px] text-muted-foreground">ID: {user.id}{isSelf ? " · вы" : ""}</div>
                    </div>
                  </div>

                  {/* Email */}
                  <div className="min-w-0 truncate text-muted-foreground">{user.email}</div>

                  {/* Role */}
                  <div>
                    {canEditRoles && !isSelf ? (
                      <Select
                        value={user.role}
                        onValueChange={(v) => changeRole(user.id, v)}
                        disabled={isBusy}
                      >
                        <SelectTrigger className="h-7 w-[140px] text-[12px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              <span className="flex items-center gap-1.5">
                                <Shield className={cn("h-3 w-3", r.color)} />
                                {r.label}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className={cn(
                        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[12px] font-semibold",
                        roleMeta.bg, roleMeta.color
                      )}>
                        <Shield className="h-3 w-3" />
                        {roleMeta.label}
                      </span>
                    )}
                  </div>

                  {/* Status */}
                  <div>
                    <span className={cn(
                      "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold",
                      user.is_active
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground"
                    )}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", user.is_active ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                      {user.is_active ? "Актив" : "Выкл"}
                    </span>
                  </div>

                  {/* Created */}
                  <div className="text-[12px] text-muted-foreground">{fmtDate(user.created_at)}</div>

                  {/* Actions */}
                  <div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={isBusy}>
                          {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-[180px]">
                        <DropdownMenuItem
                          className="text-[13px]"
                          onSelect={() => openDetail(user.id)}
                        >
                          <UserCheck className="h-3.5 w-3.5 mr-2" />
                          Детали
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-[13px]"
                          onSelect={() => resetPassword(user)}
                        >
                          <KeyRound className="h-3.5 w-3.5 mr-2" />
                          Сбросить пароль
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-[13px] text-destructive focus:text-destructive"
                          disabled={isSelf}
                          onSelect={() => {
                            if (isSelf) return
                            toggleActive(user)
                          }}
                        >
                          <UserX className="h-3.5 w-3.5 mr-2" />
                          {user.is_active ? "Заблокировать" : "Разблокировать"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border/30 bg-muted/10 px-3 py-1.5 text-[12px] text-muted-foreground">
          Показано {filtered.length} из {users.length}
        </div>
      </div>

      {/* User Detail Drawer */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-[400px] sm:w-[440px]">
          <SheetHeader>
            <SheetTitle className="text-lg">Детали пользователя</SheetTitle>
          </SheetHeader>
          {detailLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : detailUser ? (
            <div className="mt-4 space-y-4">
              {/* Basic info */}
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold uppercase",
                    getRoleMeta(detailUser.role).bg, getRoleMeta(detailUser.role).color
                  )}>
                    {detailUser.email.charAt(0)}
                  </div>
                  <div>
                    <div className="font-semibold text-foreground">{detailUser.email}</div>
                    <div className="text-[12px] text-muted-foreground">ID: {detailUser.id}</div>
                  </div>
                </div>
              </div>

              {/* Meta rows */}
              <div className="space-y-1.5">
                {[
                  { label: "Роль", value: getRoleMeta(detailUser.role).label, icon: <Shield className="h-3.5 w-3.5" /> },
                  { label: "Статус", value: detailUser.is_active ? "Активен" : "Заблокирован", icon: <UserCheck className="h-3.5 w-3.5" /> },
                  { label: "Создан", value: fmtDate(detailUser.created_at) || "—", icon: <RefreshCw className="h-3.5 w-3.5" /> },
                  { label: "Последний вход", value: fmtDate(detailUser.last_login) || "—", icon: <UserCheck className="h-3.5 w-3.5" /> },
                ].map((row) => (
                  <div key={row.label} className="flex items-center gap-2.5 rounded-lg bg-muted/40 border border-border/30 px-3 py-2">
                    <span className="text-muted-foreground">{row.icon}</span>
                    <span className="text-[13px] text-muted-foreground flex-1">{row.label}</span>
                    <span className="text-[13px] font-medium text-foreground">{row.value}</span>
                  </div>
                ))}
              </div>

              {/* Credits */}
              {(detailUser.credits_balance != null || detailUser.credits_spent != null) && (
                <div className="space-y-1.5">
                  <div className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Кредиты</div>
                  <div className="flex gap-2">
                    <div className="flex-1 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/20 px-3 py-2.5 text-center">
                      <Wallet className="h-3.5 w-3.5 mx-auto text-emerald-600 dark:text-emerald-400 mb-1" />
                      <div className="text-base font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{detailUser.credits_balance ?? 0}</div>
                      <div className="text-[11px] text-muted-foreground">Баланс</div>
                    </div>
                    <div className="flex-1 rounded-lg bg-muted/50 border border-border/30 px-3 py-2.5 text-center">
                      <Wallet className="h-3.5 w-3.5 mx-auto text-muted-foreground mb-1" />
                      <div className="text-base font-bold text-foreground tabular-nums">{detailUser.credits_spent ?? 0}</div>
                      <div className="text-[11px] text-muted-foreground">Потрачено</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Shops */}
              {detailUser.shops && detailUser.shops.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Магазины</div>
                  {detailUser.shops.map((s) => (
                    <div key={s.id} className="flex items-center gap-2.5 rounded-lg bg-muted/40 border border-border/30 px-3 py-2">
                      <Store className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[13px] font-medium text-foreground flex-1">{s.name}</span>
                      <span className="text-[11px] text-muted-foreground">#{s.id}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
