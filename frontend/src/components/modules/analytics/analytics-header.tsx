import { BarChart2 } from "lucide-react"

export function AnalyticsHeader() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
        <BarChart2 className="h-4 w-4 text-primary" />
      </div>
      <div>
        <h1 className="text-section-title text-[hsl(var(--text-strong))] leading-tight">Аналитика</h1>
        <p className="text-[11px] text-muted-foreground leading-tight">AI-анализ и классификация обратной связи</p>
      </div>
    </div>
  )
}
