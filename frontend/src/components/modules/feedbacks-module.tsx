import { FeedbacksBulkActions } from "@/components/modules/feedbacks/feedbacks-bulk-actions"
import { FeedbacksFilters } from "@/components/modules/feedbacks/feedbacks-filters"
import { FeedbacksListContainer } from "@/components/modules/feedbacks/feedbacks-list-container"
import { FeedbacksStatsBar } from "@/components/modules/feedbacks/feedbacks-stats-bar"
import { FeedbacksToolbar } from "@/components/modules/feedbacks/feedbacks-toolbar"
import { useFeedbacksController } from "@/components/modules/feedbacks/use-feedbacks-controller"
import { StateBanner, StateEmpty, StatusPill } from "@/components/shared/system-state"
import FeedbackInlinePanel from "@/components/feedback/feedback-inline-panel"
import DraftDetailSheet from "@/components/drafts/draft-detail-sheet"
import { useShop } from "@/components/shop-context"
import { MessageSquare, ShieldAlert, Wallet, CreditCard, Zap } from "lucide-react"
import { useState, useRef, useCallback, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"

const BLOCK_META: Record<string, { label: string; desc: string; tone: "warning" | "danger"; isCreditIssue: boolean }> = {
  insufficient_credits: {
    label: "Генерация приостановлена — недостаточно кредитов",
    desc: "Пополните баланс, чтобы продолжить автоматическую генерацию черновиков.",
    tone: "warning",
    isCreditIssue: true,
  },
  generation_disabled: {
    label: "Генерация отключена",
    desc: "Автоматическая генерация ответов отключена в настройках магазина.",
    tone: "danger",
    isCreditIssue: false,
  },
  publishing_disabled: {
    label: "Публикация отключена",
    desc: "Черновики генерируются, но автоматическая публикация выключена.",
    tone: "warning",
    isCreditIssue: false,
  },
  automation_disabled: {
    label: "Автоматизация отключена",
    desc: "Полная автоматизация отключена. Генерация и публикация не выполняются.",
    tone: "danger",
    isCreditIssue: false,
  },
  kill_switch: {
    label: "Аварийная остановка",
    desc: "Система принудительно остановлена администратором.",
    tone: "danger",
    isCreditIssue: false,
  },
  worker_inactive: {
    label: "Фоновый обработчик неактивен",
    desc: "Worker не отвечает. Автоматическая обработка временно недоступна.",
    tone: "danger",
    isCreditIssue: false,
  },
}

export default function FeedbacksModule({ shopId }: { shopId: number | null }) {
  const feedbacks = useFeedbacksController(shopId)
  const { selectedShop } = useShop()
  const navigate = useNavigate()

  const shopContext = useShop()
  const automationState = {
    status: (shopContext as any)?.automationStatus ?? null,
    reason: (shopContext as any)?.automationReason ?? null,
    workerStatus: (shopContext as any)?.workerStatus ?? null,
  }

  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const { feedbackDetail, draftDetail } = feedbacks.detailPanelProps
  const detailOpen = feedbackDetail.open

  useEffect(() => {
    if (!detailOpen) setPanelPos(null)
  }, [detailOpen])

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const el = containerRef.current?.querySelector<HTMLElement>('[data-drag-panel]')
    if (!el) return
    const rect = el.getBoundingClientRect()
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const dx = ev.clientX - dragRef.current.startX
      const dy = ev.clientY - dragRef.current.startY
      setPanelPos({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy })
    }
    const onUp = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  // Compute block state
  const blockReason = automationState.status === "blocked" ? automationState.reason : null
  const blockMeta = blockReason ? BLOCK_META[blockReason] ?? { label: "Автоматизация заблокирована", desc: blockReason, tone: "danger" as const, isCreditIssue: false } : null
  const isWorkerDown = automationState.workerStatus === "inactive" && automationState.status !== "blocked"

  if (!shopId) {
    return (
      <StateEmpty
        icon={<MessageSquare className="h-5 w-5" />}
        title="Магазин не выбран"
        description="Выберите магазин, чтобы работать с отзывами."
      />
    )
  }

  return (
    <div ref={containerRef} className="relative flex h-full min-h-0 flex-col">
      {/* Controls area */}
      <div className="shrink-0 space-y-1.5 pb-2">
        {/* Row 1: Title + Status + Actions */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
              <MessageSquare className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-foreground leading-tight">Отзывы</h1>
                {automationState.status === "active" && (
                  <StatusPill status="ready" label="Авто" size="xs" showIcon />
                )}
                {automationState.status === "blocked" && (
                  <StatusPill status="blocked" label={blockMeta?.label?.split("—")[0]?.trim()} size="xs" showIcon />
                )}
              </div>
              <p className="text-[11px] text-muted-foreground leading-tight">Очередь · Черновики AI · Публикация</p>
            </div>
          </div>
          <FeedbacksToolbar
            {...feedbacks.toolbarProps}
            automationState={automationState}
          />
        </div>

        {/* Automation block banner */}
        {blockMeta && (
          <StateBanner
            tone={blockMeta.tone}
            icon={blockMeta.isCreditIssue ? <Wallet className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
            title={blockMeta.label}
            description={blockMeta.desc}
            compact
            action={
              blockMeta.isCreditIssue ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] px-3 gap-1"
                  onClick={() => navigate("/app/billing")}
                >
                  <CreditCard className="h-3 w-3" />
                  Пополнить
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] px-3"
                  onClick={() => navigate("/app/settings")}
                >
                  Настройки
                </Button>
              )
            }
          />
        )}

        {/* Worker inactive warning */}
        {isWorkerDown && (
          <StateBanner
            tone="warning"
            icon={<Zap className="h-4 w-4" />}
            title="Worker неактивен"
            description="Фоновый обработчик не отвечает. Автоматическая генерация и публикация временно недоступны."
            compact
          />
        )}

        {/* Row 2-3: Tabs + Search + Filters */}
        <FeedbacksFilters {...feedbacks.filtersProps} />

        {/* Row 4: KPI strip */}
        <FeedbacksStatsBar {...feedbacks.statsProps} />

        {feedbacks.listError && (feedbacks.rows.length > 0 || feedbacks.draftRows.length > 0) ? (
          <div className="text-[11px] text-destructive">{feedbacks.listError}</div>
        ) : null}
      </div>

      {/* Split workspace: queue + detail panel */}
      <div className="flex min-h-0 flex-1 gap-0">
        {/* Left: Review queue */}
        <div className={detailOpen ? "w-[58%] shrink-0 min-h-0 pr-2" : "w-full min-h-0"}>
          <FeedbacksListContainer {...feedbacks.listProps} />
        </div>

        {/* Right: Detail workspace */}
        {detailOpen && (
          <div
            data-drag-panel
            className="hidden xl:flex w-[42%] min-h-0 min-w-0"
            style={panelPos ? {
              position: 'fixed',
              left: panelPos.x,
              top: panelPos.y,
              width: 520,
              zIndex: 20,
            } : undefined}
          >
            <div className="h-full w-full min-h-0">
              <FeedbackInlinePanel
                open={feedbackDetail.open}
                onClose={() => feedbackDetail.onOpenChange(false)}
                shopId={feedbackDetail.shopId}
                loading={feedbackDetail.loading}
                error={feedbackDetail.error}
                data={feedbackDetail.data}
                onReload={feedbackDetail.onReload}
                onPublished={feedbackDetail.onPublished}
                autoFocusAnswer={feedbackDetail.autoFocusAnswer}
                currentIndex={feedbackDetail.currentIndex}
                totalCount={feedbackDetail.totalCount}
                onPrev={feedbackDetail.onPrev}
                onNext={feedbackDetail.onNext}
                backgroundScrollRef={feedbacks.listProps.scrollRef}
                onDragStart={onDragStart}
              />
            </div>
          </div>
        )}
      </div>

      <FeedbacksBulkActions {...feedbacks.bulkActionsProps} />

      <DraftDetailSheet
        open={draftDetail.open}
        onOpenChange={draftDetail.onOpenChange}
        shopId={draftDetail.shopId}
        draftId={draftDetail.draftId}
        loading={draftDetail.loading}
        data={draftDetail.data}
        error={null}
        onAfterAction={draftDetail.onAfterAction}
      />
    </div>
  )
}
