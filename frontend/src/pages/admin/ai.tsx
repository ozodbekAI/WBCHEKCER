import * as React from "react"

import ReviewSettingsInspector from "@/components/admin/review-settings-inspector"
import { AdminAccessDenied, AdminError } from "@/components/admin/admin-ui"
import ShopSelect from "@/components/admin/shop-select"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { StatusPill } from "@/components/shared/system-state"
import {
  adminGetAiProviders,
  adminGetPromptDebugContext,
  adminListShops,
  adminPromptDebugProbeStream,
  adminUpdateAiProviders,
  getMe,
  getPromptUiOptions,
  type AdminAiProviderOption,
  type PromptDebugContextOut,
  type PromptDebugProbeMode,
  type PromptDebugProbeOut,
  type PromptDebugProbeRun,
  type PromptDebugSettingGroup,
  type PromptDebugSettingItem,
  type PromptDebugStreamEvent,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  Bot,
  Check,
  ChevronRight,
  Eye,
  Globe,
  Layers3,
  Loader2,
  Lock,
  MessageSquareQuote,
  Microscope,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Split,
  Store,
  Zap,
} from "lucide-react"

/* ── helpers ── */

type MatrixMode = "store" | "matrix"
type UiOption = { value: string; label: string }

function optionLabel(value: string, options: UiOption[], fallback?: string) {
  return options.find((i) => i.value === value)?.label || fallback || value
}

function toggleValue<T>(value: T, setValue: React.Dispatch<React.SetStateAction<T[]>>) {
  setValue((prev) => (prev.includes(value) ? prev.filter((i) => i !== value) : [...prev, value]))
}

function findInspectorItem(groups: PromptDebugSettingGroup[], key: string) {
  return groups.flatMap((g) => g.items).find((i) => i.key === key) || null
}

function selectedPreview(item: PromptDebugSettingItem | null) {
  if (!item) return "—"
  if (item.selected_label) return item.selected_label
  if (item.selected_summary) return item.selected_summary
  if (typeof item.selected === "boolean") return item.selected ? "Вкл" : "Выкл"
  if (item.selected === null || item.selected === undefined || item.selected === "") return "—"
  return String(item.selected)
}

function runLabel(params: PromptDebugProbeRun["params"], t: UiOption[], a: UiOption[], l: UiOption[]) {
  const tone = params.tone === "__store__" ? "Магазин" : optionLabel(params.tone, t, params.tone)
  return [tone, optionLabel(params.address_format, a), optionLabel(params.answer_length, l), params.emoji_enabled ? "😊" : "—"].join(" · ")
}

function combinationSummary(tones: string[], addr: string[], lengths: string[], emoji: boolean[]) {
  return tones.length * addr.length * lengths.length * emoji.length
}

const PROBE_MODE_META: Record<PromptDebugProbeMode, { label: string; desc: string; icon: React.ReactNode }> = {
  global_only: { label: "Глобальный промпт", desc: "Тестировать только базовый системный промпт без настроек магазина", icon: <Globe className="h-4 w-4" /> },
  shop_effective: { label: "Промпт магазина", desc: "Тестировать итоговый промпт с учётом всех настроек магазина", icon: <Store className="h-4 w-4" /> },
  compare: { label: "Сравнение", desc: "Запустить оба варианта и показать результаты бок о бок", icon: <Split className="h-4 w-4" /> },
}

/* ── micro components ── */

function Kpi({ label, value, sub, icon, accent }: { label: string; value: React.ReactNode; sub?: string; icon?: React.ReactNode; accent?: boolean }) {
  return (
    <div className={cn(
      "flex items-center gap-3 rounded-lg border px-3.5 py-2.5",
      accent ? "border-primary/20 bg-primary/[0.03]" : "border-border/50 bg-card"
    )}>
      {icon && <div className={cn("flex h-8 w-8 items-center justify-center rounded-md shrink-0", accent ? "bg-primary/10 text-primary" : "bg-muted/50 text-muted-foreground")}>{icon}</div>}
      <div className="min-w-0">
        <div className={cn("text-lg font-bold leading-tight tabular-nums", accent ? "text-primary" : "text-foreground")}>{value}</div>
        <div className="text-[10px] text-muted-foreground truncate">{label}{sub ? ` · ${sub}` : ""}</div>
      </div>
    </div>
  )
}

function SectionCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border border-border/50 bg-card overflow-hidden", className)}>{children}</div>
}

