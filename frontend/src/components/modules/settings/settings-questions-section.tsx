import { Check, Eye, Hand, Zap } from "lucide-react"

import type { ReplyMode, SaveStateMeta } from "@/components/modules/settings/settings-types"

type SettingsQuestionsSectionProps = {
  questionsMode: ReplyMode
  onQuestionsModeChange: (mode: ReplyMode) => void
  saveStateMeta: SaveStateMeta
}

export function SettingsQuestionsSection({
  questionsMode,
  onQuestionsModeChange,
}: SettingsQuestionsSectionProps) {
  return (
    <div className="space-y-5 3xl:space-y-7">
      <div>
        <h2 className="text-base 3xl:text-lg font-semibold">Вопросы покупателей</h2>
        <p className="text-[13px] 3xl:text-[14px] text-muted-foreground mt-0.5">
          Как система реагирует на входящие вопросы.
        </p>
      </div>

      <div className="grid gap-3 3xl:gap-4 lg:grid-cols-3">
        {[
          { value: "auto" as ReplyMode, title: "Автопилот", icon: Zap, desc: "Ответы публикуются автоматически" },
          { value: "semi" as ReplyMode, title: "Контроль", icon: Eye, desc: "AI создаёт черновик, оператор публикует" },
          { value: "manual" as ReplyMode, title: "Ручной", icon: Hand, desc: "Только показывает входящие вопросы" },
        ].map((item) => {
          const Icon = item.icon
          const active = questionsMode === item.value
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onQuestionsModeChange(item.value)}
              className={`relative rounded-xl border p-4 3xl:p-5 text-left transition ${
                active
                  ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                  : "border-border/60 hover:border-primary/30 hover:bg-muted/20"
              }`}
            >
              {active && <Check className="absolute right-3 top-3 3xl:right-4 3xl:top-4 h-4 w-4 3xl:h-5 3xl:w-5 text-primary" />}
              <div className="flex items-center gap-2 mb-1.5">
                <Icon className="h-4 w-4 3xl:h-5 3xl:w-5 text-muted-foreground" />
                <span className="text-sm 3xl:text-[15px] font-semibold">{item.title}</span>
              </div>
              <p className="text-[13px] 3xl:text-[14px] text-muted-foreground leading-snug">{item.desc}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
