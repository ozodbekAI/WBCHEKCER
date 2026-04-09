import {
  Check,
  Eye,
  Hand,
  HelpCircle,
  Info,
  MessageSquare,
  Star,
  Zap,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type { ReplyMode } from "@/components/modules/settings/settings-types"
import { cn } from "@/lib/utils"

type ProcessingRulesSectionProps = {
  // Global state for contextual warnings
  automationEnabled: boolean
  autoDraft: boolean
  autoPublish: boolean
  // Reviews
  ratingModeMap: Record<string, ReplyMode>
  onRatingModeChange: (rating: string, mode: ReplyMode) => void
  // Questions
  questionsMode: ReplyMode
  onQuestionsModeChange: (mode: ReplyMode) => void
  // Chats
  chatEnabled: boolean
  chatAutoReply: boolean
  onChatEnabledChange: (v: boolean) => void
  onChatAutoReplyChange: (v: boolean) => void
}

function Stars({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: count }).map((_, i) => (
        <Star key={i} className="h-3.5 w-3.5 fill-primary text-primary" />
      ))}
    </div>
  )
}

const MODE_OPTIONS: { value: ReplyMode; label: string; short: string }[] = [
  { value: "manual", label: "Ручной", short: "Руч" },
  { value: "semi", label: "Черновик", short: "Черн" },
  { value: "auto", label: "Авто", short: "Авто" },
]

function GlobalBlockBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-warning/20 bg-[hsl(var(--warning-soft))]/30 px-4 py-3">
      <Info className="h-4 w-4 text-warning mt-0.5 shrink-0" />
      <p className="text-[13px] text-warning leading-snug">{message}</p>
    </div>
  )
}

function ModeCard({
  icon: Icon,
  title,
  description,
  active,
  onClick,
  disabled,
}: {
  icon: React.ElementType
  title: string
  description: string
  active: boolean
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
      "relative rounded-lg border p-4 text-left transition-all",
        disabled && "opacity-40 pointer-events-none",
        active
          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
          : "border-border/60 hover:border-primary/30 hover:bg-muted/20"
      )}
    >
      {active && <Check className="absolute right-3 top-3 h-4 w-4 text-primary" />}
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-[14px] font-semibold">{title}</span>
      </div>
      <p className="text-[12px] text-muted-foreground leading-snug">{description}</p>
    </button>
  )
}

