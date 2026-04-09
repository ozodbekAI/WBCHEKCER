import {
  BarChart2,
  BrainCircuit,
  CreditCard,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react"

import { useShop } from "@/components/shop-context"
import { AnalyticsActivationCard } from "@/components/modules/analytics/analytics-activation-card"
import { AnalyticsCharts } from "@/components/modules/analytics/analytics-charts"
import { AnalyticsFilters } from "@/components/modules/analytics/analytics-filters"
import { AnalyticsHeader } from "@/components/modules/analytics/analytics-header"
import { AnalyticsSummaryCards } from "@/components/modules/analytics/analytics-summary-cards"
import { AnalyticsTable } from "@/components/modules/analytics/analytics-table"
import { AnalyticsReservedCredits } from "@/components/modules/analytics/analytics-reserved-credits"
import { useAnalyticsData } from "@/components/modules/analytics/use-analytics-data"
import {
  StateBanner,
  StateEmpty,
  StateError,
  StatusPill,
} from "@/components/shared/system-state"
import type { AnalyticsStatus } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { useNavigate } from "react-router-dom"

function mapStatus(status: AnalyticsStatus | undefined) {
  if (!status) return "loading" as const
  const map: Record<string, import("@/components/shared/system-state").SystemStatus> = {
    ready: "ready",
    running: "running",
    disabled: "disabled",
    activation_required: "activation_required",
    stale: "stale",
    paused_insufficient_balance: "paused_insufficient_balance",
    failed: "failed",
  }
  return (map[status] ?? "ready") as import("@/components/shared/system-state").SystemStatus
}

export default function AnalyticsModule() {
  const { shopId } = useShop()
  const analytics = useAnalyticsData(shopId)
  const navigate = useNavigate()

  if (!shopId) {
    return (
      <StateEmpty
        icon={<BarChart2 className="h-5 w-5" />}
        title="Сначала выберите магазин"
        description="После выбора магазина здесь появятся метрики по отзывам, динамика и AI-классификация."
      />
    )
  }

  const status = analytics.data?.analytics_status
  const systemStatus = mapStatus(status)
  const reason = analytics.data?.analytics_status_reason ?? null
  const reservedTotal = analytics.data?.analytics_reserved_credits_total ?? 0
  const reservedRemaining = analytics.data?.analytics_reserved_credits_remaining ?? 0

  return (
    <div className="flex flex-col gap-3">
      {/* Header row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-3">
          <AnalyticsHeader />
          {status && status !== "disabled" && (
            <StatusPill status={systemStatus} showIcon size="sm" />
          )}
        </div>
        <AnalyticsFilters
          period={analytics.period}
          granularity={analytics.granularity}
          loading={analytics.loading}
          onPeriodChange={analytics.setPeriod}
          onGranularityChange={analytics.setGranularity}
          onRefresh={() => void analytics.refresh()}
        />
      </div>

      {/* Error banner */}
      {analytics.error && (
        <StateError
          title="Не удалось загрузить аналитику"
          description={analytics.error}
          onRetry={() => void analytics.refresh()}
          compact
        />
      )}

      {/* Paused — insufficient balance */}
      {systemStatus === "paused_insufficient_balance" && (
        <StateBanner
          tone="warning"
          icon={<CreditCard className="h-4 w-4" />}
          title="Приостановлено — недостаточно кредитов"
          description={reason || "AI-аналитика приостановлена. Пополните баланс для продолжения классификации."}
          action={
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] px-3"
              onClick={() => navigate("/app/billing")}
            >
              Пополнить
            </Button>
          }
        />
      )}

      {/* Failed */}
      {systemStatus === "failed" && (
        <StateBanner
          tone="danger"
          icon={<RefreshCw className="h-4 w-4" />}
          title="Ошибка AI-аналитики"
          description={reason || "Произошла ошибка при классификации. Попробуйте перезапустить."}
          action={
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] px-3"
              onClick={() => void analytics.refresh()}
            >
              Повторить
            </Button>
          }
        />
      )}

      {/* Stale */}
      {systemStatus === "stale" && (
        <StateBanner
          tone="warning"
          icon={<RefreshCw className="h-4 w-4" />}
          title="Аналитика устарела"
          description={reason || "Таксономия или настройки AI изменились. Запустите обновление для актуальных данных."}
          action={
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] px-3"
              onClick={() => void analytics.refresh()}
            >
              Обновить
            </Button>
          }
        />
      )}

      {/* Running — progress + reserved credits */}
      {systemStatus === "running" && analytics.data?.is_analyzing && (
        <StateBanner
          tone="primary"
          icon={<BrainCircuit className="h-4 w-4 animate-pulse" />}
          title="AI-классификация выполняется"
          description="Отзывы обрабатываются. Данные обновляются автоматически каждые 10 секунд."
          action={<Loader2 className="h-4 w-4 animate-spin text-primary" />}
        />
      )}

      {/* Reserved credits block */}
      {(systemStatus === "running" || reservedTotal > 0) && (
        <AnalyticsReservedCredits
          total={reservedTotal}
          remaining={reservedRemaining}
          period={analytics.data?.selected_period}
          isRunning={systemStatus === "running"}
        />
      )}

      {/* Basic KPIs — always visible when data exists */}
      <AnalyticsSummaryCards data={analytics.data} />

      {/* Main content */}
      {analytics.loading && !analytics.data ? null : !analytics.hasContent ? (
        <StateEmpty
          icon={<BarChart2 className="h-5 w-5" />}
          title="Пока нет данных для аналитики"
          description="Когда появятся отзывы и завершится синхронизация, здесь появятся базовые метрики."
          compact
        />
      ) : (
        <>
          <AnalyticsCharts
            data={analytics.data}
            prevTimeline={analytics.prevTimeline}
            totalRated={analytics.totalRated}
            loading={analytics.loading}
          />

          {analytics.activationRequired ? (
            <AnalyticsActivationCard
              shopId={shopId}
              onEnabled={() => void analytics.refresh()}
            />
          ) : (
            <AnalyticsTable
              dataTotal={analytics.data?.total ?? 0}
              typeData={analytics.typeData}
              maxTypeCount={analytics.maxTypeCount}
              totalTyped={analytics.totalTyped}
              shopId={shopId}
            />
          )}
        </>
      )}
    </div>
  )
}
