import * as React from "react"
import type { RefObject } from "react"

import { ChevronLeft, ChevronRight, ExternalLink, GripVertical, RefreshCw, Save, Send, Sparkles, Star, ThumbsDown, ThumbsUp, X, Image as ImageIcon, Brain } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"

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

export type { FeedbackDetail } from "@/components/feedback/feedback-detail-dialog"
import type { FeedbackDetail } from "@/components/feedback/feedback-detail-dialog"
import { cn } from "@/lib/utils"

function fmtDate(d: string) {
  try {
    const dt = new Date(d)
    if (Number.isNaN(dt.getTime())) return d
    return dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
  } catch { return d }
}

function fmtTime(d: string) {
  try {
    const dt = new Date(d)
    if (Number.isNaN(dt.getTime())) return ""
    return dt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
  } catch { return "" }
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
  const color = value <= 2 ? "text-destructive fill-destructive" : value <= 3 ? "text-warning fill-warning" : "text-success fill-success"
  return (
    <div className="flex items-center gap-px">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={cn("h-3.5 w-3.5 3xl:h-4 3xl:w-4", i < value ? color : "text-border")} />
      ))}
    </div>
  )
}

/* ── Meta cell ── */
function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] 3xl:text-[11px] uppercase tracking-wider text-muted-foreground/60 leading-none">{label}</div>
      <div className="text-xs 3xl:text-[13px] font-medium text-foreground truncate mt-0.5">{value}</div>
    </div>
  )
}

