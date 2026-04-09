import { Check, Eye, Hand, Zap } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { SaveStateMeta, WorkMode } from "@/components/modules/settings/settings-types"
import { cn } from "@/lib/utils"

type SettingsGeneralSectionProps = {
  workMode: WorkMode
  autoSync: boolean
  autoDraftLimitPerSync: number
  onWorkModeChange: (mode: WorkMode) => void
  onAutoSyncChange: (value: boolean) => void
  onAutoDraftLimitChange: (value: number) => void
  saveStateMeta: SaveStateMeta
}

export function SettingsGeneralSection({
  workMode,
  autoSync,
  autoDraftLimitPerSync,
  onWorkModeChange,
  onAutoSyncChange,
  onAutoDraftLimitChange,
}: SettingsGeneralSectionProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold">Режим работы</h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Уровень автоматизации для отзывов магазина.
        </p>
      </div>

      <div className="grid gap-2.5 lg:grid-cols-3">
        {[
          {
            value: "autopilot" as WorkMode,
            title: "Автопилот",
            icon: Zap,
            desc: "Автоответы на 4–5★, черновики для остальных",
            bullets: ["Автопубликация", "Черновики для сложных", "Максимум автоматизации"],
          },
          {
            value: "control" as WorkMode,
            title: "Контроль",
            icon: Eye,
            desc: "AI готовит черновики, публикация вручную",
            bullets: ["Черновики по всем", "Оператор решает", "Баланс контроля"],
          },
          {
            value: "manual" as WorkMode,
            title: "Ручной",
            icon: Hand,
            desc: "Только сбор отзывов, генерация по кнопке",
            bullets: ["Без автоматизации", "Генерация по запросу", "Для тестирования"],
          },
        ].map((item) => {
          const Icon = item.icon
          const active = workMode === item.value
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onWorkModeChange(item.value)}
              className={cn(
                "relative cursor-pointer rounded-xl border p-3.5 text-left transition-all",
                active
                  ? "border-primary bg-primary/[0.04] ring-2 ring-primary/20"
                  : "border-border/50 hover:border-primary/30 hover:bg-primary/[0.02]"
              )}
            >
              {active && <Check className="absolute right-3 top-3 h-4 w-4 text-primary" />}
              <div className="flex items-center gap-2 mb-1.5">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-[13px] font-semibold">{item.title}</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">{item.desc}</p>
              <div className="mt-2 space-y-1">
                {item.bullets.map((b) => (
                  <div key={b} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Check className="h-3 w-3 text-primary shrink-0" />
                    <span>{b}</span>
                  </div>
                ))}
              </div>
            </button>
          )
        })}
      </div>

      {/* Sync & limit */}
      <div className="rounded-xl border border-border/40 divide-y divide-border/30">
        <div className="flex items-center justify-between gap-4 px-4 py-2.5 cursor-pointer transition-colors hover:bg-muted/40 rounded-t-xl" onClick={() => onAutoSyncChange(!autoSync)}>
          <div>
            <div className="text-[13px] font-medium">Автосинхронизация</div>
            <div className="text-[11px] text-muted-foreground">Автоматически обновлять данные с WB</div>
          </div>
          <Switch checked={autoSync} onCheckedChange={onAutoSyncChange} />
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <Label htmlFor="draft-limit" className="text-[13px] font-medium">Лимит черновиков за цикл</Label>
            <p className="text-[11px] text-muted-foreground">0 = без лимита</p>
          </div>
          <Input
            id="draft-limit"
            type="number"
            min={0}
            max={5000}
            value={String(autoDraftLimitPerSync)}
            onChange={(e) => {
              const raw = Number(e.target.value)
              onAutoDraftLimitChange(Number.isFinite(raw) ? Math.max(0, Math.min(5000, Math.trunc(raw))) : 0)
            }}
            className="w-20 h-8 text-[13px]"
          />
        </div>
      </div>
    </div>
  )
}