function SectionHeader({ title, sub, icon, actions }: { title: string; sub?: string; icon?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-muted/20 border-b border-border/30">
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className="text-muted-foreground/60 shrink-0">{icon}</span>}
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
          {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

function ProviderCard({ option, selected, onClick }: { option: AdminAiProviderOption; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!option.configured}
      className={cn(
        "relative rounded-lg border px-4 py-3 text-left transition-all w-full",
        selected ? "border-primary bg-primary/[0.06] ring-1 ring-primary/30" : "border-border/50 bg-card hover:border-primary/30",
        !option.configured && "cursor-not-allowed opacity-40",
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold shrink-0", selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
          {option.label.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn("text-sm font-semibold truncate", selected ? "text-primary" : "text-foreground")}>{option.label}</div>
          <div className="text-[11px] text-muted-foreground truncate">{option.model}</div>
        </div>
        {selected && <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shrink-0"><Check className="h-3 w-3" /></div>}
        {!selected && option.configured && <Badge variant="outline" className="text-[9px] shrink-0">Готов</Badge>}
      </div>
    </button>
  )
}

function ChoiceChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("rounded-full border px-3 py-1 text-[11px] font-medium transition-colors", active ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-muted-foreground hover:border-primary/30")}>{children}</button>
  )
}

function ConfigRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground text-right truncate max-w-[60%]">{value}</span>
    </div>
  )
}

function ProbeModeCard({ mode, selected, onClick }: { mode: PromptDebugProbeMode; selected: boolean; onClick: () => void }) {
  const meta = PROBE_MODE_META[mode]
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4 text-left transition-all w-full",
        selected ? "border-primary bg-primary/[0.04] ring-1 ring-primary/25" : "border-border/50 bg-card hover:border-primary/20"
      )}
    >
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", selected ? "bg-primary/10 text-primary" : "bg-muted/50 text-muted-foreground")}>
        {meta.icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn("text-[13px] font-semibold", selected ? "text-primary" : "text-foreground")}>{meta.label}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{meta.desc}</div>
      </div>
      {selected && <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground mt-0.5"><Check className="h-3 w-3" /></div>}
    </button>
  )
}

function ContextSourceBadge({ source }: { source?: string | null }) {
  if (!source) return null
  const isGlobal = source === "global" || source === "global_only"
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/30 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
      {isGlobal ? <Globe className="h-3 w-3" /> : <Store className="h-3 w-3" />}
      {isGlobal ? "Глобальный контекст" : "Контекст магазина"}
    </div>
  )
}

/* ═══════════ MAIN ═══════════ */

