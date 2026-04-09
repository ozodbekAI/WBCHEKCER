import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { RefreshCw, Search } from "lucide-react"
import FeedbackDetail from "./feedback-detail"
import { listFeedbacks, syncFeedbacks } from "@/lib/api"

interface FeedbackItem {
  wb_id: string
  title: string
  text: string
  rating: number
  user_name: string
  is_answered: boolean
  created_date: string
  answer_text?: string
}

interface FeedbackListProps {
  shopId: number
  token: string
}

export default function FeedbackList({ shopId, token }: FeedbackListProps) {
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([])
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackItem | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [filterAnswered, setFilterAnswered] = useState<boolean | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)

  useEffect(() => {
    loadFeedbacks()
  }, [filterAnswered, searchQuery])

  const loadFeedbacks = async () => {
    setIsLoading(true)
    try {
      const data = await listFeedbacks(shopId, {
        is_answered: filterAnswered,
        q: searchQuery,
      })
      setFeedbacks(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error("Failed to load feedbacks:", err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSync = async () => {
    setIsSyncing(true)
    try {
      // Ask backend to sync feedbacks from WB, then reload local list.
      await syncFeedbacks(shopId)
      await loadFeedbacks()
    } catch (err) {
      console.error("Sync failed:", err)
    } finally {
      setIsSyncing(false)
    }
  }

  if (selectedFeedback) {
    return (
      <FeedbackDetail
        feedback={selectedFeedback}
        token={token}
        shopId={shopId}
        onBack={() => setSelectedFeedback(null)}
        onUpdate={loadFeedbacks}
      />
    )
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Feedbacks</h1>
          <p className="text-muted-foreground mt-1">Manage customer reviews and responses</p>
        </div>
        <Button onClick={handleSync} disabled={isSyncing} className="gap-2">
          <RefreshCw className="w-4 h-4" />
          {isSyncing ? "Syncing..." : "Sync from WB"}
        </Button>
      </div>

      <div className="flex gap-4 mb-6">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по отзывам..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button
          variant={filterAnswered === false ? "default" : "outline"}
          onClick={() => setFilterAnswered(filterAnswered === false ? null : false)}
        >
          Без ответа
        </Button>
        <Button
          variant={filterAnswered === true ? "default" : "outline"}
          onClick={() => setFilterAnswered(filterAnswered === true ? null : true)}
        >
          Отвечено
        </Button>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          <Card className="p-8 text-center text-muted-foreground">Загрузка отзывов...</Card>
        ) : feedbacks.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">Отзывов не найдено</Card>
        ) : (
          feedbacks.map((feedback) => (
            <Card
              key={feedback.wb_id}
              className="p-4 hover:bg-accent/10 cursor-pointer transition-colors"
              onClick={() => setSelectedFeedback(feedback)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold text-foreground truncate">{feedback.user_name}</h3>
                    <Badge variant={feedback.is_answered ? "default" : "secondary"}>
                      {feedback.is_answered ? "Отвечено" : "Ожидает"}
                    </Badge>
                    <div className="flex gap-0.5">
                      {Array(5)
                        .fill(0)
                        .map((_, i) => (
                          <span
                            key={i}
                            className={`text-sm ${i < feedback.rating ? "text-yellow-500" : "text-muted-foreground"}`}
                          >
                            ★
                          </span>
                        ))}
                    </div>
                  </div>
                  <p className="text-sm text-foreground line-clamp-2">{feedback.text}</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {new Date(feedback.created_date).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
