import { useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Settings,
  MessageSquare,
  Palette,
  Star,
  Brain,
  AlertCircle,
  Wand2,
  Zap,
  HelpCircle,
  Store,
  Shield,
  ListChecks,
} from "lucide-react"

import { DataErrorState, DataLoadingState } from "@/components/ui/data-state"
import { SettingsSystemControlsSection } from "@/components/modules/settings/settings-system-controls-section"
import { SettingsProcessingRulesSection } from "@/components/modules/settings/settings-processing-rules-section"
import { SettingsAdvancedSection } from "@/components/modules/settings/settings-advanced-section"
import { SettingsAiSection } from "@/components/modules/settings/settings-ai-section"
import { SettingsBrandSection, SettingsStyleSection } from "@/components/modules/settings/settings-brand-section"
import { SettingsChatsBehaviorSection } from "@/components/modules/settings/settings-chats-section"
import { SettingsReviewRulesSection } from "@/components/modules/settings/settings-reviews-section"
import { SettingsDialogs } from "@/components/modules/settings/settings-dialogs"
import { useSettingsController } from "@/components/modules/settings/use-settings-controller"
import { EmptyState } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { StatusPill } from "@/components/shared/system-state"
import { cn } from "@/lib/utils"

type NavSection = {
  id: string
  label: string
  icon: React.ElementType
  group: string
}

const NAV_SECTIONS: NavSection[] = [
  { id: "system", label: "Системные ограничения", icon: Shield, group: "Управление" },
  { id: "rules", label: "Правила обработки", icon: ListChecks, group: "Управление" },
  { id: "reviews", label: "Правила отзывов", icon: Star, group: "Каналы" },
  { id: "chats", label: "Настройки чатов", icon: MessageSquare, group: "Каналы" },
  { id: "style", label: "Стиль и подписи", icon: Palette, group: "Генерация ответов" },
  { id: "ai", label: "AI-обучение", icon: Brain, group: "Генерация ответов" },
]

function modeLabel(mode: string) {
  if (mode === "autopilot") return "Автопилот"
  if (mode === "manual") return "Ручной"
  return "Контроль"
}

function SectionDivider({ label }: { label?: string }) {
  return (
    <div className="relative my-5">
      <div className="border-t border-border/50" />
      {label && (
        <span className="absolute left-0 -top-2.5 bg-background px-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/60">
          {label}
        </span>
      )}
    </div>
  )
}

