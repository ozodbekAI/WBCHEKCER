import { ChevronDown, ChevronUp, TrendingDown, TrendingUp } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { DataErrorState, DataLoadingState } from "@/components/ui/data-state"
import { Progress } from "@/components/ui/progress"
import type { ProductAnalytics } from "@/lib/api"
import { cn } from "@/lib/utils"

type FeedbacksStatsBarProps = {
  waitingTotalCount: number
  answeredTotalCount: number
  progressPercent: number
  draftQueueCount: number
  analyticsOpen: boolean
  onAnalyticsOpenChange: (open: boolean) => void
  analytics: ProductAnalytics | null
  analyticsLoading: boolean
  analyticsError: string | null
  countsError: string | null
  pollError: string | null
}

export function FeedbacksStatsBar({
  waitingTotalCount,
  answeredTotalCount,
  progressPercent,
  draftQueueCount,
  analyticsOpen,
  onAnalyticsOpenChange,
  analytics,
  analyticsLoading,
  analyticsError,
  countsError,
  pollError,
}: FeedbacksStatsBarProps) {
  return (
    <div className="space-y-1">
      {/* Compact KPI strip */}
      <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-card px-3.5 py-2">
        <KpiChip label="Ожидают" value={waitingTotalCount} tone="warning" />
        <Sep />
        <KpiChip label="Отвечено" value={answeredTotalCount} tone="success">
          <Progress value={progressPercent} className="h-[3px] w-10" />
          <span className="text-[10px] text-success font-bold tabular-nums">{progressPercent}%</span>
        </KpiChip>
        <Sep />
        <KpiChip label="Черновики" value={draftQueueCount} />

        <div className="ml-auto">
          <Collapsible open={analyticsOpen} onOpenChange={onAnalyticsOpenChange}>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors">
                <TrendingUp className="h-3 w-3 text-success" />
                <span className="hidden md:inline font-medium">Товары</span>
                {analyticsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            </CollapsibleTrigger>
          </Collapsible>
        </div>
      </div>

      {countsError && <ErrorLine text={countsError} />}
      {pollError && <ErrorLine text={pollError} />}

      {/* Collapsible analytics */}
      <Collapsible open={analyticsOpen} onOpenChange={onAnalyticsOpenChange}>
        <CollapsibleContent>
          <div className="rounded-xl border border-border/40 bg-card p-3">
            {analyticsLoading && !analytics ? (
              <DataLoadingState compact title="Загружаем аналитику" description="Товары-лидеры и проблемные позиции." />
            ) : analyticsError && !analytics ? (
              <DataErrorState compact title="Не удалось загрузить" description={analyticsError} />
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <AnalyticsColumn
                  title="Лучшие по отзывам"
                  icon={<TrendingUp className="h-3 w-3" />}
                  tone="success"
                  items={analytics?.top_products || []}
                />
                <AnalyticsColumn
                  title="Требуют внимания"
                  icon={<TrendingDown className="h-3 w-3" />}
                  tone="destructive"
                  items={analytics?.problem_products || []}
                />
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

function KpiChip({ label, value, tone, children }: {
  label: string; value: number; tone?: "warning" | "success"; children?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">{label}</span>
      <span className={cn(
        "text-[13px] font-bold tabular-nums leading-none",
        tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-foreground"
      )}>
        {value}
      </span>
      {children}
    </div>
  )
}

function Sep() {
  return <div className="h-3.5 w-px bg-border/40" />
}

function ErrorLine({ text }: { text: string }) {
  return <div className="text-[11px] text-destructive rounded-lg bg-[hsl(var(--danger-soft))]/40 border border-destructive/10 px-2.5 py-1">{text}</div>
}

function AnalyticsColumn({ title, icon, tone, items }: {
  title: string; icon: React.ReactNode; tone: "success" | "destructive"
  items: Array<{ name: string; count: number; recent: number }>
}) {
  return (
    <div>
      <div className={cn("mb-1.5 flex items-center gap-1 text-[11px] font-semibold", tone === "success" ? "text-success" : "text-destructive")}>
        {icon} {title}
      </div>
      <div className="space-y-1">
        {items.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">Нет данных</div>
        ) : (
          items.map((item, index) => (
            <div key={`${item.name}-${index}`} className="flex items-center justify-between text-[12px] gap-2">
              <span className="max-w-[180px] truncate text-foreground">{item.name}</span>
              <div className="flex items-center gap-1 shrink-0">
                <span className="font-semibold tabular-nums">{item.count}</span>
                {item.recent > 0 && (
                  <Badge
                    variant={tone === "destructive" ? "destructive" : "default"}
                    className={cn("h-3.5 px-1 text-[9px]", tone === "success" && "bg-success/10 text-success border-success/20 hover:bg-success/10")}
                  >
                    +{item.recent}
                  </Badge>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
