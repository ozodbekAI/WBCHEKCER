import { AlertTriangle, Star, Image as ImageIcon, Zap, Network, CheckCircle2, Clock, XCircle } from "lucide-react"
import {
  getReviewCategoryCodes,
  getReviewCategoryLabel,
  getReviewCategorySentiment,
  getReviewCategoryToneStyle,
} from "@/lib/review-categories"
import { cn } from "@/lib/utils"

export type FeedbackRow = {
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
  state?: string | null
  order_status?: string | null
  matching_size?: string | null
  answer_editable?: string | null
  product_details?: any | null
  product_image_url?: string | null
  review_type?: string | null
  review_categories?: string[] | null
  review_category_labels?: Record<string, string> | null
  review_category_matches?: Array<{ code: string; sentiment: string | null }> | null
  review_sentiment?: string | null
  review_need_reply_score?: number | null
  review_requires_manual_attention?: boolean | null
}

function formatDate(d: string) {
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return ""
  return dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })
}

function formatTime(d: string) {
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return ""
  return dt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
}

function getProductTitle(pd: any | null | undefined) {
  if (!pd) return "Товар"
  return pd.productName || pd.product_name || pd.name || pd.title || "Товар"
}

function getBrand(pd: any | null | undefined) {
  if (!pd) return ""
  return pd.brandName || pd.brand || ""
}

function getArticle(pd: any | null | undefined) {
  if (!pd) return ""
  const nm = pd.nmId ?? pd.nm_id ?? pd.nmID
  return nm ? `${nm}` : ""
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3 animate-pulse border-b border-border/30 last:border-b-0">
      <div className="w-10 h-10 bg-muted rounded-lg shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="w-2/3 h-4 bg-muted rounded" />
        <div className="w-1/2 h-3 bg-muted rounded" />
      </div>
      <div className="w-20 h-6 bg-muted rounded-md shrink-0" />
    </div>
  )
}

function RatingCompact({ value }: { value: number }) {
  const color = value <= 2 ? "text-destructive" : value <= 3 ? "text-warning" : "text-success"
  return (
    <div className={cn("flex items-center gap-0.5 text-[12px] font-semibold tabular-nums", color)}>
      <Star className="h-3.5 w-3.5 fill-current" />
      {value}
    </div>
  )
}

function StatusChip({ answered, isAutoSkipped, needsAttention, needsManualAttention, isWbAnswer, isSystemAnswer }: {
  answered: boolean
  isAutoSkipped: boolean
  needsAttention: boolean
  needsManualAttention: boolean
  isWbAnswer: boolean
  isSystemAnswer: boolean
}) {
  if (needsAttention) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-destructive/8 border border-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
        <AlertTriangle className="h-3 w-3" />
        {needsManualAttention ? "Ручной" : "Внимание"}
      </span>
    )
  }

  if (isAutoSkipped) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-muted border border-border/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <XCircle className="h-3 w-3" />
        Пропущен
      </span>
    )
  }

  if (answered) {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span className="inline-flex items-center gap-1 rounded-md bg-success/8 border border-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
          <CheckCircle2 className="h-3 w-3" />
          Отвечено
        </span>
        {isSystemAnswer && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
            <Zap className="h-2.5 w-2.5 text-info" />Авто
          </span>
        )}
        {isWbAnswer && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
            <Network className="h-2.5 w-2.5 text-primary" />WB
          </span>
        )}
      </div>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-warning/8 border border-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
      <Clock className="h-3 w-3" />
      Ожидает
    </span>
  )
}

