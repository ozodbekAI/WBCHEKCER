import { useEffect, useMemo, useState } from "react"

import type { ColumnDef } from "@tanstack/react-table"

import { AdminDataGrid } from "@/components/admin/admin-data-grid"
import {
  AdminCompactEmpty,
  AdminError,
  AdminKpi,
  AdminSectionCard,
  AdminSectionHeader,
} from "@/components/admin/admin-ui"
import ShopSelect from "@/components/admin/shop-select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { adminOpsKillSwitch, adminOpsRetryFailed, adminOpsStatus, adminOpsSyncRun, getMe, type OpsStatus } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  Activity,
  AlertTriangle,
  Ban,
  CheckCircle2,
  Loader2,
  Play,
  Power,
  RefreshCw,
  RotateCcw,
  Shield,
  ShieldAlert,
  Timer,
  XCircle,
} from "lucide-react"

type OpsErrorRow = NonNullable<OpsStatus["errors_24h"]>[number]

function ActionButton({ children, icon, variant = "outline", disabled, onClick, className }: {
  children: React.ReactNode; icon?: React.ReactNode; variant?: "outline" | "destructive" | "default"; disabled?: boolean; onClick?: () => void; className?: string
}) {
  return (
    <Button variant={variant} size="sm" disabled={disabled} onClick={onClick} className={cn("h-8 text-[12px] justify-start gap-2 w-full", className)}>
      {icon}
      {children}
    </Button>
  )
}

