import * as React from "react"
import { ExternalLink, RefreshCw, Archive, Send, Star, X, Pencil, Save } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { approveDraft, regenerateDraft, rejectDraft, updateDraft } from "@/lib/api"
import { cn } from "@/lib/utils"

function fmtDateTime(d?: string | null) {
  if (!d) return ""
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return String(d)
  return dt.toLocaleString("ru-RU")
}

function fmtDate(d?: string | null) {
  if (!d) return ""
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return String(d)
  return dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function safeText(v: any) {
  const s = typeof v === "string" ? v : v == null ? "" : String(v)
  return s.trim() ? s : "—"
}

function getPD(raw: any) {
  return raw?.product_details || raw?.productDetails || raw?.raw?.productDetails || null
}

function getFeedback(raw: any) {
  return raw?.feedback || raw?.raw?.feedback || raw?.feedback_data || raw?.feedbackData || raw?.raw || null
}

function getNmId(pd: any) {
  return pd?.nmId ?? pd?.nm_id ?? pd?.nmID ?? null
}

function RatingStars({ value }: { value: number }) {
  const v = Math.max(0, Math.min(5, value))
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            "h-4 w-4",
            i < v
              ? v <= 2
                ? "fill-destructive text-destructive"
                : v <= 3
                ? "fill-warning text-warning"
                : "fill-success text-success"
              : "text-border"
          )}
        />
      ))}
    </div>
  )
}

