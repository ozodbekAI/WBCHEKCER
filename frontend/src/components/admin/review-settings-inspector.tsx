import * as React from "react"

import { motion } from "framer-motion"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type {
  PromptDebugSettingGroup,
  PromptDebugSettingItem,
  PromptDebugSettingOption,
  PromptDebugStructuredValue,
} from "@/lib/api"

function isStructuredEntry(value: unknown): value is PromptDebugStructuredValue {
  return Boolean(value) && typeof value === "object"
}

function asStructuredList(value: unknown): PromptDebugStructuredValue[] {
  return Array.isArray(value) ? value.filter(isStructuredEntry) : []
}

function asTextList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []
}

function selectedPreview(item: PromptDebugSettingItem) {
  if (item.selected_label) return item.selected_label
  if (item.selected_summary) return item.selected_summary
  if (typeof item.selected === "boolean") return item.selected ? "Включено" : "Выключено"
  if (item.selected === null || item.selected === undefined || item.selected === "") return "Не настроено"
  return String(item.selected)
}

function ChoiceSet({ options, selected }: { options: PromptDebugSettingOption[]; selected: unknown }) {
  const selectedKey = selected === null ? "null" : String(selected)
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const activeKey = option.value === null ? "null" : String(option.value)
        const active = activeKey === selectedKey
        return (
          <div
            key={`${option.label}-${activeKey}`}
            className={cn(
              "rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
              active ? "border-foreground bg-foreground text-background" : "border-border/50 bg-muted/20 text-muted-foreground",
            )}
            title={option.description || option.label}
          >
            {option.label}
          </div>
        )
      })}
    </div>
  )
}

function StructuredList({ values, type }: { values: PromptDebugStructuredValue[]; type: PromptDebugSettingItem["kind"] }) {
  if (!values.length) return <div className="text-[12px] text-muted-foreground">Не настроено</div>

  if (type === "template_group") {
    return (
      <div className="grid gap-2 md:grid-cols-3">
        {values.map((v, i) => (
          <div key={`${v.key || "e"}-${i}`} className="rounded-md border border-border/50 bg-muted/10 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-foreground">{v.label || v.key || "Элемент"}</span>
              {v.value_label && <Badge variant="secondary" className="text-[9px] h-4">{v.value_label}</Badge>}
            </div>
            <div className="mt-1.5 whitespace-pre-wrap text-[11px] text-muted-foreground line-clamp-3">{v.value || "—"}</div>
          </div>
        ))}
      </div>
    )
  }

  if (type === "signature_list") {
    return (
      <div className="space-y-2">
        {values.map((v, i) => (
          <div key={`${v.text || "sig"}-${i}`} className="rounded-md border border-border/50 bg-muted/10 p-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="text-[9px] h-4">{!v.brand || v.brand === "all" ? "все бренды" : v.brand}</Badge>
              <Badge variant="outline" className="text-[9px] h-4">{v.type === "all" || !v.type ? "все типы" : v.type === "review" ? "отзывы" : String(v.type)}</Badge>
              {v.rating && <Badge variant="secondary" className="text-[9px] h-4">{v.rating}★</Badge>}
              <Badge variant={v.is_active ? "default" : "secondary"} className="text-[9px] h-4">{v.is_active ? "активно" : "выкл"}</Badge>
            </div>
            <div className="mt-1.5 whitespace-pre-wrap text-[12px] text-foreground">{v.text}</div>
          </div>
        ))}
      </div>
    )
  }

  if (type === "category_list") {
    return (
      <div className="space-y-2">
        {values.map((v, i) => (
          <div key={`${v.code || v.label || "cat"}-${i}`} className="rounded-md border border-border/50 bg-muted/10 p-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium text-foreground">{v.label || v.code || "Категория"}</span>
              {v.code && <Badge variant="outline" className="text-[9px] h-4">{v.code}</Badge>}
            </div>
            {v.positive_prompt && (
              <div className="mt-1.5">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Позитив: </span>
                <span className="text-[11px] text-muted-foreground">{v.positive_prompt}</span>
              </div>
            )}
            {v.negative_prompt && (
              <div className="mt-1">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Негатив: </span>
                <span className="text-[11px] text-muted-foreground">{v.negative_prompt}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  return null
}

function SettingCard({ item, className }: { item: PromptDebugSettingItem; className?: string }) {
  const structuredValues = asStructuredList(item.selected)
  const textValues = asTextList(item.selected)
  const showChoices = item.kind === "choice" || item.kind === "toggle"

  return (
    <div className={cn("rounded-lg border border-border/50 bg-card p-3", className)}>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-foreground">{item.label}</span>
          <span className="text-[12px] font-medium text-muted-foreground text-right truncate max-w-[50%]">{selectedPreview(item)}</span>
        </div>

        {showChoices && item.available_options.length ? <ChoiceSet options={item.available_options} selected={item.selected} /> : null}
        {item.kind === "text_list" && textValues.length ? (
          <div className="flex flex-wrap gap-1.5">
            {textValues.map((v) => <Badge key={v} variant="secondary" className="text-[10px]">{v}</Badge>)}
          </div>
        ) : null}
        {(item.kind === "template_group" || item.kind === "signature_list" || item.kind === "category_list") ? (
          <StructuredList values={structuredValues} type={item.kind} />
        ) : null}
        {item.resolved_effect && (
          <div className="rounded-md bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground">
            <span className="font-semibold uppercase tracking-wider text-[10px]">Эффект: </span>{item.resolved_effect}
          </div>
        )}
        {item.note && (
          <div className="rounded-md bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground">
            <span className="font-semibold uppercase tracking-wider text-[10px]">Заметка: </span>{item.note}
          </div>
        )}
      </div>
    </div>
  )
}

export default function ReviewSettingsInspector({
  groups,
  defaultOpenKeys,
}: {
  groups: PromptDebugSettingGroup[]
  defaultOpenKeys?: string[]
}) {
  const initialGroup = React.useMemo(() => {
    if (!groups.length) return null
    if (defaultOpenKeys?.length) {
      const matched = groups.find((g) => defaultOpenKeys.includes(g.key))
      if (matched) return matched.key
    }
    return groups[0]?.key || null
  }, [defaultOpenKeys, groups])

  const [activeGroupKey, setActiveGroupKey] = React.useState<string | null>(initialGroup)
  React.useEffect(() => { setActiveGroupKey(initialGroup) }, [initialGroup])

  const activeGroup = groups.find((g) => g.key === activeGroupKey) || groups[0] || null
  if (!groups.length || !activeGroup) return <div className="text-[12px] text-muted-foreground">Данные инспектора пока недоступны.</div>

  return (
    <div className="space-y-3">
      {/* Group tabs */}
      <div className="flex flex-wrap gap-1.5">
        {groups.map((g) => {
          const active = g.key === activeGroup.key
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => setActiveGroupKey(g.key)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-[12px] font-medium transition-all",
                active
                  ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/20"
                  : "border-border/50 bg-card text-muted-foreground hover:border-primary/30",
              )}
            >
              {g.label} <span className="ml-1 opacity-60">{g.items.length}</span>
            </button>
          )
        })}
      </div>

      {/* Active group content */}
      <motion.div
        key={activeGroup.key}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        className="grid gap-2 xl:grid-cols-2"
      >
        {activeGroup.items.map((item) => {
          const wide = item.kind === "template_group" || item.kind === "signature_list" || item.kind === "category_list" || item.kind === "text_list"
          return <SettingCard key={item.key} item={item} className={wide ? "xl:col-span-2" : undefined} />
        })}
      </motion.div>
    </div>
  )
}
