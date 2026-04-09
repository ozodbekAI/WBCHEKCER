import { CheckCircle2, Rocket, Settings, MessageSquareText } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

interface CompleteStepProps {
  onFinish: () => void
  onOpenSettings: () => void
  onOpenFeedbacks: () => void
}

export function CompleteStep({ onFinish, onOpenSettings, onOpenFeedbacks }: CompleteStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-success/10 text-success">
          <CheckCircle2 className="h-10 w-10" />
        </div>
        <h2 className="text-2xl font-bold">Магазин готов к работе</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          Базовая настройка завершена. Теперь вы можете перейти в кабинет и начать работу с отзывами, вопросами и чатами из одного окна.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                <MessageSquareText className="h-5 w-5" />
              </div>
              <div>
                <div className="font-semibold text-foreground">Открыть отзывы</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Перейдите в рабочую очередь и начните отвечать на обращения покупателей.
                </div>
              </div>
            </div>
            <Button variant="outline" className="mt-4 w-full" onClick={onOpenFeedbacks}>
              Перейти к отзывам
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-muted p-3 text-foreground">
                <Settings className="h-5 w-5" />
              </div>
              <div>
                <div className="font-semibold text-foreground">Расширенные настройки</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Подписи, стиль ответа, AI-правила и поведение по рейтингам доступны в настройках магазина.
                </div>
              </div>
            </div>
            <Button variant="outline" className="mt-4 w-full" onClick={onOpenSettings}>
              Открыть настройки
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="pt-2">
        <Button onClick={onFinish} size="lg" className="w-full">
          <Rocket className="mr-2 h-4 w-4" />
          Перейти в кабинет
        </Button>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Вы сможете вернуться к настройкам позже в разделе «Настройки».
        </p>
      </div>
    </div>
  )
}
