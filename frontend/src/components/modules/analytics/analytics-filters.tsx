import { RefreshCw, SlidersHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SelectItem } from "@/components/ui/select"
import {
  GRANULARITY_LABELS,
  PERIOD_LABELS,
} from "@/components/modules/analytics/use-analytics-data"
import type { ReviewAnalyticsGranularity, ReviewAnalyticsPeriod } from "@/lib/api"
import { cn } from "@/lib/utils"
import { FilterSelect } from "@/components/shared/page-controls"

type AnalyticsFiltersProps = {
  period: ReviewAnalyticsPeriod
  granularity: ReviewAnalyticsGranularity
  loading: boolean
  onPeriodChange: (value: ReviewAnalyticsPeriod) => void
  onGranularityChange: (value: ReviewAnalyticsGranularity) => void
  onRefresh: () => void
}

export function AnalyticsFilters({
  period,
  granularity,
  loading,
  onPeriodChange,
  onGranularityChange,
  onRefresh,
}: AnalyticsFiltersProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-muted/30 px-2.5 py-1.5">
        <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground hidden sm:inline">Фильтры</span>
        <div className="h-4 w-px bg-border/50" />
        <FilterSelect
          value={period}
          onValueChange={(v) => onPeriodChange(v as ReviewAnalyticsPeriod)}
          placeholder="Период"
          isActive={period !== "30d"}
        >
          {(Object.keys(PERIOD_LABELS) as ReviewAnalyticsPeriod[]).map((value) => (
            <SelectItem key={value} value={value}>{PERIOD_LABELS[value]}</SelectItem>
          ))}
        </FilterSelect>

        <FilterSelect
          value={granularity}
          onValueChange={(v) => onGranularityChange(v as ReviewAnalyticsGranularity)}
          placeholder="Группировка"
          isActive={false}
        >
          {(Object.keys(GRANULARITY_LABELS) as ReviewAnalyticsGranularity[]).map((value) => (
            <SelectItem key={value} value={value}>{GRANULARITY_LABELS[value]}</SelectItem>
          ))}
        </FilterSelect>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={onRefresh}
        disabled={loading}
        className="h-8 gap-1.5 text-xs px-3 border-border/50"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        Обновить
      </Button>
    </div>
  )
}
