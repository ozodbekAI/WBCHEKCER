import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import {
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  XCircle,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DataEmptyState, DataLoadingState } from "@/components/ui/data-state"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Progress } from "@/components/ui/progress"
import { useToast } from "@/components/ui/use-toast"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader, SegmentedTabs, SearchField, KpiStrip, ControlsRow } from "@/components/shared/page-controls"

import { getErrorMessage } from "@/lib/error-message"
import { generateQuestionDraft, getQuestion, listQuestions, publishQuestionAnswer, rejectQuestion, syncQuestions } from "@/lib/api"
import { useAsyncData } from "@/hooks/use-async-data"
import { useSyncPolling } from "@/hooks/use-sync-polling"
import { cn } from "@/lib/utils"

type Section = "waiting" | "answered"

function parseSection(value: string | null): Section {
  if (value === "answered") return "answered"
  return "waiting"
}

type QuestionListItem = {
  wb_id: string
  created_date: string
  user_name?: string | null
  text?: string | null
  was_viewed?: boolean
  answer_text?: string | null
  product_details?: any
}

type QuestionDetail = QuestionListItem & { raw?: any; state?: string | null }

export default function QuestionsModule({ shopId }: { shopId: number | null }) {
  const { toast } = useToast()
  const { isPolling, error: pollError, pollJob } = useSyncPolling()
  const [searchParams] = useSearchParams()

  const [section, setSection] = useState<Section>(() => parseSection(searchParams.get("section")))
  const [q, setQ] = useState("")
  const [debouncedQ, setDebouncedQ] = useState("")

  const [rows, setRows] = useState<QuestionListItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  const limit = 20
  const [offset, setOffset] = useState(0)
  const offsetRef = useRef(0)
  const [hasMore, setHasMore] = useState(true)
  const loadLockRef = useRef(false)

  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [detail, setDetail] = useState<QuestionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [draftText, setDraftText] = useState<string>("")
  const [draftLoading, setDraftLoading] = useState(false)
  const [publishLoading, setPublishLoading] = useState(false)
  const [currentDetailIndex, setCurrentDetailIndex] = useState<number>(0)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(q), 350)
    return () => window.clearTimeout(timer)
  }, [q])

  useEffect(() => { setSection(parseSection(searchParams.get("section"))) }, [searchParams])

  const setOffsetSafe = useCallback((next: number | ((prev: number) => number)) => {
    setOffset((prev) => {
      const v = typeof next === "function" ? (next as (p: number) => number)(prev) : next
      offsetRef.current = v
      return v
    })
  }, [])

  const countsQuery = useAsyncData<{ totalCount: number; answeredTotalCount: number }>(
    async () => {
      if (!shopId) return { totalCount: 0, answeredTotalCount: 0 }
      const [totalRes, answeredRes] = await Promise.all([
        listQuestions(shopId, { limit: 1, offset: 0 }),
        listQuestions(shopId, { is_answered: true, limit: 1, offset: 0 }),
      ])
      return { totalCount: totalRes.total, answeredTotalCount: answeredRes.total }
    },
    [shopId],
    { enabled: Boolean(shopId), keepPreviousData: true, fallbackError: "Не удалось загрузить статистику вопросов" },
  )

  const totalCount = countsQuery.data?.totalCount ?? 0
  const answeredTotalCount = countsQuery.data?.answeredTotalCount ?? 0

  const load = useCallback(
    async (reset = false) => {
      if (!shopId) return
      if (loadLockRef.current) return
      loadLockRef.current = true
      setIsLoading(true)
      setListError(null)
      try {
        const nextOffset = reset ? 0 : offsetRef.current
        const response = await listQuestions(shopId, {
          is_answered: section === "answered",
          q: debouncedQ || undefined,
          limit,
          offset: nextOffset,
        })
        const list = (response.items || []) as QuestionListItem[]
        if (reset) {
          setRows(list)
          setOffsetSafe(limit)
          setHasMore(list.length === limit)
        } else {
          setRows((prev) => {
            const seen = new Set(prev.map((r) => r.wb_id))
            let added = 0
            const next = [...prev]
            for (const r of list) {
              if (!seen.has(r.wb_id)) { seen.add(r.wb_id); next.push(r); added += 1 }
            }
            if (added === 0) setHasMore(false)
            else setHasMore(list.length === limit)
            return next
          })
          setOffsetSafe((prev) => prev + limit)
        }
      } catch (e) {
        setListError(getErrorMessage(e, "Не удалось загрузить вопросы"))
      } finally {
        setIsLoading(false)
        loadLockRef.current = false
      }
    },
    [shopId, section, debouncedQ, setOffsetSafe],
  )

  useEffect(() => {
    if (!shopId) return
    setOffsetSafe(0)
    setHasMore(true)
    load(true)
  }, [shopId, section, debouncedQ, load, setOffsetSafe])

  useEffect(() => {
    const el = sentinelRef.current
    const root = scrollRef.current
    if (!el || !root) return
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting && hasMore && !isLoading) load(false) },
      { root: scrollRef.current, rootMargin: "240px" },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasMore, isLoading, load])

  const unansweredRows = useMemo(() => rows.filter((r) => !r.answer_text?.trim()), [rows])

  async function handleSync() {
    if (!shopId) return
    try {
      const doOne = async (isAnswered: boolean) => {
        const res: any = await syncQuestions(shopId, { is_answered: isAnswered, take: 500, skip: 0, order: "dateDesc" })
        if (res?.job_id) return new Promise<void>((resolve) => { pollJob(res.job_id, () => resolve()) })
      }
      await doOne(false)
      await doOne(true)
      await load(true)
      await countsQuery.refresh({ background: true })
      toast({ title: "Вопросы обновлены", description: "Очередь вопросов синхронизирована." })
    } catch (error) {
      toast({ title: "Синхронизация не запущена", description: getErrorMessage(error, "Проверьте доступ и токен WB"), variant: "destructive" })
    }
  }

  async function openDetail(wbId: string, index?: number) {
    if (!shopId) return
    if (typeof index === "number") setCurrentDetailIndex(index)
    else { const fi = unansweredRows.findIndex((r) => r.wb_id === wbId); setCurrentDetailIndex(fi >= 0 ? fi : 0) }
    setOpen(true)
    setActiveId(wbId)
    setDetail(null)
    setDraftText("")
    setDetailLoading(true)
    try {
      const d = (await getQuestion(shopId, wbId)) as any
      setDetail(d)
      setDraftText(String(d?.answer_text || ""))
    } catch (error) {
      toast({ title: "Не удалось загрузить вопрос", description: getErrorMessage(error, "Попробуйте открыть вопрос ещё раз."), variant: "destructive" })
    } finally { setDetailLoading(false) }
  }

  function startProcessing() {
    if (unansweredRows.length === 0) return
    openDetail(unansweredRows[0].wb_id, 0)
  }

  const goToPrev = useCallback(async () => {
    if (!shopId || currentDetailIndex <= 0) return
    const prevIndex = currentDetailIndex - 1
    const prevRow = unansweredRows[prevIndex]
    if (!prevRow) return
    setCurrentDetailIndex(prevIndex); setActiveId(prevRow.wb_id); setDetailLoading(true); setDraftText("")
    try { const d = await getQuestion(shopId, prevRow.wb_id); setDetail(d as any); setDraftText(String((d as any)?.answer_text || "")) }
    catch (error) { toast({ title: "Не удалось загрузить", description: getErrorMessage(error), variant: "destructive" }) }
    finally { setDetailLoading(false) }
  }, [shopId, currentDetailIndex, unansweredRows, toast])

  const goToNext = useCallback(async () => {
    if (!shopId || currentDetailIndex >= unansweredRows.length - 1) return
    const nextIndex = currentDetailIndex + 1
    const nextRow = unansweredRows[nextIndex]
    if (!nextRow) return
    setCurrentDetailIndex(nextIndex); setActiveId(nextRow.wb_id); setDetailLoading(true); setDraftText("")
    try { const d = await getQuestion(shopId, nextRow.wb_id); setDetail(d as any); setDraftText(String((d as any)?.answer_text || "")) }
    catch (error) { toast({ title: "Не удалось загрузить", description: getErrorMessage(error), variant: "destructive" }) }
    finally { setDetailLoading(false) }
  }, [shopId, currentDetailIndex, unansweredRows, toast])

  async function handleDraft() {
    if (!shopId || !activeId) return
    setDraftLoading(true)
    try {
      const res = await generateQuestionDraft(shopId, activeId)
      if (res?.text) setDraftText(String(res.text))
      toast({ title: "Черновик создан", description: "Проверьте текст и опубликуйте, если всё верно." })
    } catch (error) {
      toast({ title: "Не удалось создать черновик", description: getErrorMessage(error, "Проверьте баланс магазина"), variant: "destructive" })
    } finally { setDraftLoading(false) }
  }

  async function handlePublish() {
    if (!shopId || !activeId) return
    setPublishLoading(true)
    try {
      await publishQuestionAnswer(shopId, activeId, draftText)
      toast({ title: "Ответ опубликован", description: "Вопрос перенесён в обработанные." })
      setOpen(false); await load(true); await countsQuery.refresh({ background: true })
    } catch (error) {
      toast({ title: "Публикация не выполнена", description: getErrorMessage(error, "Попробуйте снова."), variant: "destructive" })
    } finally { setPublishLoading(false) }
  }

  async function handleReject() {
    if (!shopId || !activeId) return
    setPublishLoading(true)
    try {
      await rejectQuestion(shopId, activeId)
      toast({ title: "Вопрос отклонён" })
      setOpen(false); await load(true); await countsQuery.refresh({ background: true })
    } catch (error) {
      toast({ title: "Не удалось отклонить", description: getErrorMessage(error), variant: "destructive" })
    } finally { setPublishLoading(false) }
  }

  if (!shopId) {
    return <EmptyState icon={<HelpCircle className="h-5 w-5" />} title="Магазин не выбран" description="Выберите магазин, чтобы работать с вопросами." />
  }

  const progressPercent = totalCount > 0 ? Math.round((answeredTotalCount / totalCount) * 100) : 0
  const waitingTotalCount = Math.max(totalCount - answeredTotalCount, 0)

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Row 1: Header */}
      <PageHeader
        title="Вопросы"
        subtitle="Новые вопросы, черновики ответов и публикация"
        actions={
          <>
            {section === "waiting" && unansweredRows.length > 0 && (
              <Button onClick={startProcessing} size="sm" className="gap-1.5">
                <Play className="h-3.5 w-3.5" />
                Очередь
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleSync} disabled={isLoading || isPolling} className="gap-1.5">
              <RefreshCw className={cn("h-3.5 w-3.5", (isLoading || isPolling) && "animate-spin")} />
              <span className="hidden sm:inline">{isPolling ? "…" : "Обновить"}</span>
            </Button>
          </>
        }
      />

      {/* KPI strip */}
      <KpiStrip items={[
        { label: "Новые", value: waitingTotalCount, accent: waitingTotalCount > 0 ? "primary" : undefined },
        { label: "Обработанные", value: answeredTotalCount, accent: "success" },
        { label: "Прогресс", value: `${progressPercent}%`, accent: "info" },
      ]} />

      {/* Error banners */}
      {(pollError || countsQuery.error || (listError && rows.length > 0)) && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/20 bg-danger-soft px-4 py-2.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
          <span className="text-[13px] text-destructive">{pollError || countsQuery.error || listError}</span>
          <Button variant="outline" size="sm" className="ml-auto shrink-0 h-7 text-[12px]" onClick={() => { void load(true); void countsQuery.refresh() }}>
            Повторить
          </Button>
        </div>
      )}

      {/* Row 2: Tabs + search */}
      <ControlsRow>
        <SegmentedTabs
          items={[
            { key: "waiting" as Section, label: "Новые", count: waitingTotalCount },
            { key: "answered" as Section, label: "Обработанные", count: answeredTotalCount },
          ]}
          value={section}
          onChange={(v) => setSection(v as Section)}
        />
        <SearchField
          value={q}
          onChange={setQ}
          placeholder="Поиск по вопросам…"
          className="flex-1 max-w-xs"
        />
      </ControlsRow>

      {/* ── List container ── */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border bg-card shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <div className="divide-y divide-border">
          {isLoading && rows.length === 0 ? (
            <div className="p-6">
              <DataLoadingState compact title="Загружаем вопросы" description="Подготавливаем список новых и обработанных вопросов." />
            </div>
          ) : listError && rows.length === 0 ? (
            <div className="p-6">
              <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-card px-8 py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-danger-soft text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-[hsl(var(--text-strong))]">Не удалось загрузить вопросы</h3>
                  <p className="mt-1 text-sm text-[hsl(var(--text-muted))]">Проверьте подключение и попробуйте ещё раз.</p>
                </div>
                <Button onClick={() => void load(true)}>Повторить загрузку</Button>
              </div>
            </div>
          ) : rows.length ? (
            rows.map((it, idx) => (
              <div
                key={it.wb_id}
                className="group flex cursor-pointer items-start justify-between gap-4 px-5 py-4 transition-colors hover:bg-secondary/30"
                onClick={() => openDetail(it.wb_id, idx)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[hsl(var(--text-strong))]">{it.user_name || "Покупатель"}</span>
                    <Badge variant={it.answer_text ? "success" : "outline"} className="text-[10px]">
                      {it.answer_text ? "Обработан" : "Новый"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-[hsl(var(--text-default))] line-clamp-2">{it.text || ""}</p>
                  <div className="mt-1.5 text-xs text-[hsl(var(--text-muted))]">
                    {new Date(it.created_date).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 gap-1 text-[hsl(var(--text-muted))] opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(e) => { e.stopPropagation(); openDetail(it.wb_id, idx) }}
                >
                  Открыть <ArrowRight className="h-3 w-3" />
                </Button>
              </div>
            ))
          ) : (
            <div className="p-6">
              <EmptyState
                icon={<HelpCircle className="h-5 w-5" />}
                title="Вопросы не найдены"
                description={q.trim() ? "Попробуйте изменить поисковый запрос или сбросить фильтр." : "Запустите синхронизацию, чтобы подтянуть новые вопросы из Wildberries."}
                action={
                  <Button variant={q.trim() ? "outline" : "default"} onClick={q.trim() ? () => setQ("") : () => void handleSync()}>
                    {q.trim() ? "Сбросить поиск" : "Синхронизировать"}
                  </Button>
                }
              />
            </div>
          )}

          <div ref={sentinelRef} className="h-1" />

          {isLoading && rows.length > 0 && (
            <div className="px-5 py-4 text-center text-sm text-[hsl(var(--text-muted))]">Загрузка…</div>
          )}
        </div>
      </div>

      {/* ── Detail dialog ── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="text-lg">Вопрос</DialogTitle>
              {section === "waiting" && unansweredRows.length > 1 && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon-sm" onClick={goToPrev} disabled={currentDetailIndex <= 0 || detailLoading}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs font-medium text-[hsl(var(--text-muted))] tabular-nums">
                    {currentDetailIndex + 1} / {unansweredRows.length}
                  </span>
                  <Button variant="outline" size="icon-sm" onClick={goToNext} disabled={currentDetailIndex >= unansweredRows.length - 1 || detailLoading}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex items-center gap-2 rounded-xl bg-secondary/30 px-4 py-6 text-sm text-[hsl(var(--text-muted))]">
              <RefreshCw className="h-4 w-4 animate-spin" /> Загружаем вопрос…
            </div>
          ) : detail ? (
            <div className="space-y-5">
              <div className="rounded-xl border border-border bg-secondary/20 p-4 space-y-3">
                <div>
                  <div className="text-xs text-[hsl(var(--text-muted))]">Покупатель</div>
                  <div className="mt-0.5 text-sm font-medium text-[hsl(var(--text-strong))]">{detail.user_name || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-[hsl(var(--text-muted))]">Вопрос</div>
                  <div className="mt-0.5 text-sm text-[hsl(var(--text-default))] whitespace-pre-wrap">{detail.text || ""}</div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-[hsl(var(--text-strong))]">Ответ</div>
                  <Button variant="outline" size="sm" onClick={handleDraft} disabled={draftLoading || publishLoading} className="gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" />
                    {draftLoading ? "Генерация…" : "Сгенерировать"}
                  </Button>
                </div>
                <Textarea value={draftText} onChange={(e) => setDraftText(e.target.value)} rows={8} className="rounded-xl" />
                <div className="text-xs text-[hsl(var(--text-muted))]">Макс. 5000 символов. Проверяйте факты перед публикацией.</div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-secondary/20 px-4 py-6 text-center text-sm text-[hsl(var(--text-muted))]">Нет данных</div>
          )}

          <DialogFooter className="sm:justify-between">
            <Button variant="danger-outline" onClick={handleReject} disabled={publishLoading || detailLoading || !detail} className="gap-1.5">
              <XCircle className="h-4 w-4" />
              Отклонить
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={publishLoading}>Закрыть</Button>
              <Button onClick={handlePublish} disabled={publishLoading || detailLoading || !detail || !draftText.trim()}>
                {publishLoading ? "Публикация…" : "Опубликовать"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
