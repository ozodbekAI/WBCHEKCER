import { useEffect, useMemo, useState } from "react"

import { AdminError, AdminKpi } from "@/components/admin/admin-ui"
import ShopSelect from "@/components/admin/shop-select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { adminCreatePayment, adminListPayments, getMe, type Payment } from "@/lib/api"
import { fmtMoney, fmtDate } from "@/lib/admin-formatters"
import { cn } from "@/lib/utils"
import {
  Banknote,
  CreditCard,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react"

const PRESETS = [500, 1000, 5000, 10000]

export default function PaymentsPage() {
  const { toast } = useToast()
  const [meRole, setMeRole] = useState<string | null>(null)
  const [rows, setRows] = useState<Payment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [filterShopId, setFilterShopId] = useState<number | null>(null)

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false)
  const [createShopId, setCreateShopId] = useState<number | null>(null)
  const [amount, setAmount] = useState("")
  const [comment, setComment] = useState("")
  const [creating, setCreating] = useState(false)
  const [confirmStep, setConfirmStep] = useState(false)

  const amountValue = useMemo(() => {
    const parsed = Number(amount)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }, [amount])

  const canEdit = meRole === "super_admin"

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const [me, list] = await Promise.all([getMe(), adminListPayments(filterShopId ? { shop_id: filterShopId } : undefined)])
      setMeRole(me.role)
      setRows(Array.isArray(list) ? list : [])
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить платежи")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [filterShopId])

  const create = async () => {
    if (!createShopId || !amountValue || !canEdit) return
    try {
      setCreating(true)
      setError(null)
      await adminCreatePayment({
        shop_id: createShopId,
        amount_rub: amountValue,
        comment: comment.trim() || undefined,
      })
      toast({ title: "Платёж создан", description: `${fmtMoney(amountValue)} зачислено` })
      setCreateOpen(false)
      setAmount("")
      setComment("")
      setCreateShopId(null)
      setConfirmStep(false)
      await load()
    } catch (e: any) {
      setError(e?.message || "Не удалось создать платёж")
    } finally {
      setCreating(false)
    }
  }

  const totalAmount = rows.reduce((sum, r) => sum + (Number(r.amount_rub) || 0), 0)

  const filtered = rows.filter((r) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      String(r.id).includes(q) ||
      String(r.shop_id).includes(q) ||
      (r.comment || "").toLowerCase().includes(q) ||
      String(r.amount_rub).includes(q)
    )
  })

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-foreground">Платежи</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">Пополнение баланса и история операций</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="h-8 gap-1.5 text-[13px]">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Обновить
          </Button>
          {canEdit && (
            <Button size="sm" onClick={() => { setConfirmStep(false); setCreateOpen(true) }} className="h-8 gap-1.5 text-[13px]">
              <Plus className="h-3.5 w-3.5" /> Новый платёж
            </Button>
          )}
        </div>
      </div>

      <AdminError message={error} />

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-2.5">
        <AdminKpi label="Записей" value={String(rows.length)} icon={<CreditCard className="h-3.5 w-3.5" />} tone="accent" />
        <AdminKpi label="Общая сумма" value={fmtMoney(totalAmount)} icon={<Banknote className="h-3.5 w-3.5" />} tone="success" />
        <AdminKpi label="Доступ" value={canEdit ? "Полный" : "Чтение"} icon={<Eye className="h-3.5 w-3.5" />} />
      </div>

      {/* Main history table */}
      <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по ID, сумме, комментарию…"
              className="h-8 pl-8 text-[13px]"
            />
          </div>
          <div className="w-[200px]">
            <ShopSelect value={filterShopId} onChange={setFilterShopId} allowAll placeholder="Все магазины" />
          </div>
        </div>

        {/* Table header */}
        <div className="grid grid-cols-[60px_1fr_120px_100px_120px_140px] gap-1 border-b border-border/30 bg-muted/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>ID</span>
          <span>Магазин</span>
          <span className="text-right">Сумма</span>
          <span className="text-right">Кредиты</span>
          <span>Статус</span>
          <span>Дата</span>
        </div>

        {/* Rows */}
        <div className="max-h-[calc(100vh-380px)] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CreditCard className="h-6 w-6 text-muted-foreground/30 mb-2" />
              <p className="text-[13px] font-medium text-muted-foreground">Платежей не найдено</p>
              <p className="text-[12px] text-muted-foreground/60 mt-0.5">
                {search ? "Попробуйте изменить поиск" : "Создайте первый платёж"}
              </p>
            </div>
          ) : (
            filtered.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-[60px_1fr_120px_100px_120px_140px] gap-1 items-center px-3 py-2.5 text-[13px] border-b border-border/20 transition-colors hover:bg-muted/40"
              >
                <span className="font-mono text-[12px] text-muted-foreground">#{row.id}</span>
                <div className="min-w-0">
                  <span className="font-medium text-foreground">Магазин #{row.shop_id}</span>
                  {row.comment && (
                    <span className="ml-2 text-[12px] text-muted-foreground truncate">· {row.comment}</span>
                  )}
                </div>
                <span className="text-right font-semibold tabular-nums text-foreground">{fmtMoney(row.amount_rub)}</span>
                <span className="text-right tabular-nums text-muted-foreground">
                  {row.credit_delta != null ? `+${row.credit_delta.toLocaleString("ru-RU")}` : "—"}
                </span>
                <div>
                  <span className={cn(
                    "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold",
                    row.status === "completed" || !row.status
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : row.status === "pending"
                        ? "bg-warning/10 text-warning"
                        : "bg-muted text-muted-foreground"
                  )}>
                    <span className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      row.status === "completed" || !row.status ? "bg-emerald-500" : row.status === "pending" ? "bg-warning" : "bg-muted-foreground/40"
                    )} />
                    {row.status === "completed" || !row.status ? "Выполнен" : row.status === "pending" ? "Ожидание" : row.status}
                  </span>
                </div>
                <span className="text-[12px] text-muted-foreground">{fmtDate(row.created_at)}</span>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {filtered.length > 0 && (
          <div className="border-t border-border/30 bg-muted/10 px-3 py-1.5 flex items-center justify-between text-[12px] text-muted-foreground">
            <span>Показано {filtered.length} из {rows.length}</span>
            <span>Итого: <span className="font-semibold text-foreground">{fmtMoney(totalAmount)}</span></span>
          </div>
        )}
      </div>

      {/* Create payment dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) setConfirmStep(false) }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{confirmStep ? "Подтверждение платежа" : "Новый платёж"}</DialogTitle>
            <DialogDescription>
              {confirmStep
                ? "Проверьте данные и подтвердите создание платежа."
                : "Выберите магазин и укажите сумму пополнения."
              }
            </DialogDescription>
          </DialogHeader>

          {!confirmStep ? (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Магазин</Label>
                <ShopSelect value={createShopId} onChange={setCreateShopId} allowAll={false} placeholder="Выберите магазин" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Сумма, ₽</Label>
                <Input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="h-11 text-lg font-bold tabular-nums"
                />
                <div className="flex gap-1.5 mt-1">
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setAmount(String(p))}
                      className={cn(
                        "rounded-md border px-3 py-1 text-[12px] font-medium transition-colors",
                        String(p) === amount
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-card text-muted-foreground hover:border-primary/40"
                      )}
                    >
                      {p.toLocaleString("ru-RU")} ₽
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Комментарий</Label>
                <Input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Причина пополнения (опционально)"
                  className="h-10"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3 py-2">
              <div className="rounded-lg border border-border/60 divide-y divide-border/30">
                {[
                  { label: "Магазин", value: `#${createShopId}` },
                  { label: "Сумма", value: amountValue ? fmtMoney(amountValue) : "—" },
                  { label: "Комментарий", value: comment.trim() || "—" },
                ].map((r) => (
                  <div key={r.label} className="flex items-center justify-between px-4 py-2.5 text-[13px]">
                    <span className="text-muted-foreground">{r.label}</span>
                    <span className="font-semibold text-foreground">{r.value}</span>
                  </div>
                ))}
              </div>
              <div className="rounded-lg bg-warning/5 border border-warning/20 px-4 py-2.5 text-[13px] text-warning">
                Платёж будет создан немедленно. Это действие нельзя отменить.
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => confirmStep ? setConfirmStep(false) : setCreateOpen(false)} disabled={creating}>
              {confirmStep ? "Назад" : "Отмена"}
            </Button>
            {!confirmStep ? (
              <Button
                onClick={() => setConfirmStep(true)}
                disabled={!createShopId || !amountValue}
              >
                Далее
              </Button>
            ) : (
              <Button onClick={create} disabled={creating}>
                {creating ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Создание…</> : "Подтвердить платёж"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
