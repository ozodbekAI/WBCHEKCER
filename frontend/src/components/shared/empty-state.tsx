import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[20px] border border-dashed border-border bg-card px-8 py-16 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[14px] bg-[hsl(var(--primary-soft))] text-primary">
          {icon}
        </div>
      ) : null}
      <h3 className="text-base font-semibold text-[hsl(var(--text-strong))]">{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-[hsl(var(--text-muted))]">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}
