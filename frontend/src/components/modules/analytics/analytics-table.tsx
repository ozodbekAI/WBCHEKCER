import { useCallback, useEffect, useRef, useState } from "react"
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ExternalLink,
  Loader2,
  MessageSquare,
  Sparkles,
  Star,
  ThumbsUp,
  TrendingDown,
  Zap,
} from "lucide-react"

import { listFeedbacks } from "@/lib/api"
import { getReviewCategorySentimentLabel, normalizeReviewCategorySentiment } from "@/lib/review-categories"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getErrorMessage } from "@/lib/error-message"
import type { AnalyticsTypeDatum } from "@/components/modules/analytics/use-analytics-data"

const PAGE_SIZE = 5

const REVIEW_TYPE_ICONS: Record<string, React.ReactNode> = {
  positive: <ThumbsUp className="h-3.5 w-3.5" />,
  mixed: <Activity className="h-3.5 w-3.5" />,
  product_defect: <AlertTriangle className="h-3.5 w-3.5" />,
  fit_size: <Zap className="h-3.5 w-3.5" />,
  price_complaint: <TrendingDown className="h-3.5 w-3.5" />,
  emotional_negative: <AlertTriangle className="h-3.5 w-3.5" />,
}

type TypeFeedbackItem = {
  wb_id: string
  text: string | null
  pros: string | null
  cons: string | null
  product_valuation: number | null
  user_name: string | null
  created_date: string
  product_image_url: string | null
  product_details: { productName?: string } | null
}

function reviewMetricIcon(sentiment?: string | null, key?: string) {
  const normalized = normalizeReviewCategorySentiment(sentiment)
  if (normalized === "positive") return <ThumbsUp className="h-3.5 w-3.5" />
  if (normalized === "negative") return <TrendingDown className="h-3.5 w-3.5" />
  return key ? REVIEW_TYPE_ICONS[key] : <MessageSquare className="h-3.5 w-3.5" />
}

