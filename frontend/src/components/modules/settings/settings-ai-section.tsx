import { Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { SaveStateMeta } from "@/components/modules/settings/settings-types"
import { prettyDateTime } from "@/components/modules/settings/settings-utils"
import type { ReviewAiLearningEntry, ReviewAiLearningState } from "@/lib/api"

function learningTargetLabel(entry: ReviewAiLearningEntry, categories: ReviewAiLearningState["categories"]) {
  if (entry.target_type === "stop_word") return "Стоп-слово"
  if (entry.target_type === "base_prompt") return "Общие правила"
  const category = categories.find((c) => c.code === entry.category_code)
  const label = category?.label || entry.category_code || "Категория"
  if (entry.sentiment_scope === "positive") return `${label} · позитив`
  if (entry.sentiment_scope === "negative") return `${label} · негатив`
  return `${label} · обе ветки`
}

type SettingsAiSectionProps = {
  learningState: ReviewAiLearningState | null
  learningLoading: boolean
  learningBusy: boolean
  learningError: string | null
  saveStateMeta: SaveStateMeta
  onEnable: () => void
  onOpenManualRule: () => void
  onReset: () => void
  onDisable: () => void
  onDeleteEntry: (entryId: number) => void
}

export function SettingsAiSection({
  learningState,
  learningLoading,
  learningBusy,
  learningError,
  onEnable,
  onOpenManualRule,
  onReset,
  onDisable,
  onDeleteEntry,
}: SettingsAiSectionProps) {
  return (
    <div className="space-y-5 3xl:space-y-7">
      <div>
        <h2 className="text-base 3xl:text-lg font-semibold">AI-обучение</h2>
        <p className="text-[13px] 3xl:text-[14px] text-muted-foreground mt-0.5">
          Shop-level правила, категории и стоп-слова для генерации.
        </p>
      </div>

      {learningError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] 3xl:text-[14px] text-destructive">
          {learningError}
        </div>
      )}

      {/* Enable/disable toggle */}
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border/50 bg-muted/10 px-4 py-3 3xl:px-5 3xl:py-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm 3xl:text-[15px] font-medium">Shop-level обучение</span>
            <Badge variant={learningState?.enabled ? "default" : "secondary"} className="text-[11px] 3xl:text-[12px] h-5 3xl:h-6 px-2">
              {learningState?.enabled ? "Вкл" : "Выкл"}
            </Badge>
          </div>
          <p className="text-[13px] 3xl:text-[14px] text-muted-foreground mt-0.5">
            Отдельная копия промптов, категорий и стоп-слов
          </p>
        </div>
        <div className="flex items-center gap-2">
          {learningState?.enabled ? (
            <Button type="button" variant="outline" size="sm" className="h-8 3xl:h-9 text-[13px] 3xl:text-[14px]" disabled={learningBusy || learningLoading} onClick={onDisable}>
              Выключить
            </Button>
          ) : (
            <Button type="button" size="sm" className="h-8 3xl:h-9 text-[13px] 3xl:text-[14px] gap-1.5" disabled={learningBusy || learningLoading} onClick={onEnable}>
              <Sparkles className="h-3.5 w-3.5" />
              Включить
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" className="h-8 3xl:h-9 text-[13px] 3xl:text-[14px] gap-1.5" disabled={!learningState?.enabled || learningBusy} onClick={onOpenManualRule}>
            <Plus className="h-3.5 w-3.5" />
            Правило
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 3xl:h-9 text-[13px] 3xl:text-[14px] gap-1.5" disabled={!learningState?.enabled || learningBusy} onClick={onReset}>
            <RefreshCw className="h-3.5 w-3.5" />
            Сброс
          </Button>
        </div>
      </div>

      {learningState && (
        <>
          {/* Stats */}
          <div className="grid gap-3 3xl:gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-border/50 bg-background px-4 py-3 3xl:px-5 3xl:py-4">
              <div className="text-[11px] 3xl:text-[12px] uppercase tracking-[0.15em] text-muted-foreground">Правила</div>
              <div className="mt-1 text-xl 3xl:text-2xl font-semibold">{learningState.entries.length}</div>
            </div>
            <div className="rounded-xl border border-border/50 bg-background px-4 py-3 3xl:px-5 3xl:py-4">
              <div className="text-[11px] 3xl:text-[12px] uppercase tracking-[0.15em] text-muted-foreground">Стоп-слова</div>
              <div className="mt-1 text-xl 3xl:text-2xl font-semibold">{learningState.stop_words.length}</div>
            </div>
            <div className="rounded-xl border border-border/50 bg-background px-4 py-3 3xl:px-5 3xl:py-4">
              <div className="text-[11px] 3xl:text-[12px] uppercase tracking-[0.15em] text-muted-foreground">Категории</div>
              <div className="mt-1 text-xl 3xl:text-2xl font-semibold">{learningState.categories.length}</div>
            </div>
          </div>

          {/* Learning entries */}
          <div className="space-y-2">
            <h3 className="text-sm 3xl:text-[15px] font-medium">История обучения</h3>
            {learningState.entries.length ? (
              <div className="space-y-2">
                {learningState.entries.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-border/50 bg-background px-4 py-3 3xl:px-5 3xl:py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-[11px] 3xl:text-[12px] h-5 3xl:h-6 px-2">{learningTargetLabel(entry, learningState.categories)}</Badge>
                          <span className="text-[11px] 3xl:text-[12px] text-muted-foreground">{prettyDateTime(entry.created_at)}</span>
                        </div>
                        <div className="text-[13px] 3xl:text-[14px]">
                          <span className="text-muted-foreground">Запрос: </span>
                          <span className="font-medium">{entry.user_instruction}</span>
                        </div>
                        <div className="text-[13px] 3xl:text-[14px]">
                          <span className="text-muted-foreground">Результат: </span>
                          <span>{entry.stop_word || entry.applied_text}</span>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 3xl:h-8 3xl:w-8 text-destructive hover:text-destructive shrink-0"
                        disabled={learningBusy}
                        onClick={() => onDeleteEntry(entry.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 3xl:h-4 3xl:w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border/50 px-4 py-6 text-center">
                <div className="text-[13px] 3xl:text-[14px] text-muted-foreground">Правил пока нет</div>
              </div>
            )}
          </div>

          {/* Accordion details */}
          <Accordion type="multiple" className="rounded-xl border border-border/50 bg-background px-4 3xl:px-5">
            <AccordionItem value="prompt">
              <AccordionTrigger className="text-sm 3xl:text-[15px] py-2.5 3xl:py-3">Базовый промпт</AccordionTrigger>
              <AccordionContent>
                <div className="max-h-56 overflow-auto rounded-lg border border-border/40 bg-muted/10 p-3 text-[13px] 3xl:text-[14px] whitespace-pre-wrap">
                  {learningState.review_prompt_template || "Пусто"}
                </div>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="stop-words">
              <AccordionTrigger className="text-sm 3xl:text-[15px] py-2.5 3xl:py-3">Стоп-слова</AccordionTrigger>
              <AccordionContent>
                {learningState.stop_words.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {learningState.stop_words.map((w) => (
                      <Badge key={w} variant="outline" className="text-[12px] 3xl:text-[13px] rounded-full">{w}</Badge>
                    ))}
                  </div>
                ) : (
                  <div className="text-[13px] 3xl:text-[14px] text-muted-foreground">Нет стоп-слов</div>
                )}
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="categories">
              <AccordionTrigger className="text-sm 3xl:text-[15px] py-2.5 3xl:py-3">Категории</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2.5">
                  {learningState.categories.map((cat) => (
                    <div key={cat.code} className="rounded-lg border border-border/40 bg-muted/10 p-3 3xl:p-4">
                      <div className="text-[13px] 3xl:text-[14px] font-medium">{cat.label}</div>
                      <div className="mt-2 grid gap-3 lg:grid-cols-2">
                        <div>
                          <div className="text-[11px] 3xl:text-[12px] uppercase tracking-wide text-emerald-600">Позитив</div>
                          <div className="text-[12px] 3xl:text-[13px] text-muted-foreground whitespace-pre-wrap">{cat.positive_prompt || "—"}</div>
                        </div>
                        <div>
                          <div className="text-[11px] 3xl:text-[12px] uppercase tracking-wide text-rose-600">Негатив</div>
                          <div className="text-[12px] 3xl:text-[13px] text-muted-foreground whitespace-pre-wrap">{cat.negative_prompt || "—"}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </>
      )}
    </div>
  )
}
