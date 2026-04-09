import * as React from "react"

import { ChevronLeft, ChevronRight, ExternalLink, Save, Send, Sparkles, Star, ThumbsDown, ThumbsUp } from "lucide-react"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { useScrollLock } from "@/hooks/use-scroll-lock"

import {
  applyReviewAiLearning,
  editFeedbackAnswer,
  generateFeedbackDraft,
  getReviewAiLearning,
  getLatestFeedbackDraft,
  publishFeedbackAnswer,
  updateDraft,
} from "@/lib/api"
import {
  getReviewCategoryCodes,
  getReviewCategoryLabel,
  getReviewCategorySentiment,
  getReviewCategoryToneStyle,
} from "@/lib/review-categories"

export type FeedbackDetail = {
  wb_id: string
  created_date: string
  product_valuation?: number | null
  user_name?: string | null
  text?: string | null
  pros?: string | null
  cons?: string | null
  was_viewed?: boolean | null
  answer_text?: string | null
  answer_state?: string | null
  answer_editable?: boolean | null
  product_details?: any | null
  product_image_url?: string | null
  photo_links?: Array<string | { fullSize?: string; miniSize?: string }> | null
  video?: any | null
  bables?: string[] | null
  raw?: any | null
  review_type?: string | null
  review_categories?: string[] | null
  review_category_labels?: Record<string, string> | null
  review_category_matches?: Array<{ code: string; sentiment: string | null }> | null
  review_sentiment?: string | null
  review_need_reply_score?: number | null
  review_requires_manual_attention?: boolean | null
}

function fmtDateTime(d: string) {
  try {
    const dt = new Date(d)
    if (Number.isNaN(dt.getTime())) return d
    return dt.toLocaleString("ru-RU")
  } catch {
    return d
  }
}

function safeText(v: any) {
  const s = typeof v === "string" ? v : v == null ? "" : String(v)
  return s.trim() ? s.trim() : "—"
}

function getBuyerTags(bables: FeedbackDetail["bables"]): string[] {
  if (!Array.isArray(bables)) return []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const item of bables) {
    const value = typeof item === "string" ? item.trim() : ""
    if (!value || seen.has(value)) continue
    seen.add(value)
    tags.push(value)
  }
  return tags
}

function categoryChipClass(code: string, sentiment?: string | null) {
  const tone = getReviewCategoryToneStyle(code, sentiment)
  return `inline-flex max-w-[11rem] items-center rounded-full px-2.5 py-1 text-[11px] font-medium leading-4 shadow-sm ring-1 ring-black/5 ${tone}`
}

function getPd(data: FeedbackDetail) {
  return data.product_details || data.raw?.productDetails || null
}

function getNmId(data: FeedbackDetail) {
  const pd = getPd(data)
  return pd?.nmId || data.raw?.nmId || null
}

function ratingValue(data: FeedbackDetail) {
  const v = Number(data.product_valuation ?? 0)
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(5, Math.round(v)))
}

function RatingStars({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }).map((_, i) => {
        const active = i < value
        return (
          <Star
            key={i}
            className={active ? "h-4 w-4 text-primary fill-primary" : "h-4 w-4 text-muted-foreground/30"}
          />
        )
      })}
    </div>
  )
}

