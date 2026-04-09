import { useState } from "react"
import {
  Activity,
  BarChart2,
  Loader2,
  Minus,
  RefreshCw,
  Star,
  TrendingDown,
  TrendingUp,
} from "lucide-react"

import type { AnalyticsTimelinePoint } from "@/components/modules/analytics/use-analytics-data"
import type { ReviewAnalyticsOut } from "@/lib/api"
import { cn } from "@/lib/utils"

function GrowthBadge({ value, suffix = "" }: { value: number; suffix?: string }) {
  if (value === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <Minus className="h-3 w-3" /> 0{suffix}
      </span>
    )
  }
  const positive = value > 0
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", positive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
      {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {positive ? "+" : ""}{value}{suffix}
    </span>
  )
}

function fillDateGaps(points: AnalyticsTimelinePoint[]): AnalyticsTimelinePoint[] {
  if (points.length <= 1) return points
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
  const map = new Map(sorted.map((point) => [point.date, point.count]))
  const start = new Date(`${sorted[0].date}T00:00:00Z`)
  const end = new Date(`${sorted[sorted.length - 1].date}T00:00:00Z`)
  const filled: AnalyticsTimelinePoint[] = []
  const cursor = new Date(start)
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10)
    filled.push({ date: key, count: map.get(key) ?? 0 })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return filled
}

