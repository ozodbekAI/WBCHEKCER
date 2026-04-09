import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/* ─── Page Header (Row 1) ─── */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-section-title text-[hsl(var(--text-strong))] leading-tight">{title}</h1>
        {subtitle && (
          <p className="mt-0.5 text-[13px] text-[hsl(var(--text-muted))] leading-snug">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
    </div>
  )
}

/* ─── Segmented Tabs (Row 2) ─── */
export type SegmentItem<T extends string = string> = {
  key: T
  label: string
  count?: number
}

export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: SegmentItem<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div className={cn("inline-flex items-center rounded-xl bg-muted/60 p-1 gap-0.5", className)}>
      {items.map((item) => {
        const active = value === item.key
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            className={cn(
              "relative flex items-center gap-1.5 rounded-lg px-3.5 py-[6px] text-[13px] font-medium transition-all",
              active
                ? "bg-card text-[hsl(var(--text-strong))] shadow-[0_1px_3px_rgba(0,0,0,0.06),0_0_0_1px_hsl(var(--border)/0.5)]"
                : "text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-default))]"
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                className={cn(
                  "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md px-1 text-[10px] font-semibold tabular-nums leading-none",
                  active
                    ? "bg-primary/10 text-primary"
                    : "bg-secondary text-[hsl(var(--text-muted))]"
                )}
              >
                {item.count > 999 ? "999+" : item.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ─── Search Input (Row 2) ─── */
import { Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"

export function SearchField({
  value,
  onChange,
  placeholder = "Поиск…",
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={cn("relative", className)}>
      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[hsl(var(--text-muted))]" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 rounded-lg pl-8 pr-8 text-[13px] bg-muted/40 border-transparent focus:border-border focus:bg-card placeholder:text-[hsl(var(--text-muted))]"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--text-muted))] hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

/* ─── Filter Bar (Row 3) ─── */
import { SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"

export function FilterBar({
  children,
  hasActiveFilters,
  activeCount,
  onReset,
  className,
}: {
  children: ReactNode
  hasActiveFilters?: boolean
  activeCount?: number
  onReset?: () => void
  className?: string
}) {
  return (
    <div className={cn("flex items-center gap-1.5 rounded-lg bg-muted/50 border border-border px-2.5 py-1.5", className)}>
      <div className="flex items-center gap-1.5 text-[12px] text-foreground/60 shrink-0 px-1">
        <SlidersHorizontal className="h-3.5 w-3.5" />
        <span className="hidden sm:inline font-medium">Фильтры</span>
      </div>
      <div className="h-3.5 w-px bg-border/50" />
      <div className="flex items-center gap-1.5 flex-wrap">
        {children}
      </div>
      {hasActiveFilters && onReset && (
        <>
          <div className="h-3.5 w-px bg-border/50 ml-auto" />
          <Button
            variant="ghost"
            onClick={onReset}
            className="h-7 gap-1 px-2 text-[11px] text-[hsl(var(--text-muted))] hover:text-foreground shrink-0"
          >
            <X className="h-3 w-3" />
            Сбросить{(activeCount ?? 0) > 0 ? ` (${activeCount})` : ""}
          </Button>
        </>
      )}
    </div>
  )
}

/* ─── Filter Select (chip-style dropdown) ─── */
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select"

export function FilterSelect({
  value,
  onValueChange,
  placeholder,
  children,
  isActive,
  className,
}: {
  value: string
  onValueChange: (v: string) => void
  placeholder: string
  children: ReactNode
  isActive?: boolean
  className?: string
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        className={cn(
          "h-7 w-auto min-w-[100px] rounded-lg px-2.5 text-[12px] border transition-colors shadow-none",
          isActive
            ? "border-primary/40 bg-primary/10 text-primary font-medium"
            : "border-border/60 bg-card text-foreground hover:bg-muted/60",
          className,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="rounded-xl shadow-lg border-border/60">
        {children}
      </SelectContent>
    </Select>
  )
}

/* ─── KPI Strip (Row 4) ─── */
export type KpiItem = {
  label: string
  value: number | string
  accent?: "primary" | "success" | "warning" | "info" | "danger"
  suffix?: ReactNode
}

export function KpiStrip({
  items,
  className,
}: {
  items: KpiItem[]
  className?: string
}) {
  const accentColor = {
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    info: "text-info",
    danger: "text-destructive",
  }

  return (
    <div className={cn("flex items-center gap-3 rounded-lg border border-border/50 bg-card px-4 py-2", className)}>
      {items.map((item, i) => (
        <div key={item.label} className="flex items-center gap-2">
          {i > 0 && <div className="h-4 w-px bg-border/50 -ml-1" />}
          <span className="text-[11px] text-[hsl(var(--text-muted))] font-medium">{item.label}</span>
          <span className={cn("text-sm font-bold tabular-nums leading-none", item.accent ? accentColor[item.accent] : "text-foreground")}>
            {item.value}
          </span>
          {item.suffix}
        </div>
      ))}
    </div>
  )
}

/* ─── Controls Layout (combines Row 2+3) ─── */
export function ControlsRow({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex items-center gap-3 flex-wrap", className)}>
      {children}
    </div>
  )
}
