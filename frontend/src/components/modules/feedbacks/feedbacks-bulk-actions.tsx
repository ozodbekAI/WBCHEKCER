import { RefreshCw, Star } from "lucide-react"

import type { FeedbackRow } from "@/components/feedback/feedbacks-feed"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

function BulkFeedbackItem({
  feedback,
  isSelected,
  onToggle,
}: {
  feedback: FeedbackRow
  isSelected: boolean
  onToggle: (wbId: string, checked: boolean) => void
}) {
  return (
    <div className="flex items-start gap-3 p-3 hover:bg-muted/50">
      <Checkbox checked={isSelected} onCheckedChange={(checked) => onToggle(feedback.wb_id, Boolean(checked))} />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <div className="flex items-center">
            {[...Array(5)].map((_, index) => (
              <Star
                key={index}
                className={`h-3 w-3 ${
                  index < (feedback.product_valuation || 0) ? "fill-yellow-400 text-yellow-400" : "fill-gray-200 text-gray-200"
                }`}
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">{feedback.user_name || "Аноним"}</span>
          <span className="text-xs text-muted-foreground">{new Date(feedback.created_date).toLocaleDateString()}</span>
        </div>
        <p className="line-clamp-2 text-sm">{feedback.text || feedback.pros || feedback.cons || "Без текста"}</p>
      </div>
    </div>
  )
}

type FeedbacksBulkActionsProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  bulkFeedbacksLoading: boolean
  bulkLoading: boolean
  bulkFeedbacks: FeedbackRow[]
  bulkSelected: Set<string>
  onToggleAll: (checked: boolean) => void
  onToggleOne: (wbId: string, checked: boolean) => void
  onSubmit: () => void
}

export function FeedbacksBulkActions({
  open,
  onOpenChange,
  bulkFeedbacksLoading,
  bulkLoading,
  bulkFeedbacks,
  bulkSelected,
  onToggleAll,
  onToggleOne,
  onSubmit,
}: FeedbacksBulkActionsProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Сгенерировать ответы</DialogTitle>
        </DialogHeader>

        {bulkFeedbacksLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-4 overflow-hidden">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Найдено отзывов без ответа: <b>{bulkFeedbacks.length}</b>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={bulkSelected.size === bulkFeedbacks.length && bulkFeedbacks.length > 0}
                  onCheckedChange={(checked) => onToggleAll(Boolean(checked))}
                />
                <span className="text-sm">Выбрать все ({bulkSelected.size})</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto rounded-lg border">
              <div className="divide-y">
                {bulkFeedbacks.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <p>Нет отзывов без ответа</p>
                    <p className="mt-2 text-sm">Все отзывы уже обработаны.</p>
                  </div>
                ) : (
                  bulkFeedbacks.map((feedback) => (
                    <BulkFeedbackItem
                      key={feedback.wb_id}
                      feedback={feedback}
                      isSelected={bulkSelected.has(feedback.wb_id)}
                      onToggle={onToggleOne}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={bulkLoading}>
            Отмена
          </Button>
          <Button onClick={onSubmit} disabled={bulkLoading || bulkSelected.size === 0 || bulkFeedbacksLoading} className="gap-2">
            {bulkLoading ? "Запуск…" : `Запустить выбранные (${bulkSelected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
