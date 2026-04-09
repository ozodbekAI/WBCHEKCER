import type { ReactNode } from "react"
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type DataStateBaseProps = {
  title: string
  description?: string | null
  className?: string
  compact?: boolean
}

type DataActionProps = {
  actionLabel?: string
  onAction?: () => void
}

function DataStateFrame({
  title,
  description,
  className,
  compact = false,
  icon,
  actionLabel,
  onAction,
}: DataStateBaseProps &
  DataActionProps & {
    icon: ReactNode
  }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-border bg-card text-center",
        compact ? "gap-2 px-4 py-4" : "gap-3 px-6 py-10",
        className,
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">{icon}</div>
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      </div>
      {actionLabel && onAction ? (
        <Button variant="outline" size={compact ? "sm" : "default"} className="rounded-xl" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}

export function DataLoadingState({
  title = "Загрузка данных",
  description = "Подождите немного, мы обновляем экран.",
  className,
  compact,
}: Partial<DataStateBaseProps>) {
  return (
    <DataStateFrame
      title={title}
      description={description}
      compact={compact}
      className={className}
      icon={<RefreshCw className="h-4 w-4 animate-spin" />}
    />
  )
}

export function DataErrorState({
  title = "Не удалось загрузить данные",
  description,
  className,
  compact,
  actionLabel = "Повторить",
  onAction,
}: Partial<DataStateBaseProps> & DataActionProps) {
  return (
    <DataStateFrame
      title={title}
      description={description}
      compact={compact}
      className={className}
      actionLabel={actionLabel}
      onAction={onAction}
      icon={<AlertTriangle className="h-4 w-4" />}
    />
  )
}

export function DataEmptyState({
  title,
  description,
  className,
  compact,
  actionLabel,
  onAction,
}: DataStateBaseProps & DataActionProps) {
  return (
    <DataStateFrame
      title={title}
      description={description}
      compact={compact}
      className={className}
      actionLabel={actionLabel}
      onAction={onAction}
      icon={<Inbox className="h-4 w-4" />}
    />
  )
}