function formatDateLabel(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`)
  const day = date.getUTCDate()
  const months = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
  return `${day} ${months[date.getUTCMonth()]}`
}

function TimelineChart({ currentPoints, previousPoints }: { currentPoints: AnalyticsTimelinePoint[]; previousPoints: AnalyticsTimelinePoint[] }) {
  const [hovered, setHovered] = useState<number | null>(null)

  const filledCurrent = fillDateGaps(currentPoints)
  const filledPrevious = fillDateGaps(previousPoints)
  const currentMap = new Map(filledCurrent.map((point) => [point.date, point.count]))
  const previousMap = new Map(filledPrevious.map((point) => [point.date, point.count]))
  const currentLabels = filledCurrent.map((point) => point.date)
  const labels = currentLabels.length > 0 ? currentLabels : Array.from(new Set([...currentMap.keys(), ...previousMap.keys()])).sort()

  if (!labels.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <BarChart2 className="mb-2 h-8 w-8 opacity-40" />
        <p className="text-sm font-medium">Нет данных за выбранный период</p>
      </div>
    )
  }

  const currentValues = labels.map((label) => currentMap.get(label) ?? 0)
  const previousValues = labels.map((_, index) => (index < filledPrevious.length ? filledPrevious[index].count : 0))
  const maxVal = Math.max(1, ...currentValues, ...previousValues)

  const W = 1200
  const H = 300
  const PAD_L = 44
  const PAD_R = 16
  const PAD_TOP = 20
  const PAD_BOTTOM = 32
  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_TOP - PAD_BOTTOM
  const n = labels.length
  const xAt = (index: number) => PAD_L + (n <= 1 ? innerW / 2 : (index / (n - 1)) * innerW)

  const yTickCount = 5
  const rawStep = maxVal / yTickCount
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep || 1)))
  const niceStep = Math.ceil(rawStep / magnitude) * magnitude
  const yTicks: number[] = []
  for (let value = 0; value <= maxVal; value += niceStep) yTicks.push(value)
  if (yTicks[yTicks.length - 1] < maxVal) yTicks.push(yTicks[yTicks.length - 1] + niceStep)
  const yMax = yTicks[yTicks.length - 1] || maxVal
  const yAt = (value: number) => PAD_TOP + (1 - value / yMax) * innerH

  const toSmoothPath = (values: number[]) => {
    if (values.length === 0) return ""
    if (values.length === 1) return `M${xAt(0).toFixed(2)} ${yAt(values[0]).toFixed(2)}`
    const points = values.map((value, index) => ({ x: xAt(index), y: yAt(value) }))
    let path = `M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
    for (let index = 0; index < points.length - 1; index++) {
      const p0 = points[Math.max(0, index - 1)]
      const p1 = points[index]
      const p2 = points[index + 1]
      const p3 = points[Math.min(points.length - 1, index + 2)]
      const tension = 0.3
      const cp1x = p1.x + (p2.x - p0.x) * tension
      const cp1y = p1.y + (p2.y - p0.y) * tension
      const cp2x = p2.x - (p3.x - p1.x) * tension
      const cp2y = p2.y - (p3.y - p1.y) * tension
      path += ` C${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
    }
    return path
  }

  const currentSmoothPath = toSmoothPath(currentValues)
  const previousSmoothPath = toSmoothPath(previousValues)
  const areaPath = currentValues.length
    ? `${currentSmoothPath} L${xAt(currentValues.length - 1).toFixed(2)} ${(PAD_TOP + innerH).toFixed(2)} L${xAt(0).toFixed(2)} ${(PAD_TOP + innerH).toFixed(2)} Z`
    : ""

  const currentTotal = currentValues.reduce((sum, value) => sum + value, 0)
  const previousTotal = previousValues.reduce((sum, value) => sum + value, 0)
  const maxXLabels = 10
  const xLabelStep = Math.max(1, Math.ceil(n / maxXLabels))

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-5 text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <span className="h-2.5 w-6 rounded-full bg-emerald-500" />
          Текущий ({currentTotal})
        </span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className="h-[3px] w-6 rounded bg-slate-400 border-t-2 border-dashed border-slate-400" />
          Пред. период ({previousTotal})
        </span>
        {currentTotal !== previousTotal && <GrowthBadge value={currentTotal - previousTotal} />}
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" preserveAspectRatio="xMidYMid meet" onMouseLeave={() => setHovered(null)}>
          <defs>
            <linearGradient id="analyticsAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#22c55e" stopOpacity="0.01" />
            </linearGradient>
            <filter id="analyticsDotShadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#22c55e" floodOpacity="0.35" />
            </filter>
          </defs>

          {yTicks.map((value) => {
            const y = yAt(value)
            return (
              <g key={value}>
                <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="currentColor" className="text-border" strokeWidth="1" opacity="0.25" strokeDasharray={value === 0 ? "none" : "4 3"} />
                <text x={PAD_L - 8} y={y + 4} textAnchor="end" className="fill-muted-foreground" fontSize="10">{value}</text>
              </g>
            )
          })}

          {areaPath && <path d={areaPath} fill="url(#analyticsAreaGrad)" />}
          <path d={previousSmoothPath} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="6 4" opacity="0.45" />
          <path d={currentSmoothPath} fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

          {hovered !== null && (
            <line x1={xAt(hovered)} x2={xAt(hovered)} y1={PAD_TOP} y2={PAD_TOP + innerH} stroke="#22c55e" strokeWidth="1" strokeDasharray="4 3" opacity="0.4" />
          )}

          {currentValues.map((value, index) => {
            const isActive = hovered === index
            return (
              <circle key={`cur-${index}`} cx={xAt(index)} cy={yAt(value)} r={isActive ? 5 : 3.5} fill={isActive ? "#22c55e" : "white"} stroke="#22c55e" strokeWidth={isActive ? 2.5 : 2} filter={isActive ? "url(#analyticsDotShadow)" : undefined} className="transition-all duration-150" />
            )
          })}

          {previousValues.map((value, index) => {
            const isActive = hovered === index
            return (
              <circle key={`prev-${index}`} cx={xAt(index)} cy={yAt(value)} r={isActive ? 4 : 2.5} fill={isActive ? "#94a3b8" : "white"} stroke="#94a3b8" strokeWidth={isActive ? 2 : 1.5} className="transition-all duration-150" />
            )
          })}

          {labels.map((_, index) => {
            const sliceW = innerW / Math.max(1, n - 1)
            const hitX = xAt(index) - sliceW / 2
            return (
              <rect key={`hit-${index}`} x={Math.max(PAD_L, hitX)} y={PAD_TOP} width={Math.min(sliceW, innerW)} height={innerH} fill="transparent" onMouseEnter={() => setHovered(index)} style={{ cursor: "crosshair" }} />
            )
          })}

          {hovered !== null && (() => {
            const index = hovered
            const currentValue = currentValues[index]
            const previousValue = previousValues[index]
            const diff = currentValue - previousValue
            const dateLabel = formatDateLabel(labels[index])
            const tx = xAt(index)
            const ty = Math.min(yAt(currentValue), yAt(previousValue)) - 14
            const flipX = tx > W - 180
            const tooltipX = flipX ? tx - 160 : tx - 50
            const tooltipY = Math.max(PAD_TOP, ty - 62)

            return (
              <g className="pointer-events-none">
                <rect x={tooltipX} y={tooltipY} width="160" height="58" rx="10" fill="white" stroke="#e5e7eb" strokeWidth="1" filter="drop-shadow(0 4px 12px rgba(0,0,0,0.08))" />
                <text x={tooltipX + 12} y={tooltipY + 18} fontSize="11" fontWeight="600" fill="#111827">{dateLabel}</text>
                <circle cx={tooltipX + 12} cy={tooltipY + 34} r="4" fill="#22c55e" />
                <text x={tooltipX + 22} y={tooltipY + 38} fontSize="11" fontWeight="500" fill="#374151">{currentValue} отз.</text>
                <text x={tooltipX + 148} y={tooltipY + 38} fontSize="11" fontWeight="600" textAnchor="end" fill={diff > 0 ? "#16a34a" : diff < 0 ? "#dc2626" : "#6b7280"}>{diff > 0 ? "+" : ""}{diff}</text>
                <circle cx={tooltipX + 12} cy={tooltipY + 50} r="3.5" fill="none" stroke="#94a3b8" strokeWidth="1.5" />
                <text x={tooltipX + 22} y={tooltipY + 54} fontSize="10" fill="#6b7280">Пред: {previousValue}</text>
              </g>
            )
          })()}

          {labels.map((label, index) => {
            if (index % xLabelStep !== 0 && index !== labels.length - 1) return null
            const isActive = hovered === index
            return (
              <text key={`x-${label}`} x={xAt(index)} y={H - 8} textAnchor="middle" className={isActive ? "fill-foreground" : "fill-muted-foreground"} fontSize={isActive ? "11" : "10"} fontWeight={isActive ? "600" : "400"}>
                {formatDateLabel(label)}
              </text>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

function RatingBar({ star, count, total }: { star: number; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  const colors = ["", "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e"]

  return (
    <div className="flex items-center gap-2.5">
      <span className="flex w-10 shrink-0 items-center gap-0.5 text-xs font-medium">
        {star}
        <Star className="h-3 w-3 fill-current" style={{ color: colors[star] }} />
      </span>
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-secondary/60">
        <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${pct}%`, backgroundColor: colors[star] }} />
      </div>
      <span className="w-10 text-right text-xs font-medium tabular-nums">{count}</span>
      <span className="w-10 text-right text-[10px] tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  )
}