export default function OpsPage() {
  const [meRole, setMeRole] = useState<string | null>(null)
  const [shopId, setShopId] = useState<number | null>(null)
  const [status, setStatus] = useState<OpsStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const canKillSwitch = meRole === "super_admin"

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const [me, nextStatus] = await Promise.all([getMe(), adminOpsStatus()])
      setMeRole(me.role)
      setStatus(nextStatus)
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить состояние операций")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const run = async (action: () => Promise<any>, key: string) => {
    try {
      setActionLoading(key)
      setError(null)
      await action()
      await load()
    } catch (e: any) {
      setError(e?.message || "Операция не выполнена")
    } finally {
      setActionLoading(null)
    }
  }

  const pending = status?.jobs_pending ?? 0
  const failed = status?.jobs_failed ?? 0
  const running = status?.jobs_running ?? 0
  const retrying = status?.jobs_retrying ?? 0
  const avgTime = status?.avg_generation_time ?? "—"
  const killSwitch = status?.kill_switch ?? false
  const workerActive = status?.worker_active ?? true
  const workerHeartbeat = status?.worker_last_heartbeat_at ?? null
  const errors24h = status?.errors_24h || []

  const errorColumns = useMemo<ColumnDef<OpsErrorRow>[]>(
    () => [
      {
        header: "Тип ошибки",
        accessorKey: "error_type",
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <XCircle className="h-3 w-3 text-red-500 shrink-0" />
            <span className="text-[11px] font-medium text-foreground truncate">{row.original.error_type}</span>
          </div>
        ),
      },
      {
        header: "Кол-во",
        accessorKey: "count_24h",
        size: 70,
        cell: ({ row }) => {
          const c = row.original.count_24h
          return (
            <Badge variant={c > 5 ? "destructive" : c > 0 ? "secondary" : "outline"} className="text-[10px] h-5 tabular-nums">
              {c.toLocaleString("ru-RU")}
            </Badge>
          )
        },
      },
      {
        header: "Последний раз",
        accessorKey: "last_seen",
        size: 140,
        cell: ({ row }) => <span className="text-[11px] text-muted-foreground tabular-nums">{row.original.last_seen || "—"}</span>,
      },
    ],
    [],
  )

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-foreground">Операционный центр</h1>
          <p className="text-[12px] text-muted-foreground">Очереди, ретраи и аварийные переключатели</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="h-8 text-[12px] gap-1.5">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Обновить
        </Button>
      </div>

      <AdminError message={error} />

      {/* KPI strip */}
      <div className="grid grid-cols-5 gap-2">
        <AdminKpi label="В очереди" value={pending} icon={<Activity className="h-3.5 w-3.5" />} tone={pending > 0 ? "accent" : "default"} />
        <AdminKpi label="В работе" value={running} icon={<Play className="h-3.5 w-3.5" />} tone={running > 0 ? "accent" : "default"} />
        <AdminKpi label="Неуспешные" value={failed} icon={<AlertTriangle className="h-3.5 w-3.5" />} tone={failed > 0 ? "error" : "success"} />
        <AdminKpi label="На повторе" value={retrying} icon={<RotateCcw className="h-3.5 w-3.5" />} tone={retrying > 0 ? "warn" : "default"} />
        <AdminKpi label="Среднее время" value={avgTime} icon={<Timer className="h-3.5 w-3.5" />} />
      </div>

      {/* Main layout */}
      <div className="grid gap-3 xl:grid-cols-[340px_1fr]">
        {/* Left: Control panel */}
        <div className="space-y-3">
          <AdminSectionCard>
            <AdminSectionHeader title="Управление магазином" icon={<Activity className="h-3.5 w-3.5" />} />
            <div className="p-3 space-y-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Магазин</label>
                <ShopSelect value={shopId} onChange={setShopId} allowAll={false} placeholder="Выберите магазин" />
              </div>
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Действия</div>
                <ActionButton
                  icon={actionLoading === "sync" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  disabled={!shopId || loading || !!actionLoading}
                  onClick={() => run(() => adminOpsSyncRun(shopId!), "sync")}
                >
                  Запустить синк
                </ActionButton>
                <ActionButton
                  icon={actionLoading === "retry" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  disabled={!shopId || loading || !!actionLoading}
                  onClick={() => run(() => adminOpsRetryFailed(shopId!), "retry")}
                >
                  Повторить неуспешные
                </ActionButton>
              </div>
            </div>
          </AdminSectionCard>

          <AdminSectionCard danger>
            <AdminSectionHeader title="Аварийная зона" sub="Только суперадмин" icon={<ShieldAlert className="h-3.5 w-3.5" />} danger />
            <div className="p-3 space-y-2">
              <ActionButton
                icon={actionLoading === "kill_on" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                variant="destructive"
                disabled={!shopId || loading || !canKillSwitch || !!actionLoading}
                onClick={() => run(() => adminOpsKillSwitch(shopId!, true), "kill_on")}
              >
                Остановка: включить
              </ActionButton>
              <ActionButton
                icon={actionLoading === "kill_off" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                disabled={!shopId || loading || !canKillSwitch || !!actionLoading}
                onClick={() => run(() => adminOpsKillSwitch(shopId!, false), "kill_off")}
              >
                Остановка: выключить
              </ActionButton>
              {!canKillSwitch && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                  <Shield className="h-3 w-3 shrink-0" />
                  Доступно только суперадмину
                </div>
              )}
            </div>
          </AdminSectionCard>

          <AdminSectionCard>
            <AdminSectionHeader title="Здоровье очереди" icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
            <div className="p-3 space-y-1">
              {[
                { label: "Ожидают", value: pending, bad: pending > 0, color: "text-primary" },
                { label: "В работе", value: running, bad: false, color: "text-info" },
                { label: "Ошибки", value: failed, bad: failed > 0, color: "text-red-600" },
                { label: "Ретраи", value: retrying, bad: retrying > 0, color: "text-amber-600" },
                { label: "Ср. время", value: avgTime, bad: false, color: "" },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between py-1.5 text-[12px]">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className={cn("font-medium tabular-nums", item.bad ? item.color : "text-foreground")}>{item.value}</span>
                </div>
              ))}
              <div className="pt-2 border-t border-border/20 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  {killSwitch ? (
                    <>
                      <Ban className="h-3.5 w-3.5 text-red-500" />
                      <span className="text-[11px] font-medium text-red-600">Kill switch активен</span>
                    </>
                  ) : failed === 0 && retrying === 0 ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      <span className="text-[11px] font-medium text-emerald-600">Система стабильна</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                      <span className="text-[11px] font-medium text-amber-600">Требуется внимание</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Activity className={cn("h-3.5 w-3.5", workerActive ? "text-emerald-500" : "text-red-500")} />
                  <span className={cn("text-[11px] font-medium", workerActive ? "text-emerald-600" : "text-red-600")}>
                    Worker: {workerActive ? "активен" : "неактивен"}
                  </span>
                  {workerHeartbeat && (
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {new Date(workerHeartbeat).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </AdminSectionCard>
        </div>

        {/* Right: Monitoring */}
        <div className="space-y-3">
          <AdminSectionCard>
            <AdminSectionHeader
              title="Ошибки за 24 часа"
              sub={`${errors24h.length} типов ошибок`}
              icon={<XCircle className="h-3.5 w-3.5" />}
              actions={
                errors24h.length > 0 ? (
                  <Badge variant={errors24h.some(e => e.count_24h > 5) ? "destructive" : "secondary"} className="text-[10px]">
                    {errors24h.reduce((s, e) => s + e.count_24h, 0)} всего
                  </Badge>
                ) : undefined
              }
            />
            <div className="p-0">
              {!errors24h.length ? (
                <AdminCompactEmpty text="Ошибок нет — система стабильна" icon={<CheckCircle2 className="h-5 w-5" />} />
              ) : (
                <AdminDataGrid data={errors24h} columns={errorColumns} emptyTitle="Ошибок нет" emptyDescription="" compact enableSorting />
              )}
            </div>
          </AdminSectionCard>

          {errors24h.length > 0 && (
            <AdminSectionCard>
              <AdminSectionHeader title="Разбивка по критичности" icon={<AlertTriangle className="h-3.5 w-3.5" />} />
              <div className="p-3">
                <div className="space-y-2">
                  {errors24h.sort((a, b) => b.count_24h - a.count_24h).slice(0, 8).map((e, i) => {
                    const maxCount = Math.max(...errors24h.map(x => x.count_24h), 1)
                    const pct = Math.round((e.count_24h / maxCount) * 100)
                    return (
                      <div key={`${e.error_type}-${i}`} className="space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-medium text-foreground truncate max-w-[70%]">{e.error_type}</span>
                          <span className="tabular-nums text-muted-foreground">{e.count_24h}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                          <div className={cn("h-full rounded-full transition-all", e.count_24h > 5 ? "bg-red-500" : "bg-amber-500")} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </AdminSectionCard>
          )}

          <AdminSectionCard>
            <AdminSectionHeader title="Статус системы" icon={<Shield className="h-3.5 w-3.5" />} />
            <div className="p-3">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Ошибки", value: failed === 0 ? "OK" : failed, ok: failed === 0 },
                  { label: "Очередь", value: pending, ok: pending < 10 },
                  { label: "Ретраи", value: retrying, ok: retrying === 0 },
                  { label: "Латенси", value: avgTime, ok: true, neutral: true },
                ].map((item) => (
                  <div key={item.label} className={cn(
                    "rounded-lg border px-3 py-2.5 text-center",
                    (item as any).neutral
                      ? "border-border/50"
                      : item.ok
                        ? "border-emerald-500/20 bg-emerald-500/[0.03]"
                        : "border-red-500/20 bg-red-500/[0.03]"
                  )}>
                    <div className={cn(
                      "text-lg font-bold tabular-nums",
                      (item as any).neutral ? "text-foreground" : item.ok ? "text-emerald-600" : "text-red-600"
                    )}>{item.value}</div>
                    <div className="text-[11px] text-muted-foreground">{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </AdminSectionCard>
        </div>
      </div>
    </div>
  )
}
