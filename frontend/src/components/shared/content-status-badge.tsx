import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const statusBadgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      status: {
        waiting: "bg-warning/15 text-warning",
        draft: "bg-info/15 text-info",
        answered: "bg-success/15 text-success",
        error: "bg-destructive/15 text-destructive",
        skipped: "bg-muted text-muted-foreground",
        new: "bg-info/15 text-info",
        active: "bg-warning/15 text-warning",
        closed: "bg-muted text-muted-foreground",
        pending: "bg-warning/15 text-warning",
        accepted: "bg-success/15 text-success",
        expired: "bg-muted text-muted-foreground",
        revoked: "bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      status: "waiting",
    },
  }
)

export type ContentStatus = NonNullable<VariantProps<typeof statusBadgeVariants>["status"]>

const STATUS_LABELS: Record<ContentStatus, string> = {
  waiting: "Ожидает",
  draft: "Черновик",
  answered: "Отвечен",
  error: "Ошибка",
  skipped: "Пропущен",
  new: "Новое",
  active: "Активный",
  closed: "Закрыт",
  pending: "Ожидает",
  accepted: "Принято",
  expired: "Истекло",
  revoked: "Отозвано",
}

interface ContentStatusBadgeProps extends VariantProps<typeof statusBadgeVariants> {
  label?: string
  className?: string
}

export function ContentStatusBadge({ status, label, className }: ContentStatusBadgeProps) {
  const resolvedStatus = status ?? "waiting"
  const displayLabel = label ?? STATUS_LABELS[resolvedStatus] ?? resolvedStatus

  return (
    <span className={cn(statusBadgeVariants({ status }), className)}>
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          resolvedStatus === "waiting" && "bg-warning",
          resolvedStatus === "draft" && "bg-info",
          resolvedStatus === "answered" && "bg-success",
          resolvedStatus === "error" && "bg-destructive",
          resolvedStatus === "skipped" && "bg-muted-foreground",
          resolvedStatus === "new" && "bg-info",
          resolvedStatus === "active" && "bg-warning",
          resolvedStatus === "closed" && "bg-muted-foreground",
          resolvedStatus === "pending" && "bg-warning",
          resolvedStatus === "accepted" && "bg-success",
          resolvedStatus === "expired" && "bg-muted-foreground",
          resolvedStatus === "revoked" && "bg-destructive",
        )}
      />
      {displayLabel}
    </span>
  )
}