export default function FeedbackInlinePanel({
  open,
  onClose,
  shopId,
  data,
  loading,
  error,
  onReload,
  onPublished,
  autoFocusAnswer = false,
  currentIndex,
  totalCount,
  onPrev,
  onNext,
  backgroundScrollRef,
  onDragStart,
}: {
  open: boolean
  onClose: () => void
  shopId: number | null
  data: FeedbackDetail | null
  loading: boolean
  error: string | null
  onReload?: () => Promise<void> | void
  onPublished?: () => Promise<void> | void
  autoFocusAnswer?: boolean
  currentIndex?: number
  totalCount?: number
  onPrev?: () => void
  onNext?: () => void
  backgroundScrollRef?: RefObject<HTMLDivElement | null>
  onDragStart?: (e: React.MouseEvent) => void
}) {
  const { toast } = useToast()
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

  React.useEffect(() => {
    if (!open) return
    if (!autoFocusAnswer) return
    const t = window.setTimeout(() => answerRef.current?.focus(), 80)
    return () => window.clearTimeout(t)
  }, [open, autoFocusAnswer])

  React.useEffect(() => {
    if (!open) return
    setActionError(null)
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
    setAnswerText("")
    setDraftId(null)
    if (!shopId || !data?.wb_id) return
    ;(async () => {
      try {
        const d = await getLatestFeedbackDraft(shopId, data.wb_id)
        if (!d?.text) return
        setAnswerText((prev) => (prev.trim() ? prev : d.text))
        setDraftId(d.draft_id ?? null)
      } catch { /* no draft */ }
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
    return () => { cancelled = true }
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

  const canAct = Boolean(shopId && data)
  const canGenerateDraft = canAct && !requiresManualAttention
  const canTeach = Boolean(canAct && answerText.trim())

  const hasNavigation = typeof currentIndex === "number" && typeof totalCount === "number" && totalCount > 0
  const canGoPrev = hasNavigation && currentIndex! > 0
  const canGoNext = hasNavigation && currentIndex! < totalCount! - 1

  const doDraft = async () => {
    if (!shopId || !data || requiresManualAttention) return
    setAction("draft")
    setActionError(null)
    try {
      const res = await generateFeedbackDraft(shopId, data.wb_id)
      if (res?.text) setAnswerText(res.text)
      if (typeof res?.draft_id === "number") setDraftId(res.draft_id)
      toast({ title: "Черновик сгенерирован" })
      await onReload?.()
    } catch (e: any) {
      const msg = e?.message || "Не удалось сгенерировать"
      setActionError(msg)
      toast({ title: "Ошибка", description: msg, variant: "destructive" })
    } finally { setAction(null) }
  }

  const doSave = async () => {
    if (!shopId || !data) return
    setAction("save")
    setActionError(null)
    try {
      if (isAnswered) {
        await editFeedbackAnswer(shopId, data.wb_id, answerText)
        toast({ title: "Сохранено" })
        await onReload?.()
      } else {
        if (!draftId) throw new Error("Нет черновика: сначала нажмите «Сгенерировать»")
        await updateDraft(shopId, draftId, { text: answerText })
        toast({ title: "Черновик обновлён" })
      }
    } catch (e: any) {
      const msg = e?.message || "Не удалось сохранить"
      setActionError(msg)
      toast({ title: "Ошибка", description: msg, variant: "destructive" })
    } finally { setAction(null) }
  }

  const doPublish = async () => {
    if (!shopId || !data) return
    setAction("publish")
    setActionError(null)
    try {
      if (isAnswered) {
        await editFeedbackAnswer(shopId, data.wb_id, answerText)
        toast({ title: "Обновлено" })
        await onPublished?.()
      } else {
        await publishFeedbackAnswer(shopId, data.wb_id, answerText)
        toast({ title: "Опубликовано" })
        await onPublished?.()
      }
    } catch (e: any) {
      const msg = e?.message || "Не удалось опубликовать"
      setActionError(msg)
      toast({ title: "Ошибка", description: msg, variant: "destructive" })
    } finally { setAction(null) }
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
      })
    } catch (e: any) {
      toast({ title: "Ошибка", description: e?.message || "Не удалось сохранить правило", variant: "destructive" })
    } finally { setLearningApplying(false) }
  }

  React.useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && canGoPrev) { e.preventDefault(); onPrev?.() }
      else if (e.key === "ArrowRight" && canGoNext) { e.preventDefault(); onNext?.() }
      else if (e.key === "g" && !e.ctrlKey && !e.metaKey && canGenerateDraft && !action) { e.preventDefault(); doDraft() }
      else if (e.key === "Escape") { e.preventDefault(); onClose() }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, canGoPrev, canGoNext, onPrev, onNext, canGenerateDraft, action, onClose])

  const passWheelToList = React.useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const listEl = backgroundScrollRef?.current
    if (!listEl) return
    event.preventDefault()
    listEl.scrollTop += event.deltaY
  }, [backgroundScrollRef])

  if (!open) return null

  return (
    <>
      <div
        className="flex h-full max-h-[calc(100vh-5rem)] flex-col overflow-hidden rounded-2xl border border-border/50 bg-card shadow-[0_8px_40px_-12px_hsl(var(--foreground)/0.12)]"
        onWheel={passWheelToList}
      >
        {/* ── Header ── */}
        <div
          className="flex shrink-0 items-center gap-2.5 3xl:gap-3 border-b border-border/40 px-4 py-2 3xl:px-5 3xl:py-2.5 cursor-grab active:cursor-grabbing bg-muted/20"
          onMouseDown={onDragStart}
        >
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />

          {/* Nav */}
          {hasNavigation && (
            <div className="flex items-center gap-0.5">
              <Button variant="ghost" size="icon" className="h-7 w-7 3xl:h-8 3xl:w-8" onClick={onPrev} disabled={!canGoPrev || loading}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-[11px] 3xl:text-xs text-muted-foreground tabular-nums min-w-[32px] text-center">{currentIndex! + 1}/{totalCount}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7 3xl:h-8 3xl:w-8" onClick={onNext} disabled={!canGoNext || loading}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {/* Product info compact */}
          {data && !loading && (
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              {(pd?.img || data.product_image_url) ? (
                <img src={pd?.img || data.product_image_url!} alt="" className="h-8 w-8 3xl:h-9 3xl:w-9 shrink-0 rounded-lg border border-border/40 object-cover" />
              ) : (
                <div className="flex h-8 w-8 3xl:h-9 3xl:w-9 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-muted">
                  <ImageIcon className="h-3.5 w-3.5 text-muted-foreground/30" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs 3xl:text-[13px] font-medium text-foreground truncate leading-tight">{productName}</div>
                <div className="flex items-center gap-1.5">
                  <RatingStars value={ratingValue(data)} />
                  <Badge
                    variant={requiresManualAttention ? "destructive" : isAnswered ? "success" : isAutoSkipped ? "secondary" : "warning"}
                    className="h-5 px-2 text-[10px] 3xl:text-[11px] py-0"
                  >
                    {isAutoSkipped ? "Пропущен" : requiresManualAttention ? "Внимание" : isAnswered ? "Опубликован" : "Ожидает"}
                  </Badge>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-0.5 shrink-0 ml-auto">
            {nmId && (
              <a
                href={`https://www.wildberries.ru/catalog/${nmId}/detail.aspx`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-7 w-7 3xl:h-8 3xl:w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            {onReload && (
              <Button variant="ghost" size="icon" className="h-7 w-7 3xl:h-8 3xl:w-8 text-muted-foreground" onClick={() => onReload()} disabled={loading}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7 3xl:h-8 3xl:w-8 text-muted-foreground" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
          {loading ? (
            <div className="flex h-24 items-center justify-center text-[13px] 3xl:text-sm text-muted-foreground">Загрузка…</div>
          ) : error ? (
            <div className="p-4 text-[13px] 3xl:text-sm text-destructive">{error}</div>
          ) : !data ? (
            <div className="flex h-24 items-center justify-center text-[13px] 3xl:text-sm text-muted-foreground">Нет данных</div>
          ) : (
            <>
              {/* Review info — scrollable top section */}
              <div className="shrink-0 overflow-y-auto max-h-[45%] border-b border-border/30 px-4 py-3 3xl:px-5 3xl:py-4 space-y-2.5">
                {/* Metadata grid */}
                <div className="grid grid-cols-4 gap-x-4 gap-y-1.5 rounded-xl bg-muted/20 px-3 py-2 3xl:px-4 3xl:py-2.5">
                  <MetaCell label="Покупатель" value={safeText(data.user_name)} />
                  <MetaCell label="Дата" value={`${fmtDate(data.created_date)} ${fmtTime(data.created_date)}`} />
                  <MetaCell label="Размер" value={safeText(sizeText)} />
                  <MetaCell label="Цвет" value={safeText(colorText)} />
                </div>

                {/* Category chips */}
                {categoryCodes.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {categoryCodes.map((code) => {
                      const sentiment = getReviewCategorySentiment(data, code)
                      return (
                        <span
                          key={code}
                          className={cn(
                            "inline-flex max-w-[9rem] items-center rounded-md px-2 py-0.5 text-[10px] 3xl:text-[11px] font-medium leading-tight",
                            getReviewCategoryToneStyle(code, sentiment)
                          )}
                        >
                          <span className="line-clamp-1">{getReviewCategoryLabel(code, data.review_category_labels)}</span>
                        </span>
                      )
                    })}
                  </div>
                )}

                {/* Review text */}
                {reviewText && (
                  <p className="whitespace-pre-wrap text-[13px] 3xl:text-sm leading-relaxed text-foreground">{reviewText}</p>
                )}

                {/* Pros/Cons */}
                {(prosText || consText) && (
                  <div className="grid grid-cols-2 gap-2">
                    {prosText && (
                      <div className="rounded-xl bg-success/5 border border-success/10 px-3 py-2 3xl:px-4 3xl:py-2.5">
                        <div className="flex items-center gap-1 text-[10px] 3xl:text-[11px] font-semibold text-success uppercase tracking-wider mb-0.5">
                          <ThumbsUp className="h-3 w-3" /> Плюсы
                        </div>
                        <div className="text-xs 3xl:text-[13px] text-foreground/80 leading-snug">{prosText}</div>
                      </div>
                    )}
                    {consText && (
                      <div className="rounded-xl bg-destructive/5 border border-destructive/10 px-3 py-2 3xl:px-4 3xl:py-2.5">
                        <div className="flex items-center gap-1 text-[10px] 3xl:text-[11px] font-semibold text-destructive uppercase tracking-wider mb-0.5">
                          <ThumbsDown className="h-3 w-3" /> Минусы
                        </div>
                        <div className="text-xs 3xl:text-[13px] text-foreground/80 leading-snug">{consText}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Photos */}
                {data.photo_links && data.photo_links.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {data.photo_links.slice(0, 6).map((link, i) => {
                      const fullUrl = typeof link === "string" ? link : (link as any)?.fullSize || (link as any)?.miniSize
                      const thumbUrl = typeof link === "string" ? link : (link as any)?.miniSize || (link as any)?.fullSize
                      if (!fullUrl) return null
                      return (
                        <a key={i} href={fullUrl} target="_blank" rel="noopener noreferrer">
                          <img src={thumbUrl} alt="" className="h-12 w-12 3xl:h-14 3xl:w-14 rounded-lg border border-border/40 object-cover hover:opacity-80 transition-opacity" />
                        </a>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Answer workspace — fills remaining space */}
              <div className="flex min-h-0 flex-1 flex-col px-4 py-2.5 3xl:px-5 3xl:py-3 gap-2">
                {requiresManualAttention && (
                  <div className="rounded-xl border border-destructive/15 bg-destructive/[0.03] px-3 py-1.5 text-xs 3xl:text-[13px] text-destructive">
                    Нужен ручной ответ.{hasNeedReplyScore ? ` Оценка: ${needReplyScore}%.` : ""}
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-[11px] 3xl:text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Ответ</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] 3xl:text-xs tabular-nums text-muted-foreground/40">{answerText.length} сим.</span>
                    <button
                      type="button"
                      onClick={() => setAnswerText("")}
                      className="text-[11px] 3xl:text-xs text-muted-foreground/50 transition-colors hover:text-foreground disabled:opacity-30"
                      disabled={!answerText}
                    >
                      Сбросить
                    </button>
                  </div>
                </div>

                <Textarea
                  ref={answerRef}
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  placeholder="Напишите ответ или сгенерируйте черновик…"
                  className="min-h-0 flex-1 resize-none rounded-xl text-[13px] 3xl:text-sm leading-relaxed !py-3 !px-3 3xl:!py-3.5 3xl:!px-4 border-border/40 bg-background"
                  disabled={!canAct || action === "publish"}
                />

                {actionError && <div className="text-[11px] 3xl:text-xs text-destructive">{actionError}</div>}
              </div>
            </>
          )}
        </div>

        {/* ── Sticky Footer ── */}
        {data && !loading && !error && (
          <div className="shrink-0 border-t border-border/40 bg-muted/10 px-4 py-2.5 3xl:px-5 3xl:py-3 space-y-2">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={doPublish}
                disabled={!canAct || action !== null || !answerText.trim()}
                className="gap-1.5"
              >
                <Send className="h-3.5 w-3.5" />
                Опубликовать
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={doSave}
                disabled={!canAct || action !== null || !answerText.trim()}
                className="gap-1.5"
              >
                <Save className="h-3.5 w-3.5" />
                В черновик
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={doDraft}
                disabled={!canGenerateDraft || action !== null}
                className="gap-1.5"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Генерация
                {!requiresManualAttention && <kbd className="ml-0.5 text-[9px] 3xl:text-[10px] text-muted-foreground/40 font-mono">G</kbd>}
              </Button>

              <button
                type="button"
                onClick={() => setLearningOpen(true)}
                disabled={!canTeach || action !== null}
                className="ml-auto flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] 3xl:text-xs text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground disabled:opacity-30"
              >
                <Brain className="h-3.5 w-3.5" />
                Обучить ИИ
              </button>
            </div>

            {/* Hints */}
            <div className="flex items-center justify-between text-[10px] 3xl:text-[11px] text-muted-foreground/30">
              <span>
                {requiresManualAttention
                  ? "Автогенерация отключена"
                  : learningEnabled === false
                  ? "Обучение ИИ выключено — включите в настройках"
                  : "AI добавит правило в prompt"}
              </span>
              <span className="flex items-center gap-2">
                <kbd className="rounded border border-border/30 px-1 py-px font-mono text-[9px] 3xl:text-[10px]">←</kbd>
                <kbd className="rounded border border-border/30 px-1 py-px font-mono text-[9px] 3xl:text-[10px]">→</kbd>
                навигация
                <kbd className="rounded border border-border/30 px-1.5 py-px font-mono text-[9px] 3xl:text-[10px]">Esc</kbd>
                закрыть
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Learning Sheet */}
      <Sheet open={learningOpen} onOpenChange={setLearningOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xl">
          <SheetHeader className="border-b border-border/50 px-5 py-4">
            <SheetTitle className="text-base 3xl:text-lg">Обучить ИИ</SheetTitle>
            <SheetDescription className="text-[13px] 3xl:text-sm">Напишите правило обычным языком — AI применит его к будущим ответам.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full flex-col overflow-hidden">
            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <div className="rounded-xl border border-border/40 bg-muted/15 p-4 text-[13px] 3xl:text-sm whitespace-pre-wrap text-foreground/80 max-h-32 overflow-y-auto">
                {answerText.trim() || "Сначала сгенерируйте или напишите ответ."}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="learning-instruction" className="text-[13px] 3xl:text-sm">Что изменить в будущих ответах</Label>
                <Textarea
                  id="learning-instruction"
                  value={learningInstruction}
                  onChange={(e) => setLearningInstruction(e.target.value)}
                  placeholder="Например: не используйте слово «благодарим»..."
                  className="min-h-[120px] resize-none text-[13px] 3xl:text-sm"
                  disabled={learningApplying}
                />
              </div>
              {learningEnabled === false && (
                <div className="rounded-xl border border-warning/20 bg-warning/5 px-4 py-2.5 text-[13px] 3xl:text-sm text-warning">
                  Обучение ИИ выключено. Включите в настройках.
                </div>
              )}
            </div>
            <div className="border-t border-border/40 px-5 py-3 flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setLearningOpen(false)} disabled={learningApplying}>Отмена</Button>
              <Button size="sm" onClick={doApplyLearning} disabled={!canTeach || !learningInstruction.trim() || learningApplying} className="gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                {learningApplying ? "Сохраняем…" : "Сохранить правило"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
