import type { ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import {
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  CircleDashed,
  CreditCard,
  Inbox,
  Loader2,
  PauseCircle,
  Power,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/* ─────────────────────────────────────────────
   System State — единый визуальный язык для
   всех состояний продукта.
   ───────────────────────────────────────────── */

export type SystemStatus =
  | "ready"
  | "running"
  | "blocked"
  | "stale"
  | "failed"
  | "paused_insufficient_balance"
  | "activation_required"
  | "disabled"
  | "worker_inactive"
  | "loading"
  | "empty"

/* ── Status Pill / Chip ── */

const STATUS_META: Record<
  SystemStatus,
  { label: string; dotClass: string; pillClass: string; icon: ReactNode }
> = {
  ready: {
    label: "Готово",
    dotClass: "bg-success",
    pillClass: "bg-[hsl(var(--success-soft))] text-success border-success/20",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  running: {
    label: "В процессе",
    dotClass: "bg-primary animate-pulse",
    pillClass: "bg-[hsl(var(--primary-soft))] text-primary border-primary/20",
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
  },
  blocked: {
    label: "Заблокировано",
    dotClass: "bg-destructive",
    pillClass: "bg-[hsl(var(--danger-soft))] text-destructive border-destructive/20",
    icon: <ShieldAlert className="h-3 w-3" />,
  },
  stale: {
    label: "Устарело",
    dotClass: "bg-warning",
    pillClass: "bg-[hsl(var(--warning-soft))] text-warning border-warning/20",
    icon: <RefreshCw className="h-3 w-3" />,
  },
  failed: {
    label: "Ошибка",
    dotClass: "bg-destructive",
    pillClass: "bg-[hsl(var(--danger-soft))] text-destructive border-destructive/20",
    icon: <XCircle className="h-3 w-3" />,
  },
  paused_insufficient_balance: {
    label: "Приостановлено",
    dotClass: "bg-warning",
    pillClass: "bg-[hsl(var(--warning-soft))] text-warning border-warning/20",
    icon: <PauseCircle className="h-3 w-3" />,
  },
  activation_required: {
    label: "Требуется активация",
    dotClass: "bg-info",
    pillClass: "bg-[hsl(var(--info-soft))] text-info border-info/20",
    icon: <BrainCircuit className="h-3 w-3" />,
  },
  disabled: {
    label: "Отключено",
    dotClass: "bg-muted-foreground",
    pillClass: "bg-muted text-muted-foreground border-border",
    icon: <CircleDashed className="h-3 w-3" />,
  },
  worker_inactive: {
    label: "Воркер неактивен",
    dotClass: "bg-destructive",
    pillClass: "bg-[hsl(var(--danger-soft))] text-destructive border-destructive/20",
    icon: <Power className="h-3 w-3" />,
  },
  loading: {
    label: "Загрузка",
    dotClass: "bg-muted-foreground animate-pulse",
    pillClass: "bg-muted text-muted-foreground border-border",
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
  },
  empty: {
    label: "Нет данных",
    dotClass: "bg-muted-foreground",
    pillClass: "bg-muted text-muted-foreground border-border",
    icon: <Inbox className="h-3 w-3" />,
  },
}

export function StatusPill({
  status,
  label,
  showDot = true,
  showIcon = false,
  size = "sm",
  className,
}: {
  status: SystemStatus
  label?: string
  showDot?: boolean
  showIcon?: boolean
  size?: "xs" | "sm" | "md"
  className?: string
}) {
  const meta = STATUS_META[status]
  const sizeClass = {
    xs: "px-1.5 py-px text-[10px] gap-1",
    sm: "px-2 py-0.5 text-[11px] gap-1.5",
    md: "px-2.5 py-1 text-xs gap-1.5",
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-semibold leading-none whitespace-nowrap",
        meta.pillClass,
        sizeClass[size],
        className,
      )}
    >
      {showIcon && meta.icon}
      {showDot && !showIcon && <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", meta.dotClass)} />}
      {label ?? meta.label}
    </span>
  )
}

export function getStatusMeta(status: SystemStatus) {
  return STATUS_META[status]
}

/* ── State Banner ── */

type BannerTone = "info" | "warning" | "danger" | "success" | "primary" | "muted"

const BANNER_TONE: Record<BannerTone, { border: string; bg: string; iconBg: string; iconColor: string }> = {
  info: { border: "border-info/20", bg: "bg-[hsl(var(--info-soft))]/40", iconBg: "bg-info/10", iconColor: "text-info" },
  warning: { border: "border-warning/20", bg: "bg-[hsl(var(--warning-soft))]/40", iconBg: "bg-warning/10", iconColor: "text-warning" },
  danger: { border: "border-destructive/20", bg: "bg-[hsl(var(--danger-soft))]/40", iconBg: "bg-destructive/10", iconColor: "text-destructive" },
  success: { border: "border-success/20", bg: "bg-[hsl(var(--success-soft))]/40", iconBg: "bg-success/10", iconColor: "text-success" },
  primary: { border: "border-primary/20", bg: "bg-[hsl(var(--primary-soft))]/40", iconBg: "bg-primary/10", iconColor: "text-primary" },
  muted: { border: "border-border", bg: "bg-muted/30", iconBg: "bg-muted", iconColor: "text-muted-foreground" },
}

export function StateBanner({
  tone,
  icon,
  title,
  description,
  action,
  compact = false,
  className,
}: {
  tone: BannerTone
  icon: ReactNode
  title: string
  description?: string
  action?: ReactNode
  compact?: boolean
  className?: string
}) {
  const t = BANNER_TONE[tone]
  return (
    <div className={cn("flex items-center gap-3 rounded-xl border", t.border, t.bg, compact ? "px-3.5 py-2.5" : "px-4 py-3.5", className)}>
      <div className={cn("flex shrink-0 items-center justify-center rounded-lg", t.iconBg, t.iconColor, compact ? "h-7 w-7" : "h-9 w-9")}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn("font-semibold text-foreground leading-tight", compact ? "text-[12px]" : "text-[13px]")}>{title}</p>
        {description && <p className={cn("text-muted-foreground mt-0.5 leading-tight", compact ? "text-[11px]" : "text-[12px]")}>{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/* ── State Action Card — premium blocked/paused/failed state with what/why/action ── */

type StateActionCardConfig = {
  tone: BannerTone
  icon: ReactNode
  title: string
  what: string
  why: string
  actionLabel?: string
  actionHref?: string
  onAction?: () => void
}

const STATE_ACTION_DEFAULTS: Record<string, StateActionCardConfig> = {
  paused_insufficient_balance: {
    tone: "warning",
    icon: <CreditCard className="h-5 w-5" />,
    title: "Работа приостановлена",
    what: "Генерация ответов и автоматизация временно остановлены.",
    why: "На балансе недостаточно кредитов для продолжения операций.",
    actionLabel: "Пополнить баланс",
    actionHref: "/app/billing",
  },
  blocked: {
    tone: "danger",
    icon: <ShieldAlert className="h-5 w-5" />,
    title: "Автоматизация заблокирована",
    what: "Автоматическая генерация и публикация ответов не выполняется.",
    why: "Один или несколько параметров автоматизации отключены в настройках.",
    actionLabel: "Открыть настройки",
    actionHref: "/app/settings",
  },
  failed: {
    tone: "danger",
    icon: <XCircle className="h-5 w-5" />,
    title: "Произошла ошибка",
    what: "Последняя операция завершилась с ошибкой.",
    why: "Возможна временная проблема на стороне сервиса или провайдера ИИ.",
    actionLabel: "Повторить",
  },
  stale: {
    tone: "warning",
    icon: <RefreshCw className="h-5 w-5" />,
    title: "Данные устарели",
    what: "Отображаемые данные могут не соответствовать текущему состоянию.",
    why: "Конфигурация изменилась после последней синхронизации.",
    actionLabel: "Обновить",
  },
  activation_required: {
    tone: "info",
    icon: <BrainCircuit className="h-5 w-5" />,
    title: "Требуется активация",
    what: "Функция доступна, но ещё не включена для вашего магазина.",
    why: "Для начала работы необходимо активировать функцию и выделить бюджет кредитов.",
    actionLabel: "Активировать",
  },
  worker_inactive: {
    tone: "danger",
    icon: <Power className="h-5 w-5" />,
    title: "Фоновый воркер неактивен",
    what: "Автоматическая обработка отзывов и публикация ответов не выполняется.",
    why: "Системный воркер остановлен или не отвечает. Это может быть временная проблема.",
    actionLabel: "Обновить статус",
  },
  disabled: {
    tone: "muted",
    icon: <CircleDashed className="h-5 w-5" />,
    title: "Функция отключена",
    what: "Эта функция сейчас неактивна.",
    why: "Функция была отключена в настройках магазина.",
    actionLabel: "Настройки",
    actionHref: "/app/settings",
  },
}

export function StateActionCard({
  status,
  what,
  why,
  title,
  icon,
  actionLabel,
  actionHref,
  onAction,
  compact = false,
  className,
}: {
  status: SystemStatus | string
  what?: string
  why?: string
  title?: string
  icon?: ReactNode
  actionLabel?: string
  actionHref?: string
  onAction?: () => void
  compact?: boolean
  className?: string
}) {
  const navigate = useNavigate()
  const defaults = STATE_ACTION_DEFAULTS[status]
  const tone = defaults?.tone ?? "muted"
  const t = BANNER_TONE[tone]

  const finalTitle = title ?? defaults?.title ?? STATUS_META[status as SystemStatus]?.label ?? "Состояние"
  const finalWhat = what ?? defaults?.what ?? ""
  const finalWhy = why ?? defaults?.why ?? ""
  const finalIcon = icon ?? defaults?.icon ?? <AlertTriangle className="h-5 w-5" />
  const finalActionLabel = actionLabel ?? defaults?.actionLabel
  const finalActionHref = actionHref ?? defaults?.actionHref

  const handleAction = () => {
    if (onAction) return onAction()
    if (finalActionHref) navigate(finalActionHref)
  }

  return (
    <div className={cn(
      "rounded-xl border overflow-hidden",
      t.border,
      className,
    )}>
      <div className={cn("flex items-center gap-3", t.bg, compact ? "px-3.5 py-2.5" : "px-4 py-3")}>
        <div className={cn("flex shrink-0 items-center justify-center rounded-lg", t.iconBg, t.iconColor, compact ? "h-8 w-8" : "h-10 w-10")}>
          {finalIcon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className={cn("font-semibold text-foreground", compact ? "text-[13px]" : "text-sm")}>{finalTitle}</h3>
            <StatusPill status={status as SystemStatus} size="xs" showIcon />
          </div>
        </div>
        {finalActionLabel && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleAction}
            className={cn("shrink-0 gap-1.5", compact ? "h-7 text-[11px] px-2.5" : "h-8 text-[12px] px-3")}
          >
            {finalActionLabel}
            <ArrowRight className="h-3 w-3" />
          </Button>
        )}
      </div>
      {(finalWhat || finalWhy) && (
        <div className={cn("border-t bg-card", t.border, compact ? "px-3.5 py-2" : "px-4 py-2.5")}>
          <div className={cn("grid gap-x-6", finalWhat && finalWhy ? "grid-cols-2" : "grid-cols-1")}>
            {finalWhat && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Что произошло</div>
                <p className="text-[12px] text-foreground/80 leading-relaxed">{finalWhat}</p>
              </div>
            )}
            {finalWhy && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Почему</div>
                <p className="text-[12px] text-foreground/80 leading-relaxed">{finalWhy}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Convenience banners for common backend states ── */

export function StatusBannerFromState({
  status,
  reason,
  blockedReason,
  onAction,
  actionLabel,
  actionHref,
  compact = false,
}: {
  status: SystemStatus
  reason?: string | null
  blockedReason?: string | null
  onAction?: () => void
  actionLabel?: string
  actionHref?: string
  compact?: boolean
}) {
  if (status === "ready" || status === "loading" || status === "empty") return null

  // For richer states, use StateActionCard
  if (!compact && (status === "paused_insufficient_balance" || status === "blocked" || status === "worker_inactive" || status === "activation_required")) {
    return (
      <StateActionCard
        status={status}
        why={blockedReason ?? reason ?? undefined}
        onAction={onAction}
        actionLabel={actionLabel}
        actionHref={actionHref}
      />
    )
  }

  const configs: Partial<Record<SystemStatus, { tone: BannerTone; icon: ReactNode; title: string; defaultDesc: string; showAction?: boolean }>> = {
    running: {
      tone: "primary",
      icon: <BrainCircuit className={cn("h-4 w-4", !compact && "animate-pulse")} />,
      title: "В процессе",
      defaultDesc: "Задача выполняется. Данные обновятся автоматически.",
    },
    stale: {
      tone: "warning",
      icon: <RefreshCw className="h-4 w-4" />,
      title: "Требуется обновление",
      defaultDesc: "Конфигурация изменилась. Запустите обновление для актуальных данных.",
      showAction: true,
    },
    blocked: {
      tone: "danger",
      icon: <ShieldAlert className="h-4 w-4" />,
      title: "Заблокировано",
      defaultDesc: blockedReason || "Операция приостановлена. Проверьте настройки.",
    },
    failed: {
      tone: "danger",
      icon: <XCircle className="h-4 w-4" />,
      title: "Ошибка",
      defaultDesc: "Произошла техническая ошибка. Попробуйте позже.",
      showAction: true,
    },
    paused_insufficient_balance: {
      tone: "warning",
      icon: <CreditCard className="h-4 w-4" />,
      title: "Недостаточно кредитов",
      defaultDesc: "Пополните баланс для продолжения работы.",
    },
    activation_required: {
      tone: "info",
      icon: <BrainCircuit className="h-4 w-4" />,
      title: "Требуется активация",
      defaultDesc: "Функция доступна, но ещё не включена.",
      showAction: true,
    },
    worker_inactive: {
      tone: "danger",
      icon: <Power className="h-4 w-4" />,
      title: "Воркер неактивен",
      defaultDesc: "Автоматическая обработка остановлена.",
      showAction: true,
    },
    disabled: {
      tone: "muted",
      icon: <CircleDashed className="h-4 w-4" />,
      title: "Отключено",
      defaultDesc: "Функция отключена в настройках.",
    },
  }

  const cfg = configs[status]
  if (!cfg) return null

  return (
    <StateBanner
      tone={cfg.tone}
      icon={cfg.icon}
      title={cfg.title}
      description={reason || cfg.defaultDesc}
      compact={compact}
      action={
        cfg.showAction && onAction ? (
          <Button variant="outline" size="sm" onClick={onAction} className="h-7 text-[11px] px-2.5">
            {actionLabel || "Обновить"}
          </Button>
        ) : undefined
      }
    />
  )
}

/* ── Empty State ── */

export function StateEmpty({
  icon,
  title,
  description,
  action,
  compact = false,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  compact?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card text-center",
        compact ? "gap-2 px-6 py-8" : "gap-3 px-8 py-14",
        className,
      )}
    >
      <div className={cn(
        "flex items-center justify-center rounded-xl bg-muted text-muted-foreground",
        compact ? "h-9 w-9" : "h-11 w-11",
      )}>
        {icon ?? <Inbox className={compact ? "h-4 w-4" : "h-5 w-5"} />}
      </div>
      <div className="space-y-1">
        <h3 className={cn("font-semibold text-foreground", compact ? "text-[13px]" : "text-sm")}>{title}</h3>
        {description && <p className={cn("max-w-sm text-muted-foreground", compact ? "text-[12px]" : "text-[13px]")}>{description}</p>}
      </div>
      {action && <div className={compact ? "mt-1" : "mt-2"}>{action}</div>}
    </div>
  )
}

/* ── Inline helper block ── */

export function InlineHelper({
  tone = "info",
  icon,
  children,
  className,
}: {
  tone?: BannerTone
  icon?: ReactNode
  children: ReactNode
  className?: string
}) {
  const t = BANNER_TONE[tone]
  return (
    <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2", t.border, t.bg, className)}>
      {icon && <span className={cn("mt-0.5 shrink-0", t.iconColor)}>{icon}</span>}
      <div className="text-[12px] text-foreground/80 leading-relaxed">{children}</div>
    </div>
  )
}

/* ── Loading State ── */

export function StateLoading({
  title = "Загрузка данных",
  description,
  className,
  compact = false,
}: {
  title?: string
  description?: string
  className?: string
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-border bg-card text-center",
        compact ? "gap-2 px-4 py-6" : "gap-3 px-6 py-10",
        className,
      )}
    >
      <div className={cn(
        "flex items-center justify-center rounded-xl bg-muted text-muted-foreground",
        compact ? "h-9 w-9" : "h-10 w-10",
      )}>
        <RefreshCw className={cn("animate-spin", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
      </div>
      <div className="space-y-1">
        <div className={cn("font-medium text-foreground", compact ? "text-[13px]" : "text-sm")}>{title}</div>
        {description && <div className={cn("text-muted-foreground", compact ? "text-[12px]" : "text-[13px]")}>{description}</div>}
      </div>
    </div>
  )
}

/* ── Error State ── */

export function StateError({
  title = "Не удалось загрузить данные",
  description,
  onRetry,
  retryLabel = "Повторить",
  className,
  compact = false,
}: {
  title?: string
  description?: string | null
  onRetry?: () => void
  retryLabel?: string
  className?: string
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-destructive/15 bg-[hsl(var(--danger-soft))]/30 text-center",
        compact ? "gap-2 px-4 py-6" : "gap-3 px-6 py-10",
        className,
      )}
    >
      <div className={cn(
        "flex items-center justify-center rounded-xl bg-destructive/10 text-destructive",
        compact ? "h-9 w-9" : "h-10 w-10",
      )}>
        <AlertTriangle className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      </div>
      <div className="space-y-1">
        <div className={cn("font-medium text-foreground", compact ? "text-[13px]" : "text-sm")}>{title}</div>
        {description && <div className={cn("text-muted-foreground", compact ? "text-[12px]" : "text-[13px]")}>{description}</div>}
      </div>
      {onRetry && (
        <Button variant="outline" size={compact ? "sm" : "default"} className="rounded-xl" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  )
}
