import type { ReactNode } from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  ArrowRight,
  Bot,
  CreditCard,
  HelpCircle,
  MessageCircle,
  MessageSquare,
  RefreshCw,
  Star,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Clock,
  Activity,
  Zap,
  BarChart3,
  Settings,
  Shield,
  ShieldAlert,
  Wallet,
  Power,
  PauseCircle,
  XCircle,
} from "lucide-react"

import { useShop } from "@/components/shop-context"
import { Button } from "@/components/ui/button"
import { DataErrorState, DataLoadingState } from "@/components/ui/data-state"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { StateEmpty, StatusPill, type SystemStatus } from "@/components/shared/system-state"
import { getErrorMessage } from "@/lib/error-message"
import { getDashboardMain, getSettings, syncDashboardAll, updateSettings, type AttentionItem, type DashboardMainOut,
  getDashboardTimeline, getDashboardRatingTrend, getDashboardResponseTime,
  getDashboardAiEfficiency, getDashboardCreditsUsage, getDashboardConversionFunnel, getDashboardTopCategories,
  type DashboardTimelinePoint, type RatingTrendPoint, type ResponseTimeOut, type AiEfficiencyOut,
  type CreditsUsageOut, type ConversionFunnelOut, type TopCategoriesOut,
} from "@/lib/api"
import { useSyncPolling } from "@/hooks/use-sync-polling"
import { useAsyncData } from "@/hooks/use-async-data"
import { cn } from "@/lib/utils"
import {
  TimelineChart,
  RatingTrendChart,
  ResponseTimeChart,
  AiEfficiencyChart,
  CreditsUsageChart,
  ConversionFunnel,
  TopCategoriesChart,
} from "@/components/modules/dashboard/dashboard-charts"

type PeriodKey = "all" | "7d" | "14d" | "30d"

function formatPeriodLabel(period: PeriodKey) {
  if (period === "all") return "Весь период"
  if (period === "7d") return "7 дней"
  if (period === "14d") return "14 дней"
  return "30 дней"
}

function formatSyncTime(value: string | null | undefined) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
}

const AUTOMATION_REASON_META: Record<string, { label: string; desc: string; icon: ReactNode; tone: "danger" | "warning" | "muted" }> = {
  insufficient_credits: { label: "Недостаточно кредитов", desc: "Пополните баланс для продолжения автоматизации", icon: <Wallet className="h-4 w-4" />, tone: "warning" },
  generation_disabled: { label: "Генерация отключена", desc: "Включите генерацию в настройках магазина", icon: <PauseCircle className="h-4 w-4" />, tone: "warning" },
  publishing_disabled: { label: "Публикация отключена", desc: "Включите автопубликацию в настройках", icon: <PauseCircle className="h-4 w-4" />, tone: "warning" },
  automation_disabled: { label: "Автоматизация отключена", desc: "Активируйте автоматизацию в настройках магазина", icon: <Power className="h-4 w-4" />, tone: "muted" },
  kill_switch: { label: "Аварийная остановка", desc: "Система остановлена администратором. Обратитесь в поддержку", icon: <ShieldAlert className="h-4 w-4" />, tone: "danger" },
  worker_inactive: { label: "Worker неактивен", desc: "Фоновый обработчик не отвечает. Обратитесь в поддержку", icon: <XCircle className="h-4 w-4" />, tone: "danger" },
}

function getAutomationMeta(reason: string | null | undefined) {
  if (!reason) return { label: "Заблокировано", desc: "Причина не указана", icon: <ShieldAlert className="h-4 w-4" />, tone: "danger" as const }
  return AUTOMATION_REASON_META[reason] || { label: reason, desc: "", icon: <ShieldAlert className="h-4 w-4" />, tone: "warning" as const }
}

/* ─────────── Compact KPI ─────────── */
function KpiStrip({ icon, value, label, accent, onClick }: {
  icon: ReactNode; value: number; label: string; accent: string; onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex items-center gap-3 rounded-xl border border-border/40 bg-card px-4 py-3 text-left transition-all",
        "hover:border-primary/20 hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]",
      )}
    >
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", accent)}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xl font-bold tabular-nums leading-none text-foreground">{value}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground leading-tight truncate">{label}</div>
      </div>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/40" />
    </button>
  )
}

