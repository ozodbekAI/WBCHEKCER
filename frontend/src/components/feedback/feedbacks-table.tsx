import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { Star } from "lucide-react"

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
  answer_editable?: string | null
  product_details?: any | null
  product_image_url?: string | null
}

function formatDate(d: string) {
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return ""
  return dt.toLocaleDateString("ru-RU")
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
  return nm ? `Арт. ${nm}` : ""
}

function RatingStars({ value }: { value: number }) {
  const v = Math.max(0, Math.min(5, value))
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => {
        const active = i < v
        return (
          <Star
            key={i}
            className={cn("h-4 w-4", active ? "fill-orange-400 text-orange-400" : "text-muted-foreground")}
          />
        )
      })}
    </div>
  )
}

export default function FeedbacksTable({
  rows,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
  isLoading,
}: {
  rows: FeedbackRow[]
  selected: Set<string>
  onToggle: (wbId: string) => void
  onToggleAll: (checked: boolean) => void
  onOpen: (wbId: string) => void
  isLoading: boolean
}) {
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.wb_id))
  const someChecked = rows.some((r) => selected.has(r.wb_id)) && !allChecked

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="w-[40px]">
              <Checkbox
                checked={allChecked ? true : someChecked ? "indeterminate" : false}
                onCheckedChange={(v) => onToggleAll(v === true)}
                aria-label="Select all"
              />
            </TableHead>
            <TableHead>Товар</TableHead>
            <TableHead className="w-[160px]">Оценка</TableHead>
            <TableHead className="w-[140px]">Текст</TableHead>
            <TableHead className="w-[160px]">Пользователь</TableHead>
            <TableHead className="w-[160px]" aria-sort="descending">
              Дата
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                Загрузка...
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                Ничего не найдено
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => {
              const pd = r.product_details || null
              const title = getProductTitle(pd)
              const brand = getBrand(pd)
              const art = getArticle(pd)
              const rating = Number(r.product_valuation || 0)
              const hasText = !!(r.text && r.text.trim().length > 0)

              return (
                <TableRow
                  key={r.wb_id}
                  className="hover:bg-muted/20 cursor-pointer"
                  onClick={() => onOpen(r.wb_id)}
                >
                  <TableCell
                    onClick={(e) => {
                      e.stopPropagation()
                    }}
                  >
                    <Checkbox
                      checked={selected.has(r.wb_id)}
                      onCheckedChange={() => onToggle(r.wb_id)}
                      aria-label={`Select ${r.wb_id}`}
                    />
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-muted overflow-hidden shrink-0">
  {r.product_image_url ? (
    <img
      src={r.product_image_url}
      alt={title}
      className="h-full w-full object-cover"
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  ) : null}
</div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground leading-snug line-clamp-1">{title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Wildberries{brand ? ` · ${brand}` : ""}{art ? ` · ${art}` : ""}
                        </div>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    <RatingStars value={rating} />
                  </TableCell>

                  <TableCell className="text-sm text-muted-foreground">
                    {hasText ? "С текстом" : "Без текста"}
                  </TableCell>

                  <TableCell className="text-sm text-muted-foreground">
                    {r.user_name || "—"}
                  </TableCell>

                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(r.created_date)}
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
    </div>
  )
}
