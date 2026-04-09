import { Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { RatingMode } from "./types"

interface RatingsStepProps {
  ratingModes: Record<number, RatingMode>
  onUpdateRatings: (ratings: Record<number, RatingMode>) => void
}

const LABELS: Record<number, string> = {
  5: "Отличные отзывы",
  4: "Хорошие отзывы",
  3: "Нейтральные",
  2: "Негативные",
  1: "Очень негативные",
}

export function RatingsStep({ ratingModes, onUpdateRatings }: RatingsStepProps) {
  const handleSet = (stars: number, mode: RatingMode) => {
    onUpdateRatings({ ...ratingModes, [stars]: mode })
  }

  const renderStars = (stars: number) => (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: stars }).map((_, i) => (
        <Star key={i} className="h-5 w-5 fill-amber-400 text-amber-400" />
      ))}
      {Array.from({ length: 5 - stars }).map((_, i) => (
        <Star key={i} className="h-5 w-5 text-muted-foreground/30" />
      ))}
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold mb-2">Настройка по рейтингу</h2>
        <p className="text-muted-foreground">
          Для каждого рейтинга выберите режим. <span className="font-medium">Авто</span> сработает только когда вы нажмёте{" "}
          <span className="font-medium">«Запустить»</span> вверху.
        </p>
      </div>

      <div className="space-y-3">
        {[5, 4, 3, 2, 1].map((stars) => {
          const current = ratingModes[stars] || "manual"
          return (
            <div key={stars} className="flex items-center justify-between p-4 rounded-lg bg-muted/30">
              <div className="flex items-center gap-3">
                {renderStars(stars)}
                <span className="text-sm text-muted-foreground">{LABELS[stars]}</span>
              </div>

              <div className="flex gap-2">
                <Button
                  variant={current === "manual" ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleSet(stars, "manual")}
                >
                  Ручной
                </Button>
                <Button
                  variant={current === "semi" ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleSet(stars, "semi")}
                >
                  Черновик
                </Button>
                <Button
                  variant={current === "auto" ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleSet(stars, "auto")}
                >
                  Авто
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="p-4 rounded-lg bg-muted/20 border border-border">
        <p className="text-sm text-muted-foreground">
          <strong>Ручной</strong> — ничего не генерируем автоматически.{" "}
          <strong>Черновик</strong> — ИИ создаст ответ для вашей проверки.{" "}
          <strong>Авто</strong> — ответ будет опубликован автоматически (только при включенной автогенерации).
        </p>
      </div>
    </div>
  )
}
