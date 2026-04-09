import * as React from "react"

import { AlertCircle, ChevronDown, Lock, Sparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

/* ═══════════════════════════════════════════════
   AdminKpi — shared KPI card for all admin pages
   ═══════════════════════════════════════════════ */

export type AdminKpiTone = "default" | "accent" | "success" | "warn" | "error"

const kpiBorder: Record<AdminKpiTone, string> = {
  default: "border-border bg-card",
  accent: "border-primary/30 bg-primary/[0.06]",
  success: "border-emerald-500/30 bg-emerald-500/[0.06]",
  warn: "border-amber-500/30 bg-amber-500/[0.06]",
  error: "border-red-500/30 bg-red-500/[0.06]",
}

const kpiIconBg: Record<AdminKpiTone, string> = {
  default: "bg-muted text-muted-foreground",
  accent: "bg-primary/15 text-primary",
  success: "bg-emerald-500/15 text-emerald-600",
  warn: "bg-amber-500/15 text-amber-600",
  error: "bg-red-500/15 text-red-600",
}

const kpiValueColor: Record<AdminKpiTone, string> = {
  default: "text-foreground",
  accent: "text-primary",
  success: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  error: "text-red-600 dark:text-red-400",
}

export function AdminKpi({
  label,
  value,
  icon,
  tone = "default",
  sub,
}: {
  label: string
  value: React.ReactNode
  icon?: React.ReactNode
  tone?: AdminKpiTone
  sub?: string
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border px-3.5 py-3 shadow-sm", kpiBorder[tone])}>
      {icon && (
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg shrink-0", kpiIconBg[tone])}>
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <div className={cn("text-xl font-bold leading-tight tabular-nums", kpiValueColor[tone])}>{value}</div>
        <div className="text-[12px] text-muted-foreground truncate leading-tight mt-0.5">
          {label}
          {sub ? <span className="opacity-70"> · {sub}</span> : null}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   AdminSectionCard — card wrapper for content sections
   ═══════════════════════════════════════════════ */

export function AdminSectionCard({
  children,
  className,
  danger,
}: {
  children: React.ReactNode
  className?: string
  danger?: boolean
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card overflow-hidden shadow-sm",
        danger ? "border-red-500/25" : "border-border",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function AdminSectionHeader({
  title,
  sub,
  icon,
  actions,
  danger,
}: {
  title: string
  sub?: string
  icon?: React.ReactNode
  actions?: React.ReactNode
  danger?: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 px-4 py-2.5 border-b",
        danger
          ? "bg-red-500/[0.06] border-red-500/15"
          : "bg-muted/40 border-border/50",
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        {icon && (
          <span className={cn("shrink-0", danger ? "text-red-500" : "text-muted-foreground/60")}>
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h3
            className={cn(
              "text-[13px] font-semibold",
              danger ? "text-red-600 dark:text-red-400" : "text-foreground",
            )}
          >
            {title}
          </h3>
          {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

/* ═══════════════════════════════════════════════
   AdminCompactEmpty — inline empty state for cards
   ═══════════════════════════════════════════════ */

export function AdminCompactEmpty({
  text,
  icon,
}: {
  text: string
  icon?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      {icon && <span className="text-muted-foreground/40 mb-2">{icon}</span>}
      <p className="text-[13px] text-muted-foreground/80">{text}</p>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   Legacy components (preserved API)
   ═══════════════════════════════════════════════ */

export function AdminPage({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground tracking-tight">{title}</h1>
            {description && (
              <p className="mt-0.5 max-w-2xl text-[13px] text-muted-foreground leading-relaxed">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </div>
      <div className="space-y-5">{children}</div>
    </div>
  )
}

export function AdminPanel({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
  collapsible = false,
  defaultOpen = true,
  summary,
  tone = "default",
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  contentClassName?: string
  collapsible?: boolean
  defaultOpen?: boolean
  summary?: React.ReactNode
  tone?: "default" | "accent" | "emerald" | "amber"
}) {
  const [open, setOpen] = React.useState(defaultOpen)

  const toneStyles = {
    default: "border-border bg-card",
    accent: "border-primary/15 bg-primary/[0.02]",
    emerald: "border-emerald-500/15 bg-emerald-50/30 dark:bg-emerald-950/10",
    amber: "border-amber-500/15 bg-amber-50/30 dark:bg-amber-950/10",
  } as const

  const header = (
    <div className="flex flex-col gap-2 border-b border-border/40 px-5 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-0.5 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {summary && (
            <Badge variant="secondary" className="text-[10px] font-semibold">
              {summary}
            </Badge>
          )}
        </div>
        {description && <p className="max-w-2xl text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {actions}
        {collapsible && (
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <span>{open ? "Скрыть" : "Показать"}</span>
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
            </button>
          </CollapsibleTrigger>
        )}
      </div>
    </div>
  )

  const shell = cn("overflow-hidden rounded-xl border", toneStyles[tone], className)

  if (collapsible) {
    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <section className={shell}>
          {header}
          <CollapsibleContent>
            <div className={cn("px-5 py-4", contentClassName)}>{children}</div>
          </CollapsibleContent>
        </section>
      </Collapsible>
    )
  }

  return (
    <section className={shell}>
      {header}
      <div className={cn("px-5 py-4", contentClassName)}>{children}</div>
    </section>
  )
}

export function AdminStatCard({
  label,
  value,
  hint,
  tone = "default",
  icon,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: "default" | "warn" | "success" | "accent"
  icon?: React.ReactNode
}) {
  const tones = {
    default: "border-border bg-card",
    warn: "border-warning/20 bg-warning/5",
    success: "border-emerald-500/20 bg-emerald-50/40 dark:bg-emerald-950/10",
    accent: "border-primary/20 bg-primary/5",
  } as const

  return (
    <div className={cn("rounded-xl border px-4 py-3", tones[tone])}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{hint}</div>}
    </div>
  )
}

export function AdminEmptyState({
  title,
  description,
  icon,
}: {
  title: string
  description: string
  icon?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-muted/20 px-8 py-10 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
        {icon || <Sparkles className="h-4 w-4 text-muted-foreground/70" />}
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">{description}</p>
    </div>
  )
}

export function AdminError({ message }: { message: string | null | undefined }) {
  if (!message) return null
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{message}</div>
    </div>
  )
}

export function AdminAccessDenied({
  title = "Доступ запрещён",
  description = "Этот раздел доступен только администраторам с нужными правами.",
}: {
  title?: string
  description?: string
}) {
  return (
    <div className="mx-auto max-w-lg">
      <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-8 py-16 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
          <Lock className="h-5 w-5 text-muted-foreground" />
        </div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

export function AdminFilterBar({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card px-4 py-3", className)}>
      {children}
    </div>
  )
}

export function AdminFilterField({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("space-y-1.5 min-w-[160px]", className)}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}
