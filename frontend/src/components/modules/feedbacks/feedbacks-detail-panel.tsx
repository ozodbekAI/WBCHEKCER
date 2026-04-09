import DraftDetailSheet from "@/components/drafts/draft-detail-sheet"
import FeedbackDetailDialog, { type FeedbackDetail } from "@/components/feedback/feedback-detail-dialog"

type FeedbacksDetailPanelProps = {
  feedbackDetail: {
    open: boolean
    onOpenChange: (open: boolean) => void
    shopId: number | null
    loading: boolean
    error: string | null
    data: FeedbackDetail | null
    onReload: () => void | Promise<void>
    onPublished: () => void
    initialTab: "review" | "answer"
    autoFocusAnswer: boolean
    currentIndex: number
    totalCount: number
    onPrev: () => void
    onNext: () => void
  }
  draftDetail: {
    open: boolean
    onOpenChange: (open: boolean) => void
    shopId: number
    draftId: number | null
    loading: boolean
    data: any | null
    onAfterAction: () => void
  }
}

export function FeedbacksDetailPanel({ feedbackDetail, draftDetail }: FeedbacksDetailPanelProps) {
  return (
    <>
      <FeedbackDetailDialog
        open={feedbackDetail.open}
        onOpenChange={feedbackDetail.onOpenChange}
        shopId={feedbackDetail.shopId}
        loading={feedbackDetail.loading}
        error={feedbackDetail.error}
        data={feedbackDetail.data}
        onReload={feedbackDetail.onReload}
        onPublished={feedbackDetail.onPublished}
        initialTab={feedbackDetail.initialTab}
        autoFocusAnswer={feedbackDetail.autoFocusAnswer}
        currentIndex={feedbackDetail.currentIndex}
        totalCount={feedbackDetail.totalCount}
        onPrev={feedbackDetail.onPrev}
        onNext={feedbackDetail.onNext}
      />

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
    </>
  )
}
