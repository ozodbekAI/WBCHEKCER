import { AlertCircle, CheckCircle2, Loader2, PackageCheck, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type ImportItemStatus = "pending" | "running" | "done" | "error"

interface ImportProgressStepProps {
  tokenVerified: boolean
  shopCreated: boolean
  statuses: {
    reviews: ImportItemStatus
    questions: ImportItemStatus
    chats: ImportItemStatus
  }
  isRunning: boolean
  error: string | null
  onRetry: () => void
}

function statusIcon(status: ImportItemStatus) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-success" />
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-info" />
  if (status === "error") return <AlertCircle className="h-4 w-4 text-destructive" />
  return <div className="h-4 w-4 rounded-full border border-border bg-muted" />
}

function statusTone(status: ImportItemStatus) {
  if (status === "done") return "text-foreground"
  if (status === "running") return "text-foreground"
  if (status === "error") return "text-destructive"
  return "text-muted-foreground"
}

function StatusRow({ label, status }: { label: string; status: ImportItemStatus }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-border bg-background px-4 py-3">
      <div className="flex items-center gap-3">
        {statusIcon(status)}
        <span className={cn("text-sm font-medium", statusTone(status))}>{label}</span>
      </div>
      <span className="text-xs text-muted-foreground">
        {status === "done" ? "Готово" : status === "running" ? "Загружаем" : status === "error" ? "Ошибка" : "Ожидает"}
      </span>
    </div>
  )
}

export function ImportProgressStep({
  tokenVerified,
  shopCreated,
  statuses,
  isRunning,
  error,
  onRetry,
}: ImportProgressStepProps) {
  const doneCount = [statuses.reviews, statuses.questions, statuses.chats].filter((item) => item === "done").length
  const allDone = doneCount === 3

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <PackageCheck className="h-8 w-8" />
        </div>
        <h2 className="text-2xl font-bold">Импорт данных</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Мы уже загружаем первые отзывы, вопросы и чаты. Обычно это занимает 30-90 секунд.
        </p>
      </div>

      <div className="space-y-3 rounded-3xl border border-border bg-muted/30 p-4">
        <StatusRow label="Токен проверен" status={tokenVerified ? "done" : "pending"} />
        <StatusRow label="Магазин создан" status={shopCreated ? "done" : "pending"} />
        <StatusRow label="Загружаем отзывы" status={statuses.reviews} />
        <StatusRow label="Загружаем вопросы" status={statuses.questions} />
        <StatusRow label="Загружаем чаты" status={statuses.chats} />
      </div>

      <div className="rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        Карточки товаров синхронизируются отдельно по расписанию. Основная работа с отзывами, вопросами и чатами будет доступна сразу после завершения импорта.
      </div>

      {error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3">
          <div className="text-sm font-medium text-destructive">Не удалось завершить импорт</div>
          <div className="mt-1 text-sm text-destructive/90">{error}</div>
          <Button variant="outline" className="mt-3 gap-2" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" />
            Повторить импорт
          </Button>
        </div>
      ) : null}

      <div className="rounded-2xl border border-border bg-card px-4 py-3 text-sm">
        <div className="font-medium text-foreground">
          {allDone ? "Импорт завершён" : isRunning ? "Импорт продолжается в фоне" : "Импорт готов к запуску"}
        </div>
        <div className="mt-1 text-muted-foreground">
          {allDone
            ? "Можно переходить к выбору режима работы и тону ответов."
            : "Вы можете дождаться завершения здесь. После этого мы предложим базовые настройки для старта."}
        </div>
      </div>
    </div>
  )
}
