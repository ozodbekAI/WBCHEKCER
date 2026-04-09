import {
  AlertTriangle,
  BotMessageSquare,
  Power,
  Send,
  Sparkles,
} from "lucide-react"

import { Switch } from "@/components/ui/switch"
import type { SaveStateMeta } from "@/components/modules/settings/settings-types"
import { cn } from "@/lib/utils"

type AutomationSectionProps = {
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
  saveStateMeta: SaveStateMeta
}

function StateChip({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none",
        on ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", on ? "bg-success" : "bg-muted-foreground/40")} />
      {label}
    </span>
  )
}

function ToggleRow({
  icon: Icon,
  title,
  description,
  onText,
  offText,
  checked,
  onCheckedChange,
  disabled = false,
  warning,
}: {
  icon: React.ElementType
  title: string
  description: string
  onText: string
  offText: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
  warning?: string | null
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3 transition-all",
        disabled
          ? "border-border/30 opacity-50"
          : checked
            ? "border-primary/20 bg-primary/[0.02]"
            : "border-border/40"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className={cn(
            "mt-0.5 rounded-lg p-1.5",
            checked ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          )}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium">{title}</span>
              <StateChip on={checked} label={checked ? "Вкл" : "Выкл"} />
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{description}</p>
          </div>
        </div>
        <Switch
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          className="shrink-0 mt-0.5"
        />
      </div>

      <div className="mt-2 ml-9 rounded-lg bg-muted/30 px-2.5 py-1.5">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {checked ? "✓ " : "⚠ "}
          {checked ? onText : offText}
        </p>
      </div>

      {warning && (
        <div className="mt-1.5 ml-9 flex items-start gap-1.5 rounded-lg border border-warning/15 bg-[hsl(var(--warning-soft))]/30 px-2.5 py-1.5">
          <AlertTriangle className="h-3 w-3 text-warning mt-0.5 shrink-0" />
          <p className="text-[11px] text-warning leading-relaxed">{warning}</p>
        </div>
      )}
    </div>
  )
}

export function SettingsAutomationSection({
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
}: AutomationSectionProps) {
  return (
    <div className="space-y-4">
      {/* Section header */}
      <div>
        <h2 className="text-[15px] font-semibold">Автоматизация</h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Контролируйте автоматическую обработку. Отключение немедленно останавливает процесс.
        </p>
      </div>

      {/* Status strip */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/40 bg-muted/10 px-3.5 py-2">
        <span className="text-[11px] font-medium text-muted-foreground mr-1">Статус:</span>
        <StateChip on={automationEnabled} label="Автоматизация" />
        <StateChip on={autoDraft} label="Генерация" />
        <StateChip on={autoPublish} label="Публикация" />
        <StateChip on={autoSync} label="Синхронизация" />
      </div>

      {/* Main automation toggle */}
      <ToggleRow
        icon={Power}
        title="Автоматизация"
        description="Главный выключатель автоматической обработки отзывов и вопросов."
        onText="Система активно обрабатывает входящие отзывы согласно выбранному режиму."
        offText="Все автоматические процессы остановлены. Отзывы только сохраняются."
        checked={automationEnabled}
        onCheckedChange={onAutomationEnabledChange}
      />

      {/* Generation toggle */}
      <ToggleRow
        icon={Sparkles}
        title="Генерация черновиков"
        description="AI создаёт черновики ответов. Каждая генерация расходует кредиты."
        onText="При поступлении нового отзыва AI автоматически создаст черновик ответа."
        offText="Черновики не создаются. Генерируйте вручную на странице отзывов."
        checked={autoDraft}
        onCheckedChange={onAutoDraftChange}
        disabled={!automationEnabled}
        warning={!automationEnabled ? "Автоматизация отключена — генерация не будет работать." : null}
      />

      {/* Publishing toggle */}
      <ToggleRow
        icon={Send}
        title="Автопубликация"
        description="Ответы отправляются на WB без подтверждения оператора."
        onText="Одобренные черновики публикуются автоматически без проверки."
        offText="Все ответы ждут ручной публикации. Полный контроль оператора."
        checked={autoPublish}
        onCheckedChange={onAutoPublishChange}
        disabled={!automationEnabled}
        warning={
          autoPublish && automationEnabled
            ? "Ответы публикуются без проверки. Убедитесь, что тон и подписи корректны."
            : !automationEnabled
              ? "Автоматизация отключена — публикация не будет работать."
              : null
        }
      />

      {/* Sync toggle */}
      <ToggleRow
        icon={BotMessageSquare}
        title="Автосинхронизация"
        description="Автоматически загружать новые отзывы и вопросы с Wildberries."
        onText="Система периодически проверяет WB и загружает новые данные."
        offText="Синхронизация остановлена. Новые отзывы не появятся без ручного запуска."
        checked={autoSync}
        onCheckedChange={onAutoSyncChange}
      />

      {/* Draft limit */}
      <div className="rounded-xl border border-border/40 px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[13px] font-medium">Лимит черновиков за цикл</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
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
            className="h-8 w-20 rounded-lg border border-border bg-background px-2.5 text-[13px] text-center focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="mt-2 rounded-lg bg-muted/30 px-2.5 py-1.5">
          <p className="text-[11px] text-muted-foreground">
            {autoDraftLimitPerSync === 0
              ? "Без ограничений — все новые отзывы получат черновики."
              : `Максимум ${autoDraftLimitPerSync} черновиков за цикл. Остальные ждут следующего цикла.`}
          </p>
        </div>
      </div>
    </div>
  )
}
