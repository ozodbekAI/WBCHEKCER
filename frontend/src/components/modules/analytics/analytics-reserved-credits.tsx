import { CreditCard, Sparkles } from "lucide-react"

import { Progress } from "@/components/ui/progress"
import type { AnalyticsSelectedPeriod } from "@/lib/api"

type Props = {
  total: number
  remaining: number
  period?: AnalyticsSelectedPeriod | null
  isRunning: boolean
}

function formatDate(unix: number) {
  return new Date(unix * 1000).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

export function AnalyticsReservedCredits({ total, remaining, period, isRunning }: Props) {
  if (total <= 0) return null

  const used = total - remaining
  const pct = total > 0 ? Math.round((used / total) * 100) : 0

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2.5">
        <CreditCard className="h-3.5 w-3.5 text-primary" />
        <span className="text-[12px] font-semibold text-foreground">Зарезервированные кредиты</span>
        {isRunning && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            <Sparkles className="h-2.5 w-2.5" />
            Активно
          </span>
        )}
      </div>
      <div className="px-4 py-3 space-y-2.5">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Всего</p>
            <p className="text-lg font-bold tabular-nums text-foreground">{total.toLocaleString("ru-RU")}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Использовано</p>
            <p className="text-lg font-bold tabular-nums text-foreground">{used.toLocaleString("ru-RU")}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Осталось</p>
            <p className="text-lg font-bold tabular-nums text-primary">{remaining.toLocaleString("ru-RU")}</p>
          </div>
        </div>
        <div className="space-y-1">
          <Progress value={pct} className="h-2" />
          <p className="text-[10px] text-muted-foreground tabular-nums">{pct}% использовано</p>
        </div>
        {period && (
          <p className="text-[11px] text-muted-foreground">
            Период: {formatDate(period.date_from_unix)} — {formatDate(period.date_to_unix)}
          </p>
        )}
      </div>
    </div>
  )
}
