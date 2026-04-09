import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Star, MessageSquare, Trash2 } from "lucide-react"

interface Feedback {
  id: string
  wb_id?: string
  rating?: number
  text?: string
  user_name?: string
  created_date?: string
  has_photo?: boolean
  product_name?: string
  answered?: boolean
}

interface FeedbacksListProps {
  feedbacks: Feedback[]
  shopId: number
  isLoading: boolean
}

export default function FeedbacksList({ feedbacks, shopId, isLoading }: FeedbacksListProps) {
  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Загрузка отзывов...</div>
  }

  if (!feedbacks || feedbacks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Star className="w-16 h-16 text-muted-foreground mb-4 opacity-50" />
        <p className="text-lg font-semibold text-foreground">Отзывов не найдено</p>
        <p className="text-sm text-muted-foreground">Синхронизируйте отзывы, чтобы они появились здесь</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {feedbacks.map((feedback) => (
        <Card key={feedback.wb_id || feedback.id} className="p-4 hover:bg-muted/50 transition-colors cursor-pointer">
          <div className="flex items-start gap-4">
            {/* Rating */}
            <div className="flex gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={`w-4 h-4 ${i < (feedback.rating || 0) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`}
                />
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground line-clamp-2">{feedback.text || "No text"}</p>
              <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                <span>{feedback.user_name || "Anonymous"}</span>
                <span>{feedback.created_date ? new Date(feedback.created_date).toLocaleDateString() : ""}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{feedback.product_name || "Product"}</p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {feedback.has_photo && (
                <Badge variant="secondary" className="text-xs">
                  📷
                </Badge>
              )}
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MessageSquare className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
