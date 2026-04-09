import { Star, Image as ImageIcon, FileEdit } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type DraftRow = {
  id: number
  created_at: string | null
  status: string
  text: string | null
  feedback: {
    wb_id: string
    created_date: string
    product_valuation?: number | null
    user_name?: string | null
    text?: string | null
    pros?: string | null
    cons?: string | null
    was_viewed?: boolean | null
    product_details?: any | null
    product_image_url?: string | null
    photo_links?: any[] | null
    raw?: any | null
  }
}

function formatDate(d?: string | null) {
  if (!d) return ""
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return String(d)
  return dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function formatTime(d?: string | null) {
  if (!d) return ""
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
  return pd.brandName || pd.brand || pd.supplierName || ""
}

function getArticle(pd: any | null | undefined) {
  if (!pd) return ""
  const nm = pd.nmId ?? pd.nm_id ?? pd.nmID
  return nm ? String(nm) : ""
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-4 py-3 animate-pulse">
      <div className="w-4 h-4 bg-muted rounded" />
      <div className="w-20 h-8 bg-muted rounded" />
      <div className="w-10 h-10 bg-muted rounded-lg" />
      <div className="w-10 h-4 bg-muted rounded" />
      <div className="flex-1 h-10 bg-muted rounded" />
      <div className="w-24 h-4 bg-muted rounded" />
      <div className="w-16 h-4 bg-muted rounded" />
    </div>
  )
}

function getStatusBadge(status: string) {
  switch (status) {
    case "approved":
      return <span className="text-xs text-green-600 dark:text-green-400 font-medium">Одобрен</span>
    case "rejected":
      return <span className="text-xs text-red-600 dark:text-red-400 font-medium">Отклонён</span>
    case "pending":
    default:
      return <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Ожидает</span>
  }
}

export default function DraftsTable({
  rows,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
  isLoading,
}: {
  rows: DraftRow[]
  selected?: Set<number>
  onToggle?: (id: number) => void
  onToggleAll?: (checked: boolean) => void
  onOpen: (id: number) => void
  isLoading: boolean
}) {
  const hasSelection = Boolean(selected && onToggle)

  if (isLoading && rows.length === 0) {
    return (
      <div className="divide-y divide-border rounded-xl border border-border bg-card overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    )
  }

  if (!isLoading && rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
        Ничего не найдено
      </div>
    )
  }

  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-card overflow-hidden">
      {rows.map((r) => {
        const fb = r.feedback || ({} as any)
        const pd = fb.product_details || fb.raw?.productDetails || null

        const title = getProductTitle(pd)
        const brand = getBrand(pd)
        const art = getArticle(pd)
        const rating = Number(fb.product_valuation || 0)
        const isNegative = rating <= 2
        const isPending = r.status === "pending"

        return (
          <div
            key={r.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(r.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onOpen(r.id)
            }}
            className={cn(
              "flex items-center gap-4 px-4 py-3 cursor-pointer transition-colors hover:bg-muted/50",
              isPending && "bg-amber-50/50 dark:bg-amber-950/20"
            )}
          >
            {hasSelection ? (
              <div onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={selected?.has(r.id)}
                  onCheckedChange={() => onToggle?.(r.id)}
                  aria-label={"Select " + r.id}
                />
              </div>
            ) : null}

            {/* Date */}
            <div className="w-20 shrink-0 text-xs text-muted-foreground">
              <div>{formatDate(r.created_at)}</div>
              <div className="text-[10px]">{formatTime(r.created_at)}</div>
            </div>

            {/* Image */}
            <div className="w-10 h-10 rounded-lg bg-muted/50 overflow-hidden shrink-0 border border-border">
              {fb.product_image_url ? (
                <img
                  src={fb.product_image_url}
                  alt={title}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center">
                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
            </div>

            {/* Rating */}
            <div className="w-10 shrink-0 flex items-center gap-0.5">
              <Star className={cn(
                "h-4 w-4",
                isNegative ? "text-red-500 fill-red-500" : rating >= 4 ? "text-green-500 fill-green-500" : "text-yellow-500 fill-yellow-500"
              )} />
              <span className={cn(
                "text-sm font-medium",
                isNegative ? "text-red-500" : "text-foreground"
              )}>{rating}</span>
            </div>

            {/* Product title with badges */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn(
                  "text-sm font-medium line-clamp-1",
                  isNegative ? "text-red-600 dark:text-red-400" : "text-primary"
                )}>
                  {title}
                </span>
                {isPending && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 gap-1 border-amber-500/50 text-amber-600 dark:text-amber-400">
                    <FileEdit className="h-3 w-3" />
                    Черновик
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                <span className="inline-flex items-center gap-1">
                  <span className="w-4 h-4 rounded bg-primary/20 text-primary text-[10px] flex items-center justify-center font-bold">W</span>
                  {brand || "Avemod"}
                </span>
                {art && <span className="ml-2">· {art}</span>}
              </div>
              <div className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
                {r.text?.trim() || fb.text?.trim() || fb.pros?.trim() || fb.cons?.trim() || "Текст черновика пока пуст"}
              </div>
            </div>

            {/* Status */}
            <div className="w-24 shrink-0 text-right">
              {getStatusBadge(r.status)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
