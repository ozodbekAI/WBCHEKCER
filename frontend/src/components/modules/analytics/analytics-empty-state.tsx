import { BarChart2 } from "lucide-react"

type AnalyticsEmptyStateProps = {
  title: string
  description: string
}

export function AnalyticsEmptyState({ title, description }: AnalyticsEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-8 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
        <BarChart2 className="h-5 w-5 text-muted-foreground" />
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
    </div>
  )
}