export function SettingsProcessingRulesSection({
  automationEnabled,
  autoDraft,
  autoPublish,
  ratingModeMap,
  onRatingModeChange,
  questionsMode,
  onQuestionsModeChange,
  chatEnabled,
  chatAutoReply,
  onChatEnabledChange,
  onChatAutoReplyChange,
}: ProcessingRulesSectionProps) {
  const isInactive = !automationEnabled

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold">Правила обработки</h2>
        <p className="text-[13px] text-muted-foreground mt-1 leading-snug max-w-xl">
          Бизнес-логика обработки отзывов, вопросов и чатов. Подчиняется системным ограничениям выше.
        </p>
      </div>

      {/* Global inactive banner */}
      {isInactive && (
        <GlobalBlockBanner message="Правила сохранены, но сейчас глобальная автоматизация отключена. Включите автоматизацию в разделе «Системные ограничения», чтобы правила начали работать." />
      )}

      {/* ─── Reviews rating matrix ─── */}
      <div className={cn("space-y-3", isInactive && "opacity-60")}>
        <div className="flex items-center gap-2">
          <Star className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-[15px] font-semibold">Отзывы — режимы по оценкам</h3>
        </div>

        <div className="rounded-xl border border-border/50 divide-y divide-border/30">
          {[5, 4, 3, 2, 1].map((rating) => {
            const key = String(rating)
            const mode = ratingModeMap[key] || "semi"
            const needsGeneration = mode === "semi" || mode === "auto"
            const needsPublish = mode === "auto"
            const genBlocked = needsGeneration && !autoDraft && automationEnabled
            const pubBlocked = needsPublish && !autoPublish && automationEnabled

            return (
              <div key={key} className="px-5 py-3.5">
                <div className="flex items-center justify-between gap-4">
                  <Stars count={rating} />
                  <div className="flex items-center gap-1">
                    {MODE_OPTIONS.map((opt) => (
                      <Button
                        key={opt.value}
                        type="button"
                        variant={mode === opt.value ? "default" : "ghost"}
                        size="sm"
                        className="h-8 px-3.5 text-[13px]"
                        onClick={() => onRatingModeChange(key, opt.value)}
                        disabled={isInactive}
                      >
                        {opt.label}
                      </Button>
                    ))}
                  </div>
                </div>
                {(genBlocked || pubBlocked) && (
                  <div className="mt-1 flex items-center gap-1">
                    <Info className="h-3.5 w-3.5 text-warning shrink-0" />
                    <span className="text-[12px] text-warning">
                      {genBlocked && pubBlocked
                        ? "Генерация и публикация заблокированы глобальным ограничением"
                        : genBlocked
                          ? "Генерация заблокирована глобальным ограничением"
                          : "Автопубликация заблокирована глобальным ограничением"}
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ─── Questions mode ─── */}
      <div className={cn("space-y-3", isInactive && "opacity-60")}>
        <div className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-[15px] font-semibold">Вопросы покупателей</h3>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <ModeCard
            icon={Zap}
            title="Автопилот"
            description="Ответы публикуются автоматически"
            active={questionsMode === "auto"}
            onClick={() => onQuestionsModeChange("auto")}
            disabled={isInactive}
          />
          <ModeCard
            icon={Eye}
            title="Контроль"
            description="AI создаёт черновик, оператор публикует"
            active={questionsMode === "semi"}
            onClick={() => onQuestionsModeChange("semi")}
            disabled={isInactive}
          />
          <ModeCard
            icon={Hand}
            title="Ручной"
            description="Только показывает входящие вопросы"
            active={questionsMode === "manual"}
            onClick={() => onQuestionsModeChange("manual")}
            disabled={isInactive}
          />
        </div>

        {automationEnabled && questionsMode !== "manual" && !autoDraft && (
          <div className="flex items-center gap-1.5 px-1">
            <Info className="h-3.5 w-3.5 text-warning shrink-0" />
            <span className="text-[12px] text-warning">Генерация заблокирована глобальным ограничением</span>
          </div>
        )}
        {automationEnabled && questionsMode === "auto" && !autoPublish && (
          <div className="flex items-center gap-1.5 px-1">
            <Info className="h-3.5 w-3.5 text-warning shrink-0" />
            <span className="text-[12px] text-warning">Автопубликация заблокирована глобальным ограничением</span>
          </div>
        )}
      </div>

      {/* ─── Chats mode ─── */}
      <div className={cn("space-y-3", isInactive && "opacity-60")}>
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-[15px] font-semibold">Чаты</h3>
        </div>

        <div className="rounded-xl border border-border/50 divide-y divide-border/30">
          <div
            className="flex items-center justify-between gap-4 px-5 py-3.5 cursor-pointer transition-colors hover:bg-muted/40"
            onClick={() => !isInactive && onChatEnabledChange(!chatEnabled)}
          >
            <div>
              <div className="text-[14px] font-medium">AI-ответы в чатах</div>
              <div className="text-[12px] text-muted-foreground">Разрешить AI помогать в чатах</div>
            </div>
            <Switch checked={chatEnabled} onCheckedChange={onChatEnabledChange} disabled={isInactive} />
          </div>
          <div
            className="flex items-center justify-between gap-4 px-5 py-3.5 cursor-pointer transition-colors hover:bg-muted/40"
            onClick={() => !isInactive && chatEnabled && onChatAutoReplyChange(!chatAutoReply)}
          >
            <div>
              <div className="text-[14px] font-medium">Автоответы в чатах</div>
              <div className="text-[12px] text-muted-foreground">Автоматическая отправка после генерации</div>
            </div>
            <Switch checked={chatAutoReply} onCheckedChange={onChatAutoReplyChange} disabled={isInactive || !chatEnabled} />
          </div>
        </div>
      </div>
    </div>
  )
}
