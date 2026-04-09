import {
  AlertTriangle,
  BotMessageSquare,
  Power,
  Send,
  Shield,
  Sparkles,
} from "lucide-react"

import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

type SystemControlsSectionProps = {
  automationEnabled: boolean
  autoDraft: boolean
  autoPublish: boolean
  autoSync: boolean
  autoDraftLimitPerSync: number
  onAutomationEnabledChange: (v: boolean) => void
  onAutoDraftChange: (v: boolean) => void
  onAutoPublishChange: (v: boolean) => void
  onAutoSyncChange: (v: boolean) => void
  onAutoDraftLimitChange: (v: number) => void
}

function MasterSwitch({
  icon: Icon,
  title,
  description,
  consequence,
  checked,
  onCheckedChange,
  disabled = false,
  warning,
}: {
  icon: React.ElementType
  title: string
  description: string
  consequence: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
  warning?: string | null
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-4 px-5 py-4 transition-colors",
        disabled && "opacity-40 pointer-events-none"
      )}
    >
      <div className={cn(
        "mt-0.5 rounded-lg p-2 shrink-0",
        checked ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
      )}>
        <Icon className="h-4 w-4" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-medium">{title}</span>
              <span className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider",
                checked ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
              )}>
                <span className={cn("h-1.5 w-1.5 rounded-full", checked ? "bg-success" : "bg-muted-foreground/40")} />
                {checked ? "Вкл" : "Выкл"}
              </span>
            </div>
            <p className="text-[13px] text-muted-foreground mt-1 leading-snug">{description}</p>
          </div>
          <Switch
            checked={checked}
            onCheckedChange={onCheckedChange}
            disabled={disabled}
            className="shrink-0"
          />
        </div>

        <p className="text-[12px] text-muted-foreground/70 mt-1.5 leading-snug italic">
          {consequence}
        </p>

        {warning && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-warning/15 bg-[hsl(var(--warning-soft))]/30 px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
            <p className="text-[12px] text-warning leading-snug">{warning}</p>
          </div>
        )}
      </div>
    </div>
  )
}

export function SettingsSystemControlsSection({
  automationEnabled,
  autoDraft,
  autoPublish,
  autoSync,
  autoDraftLimitPerSync,
  onAutomationEnabledChange,
  onAutoDraftChange,
  onAutoPublishChange,
  onAutoSyncChange,
  onAutoDraftLimitChange,
}: SystemControlsSectionProps) {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-bold">Системные ограничения</h2>
        </div>
        <p className="text-[13px] text-muted-foreground mt-1.5 leading-snug max-w-xl">
          Верхнеуровневые выключатели безопасности. Ограничивают все нижестоящие правила обработки.
          Если выключатель выключен — правила обработки сохраняются, но не выполняются.
        </p>
      </div>

      {/* Status strip */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/40 bg-muted/10 px-4 py-2.5">
        <span className="text-[12px] font-medium text-muted-foreground mr-1">Статус:</span>
        {[
          { on: automationEnabled, label: "Автоматизация" },
          { on: autoSync, label: "Синхронизация" },
          { on: autoDraft, label: "Генерация" },
          { on: autoPublish, label: "Публикация" },
        ].map((s) => (
          <span
            key={s.label}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold",
              s.on ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", s.on ? "bg-success" : "bg-muted-foreground/40")} />
            {s.label}
          </span>
        ))}
      </div>

      {/* Master switches */}
      <div className="rounded-xl border border-border/50 divide-y divide-border/30">
        <MasterSwitch
          icon={Power}
          title="Автоматизация"
          description="Главный выключатель всей автоматической обработки."
          consequence="Выключение немедленно останавливает генерацию, публикацию и все автоматические действия."
          checked={automationEnabled}
          onCheckedChange={onAutomationEnabledChange}
        />

        <MasterSwitch
          icon={BotMessageSquare}
          title="Автосинхронизация"
          description="Загрузка новых отзывов и вопросов с Wildberries."
          consequence="Без синхронизации новые отзывы не появятся в системе."
          checked={autoSync}
          onCheckedChange={onAutoSyncChange}
        />

        <MasterSwitch
          icon={Sparkles}
          title="AI-генерация разрешена"
          description="Разрешить системе создавать черновики ответов с помощью AI."
          consequence="Если выключено — ни одно правило обработки не сможет запустить генерацию, даже в режиме «Автопилот»."
          checked={autoDraft}
          onCheckedChange={onAutoDraftChange}
          disabled={!automationEnabled}
          warning={!automationEnabled ? "Автоматизация выключена — генерация заблокирована глобально." : null}
        />

        <MasterSwitch
          icon={Send}
          title="Автопубликация разрешена"
          description="Разрешить автоматическую отправку ответов на WB без проверки."
          consequence="Если выключено — все правила с авто-публикацией будут ждать ручной отправки."
          checked={autoPublish}
          onCheckedChange={onAutoPublishChange}
          disabled={!automationEnabled}
          warning={
            autoPublish && automationEnabled
              ? "Ответы публикуются без проверки оператором."
              : !automationEnabled
                ? "Автоматизация выключена — публикация заблокирована глобально."
                : null
          }
        />
      </div>

      {/* Draft limit */}
      <div className="rounded-xl border border-border/40 px-5 py-4">
        <div className="flex items-center justify-between gap-6">
          <div>
            <div className="text-[15px] font-medium">Лимит черновиков за цикл</div>
            <p className="text-[13px] text-muted-foreground mt-1">
              Максимум черновиков за один цикл синхронизации. 0 = без лимита.
            </p>
          </div>
          <input
            type="number"
            min={0}
            max={5000}
            value={autoDraftLimitPerSync}
            onChange={(e) => {
              const raw = Number(e.target.value)
              onAutoDraftLimitChange(Number.isFinite(raw) ? Math.max(0, Math.min(5000, Math.trunc(raw))) : 0)
            }}
            className="h-10 w-24 rounded-lg border border-border bg-background px-3 text-[15px] text-center focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>
    </div>
  )
}