type AnalyticsChartsProps = {
  data: ReviewAnalyticsOut | null
  prevTimeline: AnalyticsTimelinePoint[]
  totalRated: number
  loading: boolean
}

export function AnalyticsCharts({ data, prevTimeline, totalRated, loading }: AnalyticsChartsProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      {/* Timeline chart */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border/40 px-5 py-3.5">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Динамика отзывов</h3>
        </div>
        <div className="px-5 py-4">
          {loading && !data ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Загрузка…
            </div>
          ) : (
            <TimelineChart
              currentPoints={(data?.timeline ?? []).map((point) => ({ date: point.date, count: point.count }))}
              previousPoints={prevTimeline}
            />
          )}
        </div>
      </div>

      {/* Rating distribution */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border/40 px-5 py-3.5">
          <Star className="h-4 w-4 fill-amber-500 text-amber-500" />
          <h3 className="text-sm font-semibold text-foreground">Распределение оценок</h3>
        </div>
        <div className="px-5 py-4">
          {loading && !data ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Загрузка…
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 border-b border-border/40 pb-3">
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold tabular-nums">{data ? data.avg_rating.toFixed(1) : "—"}</span>
                  <span className="text-sm text-muted-foreground">/5</span>
                </div>
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star key={star} className={cn("h-4 w-4", star <= Math.round(data?.avg_rating ?? 0) ? "fill-amber-500 text-amber-500" : "text-muted-foreground/20")} />
                  ))}
                </div>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">{totalRated} оценок</span>
              </div>
              <div className="space-y-2">
                {[5, 4, 3, 2, 1].map((star) => (
                  <RatingBar key={star} star={star} count={data?.by_rating[star] ?? 0} total={totalRated} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
