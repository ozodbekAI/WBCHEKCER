import type { RefObject } from "react"

import FeedbacksFeed, { type FeedbackRow } from "@/components/feedback/feedbacks-feed"
import type { DraftRow } from "@/components/drafts/drafts-table"
import DraftsTable from "@/components/drafts/drafts-table"
import { StateEmpty, StateError } from "@/components/shared/system-state"
import type { FeedbacksSection } from "@/components/modules/feedbacks/feedbacks-types"
import { Loader2 } from "lucide-react"

type FeedbacksListContainerProps = {
  section: FeedbacksSection
  rows: FeedbackRow[]
  draftRows: DraftRow[]
  isLoading: boolean
  listError: string | null
  hasMore: boolean
  draftHasMore: boolean
  hasActiveFilters: boolean
  onResetFilters: () => void
  onReload: () => void
  onOpenBulkDialog: () => void
  onOpenDetail: (wbId: string, index?: number) => void
  onOpenDraftDetail: (draftId: number) => void
  scrollRef: RefObject<HTMLDivElement | null>
  sentinelRef: RefObject<HTMLDivElement | null>
}

export function FeedbacksListContainer({
  section,
  rows,
  draftRows,
  isLoading,
  listError,
  hasMore,
  draftHasMore,
  hasActiveFilters,
  onResetFilters,
  onReload,
  onOpenBulkDialog,
  onOpenDetail,
  onOpenDraftDetail,
  scrollRef,
  sentinelRef,
}: FeedbacksListContainerProps) {
  return (
    <div ref={scrollRef} className="h-full min-h-0 flex-1 overflow-y-auto rounded-xl border border-border/40 bg-card">
      {section === "drafts" ? (
        <>
          <DraftsTable rows={draftRows} onOpen={onOpenDraftDetail} isLoading={isLoading && draftRows.length === 0} />
          <div ref={sentinelRef} className="h-8" />
          {isLoading && draftRows.length > 0 && (
            <div className="flex items-center justify-center gap-1.5 py-2">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">Загрузка…</span>
            </div>
          )}
          {!draftHasMore && draftRows.length > 0 && (
            <div className="py-1.5 text-center text-[10px] text-muted-foreground/60">Конец списка</div>
          )}
          {!isLoading && draftRows.length === 0 && listError && (
            <div className="p-3">
              <StateError compact title="Не удалось загрузить черновики" description={listError} onRetry={onReload} />
            </div>
          )}
          {!isLoading && draftRows.length === 0 && !listError && (
            <div className="p-3">
              <StateEmpty
                compact
                title="Черновиков нет"
                description={
                  hasActiveFilters
                    ? "Попробуйте изменить фильтры."
                    : "Запустите генерацию для отзывов без ответа."
                }
                action={
                  <button
                    type="button"
                    onClick={hasActiveFilters ? onResetFilters : onOpenBulkDialog}
                    className="text-[12px] text-primary font-medium hover:underline"
                  >
                    {hasActiveFilters ? "Сбросить фильтры" : "Сгенерировать"}
                  </button>
                }
              />
            </div>
          )}
        </>
      ) : (
        <>
          <FeedbacksFeed rows={rows} onOpenDetail={onOpenDetail} isLoading={isLoading && rows.length === 0} />
          <div ref={sentinelRef} className="h-8" />
          {isLoading && rows.length > 0 && (
            <div className="flex items-center justify-center gap-1.5 py-2">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">Загрузка…</span>
            </div>
          )}
          {!hasMore && rows.length > 0 && (
            <div className="py-1.5 text-center text-[10px] text-muted-foreground/60">Конец списка</div>
          )}
          {!isLoading && rows.length === 0 && listError && (
            <div className="p-3">
              <StateError compact title="Не удалось загрузить отзывы" description={listError} onRetry={onReload} />
            </div>
          )}
          {!isLoading && rows.length === 0 && !listError && (
            <div className="p-3">
              <StateEmpty
                compact
                title="Отзывы не найдены"
                description="Попробуйте изменить фильтры или синхронизируйте магазин."
                action={
                  <button
                    type="button"
                    onClick={hasActiveFilters ? onResetFilters : onReload}
                    className="text-[12px] text-primary font-medium hover:underline"
                  >
                    {hasActiveFilters ? "Сбросить фильтры" : "Обновить"}
                  </button>
                }
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
