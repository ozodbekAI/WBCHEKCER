import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {  useSearchParams  } from "react-router-dom"

import type { FeedbackDetail } from "@/components/feedback/feedback-detail-dialog"
import type { FeedbackRow } from "@/components/feedback/feedbacks-feed"
import type { DraftRow } from "@/components/drafts/drafts-table"
import { useToast } from "@/components/ui/use-toast"
import { useAsyncData } from "@/hooks/use-async-data"
import { useSyncPolling } from "@/hooks/use-sync-polling"
import {
  approveAllDrafts,
  bulkDraftFeedbacks,
  getDraft,
  getFeedback,
  getFeedbackProductAnalytics,
  listFeedbacks,
  listPendingDrafts,
  syncFeedbacks,
} from "@/lib/api"
import { getErrorMessage } from "@/lib/error-message"
import { parseFeedbacksSection, type FeedbacksSection } from "@/components/modules/feedbacks/feedbacks-types"

async function fetchFeedbackDetail(shopId: number, wbId: string): Promise<FeedbackDetail> {
  return (await getFeedback(shopId, wbId)) as FeedbackDetail
}

export function useFeedbacksController(shopId: number | null) {
  const { toast } = useToast()
  const { isPolling, error: pollError, pollJob } = useSyncPolling()
  const [searchParams] = useSearchParams()

  const [section, setSection] = useState<FeedbacksSection>(() => parseFeedbacksSection(searchParams.get("section")))
  const [q, setQ] = useState("")
  const [debouncedQ, setDebouncedQ] = useState("")
  const [rating, setRating] = useState("all")
  const [textFilter, setTextFilter] = useState("all")
  const [photoFilter, setPhotoFilter] = useState("all")
  const hasActiveFilters = q.trim().length > 0 || rating !== "all" || textFilter !== "all" || photoFilter !== "all"

  const [rows, setRows] = useState<FeedbackRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  const limit = 20
  const [offset, setOffset] = useState(0)
  const offsetRef = useRef(0)
  const [hasMore, setHasMore] = useState(true)

  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailData, setDetailData] = useState<FeedbackDetail | null>(null)
  const [detailIntent, setDetailIntent] = useState<{
    initialTab: "review" | "answer"
    autoFocusAnswer: boolean
  }>({ initialTab: "review", autoFocusAnswer: false })
  const [currentDetailIndex, setCurrentDetailIndex] = useState<number>(0)

  const [analyticsOpen, setAnalyticsOpen] = useState(false)

  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkLoading, setBulkLoading] = useState(false)
  const [approveAllLoading, setApproveAllLoading] = useState(false)
  const [bulkFeedbacks, setBulkFeedbacks] = useState<FeedbackRow[]>([])
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())
  const [bulkFeedbacksLoading, setBulkFeedbacksLoading] = useState(false)

  const [draftRows, setDraftRows] = useState<DraftRow[]>([])
  const [draftHasMore, setDraftHasMore] = useState(true)
  const [draftDetailOpen, setDraftDetailOpen] = useState(false)
  const [draftDetailLoading, setDraftDetailLoading] = useState(false)
  const [draftDetailData, setDraftDetailData] = useState<any | null>(null)
  const [activeDraftId, setActiveDraftId] = useState<number | null>(null)

  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const loadLockRef = useRef(false)
  const draftOffsetRef = useRef(0)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQ(q)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [q])

  const setOffsetSafe = useCallback((next: number | ((prev: number) => number)) => {
    setOffset((prev) => {
      const value = typeof next === "function" ? (next as (prev: number) => number)(prev) : next
      offsetRef.current = value
      return value
    })
  }, [])

  const resetFilters = useCallback(() => {
    setQ("")
    setDebouncedQ("")
    setRating("all")
    setTextFilter("all")
    setPhotoFilter("all")
  }, [])

  useEffect(() => {
    setSection(parseFeedbacksSection(searchParams.get("section")))
  }, [searchParams])

  const countsQuery = useAsyncData<{ totalCount: number; answeredTotalCount: number }>(
    async () => {
      if (!shopId) return { totalCount: 0, answeredTotalCount: 0 }
      const [totalResponse, answeredResponse] = await Promise.all([
        listFeedbacks(shopId, { limit: 1, offset: 0 }),
        listFeedbacks(shopId, { is_answered: true, limit: 1, offset: 0 }),
      ])
      return {
        totalCount: totalResponse.total,
        answeredTotalCount: answeredResponse.total,
      }
    },
    [shopId],
    {
      enabled: Boolean(shopId),
      keepPreviousData: true,
      fallbackError: "Не удалось загрузить статистику отзывов",
    },
  )

  const analyticsQuery = useAsyncData(
    async () => {
      if (!shopId) return null
      return getFeedbackProductAnalytics(shopId, 5)
    },
    [shopId],
    {
      enabled: Boolean(shopId),
      keepPreviousData: true,
      fallbackError: "Не удалось загрузить аналитику по товарам",
    },
  )

  const load = useCallback(
    async (reset = false) => {
      if (!shopId || loadLockRef.current) return
      loadLockRef.current = true
      setIsLoading(true)
      setListError(null)

      try {
        const has_text = textFilter === "all" ? undefined : textFilter === "with"
        const has_media = photoFilter === "all" ? undefined : photoFilter === "with"

        let rating_min: number | undefined
        let rating_max: number | undefined
        if (rating !== "all") {
          if (rating === "1-2") {
            rating_min = 1
            rating_max = 2
          } else if (rating === "4-5") {
            rating_min = 4
            rating_max = 5
          } else {
            const num = Number(rating)
            if (Number.isFinite(num)) {
              rating_min = num
              rating_max = num
            }
          }
        }

        if (section === "drafts") {
          const currentOffset = reset ? 0 : draftOffsetRef.current
          const data = await listPendingDrafts(shopId, {
            limit,
            offset: currentOffset,
            q: debouncedQ || undefined,
            has_text,
            has_media,
            rating_min,
            rating_max,
          })

          const mapped: DraftRow[] = (Array.isArray(data) ? data : []).map((item: any) => {
            const feedback = item?.feedback || item?.raw?.feedback || item?.feedback_data || null
            return {
              id: Number(item?.id),
              created_at: item?.created_at || item?.createdAt || item?.generated_at || item?.generatedAt || null,
              status: String(item?.status || "drafted"),
              text: item?.text ?? item?.answer_text ?? null,
              feedback: {
                wb_id: feedback?.wb_id ?? feedback?.wbId ?? item?.wb_id ?? item?.wbId ?? "",
                created_date: feedback?.created_date ?? feedback?.createdDate ?? feedback?.created_at ?? feedback?.createdAt ?? "",
                product_valuation: feedback?.product_valuation ?? feedback?.productValuation ?? null,
                user_name: feedback?.user_name ?? feedback?.userName ?? null,
                text: feedback?.text ?? null,
                pros: feedback?.pros ?? null,
                cons: feedback?.cons ?? null,
                was_viewed: feedback?.was_viewed ?? feedback?.wasViewed ?? null,
                product_details: feedback?.product_details ?? feedback?.productDetails ?? null,
                product_image_url:
                  feedback?.product_image_url ?? feedback?.productImageUrl ?? item?.product_image_url ?? item?.productImageUrl ?? null,
                photo_links: feedback?.photo_links ?? feedback?.photoLinks ?? null,
                raw: feedback?.raw ?? feedback ?? null,
              },
            }
          })

          if (reset) {
            setDraftRows(mapped)
            draftOffsetRef.current = limit
            setDraftHasMore(mapped.length === limit)
          } else {
            setDraftRows((prev) => [...prev, ...mapped])
            draftOffsetRef.current += limit
            setDraftHasMore(mapped.length === limit)
          }

          return
        }

        const nextOffset = reset ? 0 : offsetRef.current
        const response = await listFeedbacks(shopId, {
          is_answered: section === "waiting" ? false : section === "answered" ? true : undefined,
          q: debouncedQ || undefined,
          limit,
          offset: nextOffset,
          rating_min,
          rating_max,
          has_text,
          has_media,
        })

        const list = response.items as FeedbackRow[]
        if (reset) {
          setRows(list)
          setOffsetSafe(limit)
          setHasMore(list.length === limit)
        } else {
          setRows((prev) => {
            const seen = new Set(prev.map((item) => item.wb_id))
            let added = 0
            const next = [...prev]
            for (const item of list) {
              if (!seen.has(item.wb_id)) {
                seen.add(item.wb_id)
                next.push(item)
                added += 1
              }
            }
            if (added === 0) {
              setHasMore(false)
            } else {
              setHasMore(list.length === limit)
            }
            return next
          })
          setOffsetSafe((prev) => prev + limit)
        }
      } catch (error) {
        setListError(getErrorMessage(error, "Не удалось загрузить отзывы"))
      } finally {
        setIsLoading(false)
        loadLockRef.current = false
      }
    },
    [debouncedQ, limit, photoFilter, rating, section, setOffsetSafe, shopId, textFilter],
  )

  useEffect(() => {
    if (!shopId) return
    setOffsetSafe(0)
    draftOffsetRef.current = 0
    setHasMore(true)
    setDraftHasMore(true)
    void load(true)
  }, [debouncedQ, load, photoFilter, rating, section, setOffsetSafe, shopId, textFilter])

  useEffect(() => {
    const element = sentinelRef.current
    const root = scrollRef.current
    if (!element || !root) return

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0]
        if (!first?.isIntersecting) return
        const canLoadMore = section === "drafts" ? draftHasMore : hasMore
        if (!canLoadMore || isLoading) return
        void load(false)
      },
      { root, rootMargin: "240px" },
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [draftHasMore, hasMore, isLoading, load, section])

  const unansweredRows = useMemo(() => rows.filter((row) => !row.answer_text?.trim()), [rows])

  const openDetail = useCallback(
    async (wbId: string, index?: number) => {
      if (!shopId) return
      const fromWaiting = section === "waiting"
      setDetailIntent({ initialTab: fromWaiting ? "answer" : "review", autoFocusAnswer: fromWaiting })
      if (typeof index === "number") {
        setCurrentDetailIndex(index)
      } else {
        const foundIndex = unansweredRows.findIndex((row) => row.wb_id === wbId)
        setCurrentDetailIndex(foundIndex >= 0 ? foundIndex : 0)
      }

      setDetailOpen(true)
      setDetailLoading(true)
      setDetailError(null)
      setDetailData(null)

      try {
        const data = await fetchFeedbackDetail(shopId, wbId)
        setDetailData(data)
      } catch (error) {
        setDetailError(getErrorMessage(error, "Не удалось загрузить детали отзыва"))
      } finally {
        setDetailLoading(false)
      }
    },
    [section, shopId, unansweredRows],
  )

  const handleBulkToggle = useCallback((wbId: string, checked: boolean) => {
    setBulkSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(wbId)
      else next.delete(wbId)
      return next
    })
  }, [])

  const handleBulkToggleAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setBulkSelected(new Set(bulkFeedbacks.map((item) => item.wb_id)))
      } else {
        setBulkSelected(new Set())
      }
    },
    [bulkFeedbacks],
  )

  const openBulkDialog = useCallback(async () => {
    if (!shopId) return
    setBulkOpen(true)
    setBulkFeedbacksLoading(true)
    setBulkSelected(new Set())

    try {
      const response = await listFeedbacks(shopId, {
        is_answered: false,
        limit: 200,
        offset: 0,
      })
      setBulkFeedbacks(response.items)
      setBulkSelected(new Set(response.items.map((feedback: FeedbackRow) => feedback.wb_id)))
    } catch (error) {
      toast({
        title: "Ошибка загрузки",
        description: getErrorMessage(error, "Не удалось загрузить отзывы"),
        variant: "destructive",
      })
    } finally {
      setBulkFeedbacksLoading(false)
    }
  }, [shopId, toast])

  const handleBulkDraft = useCallback(async () => {
    if (!shopId) return
    if (bulkSelected.size === 0) {
      toast({
        title: "Выберите отзывы",
        description: "Отметьте отзывы галочками",
        variant: "destructive",
      })
      return
    }

    setBulkLoading(true)
    try {
      const wbIds = Array.from(bulkSelected)
      await bulkDraftFeedbacks(shopId, { wb_ids: wbIds, limit: wbIds.length } as any)
      toast({
        title: "Запущено",
        description: `Генерация запущена для ${wbIds.length} отзывов`,
      })
      setBulkOpen(false)
      await load(true)
      window.setTimeout(() => {
        void load(true)
      }, 1200)
    } catch (error) {
      toast({
        title: "Не удалось запустить генерацию",
        description: getErrorMessage(error, "Проверьте баланс и доступ"),
        variant: "destructive",
      })
    } finally {
      setBulkLoading(false)
    }
  }, [bulkSelected, load, shopId, toast])

  const handleSync = useCallback(async () => {
    if (!shopId || isPolling) return
    try {
      const response: any = await syncFeedbacks(shopId, {})
      if (response?.job_id) {
        toast({
          title: "Синхронизация запущена",
          description: "Отзывы обновятся автоматически после завершения фоновой задачи.",
        })
        await pollJob(response.job_id, () => {
          void load(true)
          void countsQuery.refresh({ background: true })
          void analyticsQuery.refresh({ background: true })
          toast({
            title: "Отзывы обновлены",
            description: "Очередь и аналитика синхронизированы.",
          })
        })
        return
      }

      await load(true)
      await countsQuery.refresh({ background: true })
      await analyticsQuery.refresh({ background: true })
      toast({
        title: "Отзывы обновлены",
        description: "Список отзывов синхронизирован.",
      })
    } catch (error) {
      toast({
        title: "Синхронизация не запущена",
        description: getErrorMessage(error, "Проверьте подключение магазина и попробуйте снова."),
        variant: "destructive",
      })
    }
  }, [analyticsQuery, countsQuery, isPolling, load, pollJob, shopId, toast])

  const handleApproveAll = useCallback(async () => {
    if (!shopId || approveAllLoading) return
    setApproveAllLoading(true)
    try {
      const response: any = await approveAllDrafts(shopId)
      const publishedCount = Number(response?.published_count || 0)
      const hasErrors = Array.isArray(response?.errors) && response.errors.length > 0
      toast({
        title: hasErrors ? "Черновики обработаны частично" : "Черновики опубликованы",
        description: hasErrors
          ? `Опубликовано ${publishedCount}. Проверьте оставшиеся черновики с ошибками.`
          : `Опубликовано ${publishedCount} черновиков.`,
        variant: hasErrors ? "destructive" : "default",
      })
      await load(true)
      await countsQuery.refresh({ background: true })
      await analyticsQuery.refresh({ background: true })
    } catch (error) {
      toast({
        title: "Не удалось опубликовать черновики",
        description: getErrorMessage(error, "Попробуйте снова или откройте черновики по одному."),
        variant: "destructive",
      })
    } finally {
      setApproveAllLoading(false)
    }
  }, [analyticsQuery, approveAllLoading, countsQuery, load, shopId, toast])

  const openDraftDetail = useCallback(async (draftId: number) => {
    if (!shopId) return
    setActiveDraftId(draftId)
    setDraftDetailOpen(true)
    setDraftDetailLoading(true)
    setDraftDetailData(null)

    try {
      const draft = await getDraft(shopId, draftId)
      setDraftDetailData(draft)
    } catch (error) {
      toast({
        title: "Не удалось загрузить черновик",
        description: getErrorMessage(error, "Попробуйте открыть черновик ещё раз."),
        variant: "destructive",
      })
    } finally {
      setDraftDetailLoading(false)
    }
  }, [shopId, toast])

  const startProcessing = useCallback(() => {
    if (unansweredRows.length === 0) return
    void openDetail(unansweredRows[0].wb_id, 0)
  }, [openDetail, unansweredRows])

  const goToPrev = useCallback(async () => {
    if (!shopId || currentDetailIndex <= 0) return
    const prevIndex = currentDetailIndex - 1
    const prevRow = unansweredRows[prevIndex]
    if (!prevRow) return

    setCurrentDetailIndex(prevIndex)
    setDetailLoading(true)
    setDetailError(null)
    try {
      const data = await fetchFeedbackDetail(shopId, prevRow.wb_id)
      setDetailData(data)
    } catch (error) {
      setDetailError(getErrorMessage(error, "Не удалось загрузить детали"))
    } finally {
      setDetailLoading(false)
    }
  }, [currentDetailIndex, shopId, unansweredRows])

  const goToNext = useCallback(async () => {
    if (!shopId || currentDetailIndex >= unansweredRows.length - 1) return
    const nextIndex = currentDetailIndex + 1
    const nextRow = unansweredRows[nextIndex]
    if (!nextRow) return

    setCurrentDetailIndex(nextIndex)
    setDetailLoading(true)
    setDetailError(null)
    try {
      const data = await fetchFeedbackDetail(shopId, nextRow.wb_id)
      setDetailData(data)
    } catch (error) {
      setDetailError(getErrorMessage(error, "Не удалось загрузить детали"))
    } finally {
      setDetailLoading(false)
    }
  }, [currentDetailIndex, shopId, unansweredRows])

  const reloadDetail = useCallback(async () => {
    if (!shopId || !detailData?.wb_id) return
    setDetailLoading(true)
    setDetailError(null)
    try {
      const data = await fetchFeedbackDetail(shopId, detailData.wb_id)
      setDetailData(data)
    } catch (error) {
      setDetailError(getErrorMessage(error, "Не удалось обновить детали"))
    } finally {
      setDetailLoading(false)
    }
  }, [detailData?.wb_id, shopId])

  const totalCount = countsQuery.data?.totalCount ?? 0
  const answeredTotalCount = countsQuery.data?.answeredTotalCount ?? 0
  const waitingTotalCount = Math.max(totalCount - answeredTotalCount, 0)
  const draftQueueCount = draftRows.length
  const progressPercent = totalCount > 0 ? Math.round((answeredTotalCount / totalCount) * 100) : 0
  const currentListCount = section === "drafts" ? draftRows.length : rows.length

  return {
    section,
    setSection,
    q,
    setQ,
    rating,
    setRating,
    textFilter,
    setTextFilter,
    photoFilter,
    setPhotoFilter,
    hasActiveFilters,
    resetFilters,
    rows,
    draftRows,
    isLoading,
    listError,
    hasMore,
    draftHasMore,
    scrollRef,
    sentinelRef,
    waitingTotalCount,
    answeredTotalCount,
    progressPercent,
    draftQueueCount,
    countsError: countsQuery.error,
    analytics: analyticsQuery.data,
    analyticsLoading: analyticsQuery.isLoading,
    analyticsError: analyticsQuery.error,
    analyticsOpen,
    setAnalyticsOpen,
    pollError,
    isPolling,
    approveAllLoading,
    unansweredCount: unansweredRows.length,
    currentListCount,
    toolbarProps: {
      section,
      isLoading,
      isPolling,
      approveAllLoading,
      unansweredCount: unansweredRows.length,
      draftQueueCount,
      onGenerate: () => void openBulkDialog(),
      onOpenQueue: startProcessing,
      onApproveAll: () => void handleApproveAll(),
      onSync: () => void handleSync(),
    },
    filtersProps: {
      section,
      onSectionChange: setSection,
      waitingTotalCount,
      draftQueueCount,
      answeredTotalCount,
      q,
      onQueryChange: setQ,
      rating,
      onRatingChange: setRating,
      textFilter,
      onTextFilterChange: setTextFilter,
      photoFilter,
      onPhotoFilterChange: setPhotoFilter,
      hasActiveFilters,
      onResetFilters: resetFilters,
      currentListCount,
    },
    statsProps: {
      waitingTotalCount,
      answeredTotalCount,
      progressPercent,
      draftQueueCount,
      analyticsOpen,
      onAnalyticsOpenChange: setAnalyticsOpen,
      analytics: analyticsQuery.data,
      analyticsLoading: analyticsQuery.isLoading,
      analyticsError: analyticsQuery.error,
      countsError: countsQuery.error,
      pollError,
    },
    listProps: {
      section,
      rows,
      draftRows,
      isLoading,
      listError,
      hasMore,
      draftHasMore,
      hasActiveFilters,
      onResetFilters: resetFilters,
      onReload: () => void load(true),
      onOpenBulkDialog: () => void openBulkDialog(),
      onOpenDetail: openDetail,
      onOpenDraftDetail: (draftId: number) => void openDraftDetail(draftId),
      scrollRef,
      sentinelRef,
    },
    bulkActionsProps: {
      open: bulkOpen,
      onOpenChange: setBulkOpen,
      bulkFeedbacksLoading,
      bulkLoading,
      bulkFeedbacks,
      bulkSelected,
      onToggleAll: handleBulkToggleAll,
      onToggleOne: handleBulkToggle,
      onSubmit: () => void handleBulkDraft(),
    },
    detailPanelProps: {
      feedbackDetail: {
        open: detailOpen,
        onOpenChange: setDetailOpen,
        shopId,
        loading: detailLoading,
        error: detailError,
        data: detailData,
        onReload: reloadDetail,
        onPublished: () => {
          void load(true)
          void countsQuery.refresh({ background: true })
        },
        initialTab: detailIntent.initialTab,
        autoFocusAnswer: detailIntent.autoFocusAnswer,
        currentIndex: currentDetailIndex,
        totalCount: unansweredRows.length,
        onPrev: () => void goToPrev(),
        onNext: () => void goToNext(),
      },
      draftDetail: {
        open: draftDetailOpen,
        onOpenChange: setDraftDetailOpen,
        shopId: shopId ?? 0,
        draftId: activeDraftId,
        loading: draftDetailLoading,
        data: draftDetailData,
        onAfterAction: () => {
          void load(true)
          void countsQuery.refresh({ background: true })
        },
      },
    },
  }
}
