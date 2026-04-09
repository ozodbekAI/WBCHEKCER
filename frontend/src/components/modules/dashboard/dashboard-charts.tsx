import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { cn } from "@/lib/utils"
import type {
  DashboardTimelinePoint,
  RatingTrendPoint,
  ResponseTimeOut,
  AiEfficiencyOut,
  CreditsUsagePoint,
  ConversionFunnelOut,
  TopCategory,
} from "@/lib/api"
import { Loader2 } from "lucide-react"

/* ─── Shared ─── */

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border/50 bg-popover px-3 py-2 shadow-lg">
      <div className="text-[11px] font-medium text-foreground mb-1">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 text-[11px]">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-semibold text-foreground">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

function ChartLoading() {
  return (
    <div className="flex items-center justify-center h-full min-h-[120px] text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin mr-2" />
      <span className="text-[12px]">Загрузка...</span>
    </div>
  )
}

function ChartEmpty({ text = "Нет данных" }: { text?: string }) {
  return (
    <div className="flex items-center justify-center h-full min-h-[120px]">
      <span className="text-[12px] text-muted-foreground">{text}</span>
    </div>
  )
}

function fmtDate(d: string) {
  try {
    const date = new Date(d)
    return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })
  } catch { return d }
}

/* ═══ Timeline Area Chart ═══ */
export function TimelineChart({ data, loading }: { data?: DashboardTimelinePoint[]; loading?: boolean }) {
  if (loading) return <ChartLoading />
  if (!data?.length) return <ChartEmpty />
  const formatted = data.map(p => ({ ...p, date: fmtDate(p.date) }))
  return (
    <div className="h-full w-full min-h-[200px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={formatted} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="gReviews" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gAnswered" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.3} />
              <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip />} />
          <Area type="monotone" dataKey="reviews" name="Отзывы" stroke="hsl(var(--primary))" fill="url(#gReviews)" strokeWidth={2} />
          <Area type="monotone" dataKey="answered" name="Отвечено" stroke="hsl(var(--success))" fill="url(#gAnswered)" strokeWidth={2} />
          <Area type="monotone" dataKey="questions" name="Вопросы" stroke="hsl(var(--info))" fill="none" strokeWidth={1.5} strokeDasharray="4 2" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ═══ Rating Trend ═══ */