export default function AiAdminPage() {
  const [allowed, setAllowed] = React.useState<boolean | null>(null)
  const [isWriteAdmin, setIsWriteAdmin] = React.useState(true)
  const [shopId, setShopId] = React.useState<number | null>(null)
  const [context, setContext] = React.useState<PromptDebugContextOut | null>(null)
  const [probeMode, setProbeMode] = React.useState<PromptDebugProbeMode>("shop_effective")
  const [matrixMode, setMatrixMode] = React.useState<MatrixMode>("store")
  const [providerOptions, setProviderOptions] = React.useState<AdminAiProviderOption[]>([])
  const [primaryProvider, setPrimaryProvider] = React.useState<"openai" | "gemini" | null>(null)
  const [savingProvider, setSavingProvider] = React.useState(false)
  const [loadingContext, setLoadingContext] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [probe, setProbe] = React.useState<PromptDebugProbeOut | null>(null)
  const [produced, setProduced] = React.useState(0)
  const [expected, setExpected] = React.useState(0)
  const [runFilter, setRunFilter] = React.useState("")
  const [activeRunId, setActiveRunId] = React.useState<number | null>(null)
  const [activeResultIdx, setActiveResultIdx] = React.useState(0)
  const [toneOptions, setToneOptions] = React.useState<UiOption[]>([])
  const [addressOptions, setAddressOptions] = React.useState<UiOption[]>([])
  const [lengthOptions, setLengthOptions] = React.useState<UiOption[]>([])
  const [selectedTones, setSelectedTones] = React.useState<string[]>([])
  const [selectedAddresses, setSelectedAddresses] = React.useState<string[]>([])
  const [selectedLengths, setSelectedLengths] = React.useState<string[]>([])
  const [selectedEmojiModes, setSelectedEmojiModes] = React.useState<boolean[]>([false, true])
  const [customReviews, setCustomReviews] = React.useState<Record<string, string>>({ "1": "", "2": "", "3": "", "4": "", "5": "" })
  const [useCustomReviews, setUseCustomReviews] = React.useState(true)
  
  const abortRef = React.useRef<AbortController | null>(null)

  /* ── data loading ── */

  const loadContext = React.useCallback(async (id: number, mode?: PromptDebugProbeMode) => {
    setLoadingContext(true)
    setError(null)
    try {
      setContext(await adminGetPromptDebugContext(id, mode))
    } catch (e: any) {
      setContext(null)
      setError(e?.message || "Не удалось загрузить конфигурацию")
    } finally {
      setLoadingContext(false)
    }
  }, [])

  React.useEffect(() => {
    let m = true
    ;(async () => {
      try {
        const me = await getMe()
        if (!m) return
        const ok = me?.role === "super_admin" || me?.role === "admin"
        setAllowed(ok)
        setIsWriteAdmin(me?.role === "super_admin")
        if (!ok) return
        const [shops, ui, prov] = await Promise.all([adminListShops(), getPromptUiOptions(), adminGetAiProviders()])
        if (!m) return
        setShopId((p) => p ?? (Array.isArray(shops) && shops.length ? Number(shops[0].id) : null))
        setProviderOptions(Array.isArray(prov?.available) ? prov.available : [])
        setPrimaryProvider((prov?.primary_provider as any) || null)
        const t = (ui?.tone_options || []).map((i: any) => ({ value: String(i.value), label: String(i.label || i.value) }))
        const a = (ui?.address_format_options || []).map((i: any) => ({ value: String(i.value), label: String(i.label || i.value) }))
        const l = (ui?.answer_length_options || []).map((i: any) => ({ value: String(i.value), label: String(i.label || i.value) }))
        setToneOptions(t); setAddressOptions(a); setLengthOptions(l)
        setSelectedTones(t.map((i: UiOption) => i.value)); setSelectedAddresses(a.map((i: UiOption) => i.value)); setSelectedLengths(l.map((i: UiOption) => i.value))
      } catch (e: any) {
        if (!m) return
        setAllowed(false)
        setError(e?.message || "Не удалось загрузить панель ИИ")
      }
    })()
    return () => { m = false }
  }, [])

  React.useEffect(() => { if (shopId && allowed) void loadContext(shopId, probeMode) }, [allowed, loadContext, shopId, probeMode])
  React.useEffect(() => () => { abortRef.current?.abort() }, [])

  /* ── probe logic ── */

  const stopProbe = React.useCallback(() => { abortRef.current?.abort(); abortRef.current = null; setLoading(false) }, [])

  const runProbe = async () => {
    if (!shopId || loading || !isWriteAdmin) return
    setLoading(true); setError(null); setProbe(null); setProduced(0); setExpected(0); setRunFilter(""); setActiveRunId(null); setActiveResultIdx(0)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const cr = Object.fromEntries(Object.entries(customReviews).filter(([, v]) => String(v || "").trim().length > 0))
      await adminPromptDebugProbeStream(
        {
          shop_id: shopId, provider: "auto",
          probe_mode: probeMode,
          match_store_draft: matrixMode === "store",
          tones: matrixMode === "matrix" ? selectedTones : undefined,
          emoji_modes: matrixMode === "matrix" ? selectedEmojiModes : undefined,
          address_formats: matrixMode === "matrix" ? selectedAddresses : undefined,
          answer_lengths: matrixMode === "matrix" ? selectedLengths : undefined,
          per_rating: 1, max_combinations: 2000,
          custom_reviews: useCustomReviews ? cr : undefined,
        },
        (ev: PromptDebugStreamEvent) => {
          if (ev.type === "meta") {
            setProbe({ shop_id: ev.shop_id, shop_name: ev.shop_name, samples_total: ev.samples_total, missing_ratings: ev.missing_ratings, combination_count: ev.combination_count, combinations_truncated: ev.combinations_truncated, mode: ev.mode, probe_mode: ev.probe_mode, context_source: ev.context_source, runtime: ev.runtime, shop_settings: ev.shop_settings, items: [] } as PromptDebugProbeOut)
            setExpected(Number(ev.samples_total || 0) * Number(ev.combination_count || 0))
          } else if (ev.type === "run_start") {
            setProbe((p) => { if (!p || p.items.some((i) => i.run_id === ev.run_id)) return p; return { ...p, items: [...p.items, { run_id: ev.run_id, params: ev.params, compare_group: (ev as any).compare_group ?? null, execution_source: (ev as any).execution_source ?? "", results: [] }] } })
            setActiveRunId((p) => p ?? ev.run_id)
          } else if (ev.type === "result") {
            setProduced(ev.produced || 0)
            setProbe((p) => { if (!p) return p; const idx = p.items.findIndex((i) => i.run_id === ev.run_id); if (idx === -1) return { ...p, items: [...p.items, { run_id: ev.run_id, params: ev.params, compare_group: (ev as any).compare_group ?? null, execution_source: (ev as any).execution_source ?? "", results: [ev.result] }] }; const next = p.items.slice(); next[idx] = { ...next[idx], results: [...next[idx].results, ev.result] }; return { ...p, items: next } })
          } else if (ev.type === "done") { setProduced(ev.produced || 0) }
          else if (ev.type === "error") { setError(ev.message || "Ошибка") }
        },
        { signal: ctrl.signal },
      )
    } catch (e: any) { if (!ctrl.signal.aborted) setError(e?.message || "Ошибка теста") }
    finally { abortRef.current = null; setLoading(false) }
  }

  const savePrimaryProvider = async () => {
    if (!primaryProvider) return
    try { setSavingProvider(true); setError(null); await adminUpdateAiProviders({ primary_provider: primaryProvider }); if (shopId) await loadContext(shopId, probeMode) }
    catch (e: any) { setError(e?.message || "Не удалось сохранить провайдер") }
    finally { setSavingProvider(false) }
  }

  /* ── derived ── */

  const rt = probe?.runtime || context?.runtime || null
  const es = probe?.shop_settings || context?.shop_settings || null
  const ig = es?.review_settings?.groups || []
  const runs = probe?.items || []
  const filteredRuns = runs.filter((i) => !runFilter.trim() || runLabel(i.params, toneOptions, addressOptions, lengthOptions).toLowerCase().includes(runFilter.toLowerCase()))
  const activeRun = filteredRuns.find((i) => i.run_id === activeRunId) || runs.find((i) => i.run_id === activeRunId) || filteredRuns[0] || runs[0] || null
  const activeResult = activeRun?.results[activeResultIdx] || activeRun?.results[0] || null
  const matrixCount = combinationSummary(selectedTones, selectedAddresses, selectedLengths, selectedEmojiModes)
  const canRun = matrixMode === "store" || matrixCount > 0
  const contextSource = probe?.context_source || context?.context_source || null

  // Compare mode: group runs by compare_group
  const isCompare = probeMode === "compare"
  const compareGroups = React.useMemo(() => {
    if (!isCompare || !runs.length) return null
    const groups: Record<number, PromptDebugProbeRun[]> = {}
    for (const run of runs) {
      const g = run.compare_group ?? 0
      if (!groups[g]) groups[g] = []
      groups[g].push(run)
    }
    return groups
  }, [isCompare, runs])

  const si = React.useMemo(() => {
    const keys = ["address_format", "answer_length", "emoji_enabled", "use_buyer_name", "mention_product_name", "delivery_method", "tone_positive", "tone_negative"]
    return Object.fromEntries(keys.map((k) => [k, findInspectorItem(ig, k)])) as Record<string, PromptDebugSettingItem | null>
  }, [ig])

  React.useEffect(() => {
    if (!activeRun) { if (activeRunId !== null) setActiveRunId(null); if (activeResultIdx !== 0) setActiveResultIdx(0); return }
    if (activeRun.run_id !== activeRunId) { setActiveRunId(activeRun.run_id); setActiveResultIdx(0); return }
    if (activeRun.results.length && activeResultIdx >= activeRun.results.length) setActiveResultIdx(0)
  }, [activeResultIdx, activeRun, activeRunId])

  if (allowed === false) return <AdminAccessDenied description="Лаборатория ИИ доступна только администраторам." />

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-foreground">Лаборатория ИИ</h1>
          <p className="text-[12px] text-muted-foreground">Тестирование промптов, инспекция контекста и генерация ответов</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {contextSource && <ContextSourceBadge source={contextSource} />}
          <Button variant="outline" size="sm" onClick={() => shopId && loadContext(shopId, probeMode)} disabled={!shopId || loadingContext || loading} className="h-8 gap-1.5 text-[12px]">
            <Eye className="h-3.5 w-3.5" /> Инспекция
          </Button>
          {loading ? (
            <Button variant="destructive" size="sm" onClick={stopProbe} className="h-8 gap-1.5 text-[12px]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Остановить
            </Button>
          ) : isWriteAdmin ? (
            <Button size="sm" onClick={runProbe} disabled={!shopId || loadingContext || !canRun} className="h-8 gap-1.5 text-[12px] bg-gradient-to-r from-primary to-primary/80 shadow-sm">
              <Zap className="h-3.5 w-3.5" /> Запустить тест
            </Button>
          ) : (
            <div className="flex items-center gap-1.5 rounded-lg border border-border/40 bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
              <Lock className="h-3 w-3" /> Запуск теста недоступен
            </div>
          )}
        </div>
      </div>

      {/* Read-only notice */}
      {!isWriteAdmin && (
        <div className="flex items-center gap-3 rounded-xl border border-warning/20 bg-[hsl(var(--warning-soft))]/30 px-4 py-3">
          <Lock className="h-4 w-4 text-warning shrink-0" />
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-foreground">Режим только для чтения</p>
            <p className="text-[11px] text-muted-foreground">Вы можете инспектировать контекст и настройки, но запуск платных тестов доступен только write-администраторам.</p>
          </div>
          <StatusPill status="disabled" label="Read-only" size="xs" />
        </div>
      )}

      <AdminError message={error} />

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-5">
        <Kpi label="Провайдер" value={rt?.provider?.toUpperCase() || "—"} sub={rt?.model || undefined} accent icon={<Bot className="h-4 w-4" />} />
        <Kpi label="Сценарий" value={selectedPreview(findInspectorItem(ig, "reply_mode"))} icon={<Settings2 className="h-4 w-4" />} />
        <Kpi label="Категории" value={es?.review_categories?.length ?? 0} sub={es?.review_categories?.length ? "активны" : undefined} icon={<Layers3 className="h-4 w-4" />} />
        <Kpi label="Тест" value={probe ? `${produced}/${expected || produced}` : "—"} icon={<Microscope className="h-4 w-4" />} />
        <Kpi label="Режим" value={PROBE_MODE_META[probeMode].label} sub={matrixMode === "matrix" ? `${matrixCount} комб.` : "1 запуск"} icon={PROBE_MODE_META[probeMode].icon} />
      </div>

      {/* ── Probe Mode Selector ── */}
      <SectionCard>
        <SectionHeader title="Режим тестирования" sub="Определяет какой промпт используется при генерации" icon={<Split className="h-3.5 w-3.5" />} />
        <div className="p-4">
          <div className="grid gap-3 xl:grid-cols-3">
            {(["global_only", "shop_effective", "compare"] as PromptDebugProbeMode[]).map((mode) => (
              <ProbeModeCard key={mode} mode={mode} selected={probeMode === mode} onClick={() => setProbeMode(mode)} />
            ))}
          </div>
        </div>
      </SectionCard>

      {/* ── Setup: Shop + Matrix Mode + Providers ── */}
      <SectionCard>
        <SectionHeader title="Сценарий теста" sub="Магазин, параметры и провайдер" icon={<Settings2 className="h-3.5 w-3.5" />} />
        <div className="p-4 space-y-3">
          <div className="grid gap-3 grid-cols-[1fr_auto]">
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Магазин</Label>
              <ShopSelect value={shopId} onChange={setShopId} allowAll={false} placeholder="Выберите магазин" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Варианты</Label>
              <Tabs value={matrixMode} onValueChange={(v) => setMatrixMode(v as MatrixMode)}>
                <TabsList className="h-9">
                  <TabsTrigger value="store" className="text-[12px] px-5">Один запуск</TabsTrigger>
                  <TabsTrigger value="matrix" className="text-[12px] px-5">Матрица</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>

          {/* Provider cards */}
          <div className="space-y-1">
            <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Провайдер</Label>
            <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
              {providerOptions.map((o) => (
                <ProviderCard key={o.key} option={o} selected={primaryProvider === o.key} onClick={() => setPrimaryProvider(o.key)} />
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/20">
            <div className="text-[12px] text-muted-foreground">
              Текущий: <span className="font-semibold text-foreground">{(rt?.provider || primaryProvider || "—").toUpperCase()}</span>
              {rt?.model && <span className="ml-1.5 text-muted-foreground/70">({rt.model})</span>}
            </div>
            <Button size="sm" onClick={savePrimaryProvider} disabled={!primaryProvider || savingProvider || !isWriteAdmin} className="h-8 text-[12px] px-4">
              {savingProvider ? <><Loader2 className="h-3 w-3 animate-spin mr-1.5" />Сохранение...</> : "Сохранить провайдер"}
            </Button>
          </div>
        </div>
      </SectionCard>

      {/* ── Matrix params ── */}
      {matrixMode === "matrix" && (
        <SectionCard>
          <SectionHeader title="Параметры матрицы" sub={`${matrixCount} комбинаций`} icon={<Layers3 className="h-3.5 w-3.5" />} />
          <div className="p-4 grid gap-4 grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Тональности</Label>
              <div className="flex flex-wrap gap-1">{toneOptions.map((i) => <ChoiceChip key={i.value} active={selectedTones.includes(i.value)} onClick={() => toggleValue(i.value, setSelectedTones)}>{i.label}</ChoiceChip>)}</div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Обращение</Label>
              <div className="flex flex-wrap gap-1">{addressOptions.map((i) => <ChoiceChip key={i.value} active={selectedAddresses.includes(i.value)} onClick={() => toggleValue(i.value, setSelectedAddresses)}>{i.label}</ChoiceChip>)}</div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Длина ответа</Label>
              <div className="flex flex-wrap gap-1">{lengthOptions.map((i) => <ChoiceChip key={i.value} active={selectedLengths.includes(i.value)} onClick={() => toggleValue(i.value, setSelectedLengths)}>{i.label}</ChoiceChip>)}</div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Эмодзи</Label>
              <div className="flex flex-wrap gap-1">
                {[true, false].map((v) => <ChoiceChip key={String(v)} active={selectedEmojiModes.includes(v)} onClick={() => toggleValue(v, setSelectedEmojiModes)}>{v ? "Вкл" : "Выкл"}</ChoiceChip>)}
              </div>
            </div>
          </div>
        </SectionCard>
      )}

      {/* ── Context Inspection: 3-col layout ── */}
      <div className="grid gap-3 xl:grid-cols-3">
        <SectionCard>
          <SectionHeader title="Активная конфигурация" icon={<Bot className="h-3.5 w-3.5" />} actions={contextSource && <ContextSourceBadge source={contextSource} />} />
          <div className="p-4">
            {!shopId ? (
              <div className="flex flex-col items-center py-6 text-center">
                <Bot className="h-5 w-5 text-muted-foreground/30 mb-1.5" />
                <p className="text-[12px] text-muted-foreground">Выберите магазин</p>
              </div>
            ) : loadingContext && !rt ? (
              <div className="flex items-center gap-2 py-6 justify-center text-[12px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка...
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-lg shrink-0">
                    {(rt?.provider || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-base font-bold text-foreground">{(rt?.provider || "—").toUpperCase()}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{rt?.model || "Не выбран"}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md bg-muted/30 px-2.5 py-2 text-center">
                    <div className="text-lg font-bold text-foreground">{es?.review_categories?.length ?? 0}</div>
                    <div className="text-[10px] text-muted-foreground">Категории</div>
                  </div>
                  <div className="rounded-md bg-muted/30 px-2.5 py-2 text-center">
                    <div className="text-lg font-bold text-foreground">{Object.values(es?.templates || {}).filter((v) => String(v || "").trim()).length}</div>
                    <div className="text-[10px] text-muted-foreground">Шаблоны</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard>
          <SectionHeader title="Стиль ответа" icon={<MessageSquareQuote className="h-3.5 w-3.5" />} />
          <div className="px-4 py-2 divide-y divide-border/20">
            <ConfigRow label="Обращение" value={selectedPreview(si.address_format)} />
            <ConfigRow label="Длина" value={selectedPreview(si.answer_length)} />
            <ConfigRow label="Эмодзи" value={selectedPreview(si.emoji_enabled)} />
            <ConfigRow label="Имя покупателя" value={selectedPreview(si.use_buyer_name)} />
            <ConfigRow label="Товар" value={selectedPreview(si.mention_product_name)} />
            <ConfigRow label="Позитив" value={selectedPreview(si.tone_positive)} />
          </div>
        </SectionCard>

        <SectionCard>
          <SectionHeader title="Логика генерации" icon={<ShieldCheck className="h-3.5 w-3.5" />} />
          <div className="px-4 py-2 divide-y divide-border/20">
            <ConfigRow label="Негатив" value={selectedPreview(si.tone_negative)} />
            <ConfigRow label="Доставка" value={selectedPreview(si.delivery_method)} />
            <ConfigRow label="Подпись" value={es?.signatures_count ? `${es.signatures_count} активн.` : "Нет"} />
            <ConfigRow label="Стоп-слова" value={Array.isArray(es?.advanced?.stop_words) && es.advanced.stop_words.length ? "Есть" : "Нет"} />
          </div>
        </SectionCard>
      </div>

      {/* ── Settings inspector (collapsible) ── */}
      <Accordion type="single" collapsible className="rounded-xl border border-border/50 bg-card overflow-hidden">
        <AccordionItem value="inspector" className="border-none">
          <AccordionTrigger className="px-4 py-2.5 text-[13px] font-semibold hover:no-underline bg-muted/20">
            <div className="flex items-center gap-2">
              <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
              Карта настроек
              {ig.length > 0 && <Badge variant="secondary" className="text-[9px] h-4 ml-1">{ig.length} групп</Badge>}
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            {!ig.length ? (
              <p className="text-[12px] text-muted-foreground py-3 text-center">Выберите магазин для загрузки настроек</p>
            ) : (
              <ReviewSettingsInspector groups={ig} defaultOpenKeys={["workflow", "prompt_assets", "personalization"]} />
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* ── Custom reviews (collapsible) ── */}
      <Accordion type="single" collapsible className="rounded-xl border border-border/50 bg-card overflow-hidden">
        <AccordionItem value="custom" className="border-none">
          <AccordionTrigger className="px-4 py-2.5 text-[13px] font-semibold hover:no-underline bg-muted/20">
            <div className="flex items-center gap-2">
              Свои примеры отзывов
              <Badge variant={useCustomReviews ? "default" : "secondary"} className="text-[9px] h-4 ml-1">{useCustomReviews ? "Вкл" : "Выкл"}</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-[11px] text-muted-foreground">Пустые поля заменяются отзывами из базы</p>
              <Button variant={useCustomReviews ? "default" : "outline"} size="sm" onClick={() => setUseCustomReviews((p) => !p)} className="h-7 text-[11px] px-3">
                {useCustomReviews ? "Включено" : "Выключено"}
              </Button>
            </div>
            <div className="grid gap-2 grid-cols-5">
              {[1, 2, 3, 4, 5].map((r) => (
                <div key={r} className="space-y-1">
                  <Label className="text-[11px] font-semibold text-muted-foreground">★ {r}</Label>
                  <Textarea value={customReviews[String(r)]} disabled={!useCustomReviews} onChange={(e) => setCustomReviews((p) => ({ ...p, [String(r)]: e.target.value }))} className="min-h-[72px] text-[12px] resize-none" placeholder="Авто" />
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* ── Test Results ── */}
      <SectionCard>
        <SectionHeader
          title="Результаты теста"
          sub={probe ? `${probe.combination_count} запусков · ${produced} готово` : "Запустите тест"}
          icon={<Microscope className="h-3.5 w-3.5" />}
          actions={probe && (
            <div className="flex items-center gap-1.5">
              {probe.probe_mode && <Badge variant="outline" className="text-[10px]">{PROBE_MODE_META[probe.probe_mode]?.label || probe.probe_mode}</Badge>}
              <Badge variant="outline" className="text-[10px]">{probe.mode === "matrix" ? "матрица" : "магазин"}</Badge>
              {probe.context_source && <ContextSourceBadge source={probe.context_source} />}
              {probe.missing_ratings?.length ? <Badge variant="secondary" className="text-[10px]">Нет: {probe.missing_ratings.join(",")}</Badge> : null}
            </div>
          )}
        />

        {/* Progress bar */}
        {loading && expected > 0 && (
          <div className="px-4 pt-3">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
              <span>Генерация ответов...</span>
              <span className="tabular-nums">{produced} / {expected}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted/40 overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${Math.min(100, (produced / expected) * 100)}%` }} />
            </div>
          </div>
        )}

        <div className="p-4">
          {!probe && !loading ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/30 mb-3">
                <Microscope className="h-5 w-5 text-muted-foreground/30" />
              </div>
              <p className="text-[13px] font-medium text-foreground">Тест ещё не запускался</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {isWriteAdmin ? "Выберите режим и нажмите «Запустить тест» — это платная операция" : "Инспектируйте контекст. Запуск доступен write-администраторам"}
              </p>
            </div>
          ) : isCompare && compareGroups ? (
            /* ── Compare side-by-side view ── */
            <div className="space-y-4">
              {Object.entries(compareGroups).map(([groupKey, groupRuns]) => (
                <div key={groupKey} className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Группа сравнения #{groupKey}
                  </div>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {groupRuns.map((run) => (
                      <div key={run.run_id} className="rounded-xl border border-border/40 overflow-hidden">
                        <div className="flex items-center gap-2 bg-muted/20 border-b border-border/20 px-3 py-2">
                          <ContextSourceBadge source={run.execution_source} />
                          <span className="text-[11px] font-medium text-foreground">#{run.run_id}</span>
                          <Badge variant="secondary" className="text-[9px] ml-auto">{run.results.length} результ.</Badge>
                        </div>
                        <div className="p-3 space-y-2">
                          {run.results.map((result, ri) => (
                            <div key={ri} className="space-y-2">
                              <div className="grid grid-cols-2 gap-2">
                                <div className="rounded-lg border border-border/30 p-2.5">
                                  <div className="text-[9px] font-semibold uppercase text-muted-foreground mb-1">Отзыв · ★{result.rating}</div>
                                  <div className="text-[11px] text-foreground leading-relaxed line-clamp-4">{result.feedback_text || "—"}</div>
                                </div>
                                <div className="rounded-lg border border-border/30 p-2.5">
                                  <div className="text-[9px] font-semibold uppercase text-muted-foreground mb-1">Ответ</div>
                                  {result.manual_attention ? (
                                    <div className="rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1 text-[10px] text-destructive">Нужен ручной ответ</div>
                                  ) : (
                                    <div className="text-[11px] text-foreground leading-relaxed line-clamp-4">{result.reply_text || "—"}</div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                                <span>Модель: <span className="font-medium text-foreground">{result.model}</span></span>
                                <span className="tabular-nums">P: {result.prompt_tokens} · C: {result.completion_tokens}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* ── Standard results view ── */
            <div className="grid gap-3 xl:grid-cols-[260px_1fr]">
              {/* Run list */}
              <div className="space-y-1.5">
                {runs.length > 1 && (
                  <Input value={runFilter} onChange={(e) => setRunFilter(e.target.value)} placeholder="Поиск…" className="h-7 text-[11px]" />
                )}
                <div className="space-y-1 max-h-[420px] overflow-y-auto pr-0.5">
                  {filteredRuns.map((run) => (
                    <button
                      key={run.run_id}
                      type="button"
                      onClick={() => { setActiveRunId(run.run_id); setActiveResultIdx(0) }}
                      className={cn(
                        "w-full rounded-lg border px-3 py-2 text-left transition-all text-[11px]",
                        activeRun?.run_id === run.run_id ? "border-primary bg-primary/[0.06] ring-1 ring-primary/20" : "border-border/40 hover:border-primary/30",
                      )}
                    >
                      <div className="font-medium text-foreground leading-tight truncate">{runLabel(run.params, toneOptions, addressOptions, lengthOptions)}</div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-muted-foreground">#{run.run_id}</span>
                        <div className="flex items-center gap-1">
                          {run.execution_source && <ContextSourceBadge source={run.execution_source} />}
                          <Badge variant="secondary" className="text-[9px] h-3.5">{run.results.length}</Badge>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Result detail */}
              <div>
                {!activeRun || !activeResult ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <ChevronRight className="h-5 w-5 text-muted-foreground/20 mb-1.5" />
                    <p className="text-[12px] text-muted-foreground">Выберите запуск</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Run params */}
                    <div className="grid grid-cols-4 gap-2">
                      <div className="rounded-md bg-muted/30 px-2.5 py-1.5">
                        <div className="text-[9px] text-muted-foreground">Тональность</div>
                        <div className="text-[12px] font-medium text-foreground truncate">{activeRun.params.tone === "__store__" ? "Магазин" : optionLabel(activeRun.params.tone, toneOptions)}</div>
                      </div>
                      <div className="rounded-md bg-muted/30 px-2.5 py-1.5">
                        <div className="text-[9px] text-muted-foreground">Обращение</div>
                        <div className="text-[12px] font-medium text-foreground truncate">{optionLabel(activeRun.params.address_format, addressOptions)}</div>
                      </div>
                      <div className="rounded-md bg-muted/30 px-2.5 py-1.5">
                        <div className="text-[9px] text-muted-foreground">Длина</div>
                        <div className="text-[12px] font-medium text-foreground truncate">{optionLabel(activeRun.params.answer_length, lengthOptions)}</div>
                      </div>
                      <div className="rounded-md bg-muted/30 px-2.5 py-1.5">
                        <div className="text-[9px] text-muted-foreground">Эмодзи</div>
                        <div className="text-[12px] font-medium text-foreground">{activeRun.params.emoji_enabled ? "Вкл" : "Выкл"}</div>
                      </div>
                    </div>

                    {/* Rating tabs */}
                    {activeRun.results.length > 1 && (
                      <div className="flex flex-wrap gap-1">
                        {activeRun.results.map((r, i) => (
                          <Button key={`${r.wb_id}-${i}`} variant={activeResultIdx === i ? "default" : "outline"} size="sm" onClick={() => setActiveResultIdx(i)} className="h-6 text-[10px] px-2">
                            ★ {r.rating}
                          </Button>
                        ))}
                      </div>
                    )}

                    {/* Review + Reply */}
                    <div className="grid gap-2 xl:grid-cols-2">
                      <div className="rounded-lg border border-border/40 p-3">
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                          <Bot className="h-3 w-3" /> Отзыв · ★{activeResult.rating}
                        </div>
                        <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground">{activeResult.feedback_text || "Текст отсутствует"}</div>
                      </div>
                      <div className="rounded-lg border border-border/40 p-3">
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                          <Sparkles className="h-3 w-3" /> Ответ
                          {activeResult.execution_source && <ContextSourceBadge source={activeResult.execution_source} />}
                        </div>
                        {activeResult.manual_attention ? (
                          <div className="rounded-md border border-destructive/20 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive">
                            Нужен ручной ответ.{typeof activeResult.need_reply_score === "number" ? ` Оценка: ${activeResult.need_reply_score}%` : ""}
                          </div>
                        ) : (
                          <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground">{activeResult.reply_text}</div>
                        )}
                      </div>
                    </div>

                    {/* Token stats */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-md bg-muted/30 px-2.5 py-1.5">
                        <div className="text-[9px] text-muted-foreground">Модель</div>
                        <div className="text-[11px] font-medium text-foreground truncate">{activeResult.model}</div>
                      </div>
                      <div className="rounded-md bg-muted/30 px-2.5 py-1.5">
                        <div className="text-[9px] text-muted-foreground">Промпт</div>
                        <div className="text-[11px] font-medium text-foreground">{activeResult.prompt_tokens}</div>
                      </div>
                      <div className="rounded-md bg-muted/30 px-2.5 py-1.5">
                        <div className="text-[9px] text-muted-foreground">Ответ</div>
                        <div className="text-[11px] font-medium text-foreground">{activeResult.completion_tokens}</div>
                      </div>
                    </div>

                    {/* Debug accordion */}
                    <Accordion type="multiple" className="rounded-lg border border-border/40 overflow-hidden">
                      {activeResult.debug_report?.instructions && (
                        <AccordionItem value="instructions" className="border-border/30">
                          <AccordionTrigger className="px-3 py-2 text-[11px] hover:no-underline">Инструкции</AccordionTrigger>
                          <AccordionContent className="px-3 pb-2">
                            <Textarea value={activeResult.debug_report.instructions} readOnly className="min-h-[160px] text-[11px]" />
                          </AccordionContent>
                        </AccordionItem>
                      )}
                      {activeResult.debug_report?.input_text && (
                        <AccordionItem value="input" className="border-border/30">
                          <AccordionTrigger className="px-3 py-2 text-[11px] hover:no-underline">Входной текст</AccordionTrigger>
                          <AccordionContent className="px-3 pb-2">
                            <Textarea value={activeResult.debug_report.input_text} readOnly className="min-h-[120px] text-[11px]" />
                          </AccordionContent>
                        </AccordionItem>
                      )}
                    </Accordion>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  )
}
