import { useCallback, useEffect, useMemo, useState } from "react"

import {
  getReviewAnalytics,
  type ReviewAnalyticsGranularity,
  type ReviewAnalyticsOut,
  type ReviewAnalyticsPeriod,
} from "@/lib/api"
import { getErrorMessage } from "@/lib/error-message"
import {
  getReviewCategoryLabel,
  getReviewCategorySentimentLabel,
  getReviewCategoryToneColor,
} from "@/lib/review-categories"

export const PERIOD_LABELS: Record<ReviewAnalyticsPeriod, string> = {
  "7d": "7 дней",
  "30d": "30 дней",
  "90d": "90 дней",
  all: "Весь период",
  custom: "Свой период",
}

export const GRANULARITY_LABELS: Record<ReviewAnalyticsGranularity, string> = {
  day: "По дням",
  week: "По неделям",
  month: "По месяцам",
}

export type AnalyticsTimelinePoint = {
  date: string
  count: number
}

export type AnalyticsTypeDatum = {
  key: string
  code: string
  sentiment: string | null
  label: string
  legendLabel: string
  value: number
  color: string
}

function periodDays(period: ReviewAnalyticsPeriod): number {
  if (period === "7d") return 7
  if (period === "30d") return 30
  if (period === "90d") return 90
  return 365
}

function utcDayTs(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function unixSec(ms: number): number {
  return Math.floor(ms / 1000)
}

function previousPeriodRange(period: ReviewAnalyticsPeriod): { fromUnix: number; toUnix: number } | null {
  if (period === "all") return null

  const days = periodDays(period)
  const now = new Date()
  const todayStart = utcDayTs(now)
  const currentFromStart = todayStart - (days - 1) * 24 * 60 * 60 * 1000
  const prevFromStart = currentFromStart - days * 24 * 60 * 60 * 1000
  const prevToEnd = currentFromStart - 1

  return {
    fromUnix: unixSec(prevFromStart),
    toUnix: unixSec(prevToEnd),
  }
}

export function useAnalyticsData(shopId: number | null) {
  const [period, setPeriod] = useState<ReviewAnalyticsPeriod>("30d")
  const [granularity, setGranularity] = useState<ReviewAnalyticsGranularity>("day")
  const [data, setData] = useState<ReviewAnalyticsOut | null>(null)
  const [prevTimeline, setPrevTimeline] = useState<AnalyticsTimelinePoint[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!shopId) return
    setLoading(true)
    setError(null)
    try {
      const prev = previousPeriodRange(period)
      const [currentResult, previousResult] = await Promise.all([
        getReviewAnalytics(shopId, period, granularity),
        prev
          ? getReviewAnalytics(shopId, period, granularity, {
              dateFromUnix: prev.fromUnix,
              dateToUnix: prev.toUnix,
            })
          : Promise.resolve(null),
      ])

      setData(currentResult)
      setPrevTimeline(
        previousResult?.timeline?.map((point) => ({
          date: point.date,
          count: point.count,
        })) || [],
      )
    } catch (error) {
      setError(getErrorMessage(error, "Не удалось загрузить аналитику"))
    } finally {
      setLoading(false)
    }
  }, [granularity, period, shopId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh()
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    if (!data?.is_analyzing) return
    const timer = window.setInterval(() => {
      void refresh()
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [data?.is_analyzing, refresh])

  const aiEnabled = data?.ai_enabled ?? false
  const activationRequired = data?.activation_required ?? true

  const typeData = useMemo<AnalyticsTypeDatum[]>(() => {
    if (!data) return []
    if (data.by_category_sentiment?.length) {
      return data.by_category_sentiment
        .map((item) => ({
          key: item.key,
          code: item.code,
          sentiment: item.sentiment ?? null,
          label: getReviewCategoryLabel(item.code, data.category_labels),
          legendLabel: item.sentiment
            ? `${getReviewCategoryLabel(item.code, data.category_labels)} · ${getReviewCategorySentimentLabel(item.sentiment)}`
            : getReviewCategoryLabel(item.code, data.category_labels),
          value: item.count,
          color: getReviewCategoryToneColor(item.code, item.sentiment),
        }))
        .sort((a, b) => b.value - a.value)
    }
    return Object.entries(data.by_type)
      .sort((a, b) => b[1] - a[1])
      .map(([key, value]) => ({
        key,
        code: key,
        sentiment: null,
        label: getReviewCategoryLabel(key, data.category_labels),
        legendLabel: getReviewCategoryLabel(key, data.category_labels),
        value,
        color: getReviewCategoryToneColor(key, null),
      }))
  }, [data])

  const maxTypeCount = typeData.length ? typeData[0].value : 1
  const totalTyped = typeData.reduce((sum, item) => sum + item.value, 0)
  const totalRated = data ? Object.values(data.by_rating).reduce((sum, value) => sum + value, 0) : 0
  const hasContent = Boolean(data && data.total > 0)

  return {
    period,
    setPeriod,
    granularity,
    setGranularity,
    data,
    prevTimeline,
    loading,
    error,
    refresh,
    typeData,
    maxTypeCount,
    totalTyped,
    totalRated,
    hasContent,
    aiEnabled,
    activationRequired,
  }
}
