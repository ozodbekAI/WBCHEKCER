import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Sparkles } from "lucide-react"

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

interface FeedbackDetailProps {
  feedback: FeedbackItem
  token: string
  shopId: number
  onBack: () => void
  onUpdate: () => void
}

export default function FeedbackDetail({ feedback, token, shopId, onBack, onUpdate }: FeedbackDetailProps) {
  const [answerText, setAnswerText] = useState(feedback.answer_text || "")
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)

  const handleGenerateDraft = async () => {
    setIsGenerating(true)
    try {
      const res = await fetch(`/api/feedbacks/${shopId}/${feedback.wb_id}/draft`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.ok) {
        const data = await res.json()
        setAnswerText(data.text || "")
      }
    } catch (err) {
      console.error("Failed to generate draft:", err)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleSaveDraft = async () => {
    setIsSaving(true)
    try {
      await fetch(`/api/feedbacks/${shopId}/${feedback.wb_id}/answer/edit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: answerText }),
      })
      alert("Черновик сохранён!")
    } catch (err) {
      console.error("Failed to save draft:", err)
    } finally {
      setIsSaving(false)
    }
  }

  const handlePublish = async () => {
    setIsPublishing(true)
    try {
      await fetch(`/api/feedbacks/${shopId}/${feedback.wb_id}/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(answerText ? { text: answerText } : null),
      })
      alert("Answer published!")
      onUpdate()
      onBack()
    } catch (err) {
      console.error("Failed to publish:", err)
    } finally {
      setIsPublishing(false)
    }
  }

  return (
    <div className="p-8">
      {/* Header */}
      <Button variant="ghost" onClick={onBack} className="mb-6 gap-2">
        <ArrowLeft className="w-4 h-4" />
        Back to Feedbacks
      </Button>

      <div className="grid grid-cols-3 gap-6">
        {/* Feedback Content */}
        <div className="col-span-2 space-y-6">
          {/* Feedback Card */}
          <Card className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-2xl font-bold text-foreground">{feedback.user_name}</h2>
                <div className="flex gap-3 mt-2">
                  <Badge variant={feedback.is_answered ? "default" : "secondary"}>
                    {feedback.is_answered ? "Отвечено" : "Ожидает"}
                  </Badge>
                  <div className="flex gap-0.5">
                    {Array(5)
                      .fill(0)
                      .map((_, i) => (
                        <span
                          key={i}
                          className={`text-lg ${i < feedback.rating ? "text-yellow-500" : "text-muted-foreground"}`}
                        >
                          ★
                        </span>
                      ))}
                  </div>
                </div>
              </div>
            </div>

            <p className="text-sm text-muted-foreground mb-4">{new Date(feedback.created_date).toLocaleString()}</p>

            <div className="bg-card/50 p-4 rounded-lg">
              <h3 className="font-semibold text-foreground mb-2">Feedback</h3>
              <p className="text-foreground leading-relaxed">{feedback.text}</p>
            </div>
          </Card>

          {/* Answer Editor */}
          <Card className="p-6">
            <h3 className="font-semibold text-foreground mb-4">Your Response</h3>

            <Textarea
              placeholder="Write your response to this feedback..."
              value={answerText}
              onChange={(e) => setAnswerText(e.target.value)}
              className="min-h-32 mb-4"
            />

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleGenerateDraft}
                disabled={isGenerating}
                className="gap-2 bg-transparent"
              >
                <Sparkles className="w-4 h-4" />
                {isGenerating ? "Generating..." : "AI Draft"}
              </Button>
              <Button variant="outline" onClick={handleSaveDraft} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Draft"}
              </Button>
              <Button onClick={handlePublish} disabled={isPublishing || !answerText.trim()} className="gap-2">
                {isPublishing ? "Publishing..." : "Publish"}
              </Button>
            </div>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card className="p-4">
            <h4 className="font-semibold text-foreground mb-3">Details</h4>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground">ID</p>
                <p className="text-foreground font-mono">{feedback.wb_id}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Rating</p>
                <p className="text-foreground font-semibold">{feedback.rating} / 5</p>
              </div>
              <div>
                <p className="text-muted-foreground">Status</p>
                <p className="text-foreground">{feedback.is_answered ? "Responded" : "Awaiting Response"}</p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