export default function FeedbacksFeed({
  rows,
  onOpen,
  onOpenDetail,
  isLoading,
}: {
  rows: FeedbackRow[]
  onOpen?: (wbId: string, index?: number) => void
  onOpenDetail?: (wbId: string, index?: number) => void
  isLoading: boolean
}) {
  const handleOpen = (wbId: string, index?: number) => {
    const fn = onOpenDetail || onOpen
    if (typeof fn === "function") fn(wbId, index)
  }

  if (isLoading && rows.length === 0) {
    return (
      <div>
        {Array.from({ length: 10 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    )
  }

  if (!isLoading && rows.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Ничего не найдено
      </div>
    )
  }

  return (
    <div>
      {rows.map((r, index) => {
        const pd = r.product_details || null
        const title = getProductTitle(pd)
        const brand = getBrand(pd)
        const rating = Number(r.product_valuation || 0)
        const answerText = String(r.answer_text || "").trim()
        const answerState = String(r.answer_state || "").toLowerCase()
        const isAutoSkipped =
          (answerState === "system_auto_skip" || answerState === "no_reply_needed") &&
          (answerText === "—" || !answerText)
        const answered = Boolean(answerText) && !isAutoSkipped
        const isNegative = rating <= 2
        const needsManualAttention = (Boolean(r.review_requires_manual_attention) || answerState === "manual_attention") && !answered && !isAutoSkipped
        const needsAttention = needsManualAttention || (isNegative && !answered && !isAutoSkipped)
        const isWbAnswer = answerState.startsWith("wb")
        const isSystemAnswer =
          answerState === "system" || answerState === "system_auto_skip" || answerState === "no_reply_needed"
        const categoryCodes = getReviewCategoryCodes(r)
        const reviewPreview = r.text?.trim() || r.pros?.trim() || r.cons?.trim() || ""

        return (
          <div
            key={r.wb_id}
            role="button"
            tabIndex={0}
            onClick={() => handleOpen(r.wb_id, index)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleOpen(r.wb_id, index)
            }}
            className={cn(
              "flex items-center gap-3 px-3.5 py-2.5 cursor-pointer transition-colors border-b border-border/30 last:border-b-0",
              "hover:bg-secondary/40",
              needsAttention && "bg-destructive/[0.02] hover:bg-destructive/[0.05]"
            )}
          >
            {/* Product thumb */}
            <div className="w-10 h-10 rounded-lg bg-muted/50 overflow-hidden shrink-0 border border-border/40">
              {r.product_image_url ? (
                <img
                  src={r.product_image_url}
                  alt={title}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center">
                  <ImageIcon className="h-4 w-4 text-muted-foreground/40" />
                </div>
              )}
            </div>

            {/* Rating */}
            <div className="shrink-0 w-8">
              <RatingCompact value={rating} />
            </div>

            {/* Main content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[13px] font-medium text-foreground truncate leading-tight">{title}</span>
                {brand && <span className="hidden lg:inline text-[11px] text-muted-foreground shrink-0">{brand}</span>}
              </div>
              {reviewPreview && (
                <p className="text-[12px] text-muted-foreground/70 line-clamp-1 leading-snug mt-0.5">{reviewPreview}</p>
              )}
              {/* Tags */}
              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                {r.user_name && <span className="text-[11px] text-muted-foreground">{r.user_name}</span>}
                {categoryCodes.slice(0, 2).map((code) => {
                  const sentiment = getReviewCategorySentiment(r, code)
                  return (
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded font-medium leading-none",
                        getReviewCategoryToneStyle(code, sentiment)
                      )}
                      key={code}
                    >
                      {getReviewCategoryLabel(code, r.review_category_labels)}
                    </span>
                  )
                })}
                {categoryCodes.length > 2 && (
                  <span className="text-[10px] text-muted-foreground">+{categoryCodes.length - 2}</span>
                )}
              </div>
            </div>

            {/* Time */}
            <div className="shrink-0 text-right hidden sm:block">
              <div className="text-[11px] text-muted-foreground tabular-nums">{formatDate(r.created_date)}</div>
              <div className="text-[10px] text-muted-foreground/50 tabular-nums">{formatTime(r.created_date)}</div>
            </div>

            {/* Status */}
            <div className="shrink-0">
              <StatusChip
                answered={answered}
                isAutoSkipped={isAutoSkipped}
                needsAttention={needsAttention}
                needsManualAttention={needsManualAttention}
                isWbAnswer={isWbAnswer}
                isSystemAnswer={isSystemAnswer}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
