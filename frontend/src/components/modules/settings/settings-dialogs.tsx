import { Plus } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import type { SignatureItem } from "@/components/modules/settings/settings-types"

type SettingsDialogsProps = {
  signature: {
    open: boolean
    brands: string[]
    sigBrand: string
    sigRating: string
    sigText: string
    sigEditingTarget: SignatureItem | null
    onOpenChange: (open: boolean) => void
    onBrandChange: (value: string) => void
    onRatingChange: (value: string) => void
    onTextChange: (value: string) => void
    onSave: () => void
  }
  learning: {
    learningBusy: boolean
    learningEnabled: boolean
    enableConfirmOpen: boolean
    resetConfirmOpen: boolean
    manualRuleOpen: boolean
    manualInstruction: string
    manualAnswerExample: string
    onEnableConfirmChange: (open: boolean) => void
    onConfirmEnable: () => void
    onResetConfirmChange: (open: boolean) => void
    onConfirmReset: () => void
    onManualRuleOpenChange: (open: boolean) => void
    onManualInstructionChange: (value: string) => void
    onManualAnswerExampleChange: (value: string) => void
    onCreateManualRule: () => void
  }
}

export function SettingsDialogs({ signature, learning }: SettingsDialogsProps) {
  return (
    <>
      <Sheet open={signature.open} onOpenChange={signature.onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-[520px]">
          <SheetHeader>
            <SheetTitle>{signature.sigEditingTarget ? "Редактировать подпись" : "Новая подпись"}</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-6">
            <div className="space-y-2">
              <Label>Выберите бренд</Label>
              <Select value={signature.sigBrand} onValueChange={signature.onBrandChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Для всех брендов" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Для всех брендов</SelectItem>
                  {signature.brands.map((brand) => (
                    <SelectItem key={brand} value={brand}>
                      {brand}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Выберите рейтинг</Label>
              <Select value={signature.sigRating} onValueChange={signature.onRatingChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Для всех рейтингов" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Для всех рейтингов</SelectItem>
                  {[5, 4, 3, 2, 1].map((rating) => (
                    <SelectItem key={rating} value={String(rating)}>
                      {rating} ★
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Текст подписи</Label>
              <Textarea
                value={signature.sigText}
                onChange={(event) => signature.onTextChange(event.target.value)}
                rows={4}
                placeholder='Например: "С уважением, команда магазина"'
              />
            </div>

            <Button onClick={signature.onSave} className="w-full" disabled={!signature.sigText.trim()}>
              {signature.sigEditingTarget ? "Сохранить изменения" : "Сохранить"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={learning.enableConfirmOpen} onOpenChange={learning.onEnableConfirmChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Включить обучение ИИ для магазина?</AlertDialogTitle>
            <AlertDialogDescription>
              После включения система создаст отдельную копию review-prompts, категорий и стоп-слов для этого магазина.
              Новые ответы на отзывы будут строиться уже не только на стандартных настройках платформы, а с учётом ваших будущих правил и правок для магазина.
              Это повлияет только на выбранный магазин и не затронет остальные.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Подтверждая включение, вы соглашаетесь, что ответы этого магазина будут постепенно адаптироваться под ваши инструкции, добавленные через «Обучить ИИ» и «Добавить правило».
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={learning.onConfirmEnable}>Да, включить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={learning.resetConfirmOpen} onOpenChange={learning.onResetConfirmChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Сбросить обучение ИИ?</AlertDialogTitle>
            <AlertDialogDescription>
              Для магазина будет заново создана копия базового review-промпта, категорий и стоп-слов. Все накопленные AI-правила из истории будут отключены.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={learning.onConfirmReset}>Сбросить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={learning.manualRuleOpen} onOpenChange={learning.onManualRuleOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-[560px]">
          <SheetHeader>
            <SheetTitle>Новое правило для обучения ИИ</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-5">
            <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
              Напишите правило обычным языком. AI сам определит, нужно ли добавить его в общий review-prompt, в category prompt или в стоп-слова.
            </div>

            <div className="space-y-2">
              <Label>Что нужно изменить в ответах</Label>
              <Textarea
                value={learning.manualInstruction}
                onChange={(event) => learning.onManualInstructionChange(event.target.value)}
                rows={6}
                placeholder='Например: не используйте слово "благодарим". Или: для негативных отзывов про размер предлагайте помочь с подбором.'
              />
            </div>

            <div className="space-y-2">
              <Label>Необязательный пример ответа или фразы</Label>
              <Textarea
                value={learning.manualAnswerExample}
                onChange={(event) => learning.onManualAnswerExampleChange(event.target.value)}
                rows={5}
                placeholder="Можно вставить пример текущего ответа, чтобы AI точнее понял контекст."
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => learning.onManualRuleOpenChange(false)} disabled={learning.learningBusy}>
                Отмена
              </Button>
              <Button
                type="button"
                onClick={learning.onCreateManualRule}
                disabled={!learning.learningEnabled || learning.learningBusy || !learning.manualInstruction.trim()}
              >
                <Plus className="mr-2 h-4 w-4" />
                Добавить правило
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