function DonutChart({
  data,
  total,
}: {
  data: { label: string; value: number; color: string; key: string }[]
  total: number
}) {
  const size = 160
  const strokeWidth = 28
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const cx = size / 2
  const cy = size / 2

  let offset = 0

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="relative shrink-0">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="currentColor"
            className="text-muted/30"
            strokeWidth={strokeWidth}
          />
          {data.map((item) => {
            const pct = total > 0 ? item.value / total : 0
            const dashLen = pct * circumference
            const dashGap = circumference - dashLen
            const currentOffset = offset
            offset += dashLen

            return (
              <circle
                key={item.key}
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke={item.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${dashLen} ${dashGap}`}
                strokeDashoffset={-currentOffset}
                strokeLinecap="butt"
                className="transition-all duration-700"
                style={{
                  transform: "rotate(-90deg)",
                  transformOrigin: `${cx}px ${cy}px`,
                }}
              >
                <title>{`${item.label}: ${item.value} (${Math.round(pct * 100)}%)`}</title>
              </circle>
            )
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold">{total}</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">всего</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {data.map((item) => {
          const pct = total > 0 ? Math.round((item.value / total) * 100) : 0
          return (
            <div key={item.key} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: item.color }} />
              <span className="truncate text-muted-foreground">{item.label}</span>
              <span className="ml-auto tabular-nums font-semibold">{item.value}</span>
              <span className="tabular-nums text-muted-foreground/60">({pct}%)</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TypeBar({
  typeKey,
  sentiment,
  label,
  value,
  maxValue,
  total,
  color,
  shopId,
}: {
  typeKey: string
  sentiment?: string | null
  label: string
  value: number
  maxValue: number
  total: number
  color: string
  shopId: number
}) {
  const pct = maxValue > 0 ? Math.round((value / maxValue) * 100) : 0
  const share = total > 0 ? Math.round((value / total) * 100) : 0
  const icon = reviewMetricIcon(sentiment, typeKey)
  const sentimentLabel = sentiment ? getReviewCategorySentimentLabel(sentiment) : null

  const [expanded, setExpanded] = useState(false)
  const [items, setItems] = useState<TypeFeedbackItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [totalItems, setTotalItems] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const loadPage = useCallback(
    async (offset: number) => {
      setLoading(true)
      setError(null)
      try {
        const response = await listFeedbacks(shopId, {
          review_type: typeKey,
          review_category_sentiment: sentiment,
          limit: PAGE_SIZE,
          offset,
        })
        const newItems = response.items as TypeFeedbackItem[]
        setTotalItems(response.total)
        setItems((prev) => (offset === 0 ? newItems : [...prev, ...newItems]))
        setHasMore(offset + newItems.length < response.total)
      } catch (error) {
        setError(getErrorMessage(error, "Не удалось загрузить отзывы по категории"))
        setHasMore(false)
      } finally {
        setLoading(false)
      }
    },
    [sentiment, shopId, typeKey],
  )

  const handleClick = () => {
    if (value === 0) return
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    if (items.length === 0) {
      void loadPage(0)
    }
  }

  useEffect(() => {
    if (!expanded || !hasMore || loading) return
    const sentinel = sentinelRef.current
    const root = listRef.current
    if (!sentinel || !root) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loading && hasMore) {
          void loadPage(items.length)
        }
      },
      { root, rootMargin: "80px", threshold: 0.1 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [expanded, hasMore, items.length, loadPage, loading])

  const ratingStars = (rating: number | null) => {
    if (rating == null) return null
    return (
      <span className="inline-flex items-center gap-0.5">
        {Array.from({ length: 5 }, (_, index) => (
          <Star
            key={index}
            className={`h-3 w-3 ${index < rating ? "fill-amber-400 text-amber-400" : "text-gray-200"}`}
          />
        ))}
      </span>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={value === 0}
        className={`flex w-full items-center gap-2.5 rounded-lg py-1 text-left transition-colors ${
          value > 0 ? "cursor-pointer hover:bg-muted/60" : "cursor-default opacity-50"
        } ${expanded ? "bg-muted/40" : ""}`}
      >
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: `${color}20`, color }}>
          {icon || <MessageSquare className="h-3.5 w-3.5" />}
        </div>
        <div className="w-40 min-w-0 shrink-0 text-left">
          <div className="truncate text-xs font-medium">{label}</div>
          {sentimentLabel ? (
            <div className="text-[10px] font-medium" style={{ color }}>
              {sentimentLabel}
            </div>
          ) : null}
        </div>
        <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-secondary/80">
          <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${pct}%`, backgroundColor: color }} />
        </div>
        <span className="w-8 text-right text-xs font-semibold tabular-nums">{value}</span>
        <span className="w-10 text-right text-[10px] tabular-nums text-muted-foreground">{share}%</span>
        {value > 0 ? (
          <ChevronDown
            className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          />
        ) : null}
      </button>

      {expanded ? (
        <div className="mb-2 ml-8 mr-1 mt-1.5">
          {items.length > 0 ? (
            <p className="mb-1.5 text-[10px] text-muted-foreground">Показано {items.length} из {totalItems}</p>
          ) : null}

          {error ? <p className="py-2 text-xs text-destructive">{error}</p> : null}

          {items.length > 0 ? (
            <div ref={listRef} className="max-h-[360px] space-y-1 overflow-y-auto pr-1">
              {items.map((feedback) => (
                <div
                  key={feedback.wb_id}
                  className="flex gap-3 rounded-lg border border-border/50 bg-background p-2 transition-colors hover:border-border"
                >
                  {feedback.product_image_url ? (
                    <img
                      src={feedback.product_image_url}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-md bg-muted object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                      <MessageSquare className="h-4 w-4 text-muted-foreground/40" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex items-center gap-2">
                      {ratingStars(feedback.product_valuation)}
                      {feedback.user_name ? (
                        <span className="truncate text-[10px] text-muted-foreground">{feedback.user_name}</span>
                      ) : null}
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">
                        {new Date(feedback.created_date).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                      </span>
                    </div>
                    {feedback.text ? (
                      <p className="line-clamp-2 text-xs leading-relaxed text-foreground/80">{feedback.text}</p>
                    ) : (
                      <div className="flex gap-3 text-xs">
                        {feedback.pros ? (
                          <span className="line-clamp-1 text-emerald-600 dark:text-emerald-400">
                            <span className="font-medium">+</span> {feedback.pros}
                          </span>
                        ) : null}
                        {feedback.cons ? (
                          <span className="line-clamp-1 text-red-500 dark:text-red-400">
                            <span className="font-medium">−</span> {feedback.cons}
                          </span>
                        ) : null}
                        {!feedback.pros && !feedback.cons ? <span className="italic text-muted-foreground">Без текста</span> : null}
                      </div>
                    )}
                  </div>

                  <a
                    href={`https://www.wildberries.ru/catalog/0/search.aspx?search=${feedback.wb_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:text-primary"
                    title="Открыть на WB"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ))}

              {hasMore ? (
                <div ref={sentinelRef} className="flex items-center justify-center py-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <span className="ml-1.5 text-[10px] text-muted-foreground">Ещё…</span>
                </div>
              ) : null}

              {!hasMore && items.length >= totalItems && items.length > PAGE_SIZE ? (
                <p className="pt-1 text-center text-[10px] text-muted-foreground">Все {totalItems} отзывов загружены</p>
              ) : null}
            </div>
          ) : loading ? (
            <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Загрузка отзывов…
            </div>
          ) : (
            <p className="py-2 text-xs text-muted-foreground">Нет отзывов</p>
          )}
        </div>
      ) : null}
    </div>
  )
}

type AnalyticsTableProps = {
  dataTotal: number
  typeData: AnalyticsTypeDatum[]
  maxTypeCount: number
  totalTyped: number
  shopId: number
}

export function AnalyticsTable({
  dataTotal,
  typeData,
  maxTypeCount,
  totalTyped,
  shopId,
}: AnalyticsTableProps) {
  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader className="px-5 pb-2 pt-4">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Zap className="h-4 w-4 text-primary" />
            AI-классификация категорий
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 px-5 pb-4">
          <DonutChart
            data={typeData.map((item) => ({
              ...item,
              label: item.legendLabel,
            }))}
            total={totalTyped}
          />
          <div className="space-y-2 border-t border-border/40 pt-3">
            {typeData.map((item) => (
              <TypeBar
                key={item.key}
                typeKey={item.code}
                sentiment={item.sentiment}
                label={item.label}
                value={item.value}
                maxValue={maxTypeCount}
                total={totalTyped}
                color={item.color}
                shopId={shopId}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {dataTotal > 0 && typeData.length > 0 ? (
        <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
          <CardContent className="flex items-start gap-3 p-4">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="mb-0.5 text-sm font-semibold text-foreground">AI-инсайт</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {(() => {
                  const top = typeData[0]
                  const pct = totalTyped > 0 ? Math.round((top.value / totalTyped) * 100) : 0
                  const second = typeData[1]
                  const secondPct = second && totalTyped > 0 ? Math.round((second.value / totalTyped) * 100) : 0

                  let insight = `${pct}% отзывов — «${top.label}». Это самая частая причина обратной связи в выбранном периоде.`
                  if (second && secondPct > 15) {
                    insight += ` На втором месте — «${second.label}» (${secondPct}%).`
                  }
                  if (top.key === "product_defect" && pct > 30) {
                    insight += " Высокая доля жалоб на дефекты — рекомендуем проверить качество товаров."
                  }
                  if (top.key === "positive" && pct > 50) {
                    insight += " Более половины клиентов довольны — отличный результат."
                  }
                  return insight
                })()}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
