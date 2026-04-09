import {
  MessageSquare,
  Minus,
  ShieldCheck,
  Star,
  TrendingDown,
  TrendingUp,
} from "lucide-react"

import type { ReviewAnalyticsOut } from "@/lib/api"
import { cn } from "@/lib/utils"

function TrendBadge({ value, suffix = "" }: { value: number; suffix?: string }) {
  if (value === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
        <Minus className="h-2.5 w-2.5" /> 0{suffix}
      </span>
    )
  }
  const positive = value > 0
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[10px] font-semibold",
      positive ? "text-success" : "text-destructive"
    )}>
      {positive ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
      {positive ? "+" : ""}{value}{suffix}
    </span>
  )
}

function KpiCard({
  label,
  value,
  hint,
  trend,
  icon,
  iconBg,
  iconColor,
}: {
  label: string
  value: string | number
  hint?: string
  trend?: number
  icon: React.ReactNode
  iconBg: string
  iconColor: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-3.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="text-xl font-bold tabular-nums text-foreground leading-tight">{value}</p>
        </div>
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", iconBg)}>
          <div className={iconColor}>{icon}</div>
        </div>
      </div>
      {(hint || trend !== undefined) && (
        <div className="mt-2 flex items-center gap-2 border-t border-border/30 pt-1.5">
          {trend !== undefined && <TrendBadge value={trend} />}
          {hint && <span className="text-[10px] text-muted-foreground truncate">{hint}</span>}
        </div>
      )}
    </div>
  )
}

type AnalyticsSummaryCardsProps = {
  data: ReviewAnalyticsOut | null
}

export function AnalyticsSummaryCards({ data }: AnalyticsSummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      <KpiCard
        label="Всего отзывов"
        value={data?.total ?? "—"}
        hint={data ? `Пред: ${data.prev_total}` : undefined}
        trend={data?.period_growth}
        icon={<MessageSquare className="h-3.5 w-3.5" />}
        iconBg="bg-primary/10"
        iconColor="text-primary"
      />
      <KpiCard
        label="Динамика"
        value={data ? `${data.growth_pct > 0 ? "+" : ""}${data.growth_pct}%` : "—"}
        icon={data && data.period_growth >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
        iconBg={data && data.period_growth >= 0 ? "bg-success/10" : "bg-destructive/10"}
        iconColor={data && data.period_growth >= 0 ? "text-success" : "text-destructive"}
      />
      <KpiCard
        label="Средний рейтинг"
        value={data ? data.avg_rating.toFixed(1) : "—"}
        icon={<Star className="h-3.5 w-3.5 fill-current" />}
        iconBg="bg-warning/10"
        iconColor="text-warning"
      />
      <KpiCard
        label="Позитивных"
        value={data ? `${data.positive_share}%` : "—"}
        hint="Оценки 4–5 ★"
        icon={<ShieldCheck className="h-3.5 w-3.5" />}
        iconBg="bg-success/10"
        iconColor="text-success"
      />
    </div>
  )
}
