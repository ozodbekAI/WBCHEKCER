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
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  adminFinance,
  adminSystemHealth,
  adminProvidersStatus,
  type AdminProviderStatus,
  type FinanceBreakdownOut,
  type FinanceIncidentRow,
  type FinanceTopShopRow,
  type GptCostBreakdownRow,
  type SystemHealth,
} from "@/lib/api"
import { fmtDateFull, fmtMoney } from "@/lib/admin-formatters"
import {
  Activity,
  AlertTriangle,
  Bot,
  DollarSign,
  Loader2,
  RefreshCw,
  Server,
  ShieldAlert,
  TrendingUp,
  Zap,
} from "lucide-react"
import { cn } from "@/lib/utils"

type Period = "today" | "last_7_days" | "last_30_days" | "all_time"

const PERIOD_LABELS: Record<Period, string> = {
  today: "Сегодня",
  last_7_days: "7 дней",
  last_30_days: "30 дней",
  all_time: "Всё время",
}

/* ── Finance metric row ── */
function FinanceRow({
  label,
  value,
  icon,
  highlight,
}: {
  label: string
  value: string
  icon: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div className={cn(
      "flex items-center gap-3 rounded-lg px-3 py-2.5",
      highlight ? "bg-emerald-500/[0.08] border border-emerald-500/20" : "bg-muted/50 border border-border/40"
    )}>
      <span className="text-muted-foreground/80">{icon}</span>
      <span className="text-[13px] text-foreground/80 flex-1">{label}</span>
      <span className={cn("text-base font-bold tabular-nums", highlight ? "text-emerald-600 dark:text-emerald-400" : "text-foreground")}>{value}</span>
    </div>
  )
}

