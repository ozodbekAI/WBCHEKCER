import React from "react"

import { AdminAccessDenied, AdminError } from "@/components/admin/admin-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  adminAdjustShopCredits,
  adminCreateShop,
  adminListShops,
  adminListUsers,
  adminUpdateShop,
  getMe,
  type AdminShop,
} from "@/lib/api"
import { getErrorMessage } from "@/lib/error-message"
import { cn } from "@/lib/utils"
import {
  AlertTriangle,
  Coins,
  Loader2,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Search,
  ShieldAlert,
  Store,
  Wallet,
} from "lucide-react"

function fmt(value: number | null | undefined) {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0
  return n.toLocaleString("ru-RU")
}

function fmtDate(value?: string | null) {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" })
}

export default function AdminShopsModule() {
  const [meRole, setMeRole] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [shops, setShops] = React.useState<AdminShop[]>([])
  const [users, setUsers] = React.useState<Array<{ id: number; email: string }>>([])
  const [selectedShopId, setSelectedShopId] = React.useState<number | null>(null)
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<"all" | "active" | "inactive">("all")

  const [createOpen, setCreateOpen] = React.useState(false)
  const [createOwnerId, setCreateOwnerId] = React.useState("")
  const [createName, setCreateName] = React.useState("")
  const [createToken, setCreateToken] = React.useState("")

  const [creditsOpen, setCreditsOpen] = React.useState(false)
  const [creditsShop, setCreditsShop] = React.useState<AdminShop | null>(null)
  const [creditsDelta, setCreditsDelta] = React.useState("")
  const [creditsReason, setCreditsReason] = React.useState("")

  const canView = meRole === "super_admin" || meRole === "support_admin"
  const canEdit = meRole === "super_admin"

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const me = await getMe()
      setMeRole(me?.role || null)
      if (!(me?.role === "super_admin" || me?.role === "support_admin")) {
        setShops([]); setUsers([]); return
      }
      const nextShops = await adminListShops()
      const normalized = Array.isArray(nextShops) ? nextShops : []
      setShops(normalized)
      setSelectedShopId((prev) => prev ?? normalized[0]?.id ?? null)
      if (me.role === "super_admin") {
        const nextUsers = await adminListUsers()
        setUsers(
          Array.isArray(nextUsers)
            ? nextUsers.map((u: any) => ({ id: Number(u?.id), email: String(u?.email || "") })).filter((u) => Number.isFinite(u.id) && u.id > 0)
            : [],
        )
      }
    } catch (e) {
      setError(getErrorMessage(e, "Не удалось загрузить магазины"))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load])

  const handleCreate = React.useCallback(async () => {
    if (!canEdit) return
    setLoading(true); setError(null)
    try {
      const oid = Number.parseInt(createOwnerId, 10)
      if (!Number.isFinite(oid) || oid <= 0) throw new Error("Укажите владельца")
      await adminCreateShop({ owner_user_id: oid, name: createName.trim(), wb_token: createToken.trim() })
      setCreateOpen(false); setCreateOwnerId(""); setCreateName(""); setCreateToken("")
      await load()
    } catch (e) {
      setError(getErrorMessage(e, "Не удалось создать магазин"))
    } finally { setLoading(false) }
  }, [canEdit, createName, createOwnerId, createToken, load])

  const handleToggle = React.useCallback(async (shop: AdminShop) => {
    if (!canEdit) return
    setLoading(true); setError(null)
    try {
      await adminUpdateShop(shop.id, { is_active: !shop.is_active })
      await load()
    } catch (e) {
      setError(getErrorMessage(e, "Не удалось обновить магазин"))
    } finally { setLoading(false) }
  }, [canEdit, load])

  const openCredits = (shop: AdminShop) => {
    setCreditsShop(shop); setCreditsDelta(""); setCreditsReason(""); setCreditsOpen(true)
  }

  const handleCredits = React.useCallback(async () => {
    if (!creditsShop || !canEdit) return
    setLoading(true); setError(null)
    try {
      const delta = Number.parseInt(creditsDelta, 10)
      if (!Number.isFinite(delta) || delta === 0) throw new Error("Укажите корректное изменение")
      await adminAdjustShopCredits(creditsShop.id, { delta, reason: creditsReason.trim() || undefined })
      setCreditsOpen(false); setCreditsShop(null); await load()
    } catch (e) {
      setError(getErrorMessage(e, "Не удалось изменить баланс"))
    } finally { setLoading(false) }
  }, [canEdit, creditsDelta, creditsReason, creditsShop, load])

  if (!canView && meRole !== null) {
    return <AdminAccessDenied description="Управление магазинами доступно только администраторам." />
  }

  const filtered = shops.filter((s) => {
    if (statusFilter === "active" && !s.is_active) return false
    if (statusFilter === "inactive" && s.is_active) return false
    if (search) {
      const q = search.toLowerCase()
      return (s.name?.toLowerCase().includes(q) || s.owner_email?.toLowerCase().includes(q) || String(s.id).includes(q))
    }
    return true
  })

  const selected = shops.find((s) => s.id === selectedShopId) || null
  const totals = {
    total: shops.length,
    active: shops.filter((s) => s.is_active).length,
    balance: shops.reduce((sum, s) => sum + (Number(s.credits_balance) || 0), 0),
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-foreground">Магазины</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            {totals.total} магазинов · {totals.active} активных · баланс {fmt(totals.balance)}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="h-8 gap-1.5 text-[13px]">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Обновить
          </Button>
          {canEdit && (
            <Button size="sm" onClick={() => setCreateOpen(true)} className="h-8 gap-1.5 text-[13px]">
              <Plus className="h-3.5 w-3.5" /> Добавить
            </Button>
          )}
        </div>
      </div>

      <AdminError message={error} />

      {/* Master-detail layout */}
      <div className="grid gap-4 xl:grid-cols-12" style={{ minHeight: "calc(100vh - 220px)" }}>
        {/* Left — stores list (7 cols) */}
        <div className="xl:col-span-7 flex flex-col rounded-lg border border-border/60 bg-card overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск магазинов…"
                className="h-8 pl-8 text-[13px]"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger className="h-8 w-[120px] text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                <SelectItem value="active">Активные</SelectItem>
                <SelectItem value="inactive">Неактивные</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table header */}
          <div className="grid grid-cols-[1fr_1fr_80px_100px_100px_90px] gap-1 border-b border-border/30 bg-muted/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Магазин</span>
            <span>Владелец</span>
            <span>Статус</span>
            <span className="text-right">Баланс</span>
            <span className="text-right">Расход</span>
            <span className="text-right">Создан</span>
          </div>

          {/* Rows */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-[13px] text-muted-foreground">
                <Store className="h-4 w-4 mr-2 opacity-40" />
                {search ? "Ничего не найдено" : "Нет магазинов"}
              </div>
            ) : (
              filtered.map((shop) => {
                const isSelected = shop.id === selectedShopId
                return (
                  <button
                    key={shop.id}
                    type="button"
                    onClick={() => setSelectedShopId(shop.id)}
                    className={cn(
                      "grid w-full grid-cols-[1fr_1fr_80px_100px_100px_90px] gap-1 items-center px-3 py-2.5 text-left text-[13px] transition-colors border-b border-border/20",
                      isSelected
                        ? "bg-primary/[0.06] border-l-2 border-l-primary"
                        : "hover:bg-muted/40 border-l-2 border-l-transparent"
                    )}
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">{shop.name}</div>
                      <div className="text-[11px] text-muted-foreground">ID: {shop.id}</div>
                    </div>
                    <div className="min-w-0 truncate text-muted-foreground">
                      {shop.owner_email || `User #${shop.owner_user_id}`}
                    </div>
                    <div>
                      <span className={cn(
                        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold",
                        shop.is_active
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "bg-muted text-muted-foreground"
                      )}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", shop.is_active ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                        {shop.is_active ? "Актив" : "Выкл"}
                      </span>
                    </div>
                    <div className="text-right font-medium tabular-nums text-foreground">{fmt(shop.credits_balance)}</div>
                    <div className="text-right tabular-nums text-muted-foreground">{fmt(shop.credits_spent)}</div>
                    <div className="text-right text-[12px] text-muted-foreground">{fmtDate(shop.created_at)}</div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Right — inspector panel (5 cols) */}
        <div className="xl:col-span-5 xl:sticky xl:top-4 xl:self-start">
          <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
            {!selected ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Store className="h-8 w-8 text-muted-foreground/30 mb-3" />
                <p className="text-sm font-medium text-muted-foreground">Выберите магазин</p>
                <p className="text-[12px] text-muted-foreground/60 mt-0.5">Нажмите на строку слева</p>
              </div>
            ) : (
              <>
                {/* Shop header */}
                <div className="border-b border-border/40 px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-lg font-bold text-foreground truncate">{selected.name}</h2>
                      <p className="text-[13px] text-muted-foreground mt-0.5">
                        {selected.owner_email || `User #${selected.owner_user_id}`} · ID: {selected.id}
                      </p>
                    </div>
                    <span className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-semibold shrink-0",
                      selected.is_active
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "bg-destructive/10 text-destructive"
                    )}>
                      <span className={cn("h-2 w-2 rounded-full", selected.is_active ? "bg-emerald-500" : "bg-destructive")} />
                      {selected.is_active ? "Активен" : "Отключён"}
                    </span>
                  </div>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-2 gap-px bg-border/30">
                  <div className="bg-card px-5 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Баланс</p>
                    <p className="text-xl font-bold tabular-nums text-foreground mt-1">{fmt(selected.credits_balance)}</p>
                  </div>
                  <div className="bg-card px-5 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Израсходовано</p>
                    <p className="text-xl font-bold tabular-nums text-foreground mt-1">{fmt(selected.credits_spent)}</p>
                  </div>
                </div>

                {/* Details */}
                <div className="px-5 py-3 space-y-1.5 border-t border-border/30">
                  {[
                    { label: "Владелец", value: selected.owner_email || `User #${selected.owner_user_id}` },
                    { label: "Создан", value: fmtDate(selected.created_at) },
                    { label: "ID", value: String(selected.id) },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-2 text-[13px]">
                      <span className="text-muted-foreground">{row.label}</span>
                      <span className="font-medium text-foreground">{row.value}</span>
                    </div>
                  ))}
                </div>

                {canEdit && (
                  <>
                    {/* Management actions */}
                    <div className="border-t border-border/30 px-5 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Управление</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full justify-start gap-2 h-9 text-[13px]"
                        onClick={() => openCredits(selected)}
                      >
                        <Coins className="h-3.5 w-3.5 text-primary" />
                        Изменить баланс
                      </Button>
                    </div>

                    {/* Danger zone */}
                    <div className="border-t border-destructive/15 bg-destructive/[0.02] px-5 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-destructive/70 mb-2">Опасная зона</p>
                      <Button
                        variant={selected.is_active ? "destructive" : "outline"}
                        size="sm"
                        className="w-full justify-start gap-2 h-9 text-[13px]"
                        onClick={() => handleToggle(selected)}
                        disabled={loading}
                      >
                        {selected.is_active ? (
                          <><PowerOff className="h-3.5 w-3.5" /> Отключить магазин</>
                        ) : (
                          <><Power className="h-3.5 w-3.5" /> Включить магазин</>
                        )}
                      </Button>
                    </div>
                  </>
                )}

                {!canEdit && (
                  <div className="border-t border-border/30 px-5 py-3">
                    <p className="text-[13px] text-muted-foreground">
                      Просмотр. Редактирование доступно суперадмину.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Create drawer */}
      <Drawer open={createOpen} onOpenChange={setCreateOpen} direction="right">
        <DrawerContent className="right-0 w-full max-w-xl border-l border-border/70 bg-card">
          <DrawerHeader>
            <DrawerTitle>Новый магазин</DrawerTitle>
            <DrawerDescription>Создайте магазин, привяжите владельца и укажите WB-токен.</DrawerDescription>
          </DrawerHeader>
          <div className="space-y-4 px-5 pb-5">
            <div className="space-y-2">
              <Label>Владелец</Label>
              <Select value={createOwnerId} onValueChange={setCreateOwnerId}>
                <SelectTrigger className="h-[44px]">
                  <SelectValue placeholder="Выберите пользователя" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={String(user.id)}>{user.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Название</Label>
              <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="AVEMOD" className="h-[44px]" />
            </div>
            <div className="space-y-2">
              <Label>WB-токен</Label>
              <Input value={createToken} onChange={(e) => setCreateToken(e.target.value)} placeholder="eyJ..." className="h-[44px]" />
            </div>
            <DrawerFooter className="px-0 pb-0">
              <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={loading}>Отмена</Button>
              <Button onClick={handleCreate} disabled={loading || !createOwnerId || !createName.trim() || !createToken.trim()}>Создать</Button>
            </DrawerFooter>
          </div>
        </DrawerContent>
      </Drawer>

      {/* Credits drawer */}
      <Drawer open={creditsOpen} onOpenChange={setCreditsOpen} direction="right">
        <DrawerContent className="right-0 w-full max-w-lg border-l border-border/70 bg-card">
          <DrawerHeader>
            <DrawerTitle>Изменение баланса</DrawerTitle>
            <DrawerDescription>Магазин: {creditsShop?.name || "—"}</DrawerDescription>
          </DrawerHeader>
          <div className="space-y-4 px-5 pb-5">
            {creditsShop && (
              <div className="rounded-lg bg-muted/30 px-3 py-2.5 text-[13px]">
                Текущий баланс: <span className="font-bold tabular-nums">{fmt(creditsShop.credits_balance)}</span>
              </div>
            )}
            <div className="space-y-2">
              <Label>Изменение</Label>
              <Input value={creditsDelta} onChange={(e) => setCreditsDelta(e.target.value)} placeholder="500 или -200" className="h-[44px]" />
            </div>
            <div className="space-y-2">
              <Label>Причина</Label>
              <Input value={creditsReason} onChange={(e) => setCreditsReason(e.target.value)} placeholder="Пополнение / возврат / корректировка" className="h-[44px]" />
            </div>
            <DrawerFooter className="px-0 pb-0">
              <Button variant="outline" onClick={() => setCreditsOpen(false)} disabled={loading}>Отмена</Button>
              <Button onClick={handleCredits} disabled={loading || !creditsDelta.trim()}>Применить</Button>
            </DrawerFooter>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  )
}
