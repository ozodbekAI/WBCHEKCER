import { useCallback, useState } from "react"
import {
  BarChart2,
  BrainCircuit,
  CheckCircle2,
  Coins,
  FileSearch,
  Loader2,
  Sparkles,
  XCircle,
  Zap,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  type AnalyticsPreviewResponse,
  type ReviewAnalyticsPeriod,
  enableAnalyticsClassification,
  previewAnalyticsClassification,
} from "@/lib/api"
import { getErrorMessage } from "@/lib/error-message"
import { cn } from "@/lib/utils"
import { Progress } from "@/components/ui/progress"

const PERIOD_OPTIONS: { value: ReviewAnalyticsPeriod; label: string; desc: string }[] = [
  { value: "7d", label: "7 дней", desc: "Последняя неделя" },
  { value: "30d", label: "30 дней", desc: "Последний месяц" },
  { value: "90d", label: "90 дней", desc: "Последний квартал" },
  { value: "all", label: "Все", desc: "Все отзывы" },
]

const FEATURES = [
  { icon: Sparkles, text: "Классификация по категориям и тональности" },
  { icon: BarChart2, text: "Графики и тренды по типам обратной связи" },
  { icon: FileSearch, text: "Поиск проблемных товаров и паттернов" },
  { icon: Zap, text: "Новые отзывы классифицируются бесплатно" },
]

type Props = {
  shopId: number
  onEnabled: () => void
}

export function AnalyticsActivationCard({ shopId, onEnabled }: Props) {
  const [period, setPeriod] = useState<ReviewAnalyticsPeriod>("30d")
  const [preview, setPreview] = useState<AnalyticsPreviewResponse | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [enabling, setEnabling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handlePreview = useCallback(
    async (selectedPeriod: ReviewAnalyticsPeriod) => {
      setLoadingPreview(true)
      setError(null)
      setPreview(null)
      try {
        const result = await previewAnalyticsClassification(shopId, { period: selectedPeriod })
        setPreview(result)
      } catch (err) {
        setError(getErrorMessage(err, "Не удалось рассчитать стоимость"))
      } finally {
        setLoadingPreview(false)
      }
    },
    [shopId],
  )

  const handlePeriodChange = (value: ReviewAnalyticsPeriod) => {
    setPeriod(value)
    void handlePreview(value)
  }

  const handleEnable = useCallback(async () => {
    setEnabling(true)
    setError(null)
    try {
      await enableAnalyticsClassification(shopId, { period })
      setSuccess(true)
      setTimeout(() => onEnabled(), 1200)
    } catch (err) {
      setError(getErrorMessage(err, "Не удалось включить AI-аналитику"))
    } finally {
      setEnabling(false)
    }
  }, [shopId, period, onEnabled])

  if (success) {
    return (
      <div className="rounded-xl border border-success/30 bg-[hsl(var(--success-soft))]/30 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-success/10">
            <CheckCircle2 className="h-4 w-4 text-success" />
          </div>
          <div>
            <p className="text-[13px] font-bold text-foreground">AI-аналитика запущена</p>
            <p className="text-[11px] text-muted-foreground">Классификация началась. Страница обновится автоматически.</p>
          </div>
        </div>
      </div>
    )
  }

  const balancePct = preview
    ? Math.min(100, Math.round((preview.available_credits / Math.max(1, preview.required_credits)) * 100))
    : 0

  return (
    <div className="rounded-xl border border-primary/20 bg-card overflow-hidden">
      <div className="flex flex-col lg:flex-row">
        {/* Left — features */}
        <div className="flex-1 min-w-0 p-4 lg:p-5 flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-primary/5">
              <BrainCircuit className="h-4.5 w-4.5 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[13px] font-bold text-foreground leading-tight">AI-аналитика отзывов</h3>
              <p className="text-[11px] text-muted-foreground leading-tight">Автоматическая классификация по категориям, тональности и темам</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {FEATURES.map((f, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-border/30 bg-muted/20 px-3 py-2">
                <f.icon className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="text-[11px] text-foreground/80 leading-tight">{f.text}</span>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Zap className="h-3 w-3 text-primary shrink-0" />
            После первичной классификации новые отзывы обрабатываются бесплатно
          </p>
        </div>

        {/* Right — controls */}
        <div className="border-t lg:border-t-0 lg:border-l border-border/40 bg-muted/10 p-4 lg:p-5 lg:w-[320px] xl:w-[340px] shrink-0 flex flex-col gap-3">
          {/* Period selector */}
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block uppercase tracking-wider">
              Период анализа
            </label>
            <div className="grid grid-cols-4 gap-1">
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handlePeriodChange(opt.value)}
                  className={cn(
                    "rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-all",
                    period === opt.value
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:bg-muted/40"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Calculate CTA */}
          {!preview && !loadingPreview && (
            <Button variant="outline" size="sm" className="w-full gap-1.5 h-9 text-[11px]" onClick={() => handlePreview(period)}>
              <Coins className="h-3.5 w-3.5" />
              Рассчитать стоимость
            </Button>
          )}

          {/* Loading */}
          {loadingPreview && (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-background py-4">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span className="text-[11px] text-muted-foreground">Расчёт стоимости…</span>
            </div>
          )}

          {/* Preview result */}
          {preview && !loadingPreview && (
            <div className="space-y-2.5">
              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-1.5">
                <div className="rounded-lg border border-border bg-background p-2 text-center">
                  <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Отзывов</p>
                  <p className="text-sm font-bold tabular-nums text-foreground">{preview.reviews_count.toLocaleString("ru-RU")}</p>
                </div>
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-2 text-center">
                  <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Нужно</p>
                  <p className="text-sm font-bold tabular-nums text-primary">{preview.required_credits.toLocaleString("ru-RU")}</p>
                </div>
                <div className="rounded-lg border border-border bg-background p-2 text-center">
                  <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Баланс</p>
                  <p className={cn(
                    "text-sm font-bold tabular-nums",
                    preview.enough_balance ? "text-success" : "text-destructive"
                  )}>
                    {preview.available_credits.toLocaleString("ru-RU")}
                  </p>
                </div>
              </div>

              {/* Balance bar */}
              <div className="space-y-1">
                <Progress value={balancePct} className="h-1.5" />
                <p className="text-[10px] text-muted-foreground tabular-nums">
                  {preview.enough_balance
                    ? `Достаточно кредитов (${balancePct}% от требуемого)`
                    : `Не хватает ${(preview.required_credits - preview.available_credits).toLocaleString("ru-RU")} кредитов`}
                </p>
              </div>

              {!preview.enough_balance && (
                <div className="flex items-center gap-1.5 rounded-lg border border-destructive/20 bg-[hsl(var(--danger-soft))]/30 px-3 py-2">
                  <XCircle className="h-3 w-3 shrink-0 text-destructive" />
                  <p className="text-[11px] text-destructive font-medium">
                    Пополните баланс для активации AI-аналитики
                  </p>
                </div>
              )}

              <Button
                className="w-full gap-1.5 h-9 text-xs font-semibold"
                disabled={!preview.enough_balance || enabling}
                onClick={handleEnable}
              >
                {enabling ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" />Запуск…</>
                ) : (
                  <><Sparkles className="h-3.5 w-3.5" />Включить AI-аналитику</>
                )}
              </Button>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-1.5 rounded-lg border border-destructive/20 bg-[hsl(var(--danger-soft))]/30 px-3 py-2">
              <XCircle className="h-3 w-3 shrink-0 text-destructive" />
              <p className="text-[11px] text-destructive">{error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