/* ─────────── System Health Strip ─────────── */
function SystemHealthStrip({ data, shopRole, billing }: {
  data: DashboardMainOut; shopRole?: string; billing?: { credits_balance?: number } | null
}) {
  const isBlocked = data.automationStatus === "blocked"
  const blockedMeta = isBlocked ? getAutomationMeta(data.automationReason) : null

  const toneMap = { danger: "border-destructive/20 bg-[hsl(var(--danger-soft))]/30", warning: "border-warning/20 bg-[hsl(var(--warning-soft))]/30", muted: "border-border bg-muted/20" }
  const iconToneMap = { danger: "bg-destructive/10 text-destructive", warning: "bg-warning/10 text-warning", muted: "bg-muted text-muted-foreground" }

  const automationStatus: SystemStatus = isBlocked ? "blocked" : data.automationStatus === "active" ? "ready" : "disabled"
  const workerOk = data.workerStatus === "active"

  return (
    <div className="space-y-2">
      {/* Blocked banner — prominent */}
      {isBlocked && blockedMeta && (
        <div className={cn("flex items-center gap-3 rounded-xl border px-4 py-3", toneMap[blockedMeta.tone])}>
          <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", iconToneMap[blockedMeta.tone])}>
            {blockedMeta.icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-foreground leading-tight">{blockedMeta.label}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{blockedMeta.desc}</p>
          </div>
          <StatusPill status="blocked" size="xs" showIcon />
        </div>
      )}

      {/* Health indicators row */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {/* Automation */}
        <div className="flex items-center gap-2.5 rounded-lg border border-border/30 bg-card px-3 py-2.5">
          <Bot className="h-3.5 w-3.5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 leading-none">Автоматизация</div>
            <div className="mt-1">
              <StatusPill status={automationStatus} size="xs" showDot />
            </div>
          </div>
        </div>

        {/* Worker */}
        <div className="flex items-center gap-2.5 rounded-lg border border-border/30 bg-card px-3 py-2.5">
          <Activity className="h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 leading-none">Worker</div>
            <div className="mt-1">
              <StatusPill
                status={workerOk ? "ready" : data.workerStatus ? "failed" : "disabled"}
                label={workerOk ? "Активен" : data.workerStatus ? "Неактивен" : "—"}
                size="xs"
                showDot
              />
            </div>
          </div>
        </div>

        {/* Sync */}
        <div className="flex items-center gap-2.5 rounded-lg border border-border/30 bg-card px-3 py-2.5">
          <Clock className="h-3.5 w-3.5 shrink-0 text-info" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 leading-none">Синхронизация</div>
            <div className="mt-1 text-[12px] font-medium text-foreground tabular-nums truncate">{formatSyncTime(data.lastSyncAt)}</div>
          </div>
        </div>

        {/* Credits */}
        {shopRole === "owner" && (
          <div className="flex items-center gap-2.5 rounded-lg border border-border/30 bg-card px-3 py-2.5">
            <CreditCard className="h-3.5 w-3.5 shrink-0 text-success" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 leading-none">Баланс</div>
              <div className="mt-1 text-[12px] font-bold text-foreground tabular-nums">{billing?.credits_balance ?? 0} кр.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ─────────── Attention Queue ─────────── */
function AttentionQueue({ items, onOpen }: { items: AttentionItem[]; onOpen: (href: string) => void }) {
  if (!items.length) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-success/25 bg-success/[0.02] px-4 py-3">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
        <div>
          <div className="text-[13px] font-medium text-foreground">Всё обработано</div>
          <div className="text-[11px] text-muted-foreground">Срочных задач нет</div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {items.map((item, index) => {
        const isHigh = item.severity === "high"
        const isMedium = item.severity === "medium"
        return (
          <div
            key={`${item.type}-${index}`}
            className={cn(
              "group flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors cursor-pointer",
              isHigh ? "border-destructive/15 bg-destructive/[0.02] hover:bg-destructive/[0.04]" : isMedium ? "border-warning/15 bg-warning/[0.02] hover:bg-warning/[0.04]" : "border-border/30 bg-card hover:bg-muted/20"
            )}
            onClick={() => onOpen(item.link)}
          >
            <div className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
              isHigh ? "bg-destructive/10 text-destructive" : isMedium ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"
            )}>
              {isHigh ? <AlertTriangle className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[12px] font-medium text-foreground">{item.title}</span>
              <span className="ml-1.5 text-[11px] text-muted-foreground">{item.subtitle}</span>
            </div>
            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/50" />
          </div>
        )
      })}
    </div>
  )
}

/* ─────────── Performance Metrics ─────────── */
function PerformanceMetrics({ data }: { data: DashboardMainOut }) {
  const fb = data.feedbacks
  if (!fb) return null

  const answered = fb.answered || Math.max(0, (fb.total || 0) - (fb.unanswered || 0))
  const answerRate = fb.total ? Math.round((answered / fb.total) * 100) : 0

  const primaryMetrics = [
    { value: String(fb.total || 0), label: "Всего отзывов", color: "text-foreground", bg: "bg-muted/30" },
    { value: String(answered), label: "Отвечено", color: "text-success", bg: "bg-success/5" },
    { value: String(fb.unanswered || 0), label: "Без ответа", color: "text-destructive", bg: "bg-destructive/5" },
    { value: String(fb.draftsReady || 0), label: "Черновики", color: "text-warning", bg: "bg-warning/5" },
  ]

  const secondaryMetrics = [
    { value: `${answerRate}%`, label: "Покрытие ответами", hint: "по текущему периоду", color: "text-success", bg: "bg-success/5" },
    { value: String(fb.processedBySystem || 0), label: "Авто-ответы", hint: "обработано системой", color: "text-primary", bg: "bg-primary/5" },
    { value: String(data.questions?.unanswered || 0), label: "Новые вопросы", hint: "требуют ответа", color: "text-info", bg: "bg-info/5" },
    { value: String(data.chats?.active || 0), label: "Активные чаты", hint: "сейчас в работе", color: "text-success", bg: "bg-success/5" },
  ]

  return (
    <div className="space-y-2.5">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {primaryMetrics.map((m) => (
          <div key={m.label} className={cn("rounded-lg px-3 py-3", m.bg)}>
            <div className={cn("text-xl font-bold tabular-nums leading-none", m.color)}>{m.value}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">{m.label}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {secondaryMetrics.map((m) => (
          <div key={m.label} className={cn("rounded-lg border border-border/30 px-3 py-3", m.bg)}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className={cn("text-lg font-bold tabular-nums leading-none", m.color)}>{m.value}</div>
                <div className="mt-1 text-[10px] text-foreground/80">{m.label}</div>
              </div>
            </div>
            <div className="mt-1.5 text-[10px] text-muted-foreground">{m.hint}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─────────── Rating Card ─────────── */
function RatingCard({ data }: { data: DashboardMainOut }) {
  const dist = data.ratingDistribution
  if (!dist) return null

  const total = (dist.stars5 || 0) + (dist.stars4 || 0) + (dist.stars3 || 0) + (dist.stars2 || 0) + (dist.stars1 || 0)
  const avg = Number(data.feedbacks?.avgRating || 0).toFixed(1)

  const bars = [
    { label: "5", value: dist.stars5 || 0, color: "bg-success" },
    { label: "4", value: dist.stars4 || 0, color: "bg-info" },
    { label: "3", value: dist.stars3 || 0, color: "bg-primary" },
    { label: "2", value: dist.stars2 || 0, color: "bg-warning" },
    { label: "1", value: dist.stars1 || 0, color: "bg-destructive" },
  ]

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-2xl font-bold text-foreground tabular-nums leading-none">{avg}</span>
        <Star className="h-4 w-4 fill-warning text-warning" />
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{total} отз.</span>
      </div>
      <div className="space-y-0.5">
        {bars.map((r) => {
          const pct = total > 0 ? (r.value / total) * 100 : 0
          return (
            <div key={r.label} className="flex items-center gap-1.5 text-[11px]">
              <span className="w-2.5 text-right text-muted-foreground tabular-nums">{r.label}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/40">
                <div className={cn("h-full rounded-full transition-all", r.color)} style={{ width: `${pct}%` }} />
              </div>
              <span className="w-6 text-right font-medium text-foreground/70 tabular-nums">{r.value}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ─────────── Section Card ─────────── */
function SectionCard({ title, icon, badge, action, children, className }: {
  title: string; icon?: ReactNode; badge?: number; action?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <div className={cn("rounded-xl border border-border/40 bg-card flex flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-border/20 px-4 py-2.5">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 flex-1">{title}</h3>
        {badge !== undefined && badge > 0 && (
          <span className="flex h-4.5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[9px] font-bold text-primary-foreground">{badge}</span>
        )}
        {action}
      </div>
      <div className="p-3 flex-1 flex flex-col">{children}</div>
    </div>
  )
}

/* ═══════════ MAIN ═══════════ */
export default function DashboardModule() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { shopId, selectedShop, billing, shopRole } = useShop()
  const { isPolling, pollJobs } = useSyncPolling()

  const [period, setPeriod] = useState<PeriodKey>("all")
  const [introOpen, setIntroOpen] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)

  const introQuery = useAsyncData<boolean>(
    async () => {
      if (!shopId) return false
      const settings: any = await getSettings(shopId)
      const onboarding = settings?.config?.onboarding
      return Boolean(onboarding?.done && !onboarding?.dashboard_intro_seen)
    },
    [shopId],
    { enabled: Boolean(shopId), keepPreviousData: true, fallbackError: "Не удалось загрузить состояние онбординга" },
  )

  const dashboardQuery = useAsyncData<DashboardMainOut | null>(
    async () => {
      if (!shopId) return null
      return getDashboardMain({ shop_id: shopId, period })
    },
    [shopId, period],
    { enabled: Boolean(shopId), keepPreviousData: true, fallbackError: "Не удалось загрузить данные кабинета" },
  )

  /* ── Chart data queries ── */
  const timelineQ = useAsyncData(
    () => shopId ? getDashboardTimeline({ shop_id: shopId, period }) : Promise.resolve(null),
    [shopId, period], { enabled: Boolean(shopId), keepPreviousData: true }
  )
  const ratingTrendQ = useAsyncData(
    () => shopId ? getDashboardRatingTrend({ shop_id: shopId, period }) : Promise.resolve(null),
    [shopId, period], { enabled: Boolean(shopId), keepPreviousData: true }
  )
  const responseTimeQ = useAsyncData(
    () => shopId ? getDashboardResponseTime({ shop_id: shopId, period }) : Promise.resolve(null),
    [shopId, period], { enabled: Boolean(shopId), keepPreviousData: true }
  )
  const aiEfficiencyQ = useAsyncData(
    () => shopId ? getDashboardAiEfficiency({ shop_id: shopId, period }) : Promise.resolve(null),
    [shopId, period], { enabled: Boolean(shopId), keepPreviousData: true }
  )
  const creditsQ = useAsyncData(
    () => shopId ? getDashboardCreditsUsage({ shop_id: shopId, period }) : Promise.resolve(null),
    [shopId, period], { enabled: Boolean(shopId), keepPreviousData: true }
  )
  const funnelQ = useAsyncData(
    () => shopId ? getDashboardConversionFunnel({ shop_id: shopId, period }) : Promise.resolve(null),
    [shopId, period], { enabled: Boolean(shopId), keepPreviousData: true }
  )
  const categoriesQ = useAsyncData(
    () => shopId ? getDashboardTopCategories({ shop_id: shopId, period }) : Promise.resolve(null),
    [shopId, period], { enabled: Boolean(shopId), keepPreviousData: true }
  )

  const dashboardData = dashboardQuery.data
  const isLoading = dashboardQuery.isLoading
  const error = dashboardQuery.error

  useEffect(() => { if (introQuery.data) setIntroOpen(true) }, [introQuery.data])

  const finishIntro = useCallback(async () => {
    if (!shopId) return
    try {
      await updateSettings(shopId, { config: { onboarding: { dashboard_intro_seen: true } } })
      introQuery.setData(false)
    } catch (error) {
      toast({ title: "Не удалось сохранить", description: getErrorMessage(error), variant: "destructive" })
    } finally { setIntroOpen(false); navigate("/app/feedbacks") }
  }, [introQuery, navigate, shopId, toast])

  const runSync = useCallback(async () => {
    if (!shopId || isSyncing || isPolling) return
    setIsSyncing(true)
    try {
      const result = await syncDashboardAll({ shop_id: shopId })
      const ids = (result.job_ids || []).filter((v) => Number.isFinite(v) && v > 0)
      if (ids.length) {
        pollJobs(ids, async () => { await dashboardQuery.refresh({ background: true }); toast({ title: "Синхронизация завершена" }) })
      } else {
        await dashboardQuery.refresh({ background: true }); toast({ title: "Синхронизация запущена" })
      }
    } catch (error) {
      toast({ title: "Не удалось синхронизировать", description: getErrorMessage(error), variant: "destructive" })
    } finally { setIsSyncing(false) }
  }, [dashboardQuery, isPolling, isSyncing, pollJobs, shopId, toast])

  if (!shopId) {
    return <StateEmpty title="Магазин не выбран" description="Выберите магазин, чтобы открыть рабочий кабинет." />
  }

  const fb = dashboardData?.feedbacks
  const answered = fb ? (fb.answered || Math.max(0, (fb.total || 0) - (fb.unanswered || 0))) : 0
  const answerRate = fb?.total ? Math.round((answered / fb.total) * 100) : 0

  return (
    <div className="flex flex-col gap-3" style={{ minHeight: 'calc(100vh - 5.5rem)' }}>
      {/* Intro dialog */}
      <Dialog open={introOpen} onOpenChange={setIntroOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Добро пожаловать в кабинет</DialogTitle>
            <DialogDescription>Начните с отзывов без ответа, затем проверьте черновики.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={finishIntro}>Перейти к отзывам</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-foreground truncate">{selectedShop?.name || "Главная"}</h1>
          <p className="text-[12px] text-muted-foreground">Операционная сводка · {formatPeriodLabel(period)}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
            <SelectTrigger className="w-[120px] h-8 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["all", "7d", "14d", "30d"] as PeriodKey[]).map((p) => (
                <SelectItem key={p} value={p}>{formatPeriodLabel(p)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8 text-[12px] gap-1.5" onClick={() => void runSync()} disabled={isSyncing || isPolling || isLoading}>
            <RefreshCw className={cn("h-3.5 w-3.5", (isSyncing || isPolling) && "animate-spin")} />
            Синхронизация
          </Button>
        </div>
      </div>

      {/* ── Error / Loading / Content ── */}
      {error && !dashboardData ? (
        <DataErrorState title="Не удалось загрузить сводку" description={error} onAction={() => void dashboardQuery.refresh()} />
      ) : isLoading && !dashboardData ? (
        <DataLoadingState title="Загружаем кабинет" description="Подготавливаем метрики магазина." />
      ) : (
        <div className="flex flex-1 flex-col gap-3">
          {/* ── System Health ── */}
          {dashboardData && (
            <SystemHealthStrip data={dashboardData} shopRole={shopRole} billing={billing} />
          )}

          {/* ── Row 1: 12-col grid — KPI + Attention + Actions ── */}
          <div className="grid gap-3 lg:grid-cols-12">
            {/* Col 1-3: KPI vertical stack */}
            <div className="grid grid-cols-2 gap-2 lg:col-span-3 lg:grid-cols-1">
              <KpiStrip icon={<MessageSquare className="h-4 w-4" />} value={dashboardData?.feedbacks?.unanswered || 0} label="Отзывы без ответа" accent="bg-primary/10 text-primary" onClick={() => navigate("/app/feedbacks?section=waiting")} />
              <KpiStrip icon={<FileText className="h-4 w-4" />} value={dashboardData?.feedbacks?.draftsReady || 0} label="Черновики готовы" accent="bg-warning/10 text-warning" onClick={() => navigate("/app/feedbacks?section=drafts")} />
              <KpiStrip icon={<HelpCircle className="h-4 w-4" />} value={dashboardData?.questions?.unanswered || 0} label="Новые вопросы" accent="bg-info/10 text-info" onClick={() => navigate("/app/questions")} />
              <KpiStrip icon={<MessageCircle className="h-4 w-4" />} value={dashboardData?.chats?.active || 0} label="Активные чаты" accent="bg-success/10 text-success" onClick={() => navigate("/app/chat")} />
            </div>

            {/* Col 4-9: Attention queue */}
            <SectionCard title="Требуют внимания" icon={<AlertTriangle className="h-3 w-3" />} badge={dashboardData?.attentionItems?.length} className="lg:col-span-6">
              <AttentionQueue items={dashboardData?.attentionItems || []} onOpen={(href) => navigate(href)} />
            </SectionCard>

            {/* Col 10-12: Quick Actions */}
            <SectionCard title="Быстрые действия" icon={<Zap className="h-3 w-3" />} className="lg:col-span-3">
              <div className="space-y-1">
                <Button size="sm" className="w-full justify-between h-9 text-[12px]" onClick={() => navigate("/app/feedbacks?section=waiting")}>Открыть отзывы <ArrowRight className="h-3 w-3" /></Button>
                <Button variant="outline" size="sm" className="w-full justify-between h-9 text-[12px]" onClick={() => navigate("/app/chat")}>Перейти в чаты <MessageCircle className="h-3 w-3" /></Button>
                <Button variant="outline" size="sm" className="w-full justify-between h-9 text-[12px]" onClick={() => navigate("/app/questions")}>Вопросы <HelpCircle className="h-3 w-3" /></Button>
                <Button variant="ghost" size="sm" className="w-full justify-between h-9 text-[12px] text-muted-foreground" onClick={() => navigate("/app/settings")}>Настройки <Settings className="h-3 w-3" /></Button>
              </div>
            </SectionCard>
          </div>

          {/* ── Row 2: Timeline chart + Rating ── */}
          <div className="grid gap-3 lg:grid-cols-12">
            <SectionCard title="Динамика отзывов" icon={<BarChart3 className="h-3 w-3" />} className="lg:col-span-9" badge={undefined}>
              <div className="h-[220px]">
                <TimelineChart data={timelineQ.data?.points} loading={timelineQ.isLoading} />
              </div>
            </SectionCard>
            {dashboardData?.ratingDistribution && (
              <SectionCard title="Рейтинг" icon={<Star className="h-3 w-3" />} className="lg:col-span-3">
                <RatingCard data={dashboardData} />
              </SectionCard>
            )}
          </div>

          {/* ── Row 3: AI Efficiency + Response Time + Credits ── */}
          <div className="grid gap-3 lg:grid-cols-3">
            <SectionCard title="AI-эффективность" icon={<Bot className="h-3 w-3" />}>
              <AiEfficiencyChart data={aiEfficiencyQ.data} loading={aiEfficiencyQ.isLoading} />
            </SectionCard>
            <SectionCard title="Время ответа" icon={<Clock className="h-3 w-3" />}>
              <ResponseTimeChart data={responseTimeQ.data} loading={responseTimeQ.isLoading} />
            </SectionCard>
            <SectionCard title="Расход кредитов" icon={<CreditCard className="h-3 w-3" />}>
              <CreditsUsageChart data={creditsQ.data?.points} totalSpent={creditsQ.data?.total_spent} loading={creditsQ.isLoading} />
            </SectionCard>
          </div>

          {/* ── Row 4: Rating Trend + Funnel + Categories ── */}
          <div className="grid gap-3 lg:grid-cols-12">
            <SectionCard title="Тренд рейтинга" icon={<Star className="h-3 w-3" />} className="lg:col-span-5">
              <div className="h-[180px]">
                <RatingTrendChart data={ratingTrendQ.data?.points} loading={ratingTrendQ.isLoading} />
              </div>
            </SectionCard>
            <SectionCard title="Воронка обработки" icon={<Activity className="h-3 w-3" />} className="lg:col-span-3">
              <ConversionFunnel data={funnelQ.data} loading={funnelQ.isLoading} />
            </SectionCard>
            <SectionCard title="Топ категорий" icon={<BarChart3 className="h-3 w-3" />} className="lg:col-span-4">
              <TopCategoriesChart data={categoriesQ.data?.categories} loading={categoriesQ.isLoading} />
            </SectionCard>
          </div>

          {/* ── Row 5: Performance Metrics ── */}
          <SectionCard title="Показатели" icon={<BarChart3 className="h-3 w-3" />}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { value: String(fb?.total || 0), label: "Всего отзывов", hint: "за выбранный период", color: "text-foreground", bg: "bg-muted/30" },
                { value: String(answered), label: "Отвечено", hint: "с ответом продавца", color: "text-success", bg: "bg-success/5" },
                { value: String(fb?.unanswered || 0), label: "Без ответа", hint: "ожидают реакции", color: "text-destructive", bg: "bg-destructive/5" },
                { value: String(fb?.draftsReady || 0), label: "Черновики", hint: "готовы к публикации", color: "text-warning", bg: "bg-warning/5" },
                { value: `${answerRate}%`, label: "Покрытие ответами", hint: "по текущему периоду", color: "text-success", bg: "bg-success/5" },
                { value: String(fb?.processedBySystem || 0), label: "Авто-ответы", hint: "обработано системой", color: "text-primary", bg: "bg-primary/5" },
                { value: String(dashboardData?.questions?.unanswered || 0), label: "Новые вопросы", hint: "требуют ответа", color: "text-info", bg: "bg-info/5" },
                { value: String(dashboardData?.chats?.active || 0), label: "Активные чаты", hint: "сейчас в работе", color: "text-success", bg: "bg-success/5" },
              ].map((m) => (
                <div key={m.label} className={cn("rounded-xl border border-border/20 px-4 py-3", m.bg)}>
                  <div className={cn("text-xl font-bold tabular-nums leading-none", m.color)}>{m.value}</div>
                  <div className="mt-1.5 text-[11px] font-medium text-foreground/80">{m.label}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{m.hint}</div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  )
}