export default function FeedbackDetailDialog({
  open,
  onOpenChange,
  shopId,
  data,
  loading,
  error,
  onReload,
  onPublished,
  initialTab = "review",
  autoFocusAnswer = false,
  // Navigation props
  currentIndex,
  totalCount,
  onPrev,
  onNext,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  shopId: number | null
  data: FeedbackDetail | null
  loading: boolean
  error: string | null
  onReload?: () => Promise<void> | void
  onPublished?: () => Promise<void> | void
  initialTab?: "review" | "answer"
  autoFocusAnswer?: boolean
  // Navigation props
  currentIndex?: number
  totalCount?: number
  onPrev?: () => void
  onNext?: () => void
}) {
  const { toast } = useToast()
  useScrollLock(open)

  const answerRef = React.useRef<HTMLTextAreaElement | null>(null)

  const [answerText, setAnswerText] = React.useState("")
  const [draftId, setDraftId] = React.useState<number | null>(null)
  const [action, setAction] = React.useState<"draft" | "save" | "publish" | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [learningOpen, setLearningOpen] = React.useState(false)
  const [learningEnabled, setLearningEnabled] = React.useState<boolean | null>(null)
  const [learningInstruction, setLearningInstruction] = React.useState("")
  const [learningApplying, setLearningApplying] = React.useState(false)

  const answerState = String(data?.answer_state || "").toLowerCase()
  const answerTextRaw = String(data?.answer_text || "").trim()
  const isAutoSkipped = (answerState === "system_auto_skip" || answerState === "no_reply_needed") && answerTextRaw === "—"
  const isAnswered = Boolean(answerTextRaw) && !isAutoSkipped
  const needReplyScore = Number(data?.review_need_reply_score)
  const hasNeedReplyScore = Number.isFinite(needReplyScore)
  const requiresManualAttention = (Boolean(data?.review_requires_manual_attention) || answerState === "manual_attention") && !isAnswered && !isAutoSkipped

  // Focus the answer textarea when opened from "Ожидают ответа"
  React.useEffect(() => {
    if (!open) return
    if (!autoFocusAnswer) return
    const t = window.setTimeout(() => {
      answerRef.current?.focus()
    }, 80)
    return () => window.clearTimeout(t)
  }, [open, autoFocusAnswer])

  React.useEffect(() => {
    if (!open) return
    setActionError(null)

    // If feedback already has a real published answer, display it.
    // No-reply-needed placeholder ("—") is treated as unanswered in the editor.
    const published = (data?.answer_text || "").toString().trim()
    const state = String(data?.answer_state || "").toLowerCase()
    const isSkipped = (state === "system_auto_skip" || state === "no_reply_needed") && published === "—"
    if (published && !isSkipped) {
      setAnswerText(published)
      setDraftId(null)
      return
    }

    if (data?.review_requires_manual_attention) {
      setAnswerText("")
      setDraftId(null)
      return
    }

    // No published answer: try to load the latest draft (auto-generated or previously created).
    setAnswerText("")
    setDraftId(null)
    if (!shopId || !data?.wb_id) return

    ;(async () => {
      try {
        const d = await getLatestFeedbackDraft(shopId, data.wb_id)
        if (!d?.text) return
        // Guard: don't override if the user already typed something while we were loading.
        setAnswerText((prev) => (prev.trim() ? prev : d.text))
        setDraftId(d.draft_id ?? null)
      } catch {
        // no draft yet -> ignore
      }
    })()
  }, [open, shopId, data?.wb_id, data?.answer_text])

  React.useEffect(() => {
    if (!open || !shopId) return
    let cancelled = false
    ;(async () => {
      try {
        const state = await getReviewAiLearning(shopId)
        if (!cancelled) setLearningEnabled(Boolean(state.enabled))
      } catch {
        if (!cancelled) setLearningEnabled(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, shopId])

  const pd = data ? getPd(data) : null
  const nmId = data ? getNmId(data) : null
  const brandName = pd?.brandName || pd?.brand || ""
  const productName = pd?.productName || pd?.name || "Товар"
  const sizeText = pd?.size || "—"
  const colorText = data?.raw?.color || "—"
  const categoryCodes = data ? getReviewCategoryCodes(data) : []
  const reviewText = String(data?.text || "").trim()
  const prosText = String(data?.pros || "").trim()
  const consText = String(data?.cons || "").trim()
  const buyerTags = getBuyerTags(data?.bables)
  const categoriesFromBuyerTags = categoryCodes.length > 0 && !reviewText && !prosText && !consText && buyerTags.length > 0

  const canAct = Boolean(shopId && data)
  const canGenerateDraft = canAct && !requiresManualAttention
  const canTeach = Boolean(canAct && answerText.trim())

  const doDraft = async () => {
    if (!shopId || !data || requiresManualAttention) return
    setAction("draft")
    setActionError(null)
    try {
      const res = await generateFeedbackDraft(shopId, data.wb_id)
      if (res?.text) setAnswerText(res.text)
      if (typeof res?.draft_id === "number") setDraftId(res.draft_id)
      toast({ title: "Черновик сгенерирован", description: "Проверьте текст и при необходимости отредактируйте." })
      await onReload?.()
    } catch (e: any) {
      const msg = e?.message || "Не удалось сгенерировать черновик"
      setActionError(msg)
      toast({ title: "Ошибка", description: msg, variant: "destructive" })
    } finally {
      setAction(null)
    }
  }

  const doSave = async () => {
    if (!shopId || !data) return
    setAction("save")
    setActionError(null)
    try {
      if (isAnswered) {
        await editFeedbackAnswer(shopId, data.wb_id, answerText)
        toast({ title: "Сохранено", description: "Ответ обновлён в Wildberries." })
        await onReload?.()
      } else {
        if (!draftId) {
          throw new Error("Нет черновика: сначала нажмите «Сгенерировать»")
        }
        await updateDraft(shopId, draftId, { text: answerText })
        toast({ title: "Сохранено", description: "Черновик обновлён." })
      }
    } catch (e: any) {
      const msg = e?.message || "Не удалось сохранить"
      setActionError(msg)
      toast({ title: "Ошибка", description: msg, variant: "destructive" })
    } finally {
      setAction(null)
    }
  }

  const doPublish = async () => {
    if (!shopId || !data) return
    setAction("publish")
    setActionError(null)
    try {
      if (isAnswered) {
        await editFeedbackAnswer(shopId, data.wb_id, answerText)
        toast({ title: "Обновлено", description: "Ответ обновлён в Wildberries." })
        await onPublished?.()
      } else {
        await publishFeedbackAnswer(shopId, data.wb_id, answerText)
        toast({ title: "Опубликовано", description: "Ответ отправлен на Wildberries." })
        await onPublished?.()
      }
    } catch (e: any) {
      const msg = e?.message || "Не удалось опубликовать"
      setActionError(msg)
      toast({ title: "Ошибка", description: msg, variant: "destructive" })
    } finally {
      setAction(null)
    }
  }

  const doApplyLearning = async () => {
    if (!shopId || !data) return
    const instruction = learningInstruction.trim()
    if (!instruction) return
    setLearningApplying(true)
    try {
      const result = await applyReviewAiLearning(shopId, {
        feedback_wb_id: data.wb_id,
        answer_text: answerText,
        instruction,
      })
      setLearningOpen(false)
      setLearningInstruction("")
      toast({
        title: result.actions_count > 0 ? "Правило добавлено" : "Изменений не потребовалось",
        description:
          result.actions_count > 0
            ? "AI добавил правило в shop-настройки этого магазина."
            : "Такое правило уже есть в настройках магазина.",
      })
    } catch (e: any) {
      const msg = e?.message || "Не удалось сохранить правило обучения"
      toast({ title: "Ошибка", description: msg, variant: "destructive" })
    } finally {
      setLearningApplying(false)
    }
  }

  const hasNavigation = typeof currentIndex === "number" && typeof totalCount === "number" && totalCount > 0
  const canGoPrev = hasNavigation && currentIndex > 0
  const canGoNext = hasNavigation && currentIndex < totalCount - 1

  // Keyboard navigation
  React.useEffect(() => {
    if (!open || !hasNavigation) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && canGoPrev) {
        e.preventDefault()
        onPrev?.()
      } else if (e.key === "ArrowRight" && canGoNext) {
        e.preventDefault()
        onNext?.()
      } else if (e.key === "g" && !e.ctrlKey && !e.metaKey) {
        // G for generate
        if (canGenerateDraft && !action) {
          e.preventDefault()
          doDraft()
        }
      } else if (e.key === "Escape") {
        e.preventDefault()
        onOpenChange(false)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, hasNavigation, canGoPrev, canGoNext, onPrev, onNext, canGenerateDraft, action, isAnswered, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="
          w-[96vw] max-w-5xl
          sm:w-[96vw] sm:max-w-5xl
          h-[90vh] max-h-[90vh]
          overflow-hidden
          p-0
          flex flex-col
          gap-0
        "
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Отзыв</DialogTitle>
        </DialogHeader>

        {/* Navigation Header */}
        {hasNavigation && (
          <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
            <Button
              variant="ghost"
              size="sm"
              onClick={onPrev}
              disabled={!canGoPrev || loading}
              className="gap-1 text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
              Предыдущий
            </Button>
            <div className="text-sm text-muted-foreground">
              {currentIndex + 1} из {totalCount}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onNext}
              disabled={!canGoNext || loading}
              className="gap-1 text-muted-foreground hover:text-foreground"
            >
              Следующий
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 min-h-0 overflow-hidden flex">
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Загрузка…</div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-sm text-destructive">{error}</div>
            </div>
          ) : !data ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Нет данных</div>
          ) : (
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 min-h-0 overflow-hidden">
              {/* Left: Review details */}
              <div className="border-r border-border overflow-y-auto p-5 space-y-4">
                {/* Product info */}
                <div className="flex items-start gap-3">
                  {pd?.img || data.product_image_url ? (
                    <img
                      src={pd?.img || data.product_image_url}
                      alt=""
                      className="w-12 h-12 rounded-lg object-cover border border-border"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
                      <Star className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-foreground leading-tight line-clamp-2">
                      {productName}
                    </h3>
                    <div className="text-xs text-muted-foreground mt-1">
                      {brandName && <span>{brandName} · </span>}
                      {nmId && <span>#{nmId}</span>}
                    </div>
                  </div>
                </div>

                {/* Rating and WB link */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RatingStars value={ratingValue(data)} />
                    <span className="text-sm font-medium text-foreground">
                      {Number(data.product_valuation || 0)}/5
                    </span>
                  </div>
                  {nmId ? (
                    <a
                      href={`https://www.wildberries.ru/catalog/${nmId}/detail.aspx`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Открыть на WB
                    </a>
                  ) : null}
                </div>

                {categoryCodes.length ? (
                  <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          Категории анализа
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {categoriesFromBuyerTags
                            ? "Определены по меткам покупателя Wildberries."
                            : "Определены по тексту отзыва, плюсам, минусам и меткам WB."}
                        </p>
                      </div>
                      {categoriesFromBuyerTags ? (
                        <Badge variant="outline" className="h-6 shrink-0 rounded-full border-dashed text-[11px] text-muted-foreground">
                          Метки WB
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {categoryCodes.map((code) => {
                        const sentiment = getReviewCategorySentiment(data, code)
                        return (
                          <span
                            key={code}
                            title={getReviewCategoryLabel(code, data.review_category_labels)}
                            className={categoryChipClass(code, sentiment)}
                          >
                            <span className="line-clamp-2 text-left">
                              {getReviewCategoryLabel(code, data.review_category_labels)}
                            </span>
                          </span>
                        )
                      })}
                    </div>
                  </div>
                ) : null}

                <Separator />

                {/* Customer info */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Покупатель</div>
                    <div className="font-medium text-foreground">{safeText(data.user_name)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Дата</div>
                    <div className="font-medium text-foreground">{fmtDateTime(data.created_date)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Размер</div>
                    <div className="font-medium text-foreground">{safeText(sizeText)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Цвет</div>
                    <div className="font-medium text-foreground">{safeText(colorText)}</div>
                  </div>
                </div>

                <Separator />

                {buyerTags.length ? (
                  <div>
                    <div className="text-xs text-muted-foreground mb-2">Метки покупателя WB</div>
                    <div className="flex flex-wrap gap-2">
                      {buyerTags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-primary/15 bg-primary/5 px-2.5 py-1 text-[11px] font-medium leading-4 text-primary"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    {categoriesFromBuyerTags ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Текстового отзыва нет, поэтому категории определены по выбранным меткам Wildberries.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {buyerTags.length ? <Separator /> : null}

                {/* Review text */}
                <div>
                  <div className="text-xs text-muted-foreground mb-2">Текст отзыва</div>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{safeText(data.text)}</p>
                </div>

                {/* Pros and cons */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 p-3">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-400 mb-1">
                      <ThumbsUp className="h-3.5 w-3.5" />
                      Плюсы
                    </div>
                    <div className="text-sm text-green-800 dark:text-green-300">{safeText(data.pros)}</div>
                  </div>
                  <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-3">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400 mb-1">
                      <ThumbsDown className="h-3.5 w-3.5" />
                      Минусы
                    </div>
                    <div className="text-sm text-red-800 dark:text-red-300">{safeText(data.cons)}</div>
                  </div>
                </div>

                {/* Photos */}
                {!!(data.photo_links && data.photo_links.length) && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-2">Фото ({data.photo_links.length})</div>
                    <div className="flex gap-2 flex-wrap">
                      {data.photo_links.slice(0, 6).map((link, i) => {
                        // Support both string URLs and {fullSize, miniSize} objects
                        const fullUrl = typeof link === 'string' ? link : (link as any)?.fullSize || (link as any)?.miniSize
                        const thumbUrl = typeof link === 'string' ? link : (link as any)?.miniSize || (link as any)?.fullSize
                        if (!fullUrl) return null
                        return (
                          <a key={i} href={fullUrl} target="_blank" rel="noopener noreferrer">
                            <img
                              src={thumbUrl}
                              alt=""
                              className="h-16 w-16 object-cover rounded-lg border border-border hover:opacity-80 transition-opacity"
                            />
                          </a>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Right: Answer section */}
              <div className="overflow-y-auto p-5 flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-foreground">Ваш ответ</h3>
                  <Badge variant={requiresManualAttention ? "destructive" : isAnswered ? "default" : "secondary"} className="text-xs">
                    {isAutoSkipped ? "Пропущен (авто)" : requiresManualAttention ? "Требует внимания" : isAnswered ? "Опубликован" : "Ожидает ответа"}
                  </Badge>
                </div>

                {requiresManualAttention ? (
                  <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                    <div className="font-medium">Для этого отзыва нужен ручной ответ.</div>
                    <div className="mt-1 text-xs text-red-600/90 dark:text-red-300/80">
                      AI определил, что обычный автоответ здесь не подходит.
                      {hasNeedReplyScore ? ` Оценка пригодности для автоответа: ${needReplyScore}%.` : ""}
                    </div>
                  </div>
                ) : null}

                <Textarea
                  ref={answerRef}
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  placeholder="Напишите ответ или сгенерируйте черновик..."
                  className="flex-1 min-h-[120px] max-h-[180px] rounded-xl resize-none text-sm"
                  disabled={!canAct || action === "publish"}
                />

                <div className="flex items-center justify-between text-xs text-muted-foreground mt-2 mb-4">
                  <button
                    type="button"
                    onClick={() => setAnswerText("")}
                    className="hover:text-foreground transition-colors"
                    disabled={!answerText}
                  >
                    ↺ Сбросить
                  </button>
                  <span>{answerText.length} символов</span>
                </div>

                {actionError && (
                  <div className="text-xs text-destructive mb-3">{actionError}</div>
                )}

                <div className="space-y-2">
                  <Button
                    variant="outline"
                    onClick={doDraft}
                    disabled={!canGenerateDraft || action !== null}
                    className="w-full justify-center gap-2"
                  >
                    <Sparkles className="h-4 w-4" />
                    {requiresManualAttention ? "Только ручной ответ" : "Сгенерировать ответ"}
                    <span className="text-xs text-muted-foreground ml-auto">G</span>
                  </Button>

                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      onClick={doSave}
                      disabled={!canAct || action !== null || !answerText.trim()}
                      className="gap-2"
                    >
                      <Save className="h-4 w-4" />
                      Черновик
                    </Button>

                    <Button
                      onClick={doPublish}
                      disabled={!canAct || action !== null || !answerText.trim()}
                      className="gap-2 bg-primary hover:bg-primary/90"
                    >
                      <Send className="h-4 w-4" />
                      Опубликовать
                    </Button>
                  </div>

                  <Button
                    variant="ghost"
                    onClick={() => setLearningOpen(true)}
                    disabled={!canTeach || action !== null}
                    className="w-full justify-center gap-2 text-muted-foreground hover:text-foreground"
                  >
                    <Sparkles className="h-4 w-4" />
                    Обучить ИИ по этому ответу
                  </Button>
                  <div className="text-[11px] text-muted-foreground">
                    {requiresManualAttention
                      ? "Автогенерация отключена для этого отзыва, но вы можете написать ответ вручную и затем обучить ИИ по готовому тексту."
                      : learningEnabled === false
                      ? "Сначала включите «Обучение ИИ» в настройках магазина."
                      : "AI сам решит, куда добавить правило: в общий prompt, category prompt или стоп-слова."}
                  </div>
                </div>

                <div className="mt-4 text-xs text-muted-foreground text-center">
                  ← → для навигации • {requiresManualAttention ? "G отключена для ручного ответа" : "G для генерации"} • Esc для закрытия
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>

      <Sheet open={learningOpen} onOpenChange={setLearningOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xl">
          <SheetHeader className="border-b border-border/70 px-6 py-5">
            <SheetTitle>Обучить ИИ для этого магазина</SheetTitle>
            <SheetDescription>
              Напишите правило обычным языком. AI сам определит, нужно ли добавить его в общий review-promt, в конкретную категорию или в стоп-слова.
            </SheetDescription>
          </SheetHeader>

          <div className="flex h-full flex-col overflow-hidden">
            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
              <Card className="border-border/70">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Текущий ответ</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-sm whitespace-pre-wrap">
                    {answerText.trim() || "Сначала сгенерируйте или напишите ответ, чтобы обучить ИИ."}
                  </div>
                </CardContent>
              </Card>

              {categoryCodes.length ? (
                <Card className="border-border/70">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Категории этого отзыва</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                      {categoryCodes.map((code) => {
                        const sentiment = getReviewCategorySentiment(data!, code)
                        return (
                          <span key={code} className={categoryChipClass(code, sentiment)}>
                            {getReviewCategoryLabel(code, data?.review_category_labels)}
                          </span>
                        )
                    })}
                  </CardContent>
                </Card>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="learning-instruction">Что нужно изменить в будущих ответах</Label>
                <Textarea
                  id="learning-instruction"
                  value={learningInstruction}
                  onChange={(e) => setLearningInstruction(e.target.value)}
                  placeholder="Например: не используйте слово «благодарим», лучше пишите более тепло. Или: для категории «Размер и посадка» в негативных отзывах предлагайте обмен размера."
                  className="min-h-[140px] resize-none"
                  disabled={learningApplying}
                />
                <div className="text-xs text-muted-foreground">
                  Примеры: «не используйте слово “благодарим”», «для негативных отзывов про размер предлагайте помочь с подбором», «фразу “идеальная покупка” не писать».
                </div>
              </div>

              {learningEnabled === false ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Обучение ИИ выключено для этого магазина. Включите его в разделе «Настройки → Отзывы → Обучение ИИ».
                </div>
              ) : null}
            </div>

            <div className="border-t border-border/70 px-6 py-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLearningOpen(false)}
                  disabled={learningApplying}
                >
                  Отмена
                </Button>
                <Button
                  type="button"
                  onClick={doApplyLearning}
                  disabled={!canTeach || !learningInstruction.trim() || learningApplying}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  {learningApplying ? "Сохраняем правило…" : "Сохранить правило"}
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </Dialog>
  )
}