function SettingsNav({
  activeSection,
  onSelect,
  automationEnabled,
}: {
  activeSection: string
  onSelect: (id: string) => void
  automationEnabled: boolean
}) {
  const groups = NAV_SECTIONS.reduce<Record<string, NavSection[]>>((acc, s) => {
    ;(acc[s.group] ||= []).push(s)
    return acc
  }, {})

  return (
    <nav className="w-[220px] shrink-0 space-y-4">
      {Object.entries(groups).map(([group, items]) => (
        <div key={group}>
          <div className="px-3 mb-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/50">
            {group}
          </div>
          <div className="space-y-0.5">
            {items.map((section) => {
              const Icon = section.icon
              const active = activeSection === section.id
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => onSelect(section.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-[14px] transition-all text-left cursor-pointer",
                    active
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{section.label}</span>
                  {section.id === "system" && (
                    <span className={cn(
                      "ml-auto h-2 w-2 rounded-full shrink-0",
                      automationEnabled ? "bg-success" : "bg-muted-foreground/40"
                    )} />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}

function SettingsSectionContent({
  activeSection,
  settings,
}: {
  activeSection: string
  settings: ReturnType<typeof useSettingsController>
}) {
  const draft = settings.draft

  switch (activeSection) {
    case "system":
      return (
        <SettingsSystemControlsSection {...settings.automationSectionProps} />
      )
    case "rules":
      return (
        <SettingsProcessingRulesSection
          automationEnabled={draft?.automation_enabled ?? false}
          autoDraft={draft?.auto_draft ?? false}
          autoPublish={draft?.auto_publish ?? false}
          ratingModeMap={draft?.rating_mode_map || {}}
          onRatingModeChange={settings.reviewModesSectionProps.onRatingModeChange}
          questionsMode={settings.questionsMode}
          onQuestionsModeChange={settings.questionsSectionProps.onQuestionsModeChange}
          chatEnabled={draft?.chat_enabled ?? true}
          chatAutoReply={draft?.chat_auto_reply ?? false}
          onChatEnabledChange={settings.chatsSectionProps.onChatEnabledChange}
          onChatAutoReplyChange={settings.chatsSectionProps.onChatAutoReplyChange}
        />
      )
    case "reviews":
      return (
        <SettingsReviewRulesSection {...settings.reviewRulesSectionProps} />
      )
    case "chats":
      return (
        <SettingsChatsBehaviorSection {...settings.chatsBehaviorSectionProps} />
      )
    case "style":
      return (
        <>
          <SettingsStyleSection {...settings.styleSectionProps} />
          <SectionDivider label="Подписи" />
          <SettingsBrandSection {...settings.brandSectionProps} />
        </>
      )
    case "ai":
      return <SettingsAiSection {...settings.aiSectionProps} />
    default:
      return null
  }
}

export default function SettingsModule({ shopId }: { shopId: number | null }) {
  const navigate = useNavigate()
  const settings = useSettingsController(shopId)
  const [activeSection, setActiveSection] = useState("system")

  if (!shopId) {
    return (
      <EmptyState
        icon={<Settings className="h-5 w-5" />}
        title="Магазин не выбран"
        description="Выберите магазин, чтобы открыть настройки."
      />
    )
  }

  if (!settings.draft && settings.settingsQuery.isLoading) {
    return (
      <DataLoadingState
        title="Загружаем настройки"
        description="Подготавливаем режимы автоматизации, подписи и правила ответов."
      />
    )
  }

  if (!settings.draft && settings.settingsQuery.error) {
    return (
      <DataErrorState
        title="Не удалось открыть настройки"
        description={settings.settingsQuery.error}
        onAction={() => void settings.settingsQuery.refresh()}
      />
    )
  }

  const hasError = settings.settingsQuery.error && settings.draft
  const hasToneError = settings.toneOptionsQuery.error
  const automationEnabled = settings.draft?.automation_enabled ?? false
  const autoDraft = settings.draft?.auto_draft ?? false
  const autoPublish = settings.draft?.auto_publish ?? false

  return (
    <div className="-mx-6 -mt-5">
      {/* Compact header */}
      <div className="border-b border-border/50 px-6 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 shrink-0">
              <Settings className="h-4.5 w-4.5 text-primary" />
            </div>
            <h1 className="text-lg font-bold whitespace-nowrap">Настройки</h1>
            <div className="flex items-center gap-1 text-muted-foreground">
              <Store className="h-3.5 w-3.5" />
              <span className="text-[13px] truncate max-w-[250px]">{settings.shopLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-border/40 bg-muted/20 px-3 py-1.5">
              <StatusPill
                status={automationEnabled ? "ready" : "disabled"}
                label={automationEnabled ? "Авто" : "Выкл"}
                size="sm"
                showDot
              />
              {automationEnabled && (
                <>
                  <span className="h-4 w-px bg-border/40" />
                  <span className="text-[12px] text-muted-foreground">
                    {autoDraft ? "Ген" : "—"} · {autoPublish ? "Пуб" : "—"}
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-border/40 bg-muted/20 px-3 py-1.5">
              <span className="text-[12px] text-muted-foreground">Отзывы:</span>
              <span className="text-[12px] font-medium">{modeLabel(settings.workMode)}</span>
            </div>
            <Badge className={cn("text-[12px] h-6 px-3", settings.saveStateMeta.tone)}>
              {settings.saveStateMeta.badge}
            </Badge>
          </div>
        </div>

        {(hasError || hasToneError || settings.warnings.length > 0 || settings.onboardingDone === false) && (
          <div className="mt-2 space-y-1.5">
            {hasError && (
              <div className="rounded-lg border border-destructive/20 bg-[hsl(var(--danger-soft))]/30 px-4 py-2 text-[13px] text-destructive">
                {settings.settingsQuery.error}
              </div>
            )}
            {hasToneError && (
              <div className="rounded-lg border border-warning/20 bg-[hsl(var(--warning-soft))]/30 px-4 py-2 text-[13px] text-warning">
                {settings.toneOptionsQuery.error}
              </div>
            )}
            {settings.warnings.map((w) => (
              <div key={w} className="rounded-lg border border-warning/20 bg-[hsl(var(--warning-soft))]/30 px-4 py-2 text-[13px] text-warning">
                {w}
              </div>
            ))}
            {settings.onboardingDone === false && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/20 bg-[hsl(var(--warning-soft))]/30 px-4 py-2.5">
                <div className="flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4 text-warning" />
                  <span className="text-[13px] text-foreground">Завершите первичную настройку</span>
                </div>
                <Button variant="outline" size="sm" className="h-8 text-[13px] px-3 gap-1.5" onClick={() => navigate("/app/onboarding")}>
                  <Wand2 className="h-3 w-3" />
                  Мастер
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Body: nav + content */}
      <div className="flex" style={{ height: "calc(100vh - 120px)" }}>
        <div className="shrink-0 border-r border-border/30 px-3 py-4 overflow-y-auto">
          <SettingsNav
            activeSection={activeSection}
            onSelect={setActiveSection}
            automationEnabled={automationEnabled}
          />
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
          <SettingsSectionContent activeSection={activeSection} settings={settings} />
        </div>
      </div>

      <SettingsDialogs {...settings.dialogsProps} />
    </div>
  )
}
