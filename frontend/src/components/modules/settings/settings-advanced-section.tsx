import { Brain, MessageSquareText, ShieldAlert } from "lucide-react"

import type { SaveStateMeta } from "@/components/modules/settings/settings-types"

type SettingsAdvancedSectionProps = {
  learningEnabled: boolean
  stopWordsCount: number
  customRulesCount: number
  chatConfirmationEnabled: boolean
  saveStateMeta: SaveStateMeta
}

export function SettingsAdvancedSection({
  learningEnabled,
  stopWordsCount,
  customRulesCount,
  chatConfirmationEnabled,
}: SettingsAdvancedSectionProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold">Обзор расширенных настроек</h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Сводка по AI, тональности и техническому поведению.
        </p>
      </div>

      <div className="grid gap-2.5 md:grid-cols-3">
        <div className="rounded-xl border border-border/40 bg-muted/10 px-3.5 py-3">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Brain className="h-3.5 w-3.5 text-primary" />
            AI обучение
          </div>
          <div className="mt-1 text-lg font-semibold">{learningEnabled ? "Вкл" : "Выкл"}</div>
          <div className="text-[11px] text-muted-foreground">Shop-level правила</div>
        </div>
        <div className="rounded-xl border border-border/40 bg-muted/10 px-3.5 py-3">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5 text-primary" />
            Ограничения
          </div>
          <div className="mt-1 text-lg font-semibold">{stopWordsCount + customRulesCount}</div>
          <div className="text-[11px] text-muted-foreground">Стоп-слов и правил</div>
        </div>
        <div className="rounded-xl border border-border/40 bg-muted/10 px-3.5 py-3">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <MessageSquareText className="h-3.5 w-3.5 text-primary" />
            Подтверждения
          </div>
          <div className="mt-1 text-lg font-semibold">{chatConfirmationEnabled ? "Вкл" : "Выкл"}</div>
          <div className="text-[11px] text-muted-foreground">Подтверждения в чатах</div>
        </div>
      </div>
    </div>
  )
}
