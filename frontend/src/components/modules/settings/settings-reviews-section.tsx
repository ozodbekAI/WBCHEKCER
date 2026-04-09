import { Star } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { ReplyMode, SaveStateMeta, ToneOption } from "@/components/modules/settings/settings-types"

function Stars({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: count }).map((_, i) => (
        <Star key={i} className="h-4 w-4 3xl:h-5 3xl:w-5 fill-primary text-primary" />
      ))}
    </div>
  )
}

type SettingsReviewModesSectionProps = {
  ratingModeMap: Record<string, ReplyMode>
  onRatingModeChange: (rating: string, mode: ReplyMode) => void
  saveStateMeta: SaveStateMeta
}

export function SettingsReviewModesSection({
  ratingModeMap,
  onRatingModeChange,
}: SettingsReviewModesSectionProps) {
  return (
    <div className="space-y-5 3xl:space-y-7">
      <div>
        <h2 className="text-base 3xl:text-lg font-semibold">Режимы по оценкам</h2>
        <p className="text-[13px] 3xl:text-[14px] text-muted-foreground mt-0.5">
          Точная настройка поведения для каждой оценки.
        </p>
      </div>

      <div className="rounded-xl border border-border/50 divide-y divide-border/40">
        {[5, 4, 3, 2, 1].map((rating) => {
          const key = String(rating)
          const mode = ratingModeMap[key] || "semi"
          return (
            <div key={key} className="flex items-center justify-between gap-4 px-4 py-3 3xl:px-5 3xl:py-4">
              <Stars count={rating} />
              <div className="flex items-center gap-1.5 3xl:gap-2">
                {([
                  { value: "manual" as ReplyMode, label: "Ручной" },
                  { value: "semi" as ReplyMode, label: "Черновик" },
                  { value: "auto" as ReplyMode, label: "Авто" },
                ] as const).map((opt) => (
                  <Button
                    key={opt.value}
                    type="button"
                    variant={mode === opt.value ? "default" : "ghost"}
                    size="sm"
                    className="h-7 3xl:h-8 px-3 3xl:px-4 text-[12px] 3xl:text-[13px]"
                    onClick={() => onRatingModeChange(key, opt.value)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type SettingsReviewRulesSectionProps = {
  emojiEnabled: boolean
  photoReactionEnabled: boolean
  deliveryMethod: string | null
  tonePositive: string
  toneNeutral: string
  toneNegative: string
  toneQuestion: string
  availableToneOptions: ToneOption[]
  reviewStopWords: string[]
  learningEnabled: boolean
  onEmojiEnabledChange: (value: boolean) => void
  onPhotoReactionEnabledChange: (value: boolean) => void
  onDeliveryMethodChange: (value: string | null) => void
  onToneChange: (bucket: "positive" | "neutral" | "negative" | "question", value: string) => void
  onStopWordsChange: (value: string[]) => void
  saveStateMeta: SaveStateMeta
}

export function SettingsReviewRulesSection({
  emojiEnabled,
  photoReactionEnabled,
  deliveryMethod,
  tonePositive,
  toneNeutral,
  toneNegative,
  toneQuestion,
  availableToneOptions,
  reviewStopWords,
  learningEnabled,
  onEmojiEnabledChange,
  onPhotoReactionEnabledChange,
  onDeliveryMethodChange,
  onToneChange,
  onStopWordsChange,
}: SettingsReviewRulesSectionProps) {
  return (
    <div className="space-y-5 3xl:space-y-7">
      <div>
        <h2 className="text-base 3xl:text-lg font-semibold">Правила ответов</h2>
        <p className="text-[13px] 3xl:text-[14px] text-muted-foreground mt-0.5">
          Тональность, стоп-слова и дополнительные сигналы для генерации.
        </p>
      </div>

      {/* Toggles */}
      <div className="rounded-xl border border-border/50 divide-y divide-border/40">
        <div className="flex items-center justify-between gap-4 px-4 py-3.5 3xl:px-5 3xl:py-4 rounded-lg cursor-pointer transition-colors hover:bg-muted/40" onClick={() => onEmojiEnabledChange(!emojiEnabled)}>
          <div>
            <div className="text-sm 3xl:text-[15px] font-medium">Эмодзи в ответах</div>
            <div className="text-[13px] 3xl:text-[14px] text-muted-foreground">AI может добавлять эмодзи</div>
          </div>
          <Switch checked={emojiEnabled} onCheckedChange={onEmojiEnabledChange} />
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3.5 3xl:px-5 3xl:py-4 rounded-lg cursor-pointer transition-colors hover:bg-muted/40" onClick={() => onPhotoReactionEnabledChange(!photoReactionEnabled)}>
          <div>
            <div className="text-sm 3xl:text-[15px] font-medium">Реакция на фото</div>
            <div className="text-[13px] 3xl:text-[14px] text-muted-foreground">Благодарить за прикреплённые фото</div>
          </div>
          <Switch checked={photoReactionEnabled} onCheckedChange={onPhotoReactionEnabledChange} />
        </div>
      </div>

      {/* Delivery + Tones */}
      <div className="grid gap-4 3xl:gap-5 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-[13px] 3xl:text-[14px]">Способ доставки</Label>
          <Select value={deliveryMethod || "none"} onValueChange={(v) => onDeliveryMethodChange(v === "none" ? null : v)}>
            <SelectTrigger className="h-9 3xl:h-10 text-sm 3xl:text-[15px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-sm 3xl:text-[14px]">Не выбрано</SelectItem>
              <SelectItem value="courier" className="text-sm 3xl:text-[14px]">Курьер</SelectItem>
              <SelectItem value="pickup" className="text-sm 3xl:text-[14px]">ПВЗ</SelectItem>
              <SelectItem value="post" className="text-sm 3xl:text-[14px]">Почта</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[13px] 3xl:text-[14px]">Тон: положительные</Label>
          <Select value={tonePositive} onValueChange={(v) => onToneChange("positive", v)}>
            <SelectTrigger className="h-9 3xl:h-10 text-sm 3xl:text-[15px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {availableToneOptions.map((t) => <SelectItem key={`p-${t.value}`} value={t.value} className="text-sm 3xl:text-[14px]">{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[13px] 3xl:text-[14px]">Тон: нейтральные</Label>
          <Select value={toneNeutral} onValueChange={(v) => onToneChange("neutral", v)}>
            <SelectTrigger className="h-9 3xl:h-10 text-sm 3xl:text-[15px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {availableToneOptions.map((t) => <SelectItem key={`n-${t.value}`} value={t.value} className="text-sm 3xl:text-[14px]">{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[13px] 3xl:text-[14px]">Тон: негативные</Label>
          <Select value={toneNegative} onValueChange={(v) => onToneChange("negative", v)}>
            <SelectTrigger className="h-9 3xl:h-10 text-sm 3xl:text-[15px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {availableToneOptions.map((t) => <SelectItem key={`neg-${t.value}`} value={t.value} className="text-sm 3xl:text-[14px]">{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <Label className="text-[13px] 3xl:text-[14px]">Тон: вопросы</Label>
          <Select value={toneQuestion} onValueChange={(v) => onToneChange("question", v)}>
            <SelectTrigger className="h-9 3xl:h-10 text-sm 3xl:text-[15px] md:w-1/2"><SelectValue /></SelectTrigger>
            <SelectContent>
              {availableToneOptions.map((t) => <SelectItem key={`q-${t.value}`} value={t.value} className="text-sm 3xl:text-[14px]">{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stop words */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label className="text-[13px] 3xl:text-[14px]">Стоп-слова</Label>
          {learningEnabled && (
            <span className="rounded bg-muted px-2 py-0.5 text-[11px] 3xl:text-[12px] text-muted-foreground">Управляется AI</span>
          )}
        </div>
        <Textarea
          rows={4}
          value={reviewStopWords.join("\n")}
          onChange={(e) =>
            onStopWordsChange(
              e.target.value.split("\n").map((s) => s.trim()).filter(Boolean)
            )
          }
          placeholder="Каждое стоп-слово с новой строки"
          disabled={learningEnabled}
          className="text-sm 3xl:text-[15px]"
        />
      </div>
    </div>
  )
}
