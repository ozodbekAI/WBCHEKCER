import { Badge } from "@/components/ui/badge"

import type { SaveStateMeta } from "@/components/modules/settings/settings-types"

type SettingsSectionStatusProps = {
  saveStateMeta: SaveStateMeta
  isLoading?: boolean
  error?: string | null
  overrideMeta?: SaveStateMeta | null
}

export function SettingsSectionStatus({
  saveStateMeta,
  isLoading = false,
  error = null,
  overrideMeta = null,
}: SettingsSectionStatusProps) {
  const meta = overrideMeta
    ? overrideMeta
    : error
      ? {
          badge: "Ошибка",
          tone: "border-destructive/30 bg-destructive/10 text-destructive",
          hint: error,
        }
      : isLoading
        ? {
            badge: "Загрузка…",
            tone: "border-border bg-muted/50 text-muted-foreground",
            hint: "Секция подготавливается.",
          }
        : saveStateMeta

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge className={meta.tone}>{meta.badge}</Badge>
      <span className="text-xs text-muted-foreground">{meta.hint}</span>
    </div>
  )
}
