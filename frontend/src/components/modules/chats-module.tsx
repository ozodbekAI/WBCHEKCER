import * as React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowRight, Image as ImageIcon, Inbox, MessageCircle, RefreshCw, Search, User } from "lucide-react"

import { useShop } from "@/components/shop-context"
import { listChatsPage, syncChats, type ChatSessionRow } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { DataErrorState, DataLoadingState } from "@/components/ui/data-state"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/use-toast"
import { getErrorMessage } from "@/lib/error-message"
import { cn } from "@/lib/utils"
import { EmptyState } from "@/components/shared/empty-state"
import { ChatDrawer } from "@/components/modules/chat-drawer"
import { PageHeader, SegmentedTabs, SearchField, KpiStrip, ControlsRow } from "@/components/shared/page-controls"

type StatusFilter = "unread" | "read" | "all"

function safeText(v: any): string {
  if (v == null) return ""
  if (typeof v === "string") return v
  if (typeof v === "number") return String(v)
  if (typeof v === "object") {
    if (typeof v.text === "string") return v.text
    if (typeof v.message === "string") return v.message
  }
  return ""
}

function fmtDate(iso: string) {
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return iso
  const now = new Date()
  const diff = now.getTime() - dt.getTime()
  if (diff < 60_000) return "только что"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин назад`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч назад`
  if (diff < 172_800_000) return "вчера"
  return dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function getLastMessagePreview(session: ChatSessionRow) {
  return safeText(session.last_message) || "Нет сообщений"
}

function getLastMessageDate(session: ChatSessionRow) {
  const lm = session.last_message || {} as any
  const tsMs = typeof lm.addTimestamp === "number" ? lm.addTimestamp : typeof lm.addTimestampMs === "number" ? lm.addTimestampMs : null
  if (tsMs) {
    const dt = new Date(tsMs)
    if (!Number.isNaN(dt.getTime())) return dt.toISOString()
  }
  return session.updated_at
}

function isUnread(session: ChatSessionRow): boolean {
  return (session.unread_count ?? 0) > 0
}

/* ─── Removed KpiCard — using shared KpiStrip ─── */

/* ─── Inbox Row ─── */
function InboxRow({ row, onOpen }: { row: ChatSessionRow; onOpen: () => void }) {
  const unread = isUnread(row)

  return (
    <div
      onClick={onOpen}
      className={cn(
        "group flex items-center gap-3 rounded-xl border bg-card p-3.5 cursor-pointer transition-all hover:shadow-sm",
        unread
          ? "border-primary/20 bg-[hsl(var(--primary-soft))]/30"
          : "border-border hover:border-border/80"
      )}
    >
      {/* Product thumb */}
      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden">
        {row.product_thumb_url ? (
          <img src={row.product_thumb_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <ImageIcon className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn("text-sm truncate", unread ? "font-semibold text-foreground" : "font-medium text-foreground/80")}>
            {row.product_title || "Товар"}
          </span>
          {unread && (
            <Badge className="bg-primary/10 text-primary border-0 text-[10px] px-1.5 py-0 h-[18px] font-semibold">
              {row.unread_count}
            </Badge>
          )}
        </div>
        <p className={cn("mt-0.5 text-xs truncate", unread ? "text-foreground/70" : "text-muted-foreground")}>
          {getLastMessagePreview(row)}
        </p>
      </div>

      {/* Meta */}
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-[11px] text-muted-foreground whitespace-nowrap">{fmtDate(getLastMessageDate(row))}</span>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <User className="h-3 w-3" />
          <span className="truncate max-w-[100px]">{row.client_name || "Покупатель"}</span>
        </div>
      </div>

      {/* Action */}
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-primary transition-colors" />
    </div>
  )
}

/* ─── Main Module ─── */
export default function ChatsModule() {
  const { shops, shopId, isSuperAdmin } = useShop()
  const { toast } = useToast()

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("unread")
  const [searchQuery, setSearchQuery] = useState("")
  const [shopFilter, setShopFilter] = React.useState<number | null>(shopId)

  React.useEffect(() => {
    setShopFilter((prev) => (prev === null ? null : shopId))
  }, [shopId])

  const [rows, setRows] = useState<ChatSessionRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)

  const limit = 20
  const offsetRef = useRef(0)
  const loadLockRef = useRef(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const [active, setActive] = useState<ChatSessionRow | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [currentDetailIndex, setCurrentDetailIndex] = useState<number>(0)

  const fetchPage = useCallback(async (reset = false) => {
    if (loadLockRef.current) return
    loadLockRef.current = true
    setLoading(true)
    setError(null)

    try {
      const currentOffset = reset ? 0 : offsetRef.current
      const res = await listChatsPage({
        shopId: shopFilter ?? null,
        limit,
        offset: currentOffset,
        unread: statusFilter === "unread" ? true : null,
      })

      let items = res.items || []
      items = [...items].sort((a, b) => new Date(getLastMessageDate(b)).getTime() - new Date(getLastMessageDate(a)).getTime())

      if (reset) {
        setRows(items)
        offsetRef.current = limit
        setHasMore(items.length === limit)
      } else {
        setRows((prev) => {
          const seen = new Set(prev.map((r) => `${r.shop_id}:${r.chat_id}`))
          const next = [...prev]
          let added = 0
          for (const r of items) {
            const key = `${r.shop_id}:${r.chat_id}`
            if (!seen.has(key)) { seen.add(key); next.push(r); added++ }
          }
          setHasMore(added > 0 && items.length === limit)
          return next
        })
        offsetRef.current += limit
      }
    } catch (error) {
      setError(getErrorMessage(error, "Не удалось загрузить чаты"))
    } finally {
      setLoading(false)
      loadLockRef.current = false
    }
  }, [shopFilter, statusFilter])

  useEffect(() => {
    offsetRef.current = 0
    setHasMore(true)
    fetchPage(true)
  }, [fetchPage, shopFilter, statusFilter])

  useEffect(() => {
    const el = sentinelRef.current
    const root = scrollRef.current
    if (!el || !root) return
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting && hasMore && !loading) fetchPage(false) },
      { root, rootMargin: "240px" },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasMore, loading, fetchPage])

  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rows
    const q = searchQuery.toLowerCase()
    return rows.filter((r) =>
      (r.client_name || "").toLowerCase().includes(q) ||
      (r.product_title || "").toLowerCase().includes(q) ||
      (r.product_brand || "").toLowerCase().includes(q)
    )
  }, [rows, searchQuery])

  const displayRows = useMemo(() => {
    if (statusFilter === "all") return filteredRows
    if (statusFilter === "unread") return filteredRows.filter(isUnread)
    return filteredRows.filter((r) => !isUnread(r))
  }, [filteredRows, statusFilter])

  const unreadRows = useMemo(() => rows.filter(isUnread), [rows])

  const openChat = (row: ChatSessionRow, index?: number) => {
    if (typeof index === "number") setCurrentDetailIndex(index)
    setActive(row)
    setDrawerOpen(true)
  }

  const goToPrev = useCallback(() => {
    if (currentDetailIndex <= 0) return
    const prev = unreadRows[currentDetailIndex - 1]
    if (!prev) return
    setCurrentDetailIndex(currentDetailIndex - 1)
    setActive(prev)
  }, [currentDetailIndex, unreadRows])

  const goToNext = useCallback(() => {
    if (currentDetailIndex >= unreadRows.length - 1) return
    const next = unreadRows[currentDetailIndex + 1]
    if (!next) return
    setCurrentDetailIndex(currentDetailIndex + 1)
    setActive(next)
  }, [currentDetailIndex, unreadRows])

  const runSync = async () => {
    if ((!shopFilter && !isSuperAdmin) || isSyncing) return
    setIsSyncing(true)
    try {
      if (!shopFilter) {
        await Promise.allSettled(shops.map((s) => syncChats(s.id)))
      } else {
        await syncChats(shopFilter)
      }
      offsetRef.current = 0
      await fetchPage(true)
      toast({ title: "Синхронизация чатов запущена" })
    } catch (error) {
      setError(getErrorMessage(error, "Не удалось синхронизировать"))
      toast({ title: "Ошибка синхронизации", description: getErrorMessage(error), variant: "destructive" })
    } finally {
      setIsSyncing(false)
    }
  }

  const tabCounts = useMemo(() => ({
    unread: rows.filter(isUnread).length,
    read: rows.filter((r) => !isUnread(r)).length,
    all: rows.length,
  }), [rows])

  if (!shopId) {
    return (
      <EmptyState
        icon={<MessageCircle className="h-5 w-5" />}
        title="Магазин не выбран"
        description="Выберите магазин, чтобы работать с чатами."
      />
    )
  }

  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      {/* Row 1: Header */}
      <PageHeader
        title="Чаты"
        subtitle="Входящие сообщения от покупателей"
        actions={
          <Button variant="outline" size="sm" onClick={runSync} className="gap-1.5" disabled={loading || isSyncing || (!shopFilter && !isSuperAdmin)}>
            <RefreshCw className={cn("h-3.5 w-3.5", (loading || isSyncing) && "animate-spin")} />
            Обновить
          </Button>
        }
      />

      {/* KPI strip */}
      <KpiStrip items={[
        { label: "Новые", value: tabCounts.unread, accent: "primary" },
        { label: "Прочитанные", value: tabCounts.read },
        { label: "Всего", value: tabCounts.all },
      ]} />

      {error && rows.length > 0 && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2 text-[13px] text-destructive">{error}</div>
      )}

      {/* Row 2: Tabs + Search */}
      <ControlsRow>
        <SegmentedTabs
          items={[
            { key: "unread" as StatusFilter, label: "Новые", count: tabCounts.unread },
            { key: "read" as StatusFilter, label: "Прочитанные", count: tabCounts.read },
            { key: "all" as StatusFilter, label: "Все", count: tabCounts.all },
          ]}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilter)}
        />
        <SearchField
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Поиск по покупателю или товару…"
          className="flex-1 max-w-xs"
        />
      </ControlsRow>

      {/* Inbox List */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto space-y-1.5">
        {loading && rows.length === 0 ? (
          <DataLoadingState compact title="Загружаем чаты…" />
        ) : error && rows.length === 0 ? (
          <DataErrorState compact title="Не удалось загрузить чаты" description="Проверьте подключение и попробуйте снова." onAction={() => void fetchPage(true)} />
        ) : displayRows.length ? (
          displayRows.map((r, idx) => (
            <InboxRow key={`${r.shop_id}:${r.chat_id}`} row={r} onOpen={() => openChat(r, idx)} />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-8 py-16 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
              <Inbox className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold text-foreground">
              {statusFilter === "unread" ? "Нет новых сообщений" : statusFilter === "read" ? "Нет прочитанных чатов" : "Чаты не найдены"}
            </h3>
            <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
              {statusFilter === "unread"
                ? "Все диалоги обработаны. Новые сообщения появятся после синхронизации."
                : "Попробуйте изменить фильтр или запустить синхронизацию с Wildberries."}
            </p>
            <Button variant="outline" size="sm" onClick={runSync} className="mt-5 gap-1.5 rounded-xl" disabled={isSyncing}>
              <RefreshCw className={cn("h-3.5 w-3.5", isSyncing && "animate-spin")} />
              Синхронизировать
            </Button>
          </div>
        )}
        <div ref={sentinelRef} className="h-1" />
        {loading && rows.length > 0 && (
          <div className="py-3 text-center text-xs text-muted-foreground">Загрузка…</div>
        )}
      </div>

      <ChatDrawer
        open={drawerOpen}
        onOpenChange={(v) => { setDrawerOpen(v); if (!v) setActive(null) }}
        session={active}
        onSent={() => fetchPage(true)}
        onPrev={unreadRows.length > 1 ? goToPrev : undefined}
        onNext={unreadRows.length > 1 ? goToNext : undefined}
        currentIndex={currentDetailIndex}
        totalCount={unreadRows.length}
      />
    </div>
  )
}
