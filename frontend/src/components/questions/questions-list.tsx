import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { RefreshCw, Search } from "lucide-react"

interface Question {
  wb_id: string
  text: string
  user_name: string
  is_answered: boolean
  created_date: string
  answer_text?: string
}

interface QuestionsListProps {
  shopId: number
  token: string
}

export default function QuestionsList({ shopId, token }: QuestionsListProps) {
  const [questions, setQuestions] = useState<Question[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [filterAnswered, setFilterAnswered] = useState<boolean | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)

  useEffect(() => {
    loadQuestions()
  }, [filterAnswered, searchQuery])

  const loadQuestions = async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterAnswered !== null) params.append("is_answered", String(filterAnswered))
      if (searchQuery) params.append("q", searchQuery)

      const res = await fetch(`/api/questions/${shopId}?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.ok) {
        const data = await res.json()
        setQuestions(Array.isArray(data) ? data : [])
      }
    } catch (err) {
      console.error("Failed to load questions:", err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSync = async () => {
    setIsSyncing(true)
    try {
      const res = await fetch(`/api/questions/${shopId}/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          is_answered: null,
          take: 100,
          skip: 0,
          order: "dateDesc",
          date_from_unix: null,
          date_to_unix: null,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const interval = setInterval(async () => {
          const jobRes = await fetch(`/api/jobs/${data.job_id}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (jobRes.ok) {
            const job = await jobRes.json()
            if (job.status === "done") {
              clearInterval(interval)
              setIsSyncing(false)
              loadQuestions()
            } else if (job.status === "failed") {
              clearInterval(interval)
              setIsSyncing(false)
            }
          }
        }, 2000)
      }
    } catch (err) {
      console.error("Sync failed:", err)
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Вопросы покупателей</h1>
          <p className="text-muted-foreground mt-1">Управление вопросами</p>
        </div>
        <Button onClick={handleSync} disabled={isSyncing} className="gap-2">
          <RefreshCw className="w-4 h-4" />
          {isSyncing ? "Синхронизация..." : "Синхронизировать"}
        </Button>
      </div>

      <div className="flex gap-4 mb-6">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по вопросам..."
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
      </div>

      <div className="space-y-3">
        {isLoading ? (
          <Card className="p-8 text-center text-muted-foreground">Загрузка вопросов...</Card>
        ) : questions.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">Вопросов не найдено</Card>
        ) : (
          questions.map((question) => (
            <Card key={question.wb_id} className="p-4 hover:bg-accent/10 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold text-foreground">{question.user_name}</h3>
                    <Badge variant={question.is_answered ? "default" : "secondary"}>
                      {question.is_answered ? "Отвечено" : "Ожидает"}
                    </Badge>
                  </div>
                  <p className="text-sm text-foreground line-clamp-2">{question.text}</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {new Date(question.created_date).toLocaleDateString()}
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