/* ═══════════════════════════════════════════════ */
export default function AdminDashboardPage() {
  const [period, setPeriod] = useState<Period>("today")
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [finance, setFinance] = useState<FinanceBreakdownOut | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [providers, setProviders] = useState<AdminProviderStatus[]>([])

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const [nextHealth, nextFinance, nextProviders] = await Promise.all([
        adminSystemHealth(),
        adminFinance(period),
        adminProvidersStatus().catch(() => ({ providers: [] })),
      ])
      setHealth(nextHealth)
      setFinance(nextFinance)
      setProviders(nextProviders.providers || [])
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить сводку")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [period])

  const breakdownColumns = useMemo<ColumnDef<GptCostBreakdownRow>[]>(
    () => [
      { header: "Операция", accessorKey: "operation_type", cell: ({ row }) => <span className="text-[13px] font-medium">{row.original.operation_type}</span> },
      { header: "Стоимость", accessorKey: "gpt_cost_rub", cell: ({ row }) => <span className="text-[13px] tabular-nums">{fmtMoney(row.original.gpt_cost_rub)}</span> },
      { header: "Доля", accessorKey: "percent", cell: ({ row }) => <span className="text-[13px] tabular-nums text-muted-foreground">{row.original.percent}%</span> },
    ],
    [],
  )

  const shopsColumns = useMemo<ColumnDef<FinanceTopShopRow>[]>(
    () => [
      { header: "Магазин", cell: ({ row }) => <span className="text-[13px] font-medium">{row.original.shop || row.original.shop_name || row.original.shop_id}</span> },
      { header: "Генерации", accessorKey: "generations_count", cell: ({ row }) => <span className="text-[13px] tabular-nums">{row.original.generations_count.toLocaleString("ru-RU")}</span> },
      { header: "Расход", accessorKey: "gpt_cost_rub", cell: ({ row }) => <span className="text-[13px] tabular-nums">{fmtMoney(row.original.gpt_cost_rub)}</span> },
    ],
    [],
  )

  const incidentsColumns = useMemo<ColumnDef<FinanceIncidentRow>[]>(
    () => [
      { header: "Магазин", cell: ({ row }) => <span className="text-[13px] font-medium">{row.original.shop || row.original.shop_name || row.original.shop_id}</span> },
      { header: "Тип", cell: ({ row }) => <span className="text-[13px]">{row.original.incident_type}</span> },
      { header: "С", cell: ({ row }) => <span className="text-[13px] text-muted-foreground">{fmtDateFull(row.original.since)}</span> },
    ],
    [],
  )

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-foreground">Сводка системы</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">Состояние, финансы и инциденты</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger className="h-8 w-[150px] text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                <SelectItem key={p} value={p}>{PERIOD_LABELS[p]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="h-8 gap-1.5 text-[13px]">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Обновить
          </Button>
        </div>
      </div>

      <AdminError message={error} />

      {/* ── KPI Row — 6 compact cards ── */}
      <div className="grid grid-cols-3 gap-2.5 xl:grid-cols-6">
        <AdminKpi label="Магазины" value={health?.active_shops ?? "—"} tone="accent" icon={<Activity className="h-3.5 w-3.5" />} />
        <AdminKpi label="Ошибки синка" value={health?.shops_with_sync_errors ?? "—"} tone={(health?.shops_with_sync_errors ?? 0) > 0 ? "warn" : "default"} icon={<AlertTriangle className="h-3.5 w-3.5" />} />
        <AdminKpi label="Очередь" value={health?.generation_queue_size ?? "—"} tone={(health?.generation_queue_size ?? 0) > 0 ? "warn" : "default"} icon={<Zap className="h-3.5 w-3.5" />} />
        <AdminKpi label="Ошибки генерации" value={health?.generation_errors_24h ?? "—"} tone={(health?.generation_errors_24h ?? 0) > 0 ? "warn" : "default"} icon={<ShieldAlert className="h-3.5 w-3.5" />} />
        <AdminKpi label="Автопубликация" value={health?.autopublish_enabled_shops ?? "—"} tone="success" icon={<Bot className="h-3.5 w-3.5" />} />
        <AdminKpi label="Ошибки публикации" value={health?.autopublish_errors_24h ?? "—"} tone={(health?.autopublish_errors_24h ?? 0) > 0 ? "warn" : "default"} icon={<Server className="h-3.5 w-3.5" />} />
      </div>

      {/* ── Main 2-column body ── */}
      <div className="grid gap-4 xl:grid-cols-12">
        {/* Left column — 7 cols */}
        <div className="space-y-4 xl:col-span-7">
          <AdminSectionCard>
            <AdminSectionHeader title="Структура расходов на ИИ" icon={<Zap className="h-3.5 w-3.5" />} />
            {(finance?.breakdown?.length ?? 0) > 0 ? (
              <AdminDataGrid data={finance?.breakdown || []} columns={breakdownColumns} emptyTitle="Нет данных" emptyDescription="" compact enableSorting />
            ) : (
              <AdminCompactEmpty text="Разбивка появится при накоплении AI-расходов" />
            )}
          </AdminSectionCard>

          <AdminSectionCard>
            <AdminSectionHeader title="Топ магазинов" icon={<TrendingUp className="h-3.5 w-3.5" />} />
            {(finance?.top_shops?.length ?? 0) > 0 ? (
              <AdminDataGrid data={finance?.top_shops || []} columns={shopsColumns} emptyTitle="Нет данных" emptyDescription="" compact enableSorting />
            ) : (
              <AdminCompactEmpty text="Список появится при появлении генераций" />
            )}
          </AdminSectionCard>

          <AdminSectionCard>
            <AdminSectionHeader title="Инциденты" icon={<AlertTriangle className="h-3.5 w-3.5" />} />
            {(finance?.incidents?.length ?? 0) > 0 ? (
              <AdminDataGrid data={finance?.incidents || []} columns={incidentsColumns} emptyTitle="Нет инцидентов" emptyDescription="" compact />
            ) : (
              <AdminCompactEmpty text="Инцидентов не обнаружено" />
            )}
          </AdminSectionCard>
        </div>

        {/* Right column — 5 cols */}
        <div className="space-y-4 xl:col-span-5">
          <AdminSectionCard>
            <AdminSectionHeader title="Финансы" icon={<DollarSign className="h-3.5 w-3.5" />} />
            <div className="p-4 space-y-2">
              <FinanceRow label="Поступило" value={fmtMoney(finance?.summary?.money_received_rub)} icon={<DollarSign className="h-3.5 w-3.5" />} />
              <FinanceRow label="Стоимость ИИ" value={fmtMoney(finance?.summary?.gpt_cost_rub)} icon={<Bot className="h-3.5 w-3.5" />} />
              <FinanceRow label="Итог" value={fmtMoney(finance?.summary?.gross_result_rub)} icon={<TrendingUp className="h-3.5 w-3.5" />} highlight />
              <div className="rounded-lg bg-muted/50 border border-border/30 px-3 py-2 text-[12px] text-muted-foreground">
                {fmtDateFull(finance?.summary?.date_from)} — {fmtDateFull(finance?.summary?.date_to)}
              </div>
            </div>
          </AdminSectionCard>

          <AdminSectionCard>
            <AdminSectionHeader title="Здоровье системы" icon={<Server className="h-3.5 w-3.5" />} />
            <div className="p-4 space-y-2">
              {[
                { label: "Активные магазины", value: health?.active_shops ?? 0, ok: true },
                { label: "Ошибки синхронизации", value: health?.shops_with_sync_errors ?? 0, ok: (health?.shops_with_sync_errors ?? 0) === 0 },
                { label: "Очередь генерации", value: health?.generation_queue_size ?? 0, ok: (health?.generation_queue_size ?? 0) === 0 },
                { label: "Ошибки генерации (24ч)", value: health?.generation_errors_24h ?? 0, ok: (health?.generation_errors_24h ?? 0) === 0 },
                { label: "Ошибки публикации (24ч)", value: health?.autopublish_errors_24h ?? 0, ok: (health?.autopublish_errors_24h ?? 0) === 0 },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 border border-border/30 px-3 py-2.5">
                  <span className="text-[13px] text-foreground/80">{item.label}</span>
                  <span className={cn("text-sm font-bold tabular-nums", item.ok ? "text-foreground" : "text-amber-600 dark:text-amber-400")}>{item.value}</span>
                </div>
              ))}
            </div>
          </AdminSectionCard>

          <AdminSectionCard>
            <AdminSectionHeader title="Провайдеры" icon={<Activity className="h-3.5 w-3.5" />} />
            <div className="p-4 space-y-1.5">
              {providers.length > 0 ? providers.map((p) => (
                <div key={p.name} className="flex items-center gap-2.5 rounded-lg bg-muted/50 border border-border/30 px-3 py-2.5">
                  <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", p.status === "ok" ? "bg-emerald-500" : "bg-amber-500")} />
                  <span className="text-[13px] text-foreground flex-1 font-medium">{p.name}</span>
                  {p.latency_ms != null && <span className="text-[11px] text-muted-foreground tabular-nums">{p.latency_ms}ms</span>}
                  <span className={cn("text-[12px] font-medium", p.status === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600")}>{p.status === "ok" ? "Работает" : "Проблемы"}</span>
                </div>
              )) : (
                <div className="text-[13px] text-muted-foreground text-center py-4">Нет данных о провайдерах</div>
              )}
            </div>
          </AdminSectionCard>
        </div>
      </div>
    </div>
  )
}