export default function DraftDetailSheet({
  open,
  onOpenChange,
  shopId,
  draftId,
  data,
  loading,
  error,
  onAfterAction,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  shopId: number
  draftId: number | null
  data: any | null
  loading: boolean
  error: string | null
  onAfterAction?: () => void
}) {
  const { toast } = useToast()

  const fb = React.useMemo(() => getFeedback(data) || {}, [data])
  const pd = React.useMemo(() => getPD(fb) || {}, [fb])

  const productName = pd.productName || pd.product_name || pd.name || "Товар"
  const supplierOrBrand = pd.supplierName || pd.brandName || pd.brand || ""
  const nmId = getNmId(pd)
  const createdAt = data?.created_at || data?.createdAt || data?.generated_at || data?.generatedAt || null

  const productUrl = nmId ? `https://www.wildberries.ru/catalog/${nmId}/detail.aspx` : null
  const productImageUrl =
    fb?.product_image_url ||
    fb?.productImageUrl ||
    data?.product_image_url ||
    data?.productImageUrl ||
    null

  const reviewDate = fb?.created_date || fb?.createdDate || fb?.created_at || fb?.createdAt || null
  const rating = Number(fb?.product_valuation || 0)

  const [editing, setEditing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [text, setText] = React.useState("")

  React.useEffect(() => {
    const t = data?.text ?? data?.answer_text ?? data?.answerText ?? ""
    setText(typeof t === "string" ? t : t == null ? "" : String(t))
    setEditing(false)
  }, [data, draftId])

  async function doSave() {
    if (!draftId) return
    setSaving(true)
    try {
      await updateDraft(shopId, draftId, { text })
      toast({ title: "Сохранено" })
      setEditing(false)
      onAfterAction?.()
    } catch (e: any) {
      toast({ title: "Не удалось сохранить", description: e?.message ?? "", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function doRegenerate() {
    if (!draftId) return
    setSaving(true)
    try {
      await regenerateDraft(shopId, draftId)
      toast({ title: "Перегенерация поставлена в очередь" })
      onOpenChange(false)
      onAfterAction?.()
    } catch (e: any) {
      toast({ title: "Не удалось перегенерировать", description: e?.message ?? "", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function doArchive() {
    if (!draftId) return
    setSaving(true)
    try {
      await rejectDraft(shopId, draftId)
      toast({ title: "Перемещено в архив" })
      onOpenChange(false)
      onAfterAction?.()
    } catch (e: any) {
      toast({ title: "Не удалось переместить", description: e?.message ?? "", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function doPublish() {
    if (!draftId) return
    setSaving(true)
    try {
      await approveDraft(shopId, draftId)
      toast({ title: "Опубликовано" })
      onOpenChange(false)
      onAfterAction?.()
    } catch (e: any) {
      toast({ title: "Не удалось опубликовать", description: e?.message ?? "", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(600px,98vw)] sm:max-w-[600px] p-0 flex flex-col">
        {/* Header */}
        <SheetHeader className="border-b border-border px-6 py-5 space-y-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-lg font-semibold text-foreground">Черновик ответа</SheetTitle>
              <SheetDescription className="text-sm text-[hsl(var(--text-muted))] mt-1">
                {createdAt ? fmtDateTime(createdAt) : "Дата неизвестна"}
                {supplierOrBrand ? ` · ${supplierOrBrand}` : ""}
              </SheetDescription>
            </div>
            <Badge variant="secondary" className="shrink-0 text-xs">
              Черновик
            </Badge>
          </div>
        </SheetHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-16 text-center text-sm text-[hsl(var(--text-muted))]">Загрузка...</div>
          ) : error ? (
            <div className="py-10 px-6 text-center">
              <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-5 py-4">
                <div className="text-base font-medium text-destructive">Не удалось загрузить черновик</div>
                <div className="mt-1 text-sm text-[hsl(var(--text-muted))]">{error}</div>
              </div>
            </div>
          ) : !data ? (
            <div className="py-10 text-center text-sm text-[hsl(var(--text-muted))]">Нет данных</div>
          ) : (
            <div className="px-6 py-5 space-y-5">
              {/* Product card */}
              <div className="flex items-start gap-4 rounded-xl border border-border bg-card p-4">
                <div className="h-16 w-16 rounded-lg bg-muted overflow-hidden shrink-0 border border-border">
                  {productImageUrl ? (
                    <img
                      src={productImageUrl}
                      alt={productName}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-muted-foreground/40">
                      <Star className="h-6 w-6" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <h4 className="text-base font-medium text-foreground line-clamp-2 leading-snug">{productName}</h4>
                  <div className="flex items-center gap-2">
                    <RatingStars value={rating} />
                    <span className="text-sm text-[hsl(var(--text-muted))]">{rating}/5</span>
                  </div>
                  {productUrl && (
                    <a
                      href={productUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Открыть на WB
                    </a>
                  )}
                </div>
              </div>

              {/* Review section */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h5 className="text-sm font-semibold uppercase tracking-wider text-[hsl(var(--text-muted))]">Отзыв покупателя</h5>
                  {reviewDate && <span className="text-sm text-[hsl(var(--text-muted))]">{fmtDate(reviewDate)}</span>}
                </div>

                <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2.5">
                  {fb?.pros && fb.pros.trim() && (
                    <div className="text-sm">
                      <span className="font-medium text-success">Плюсы: </span>
                      <span className="text-foreground">{fb.pros}</span>
                    </div>
                  )}
                  {fb?.cons && fb.cons.trim() && (
                    <div className="text-sm">
                      <span className="font-medium text-destructive">Минусы: </span>
                      <span className="text-foreground">{fb.cons}</span>
                    </div>
                  )}
                  {fb?.text && fb.text.trim() && (
                    <div className="text-base text-foreground whitespace-pre-wrap">{fb.text}</div>
                  )}
                  {!fb?.pros?.trim() && !fb?.cons?.trim() && !fb?.text?.trim() && (
                    <div className="text-sm text-[hsl(var(--text-muted))]">Текст отзыва отсутствует</div>
                  )}
                </div>
              </div>

              <Separator />

              {/* Answer section */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h5 className="text-sm font-semibold uppercase tracking-wider text-[hsl(var(--text-muted))]">Ответ на отзыв</h5>
                  {!editing ? (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={saving} className="h-8 gap-1.5 text-sm">
                      <Pencil className="h-3.5 w-3.5" />
                      Редактировать
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={doSave} disabled={saving} className="h-8 gap-1.5 text-sm text-primary">
                      <Save className="h-3.5 w-3.5" />
                      Сохранить
                    </Button>
                  )}
                </div>

                {editing ? (
                  <div>
                    <Textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      rows={6}
                      maxLength={5000}
                      className="rounded-xl text-base"
                      placeholder="Текст ответа"
                    />
                    <div className="mt-1 text-right text-xs text-[hsl(var(--text-muted))] tabular-nums">{text.length}/5000</div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-primary/10 bg-primary-soft p-4 text-base text-foreground whitespace-pre-wrap">
                    {safeText(text)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t border-border px-6 py-4 bg-card">
          <div className="flex items-center gap-2.5">
            <Button variant="outline" size="default" onClick={doRegenerate} disabled={saving || loading || !draftId} className="gap-1.5">
              <RefreshCw className="h-4 w-4" />
              Перегенерировать
            </Button>
            <Button variant="outline" size="default" onClick={doArchive} disabled={saving || loading || !draftId} className="gap-1.5 text-[hsl(var(--text-muted))]">
              <Archive className="h-4 w-4" />
              В архив
            </Button>
            <Button size="default" className="ml-auto gap-1.5" onClick={doPublish} disabled={saving || loading || !draftId}>
              <Send className="h-4 w-4" />
              Опубликовать
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
