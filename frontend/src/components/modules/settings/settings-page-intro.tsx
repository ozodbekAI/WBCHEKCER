import { AlertCircle, Wand2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { ReplyMode, SaveStateMeta, WorkMode } from "@/components/modules/settings/settings-types"

type SettingsPageIntroProps = {
  shopLabel: string
  settingsLayer: "basic" | "advanced"
  saveStateMeta: SaveStateMeta
  workMode: WorkMode
  questionsMode: ReplyMode
  settingsError: string | null
  toneOptionsError: string | null
  warnings: string[]
  onboardingDone: boolean | null
  onOpenOnboarding: () => void
}

function modeLabel(mode: WorkMode) {
  if (mode === "autopilot") return "Автопилот"
  if (mode === "manual") return "Ручной"
  return "Контроль"
}

function replyModeLabel(mode: ReplyMode) {
  if (mode === "auto") return "Автопилот"
  if (mode === "semi") return "Контроль"
  return "Ручной"
}

function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/30 px-3 py-1">
      <span className="text-[11px] text-muted-foreground">{label}:</span>
      <span className="text-[11px] font-medium">{value}</span>
    </div>
  )
}

export function SettingsPageIntro({
  shopLabel,
  settingsLayer,
  saveStateMeta,
  workMode,
  questionsMode,
  settingsError,
  toneOptionsError,
  warnings,
  onboardingDone,
  onOpenOnboarding,
}: SettingsPageIntroProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Настройки</h1>
          <span className="text-sm text-muted-foreground">«{shopLabel}»</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill label="Отзывы" value={modeLabel(workMode)} />
          <StatusPill label="Вопросы" value={replyModeLabel(questionsMode)} />
          <Badge variant="outline" className="text-[11px]">Wildberries</Badge>
          <Badge className={`text-[11px] ${saveStateMeta.tone}`}>{saveStateMeta.badge}</Badge>
        </div>
      </div>

      {settingsError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-sm text-destructive">
          {settingsError}
        </div>
      ) : null}

      {toneOptionsError ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-1.5 text-sm text-warning">
          {toneOptionsError}
        </div>
      ) : null}

      {warnings.map((warning) => (
        <div key={warning} className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-1.5 text-sm text-warning">
          {warning}
        </div>
      ))}

      {onboardingDone === false ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-2.5 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="text-sm text-amber-900 dark:text-amber-100">
              Завершите первичную настройку магазина
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={onOpenOnboarding}>
            <Wand2 className="mr-1.5 h-3.5 w-3.5" />
            Мастер
          </Button>
        </div>
      ) : null}
    </div>
  )
}