export function RatingTrendChart({ data, loading }: { data?: RatingTrendPoint[]; loading?: boolean }) {
  if (loading) return <ChartLoading />
  if (!data?.length) return <ChartEmpty />
  const formatted = data.map(p => ({ ...p, date: fmtDate(p.date), rating: p.avg_rating }))
  return (
    <div className="h-full w-full min-h-[200px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={formatted} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis domain={[3, 5]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip />} />
          <Line type="monotone" dataKey="rating" name="Рейтинг" stroke="hsl(var(--warning))" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ═══ Response Time ═══ */
export function ResponseTimeChart({ data, loading }: { data?: ResponseTimeOut | null; loading?: boolean }) {
  if (loading) return <ChartLoading />
  if (!data?.points?.length) return <ChartEmpty />
  const formatted = data.points.map(p => ({ ...p, date: fmtDate(p.date) }))
  const trend = data.trend_percent

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-2xl font-bold tabular-nums text-foreground">{data.current_avg_minutes} мин</span>
        <span className={cn("text-[11px] font-semibold tabular-nums", trend <= 0 ? "text-success" : "text-destructive")}>
          {trend <= 0 ? "↓" : "↑"} {Math.abs(trend)}%
        </span>
      </div>
      <div className="flex-1 min-h-[120px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={formatted} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="gTime" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--info))" stopOpacity={0.2} />
                <stop offset="100%" stopColor="hsl(var(--info))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" hide />
            <YAxis hide />
            <Tooltip content={<ChartTooltip />} />
            <Area type="monotone" dataKey="avg_minutes" name="Ср. время" stroke="hsl(var(--info))" fill="url(#gTime)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* ═══ AI Efficiency Donut ═══ */
export function AiEfficiencyChart({ data, loading }: { data?: AiEfficiencyOut | null; loading?: boolean }) {
  if (loading) return <ChartLoading />
  if (!data || data.total_drafts === 0) return <ChartEmpty text="Нет данных по AI-генерации" />

  const items = [
    { name: "Без правок", value: data.published_as_is, color: "hsl(var(--success))" },
    { name: "С правками", value: data.published_with_edits, color: "hsl(var(--warning))" },
    { name: "Вручную", value: data.manual_only, color: "hsl(var(--muted-foreground))" },
  ]

  return (
    <div className="flex items-center gap-4 h-full">
      <div className="relative w-[120px] h-[120px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={items} dataKey="value" cx="50%" cy="50%" innerRadius={36} outerRadius={54} strokeWidth={0}>
              {items.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold text-foreground tabular-nums">{data.auto_rate_percent}%</span>
          <span className="text-[9px] text-muted-foreground">авто</span>
        </div>
      </div>
      <div className="space-y-2 flex-1 min-w-0">
        {items.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
            <span className="text-[11px] text-muted-foreground truncate flex-1">{d.name}</span>
            <span className="text-[12px] font-semibold text-foreground tabular-nums">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ═══ Credits Usage ═══ */
export function CreditsUsageChart({ data, totalSpent, loading }: { data?: CreditsUsagePoint[]; totalSpent?: number; loading?: boolean }) {
  if (loading) return <ChartLoading />
  if (!data?.length) return <ChartEmpty text="Нет данных о расходе кредитов" />
  const formatted = data.map(p => ({ ...p, date: fmtDate(p.date) }))

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-2xl font-bold tabular-nums text-foreground">{totalSpent ?? 0}</span>
        <span className="text-[11px] text-muted-foreground">кредитов</span>
      </div>
      <div className="flex-1 min-h-[120px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={formatted} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval={2} />
            <YAxis hide />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="draft" name="Черновики" stackId="a" fill="hsl(var(--primary))" radius={[0, 0, 0, 0]} />
            <Bar dataKey="classification" name="Классификация" stackId="a" fill="hsl(var(--primary))" fillOpacity={0.4} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* ═══ Conversion Funnel ═══ */
export function ConversionFunnel({ data, loading }: { data?: ConversionFunnelOut | null; loading?: boolean }) {
  if (loading) return <ChartLoading />
  if (!data) return <ChartEmpty />

  const items = [
    { stage: "Отзывы", value: data.total_reviews, color: "hsl(var(--foreground))" },
    { stage: "AI-черновики", value: data.drafts_generated, color: "hsl(var(--primary))" },
    { stage: "Отредактировано", value: data.drafts_edited, color: "hsl(var(--warning))" },
    { stage: "Опубликовано", value: data.published, color: "hsl(var(--success))" },
  ]
  const maxVal = items[0].value || 1

  return (
    <div className="space-y-2">
      {items.map((item, i) => {
        const pct = (item.value / maxVal) * 100
        const convRate = i > 0 && items[i - 1].value > 0 ? Math.round((item.value / items[i - 1].value) * 100) : 100
        return (
          <div key={item.stage}>
            <div className="flex items-center justify-between text-[11px] mb-0.5">
              <span className="text-foreground font-medium">{item.stage}</span>
              <div className="flex items-center gap-2">
                <span className="font-bold tabular-nums text-foreground">{item.value}</span>
                {i > 0 && <span className="text-[10px] text-muted-foreground tabular-nums">({convRate}%)</span>}
              </div>
            </div>
            <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: item.color }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ═══ Top Categories ═══ */
export function TopCategoriesChart({ data, loading }: { data?: TopCategory[]; loading?: boolean }) {
  if (loading) return <ChartLoading />
  if (!data?.length) return <ChartEmpty text="Категории появятся при включении AI-аналитики" />

  return (
    <div className="space-y-2">
      {data.map((cat) => {
        const negPct = cat.total > 0 ? (cat.negative / cat.total) * 100 : 0
        const posPct = cat.total > 0 ? (cat.positive / cat.total) * 100 : 0
        return (
          <div key={cat.code}>
            <div className="flex items-center justify-between text-[11px] mb-0.5">
              <span className="text-foreground font-medium truncate max-w-[160px]">{cat.label}</span>
              <span className="font-bold tabular-nums text-foreground shrink-0">{cat.total}</span>
            </div>
            <div className="flex h-1.5 rounded-full overflow-hidden bg-muted/30">
              <div className="h-full bg-success" style={{ width: `${posPct}%` }} />
              <div className="h-full bg-destructive" style={{ width: `${negPct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
