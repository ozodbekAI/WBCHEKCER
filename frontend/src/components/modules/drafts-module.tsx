import { useEffect, useMemo, useState } from "react"
import { ChevronDown, Download, RefreshCw, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DataEmptyState, DataErrorState, DataLoadingState } from "@/components/ui/data-state"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

import DraftsTable, { DraftRow } from "@/components/drafts/drafts-table"
import DraftDetailSheet from "@/components/drafts/draft-detail-sheet"
import { getDraft, listPendingDrafts } from "@/lib/api"
import { getErrorMessage } from "@/lib/error-message"

export default function DraftsModule({ shopId }: { shopId: number | null }) {
  // UI-only filters (like WB): we keep them for the same look, but only `q` is used (local filter)
  const [q, setQ] = useState("")
  const [period, setPeriod] = useState("14d")
  const [rating, setRating] = useState("all")
  const [textFilter, setTextFilter] = useState("all")
  const [photoFilter, setPhotoFilter] = useState("all")
  const [shopsFilter, setShopsFilter] = useState("all")

  const [rows, setRows] = useState<DraftRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  const [limit] = useState(20)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)

  const [selected, setSelected] = useState<Set<number>>(new Set())

  // detail sheet state
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailData, setDetailData] = useState<any | null>(null)
  const [activeId, setActiveId] = useState<number | null>(null)

  const title = "Ответы на отзывы — Ожидают публикации"

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll(checked: boolean) {
    if (!checked) {
      setSelected(new Set())
      return
    }
    setSelected(new Set(rows.map((r) => r.id)))
  }

  const filteredRows = useMemo(() => {
    const qq = q.trim().toLowerCase()
    if (!qq) return rows
    return rows.filter((r) => {
      const fb: any = r.feedback || {}
      const pd = fb.product_details || fb.raw?.productDetails || {}
      const title = String(pd.productName || pd.product_name || pd.name || "").toLowerCase()
      const nmId = String(pd.nmId ?? pd.nm_id ?? pd.nmID ?? "").toLowerCase()
      const article = String(pd.supplierArticle || "").toLowerCase()
      const user = String(fb.user_name || "").toLowerCase()
      const text = String(fb.text || "").toLowerCase()
      return (
        String(r.id).includes(qq) ||
        String(fb.wb_id || "").toLowerCase().includes(qq) ||
        title.includes(qq) ||
        nmId.includes(qq) ||
        article.includes(qq) ||
        user.includes(qq) ||
        text.includes(qq)
      )
    })
  }, [q, rows])

  async function load(reset = false) {
    if (!shopId) return
    setIsLoading(true)
    setListError(null)
    try {
      const currentOffset = reset ? 0 : offset
      const data = await listPendingDrafts(shopId, { limit, offset: currentOffset })
      const list = (Array.isArray(data) ? data : []) as any[]
      const mapped: DraftRow[] = list.map((it) => {
        const fb = it?.feedback || it?.raw?.feedback || it?.feedback_data || null
        return {
          id: Number(it?.id),
          created_at: it?.created_at || it?.createdAt || it?.generated_at || it?.generatedAt || null,
          status: String(it?.status || "drafted"),
          text: it?.text ?? it?.answer_text ?? null,
          feedback: {
            wb_id: fb?.wb_id ?? fb?.wbId ?? it?.wb_id ?? it?.wbId ?? "",
            created_date: fb?.created_date ?? fb?.createdDate ?? fb?.created_at ?? fb?.createdAt ?? "",
            product_valuation: fb?.product_valuation ?? fb?.productValuation ?? null,
            user_name: fb?.user_name ?? fb?.userName ?? null,
            text: fb?.text ?? null,
            pros: fb?.pros ?? null,
            cons: fb?.cons ?? null,
            was_viewed: fb?.was_viewed ?? fb?.wasViewed ?? null,
            product_details: fb?.product_details ?? fb?.productDetails ?? null,
            product_image_url: fb?.product_image_url ?? fb?.productImageUrl ?? it?.product_image_url ?? it?.productImageUrl ?? null,
            photo_links: fb?.photo_links ?? fb?.photoLinks ?? null,
            raw: fb?.raw ?? fb ?? null,
          },
        }
      })

      if (reset) {
        setRows(mapped)
        setOffset(limit)
        setSelected(new Set())
      } else {
        setRows((prev) => [...prev, ...mapped])
        setOffset((prev) => prev + limit)
      }
      setHasMore(mapped.length === limit)
    } catch (error) {
      setListError(getErrorMessage(error, "Не удалось загрузить черновики"))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!shopId) return
    setOffset(0)
    setHasMore(true)
    load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId])

  async function handleRefresh() {
    // backend worker sync qiladi; bu tugma faqat DB’dan qayta yuklaydi
    await load(true)
  }

  async function openDetail(draftId: number) {
    if (!shopId) return
    setActiveId(draftId)
    setDetailOpen(true)
    setDetailLoading(true)
    setDetailError(null)
    setDetailData(null)

    try {
      const d = await getDraft(shopId, draftId)
      setDetailData(d)
    } catch (error) {
      setDetailError(getErrorMessage(error, "Не удалось загрузить черновик"))
    } finally {
      setDetailLoading(false)
    }
  }

  if (!shopId) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <div className="text-lg font-semibold text-foreground">Магазин не выбран</div>
          <div className="text-sm text-muted-foreground mt-2">Выберите магазин, чтобы работать с черновиками.</div>
        </div>
      </div>
    )
  }

  const showInitialLoading = isLoading && rows.length === 0
  const showListError = Boolean(listError && rows.length === 0)
  const showEmptyState = !isLoading && !listError && filteredRows.length === 0


  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-lg font-semibold text-foreground truncate">{title}</div>
        </div>

        <Button variant="outline" onClick={handleRefresh} disabled={isLoading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </div>

      {/* Filters bar (WB-like) */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative w-[320px] max-w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Артикул или название" className="pl-9" />
        </div>

        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Период" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">7 дней</SelectItem>
            <SelectItem value="14d">14 дней</SelectItem>
            <SelectItem value="30d">30 дней</SelectItem>
          </SelectContent>
        </Select>

        <Select value={rating} onValueChange={setRating}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Все оценки" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все оценки</SelectItem>
            <SelectItem value="5">5</SelectItem>
            <SelectItem value="4">4</SelectItem>
            <SelectItem value="3">3</SelectItem>
            <SelectItem value="2">2</SelectItem>
            <SelectItem value="1">1</SelectItem>
          </SelectContent>
        </Select>

        <Select value={textFilter} onValueChange={setTextFilter}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Текст" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Текст</SelectItem>
            <SelectItem value="with">С текстом</SelectItem>
            <SelectItem value="without">Без текста</SelectItem>
          </SelectContent>
        </Select>

        <Select value={photoFilter} onValueChange={setPhotoFilter}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Фото" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Фото</SelectItem>
            <SelectItem value="with">С фото</SelectItem>
            <SelectItem value="without">Без фото</SelectItem>
          </SelectContent>
        </Select>

        <Select value={shopsFilter} onValueChange={setShopsFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Все магазины" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все магазины</SelectItem>
            <SelectItem value="current">Текущий магазин</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" className="ml-auto gap-2">
          <Download className="h-4 w-4" />
          Excel
          <ChevronDown className="h-4 w-4 opacity-60" />
        </Button>
      </div>

      {listError && rows.length > 0 ? (
        <DataErrorState compact title="Черновики обновились не полностью" description={listError} onAction={() => void load(true)} />
      ) : null}

      {showInitialLoading ? (
        <DataLoadingState
          title="Загружаем черновики"
          description="Подготавливаем очередь ответов, ожидающих публикации."
        />
      ) : showListError ? (
        <DataErrorState
          title="Не удалось загрузить черновики"
          description={listError}
          onAction={() => void load(true)}
        />
      ) : showEmptyState ? (
        <DataEmptyState
          title={q.trim() ? "По запросу ничего не найдено" : "Черновиков пока нет"}
          description={
            q.trim()
              ? "Сбросьте поиск или обновите очередь, чтобы увидеть другие черновики."
              : "Когда AI подготовит ответы, они появятся здесь для проверки и публикации."
          }
          actionLabel={q.trim() ? "Сбросить поиск" : "Обновить"}
          onAction={q.trim() ? () => setQ("") : () => void load(true)}
        />
      ) : (
        <>
          <DraftsTable
            rows={filteredRows}
            selected={selected}
            onToggle={toggleOne}
            onToggleAll={toggleAll}
            onOpen={openDetail}
            isLoading={isLoading}
          />

          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">Выбрано: {selected.size}</div>
            <Button variant="outline" disabled={!hasMore || isLoading} onClick={() => load(false)}>
              {hasMore ? "Загрузить ещё" : "Больше нет"}
            </Button>
          </div>
        </>
      )}

      <DraftDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        shopId={shopId}
        draftId={activeId}
        data={detailData}
        loading={detailLoading}
        error={detailError}
        onAfterAction={() => load(true)}
      />
    </div>
  )
}
