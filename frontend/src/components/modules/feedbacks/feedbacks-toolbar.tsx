import { RefreshCw, Sparkles, Send, ArrowRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { FeedbacksSection } from "@/components/modules/feedbacks/feedbacks-types"
import { cn } from "@/lib/utils"

type AutomationState = {
  status: string | null
  reason: string | null
  workerStatus: string | null
}

type FeedbacksToolbarProps = {
  section: FeedbacksSection
  isLoading: boolean
  isPolling: boolean
  approveAllLoading: boolean
  unansweredCount: number
  draftQueueCount: number
  onGenerate: () => void
  onOpenQueue: () => void
  onApproveAll: () => void
  onSync: () => void
  automationState?: AutomationState | null
}

export function FeedbacksToolbar({
  section,
  isLoading,
  isPolling,
  approveAllLoading,
  unansweredCount,
  draftQueueCount,
  onGenerate,
  onOpenQueue,
  onApproveAll,
  onSync,
  automationState,
}: FeedbacksToolbarProps) {
  const isBlocked = automationState?.status === "blocked"

  return (
    <div className="flex items-center gap-1.5">
      {section === "waiting" && (
        <>
          <Button
            onClick={onGenerate}
            disabled={isLoading || isPolling || isBlocked}
            size="sm"
            className="gap-1.5 text-[12px] h-8"
            title={isBlocked ? "Генерация заблокирована — см. причину выше" : undefined}
          >
            <Sparkles className="h-3 w-3" />
            Генерация
          </Button>
          <Button
            variant="outline"
            onClick={onOpenQueue}
            disabled={unansweredCount === 0 || isLoading}
            size="sm"
            className="gap-1 text-[12px] h-8"
          >
            Очередь <ArrowRight className="h-2.5 w-2.5" />
          </Button>
        </>
      )}

      {section === "drafts" && (
        <Button
          onClick={onApproveAll}
          disabled={approveAllLoading || draftQueueCount === 0 || isBlocked}
          size="sm"
          className="gap-1.5 text-[12px] h-8"
          title={isBlocked ? "Публикация заблокирована — см. причину выше" : undefined}
        >
          <Send className="h-3 w-3" />
          {approveAllLoading ? "Публикация…" : "Опубликовать все"}
        </Button>
      )}

      <Button
        variant="outline"
        onClick={onSync}
        disabled={isLoading || isPolling}
        size="sm"
        className="gap-1 text-[12px] h-8"
      >
        <RefreshCw className={cn("h-3 w-3", isPolling && "animate-spin")} />
        {isPolling ? "…" : "Обновить"}
      </Button>
    </div>
  )
}
