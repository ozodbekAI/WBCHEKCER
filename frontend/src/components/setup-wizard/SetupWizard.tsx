import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"

import { Card, CardContent } from "@/components/ui/card"

import { WizardProgress } from "./WizardProgress"
import { WizardNavigation } from "./WizardNavigation"
import { ConnectionStep } from "./ConnectionStep"
import { ToneStep } from "./ToneStep"
import { CompleteStep } from "./CompleteStep"
import { ModeStep } from "./ModeStep"
import { ImportProgressStep } from "./ImportProgressStep"

import type { WizardStep, AutomationMode } from "./types"
import { createShop, getJobStatus, getShop, getToneOptions, syncDashboardAll, updateSettings, verifyWbToken } from "@/lib/api"
import { SELECTED_SHOP_KEY, setSelectedShopId } from "@/lib/onboarding"

type ToneOption = { value: string; label: string; hint?: string | null; example?: string | null }
type ImportItemStatus = "pending" | "running" | "done" | "error"

type WizardState = {
  currentStep: WizardStep
  completedSteps: WizardStep[]
  storeConnected: boolean
  storeName: string
  token: string
  isTokenValid: boolean
  shopId: number | null
  automationMode: AutomationMode | null
  tone: string
  importStarted: boolean
  importStatuses: {
    reviews: ImportItemStatus
    questions: ImportItemStatus
    chats: ImportItemStatus
  }
}

const STORAGE_KEY = "wb_otveto_setup_wizard_v3"
const ACTIVE_STEPS: WizardStep[] = ["connection", "import", "mode", "tone", "complete"]

function defaultState(): WizardState {
  return {
    currentStep: "connection",
    completedSteps: [],
    storeConnected: false,
    storeName: "",
    token: "",
    isTokenValid: false,
    shopId: null,
    automationMode: null,
    tone: "none",
    importStarted: false,
    importStatuses: {
      reviews: "pending",
      questions: "pending",
      chats: "pending",
    },
  }
}

function uniqSteps(xs: WizardStep[]) {
  return Array.from(new Set(xs))
}

function nextStepOf(step: WizardStep): WizardStep {
  const index = ACTIVE_STEPS.indexOf(step)
  return ACTIVE_STEPS[Math.min(index + 1, ACTIVE_STEPS.length - 1)]
}

function prevStepOf(step: WizardStep): WizardStep {
  const index = ACTIVE_STEPS.indexOf(step)
  return ACTIVE_STEPS[Math.max(index - 1, 0)]
}

function mapAddressFormat() {
  return "vy_caps"
}

function buildRatingModeMap(mode: AutomationMode) {
  if (mode === "manual") {
    return { "1": "manual", "2": "manual", "3": "manual", "4": "manual", "5": "manual" }
  }
  if (mode === "control") {
    return { "1": "semi", "2": "semi", "3": "semi", "4": "semi", "5": "semi" }
  }
  return { "1": "auto", "2": "auto", "3": "auto", "4": "auto", "5": "auto" }
}

function aggregateImportStatus(statuses: Array<{ status?: string } | null | undefined>): ImportItemStatus {
  if (!statuses.length) return "pending"
  if (statuses.some((item) => item?.status === "failed")) return "error"
  if (statuses.every((item) => item?.status === "done")) return "done"
  if (statuses.some((item) => item?.status === "running" || item?.status === "queued" || item?.status === "pending")) {
    return "running"
  }
  return "pending"
}

export function SetupWizard() {
  const navigate = useNavigate()
  const [state, setState] = useState<WizardState>(() => defaultState())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importJobIds, setImportJobIds] = useState<number[]>([])
  const [isNewShopFlow, setIsNewShopFlow] = useState(false)

  const [toneOptions, setToneOptions] = useState<ToneOption[]>([])
  const [toneLoading, setToneLoading] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("new") === "1") {
      setIsNewShopFlow(true)
      try {
        window.localStorage.removeItem(STORAGE_KEY)
      } catch {}
      const url = new URL(window.location.href)
      url.searchParams.delete("new")
      window.history.replaceState({}, "", url.pathname)
    }
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setToneLoading(true)
      try {
        const options = await getToneOptions()
        if (!mounted) return
        const list = Array.isArray(options) ? options : []
        setToneOptions(
          list
            .map((item: any) => ({
              value: String(item?.value || "").trim(),
              label: String(item?.label || "").trim(),
              hint: item?.hint ?? null,
              example: item?.example ?? null,
            }))
            .filter((item) => item.value && item.label),
        )
      } catch {
        setToneOptions([])
      } finally {
        if (mounted) setToneLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!toneOptions.length) return
    if (toneOptions.some((item) => item.value === state.tone)) return
    setState((prev) => ({ ...prev, tone: toneOptions[0]!.value }))
  }, [toneOptions, state.tone])

  useEffect(() => {
    if (isNewShopFlow) return
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object") return
      setState((prev) => {
        const next = {
          ...prev,
          ...parsed,
          completedSteps: Array.isArray(parsed.completedSteps) ? parsed.completedSteps.filter((step: string) => ACTIVE_STEPS.includes(step as WizardStep)) : [],
          importStatuses: {
            reviews: parsed?.importStatuses?.reviews || "pending",
            questions: parsed?.importStatuses?.questions || "pending",
            chats: parsed?.importStatuses?.chats || "pending",
          },
        } as WizardState
        if (!ACTIVE_STEPS.includes(next.currentStep)) next.currentStep = "connection"
        return next
      })
    } catch {}
  }, [isNewShopFlow])

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {}
  }, [state])

  useEffect(() => {
    if (isNewShopFlow) return
    let mounted = true
    ;(async () => {
      if (state.shopId) return
      const savedShopId = typeof window !== "undefined" ? window.localStorage.getItem(SELECTED_SHOP_KEY) : null
      const shopId = savedShopId ? Number.parseInt(savedShopId, 10) : null
      if (!shopId || !Number.isFinite(shopId)) return
      try {
        const shop = await getShop(shopId)
        if (!mounted || !shop) return
        setState((prev) => ({
          ...prev,
          shopId: shop.id,
          storeConnected: true,
          storeName: shop.name || "",
          isTokenValid: true,
          currentStep: prev.currentStep === "connection" ? "import" : prev.currentStep,
          completedSteps: uniqSteps([...prev.completedSteps, "connection"]),
        }))
      } catch {}
    })()
    return () => {
      mounted = false
    }
  }, [isNewShopFlow, state.shopId])

  const markCompleted = useCallback((step: WizardStep) => {
    setState((prev) => ({ ...prev, completedSteps: uniqSteps([...prev.completedSteps, step]) }))
  }, [])

  const goToStep = useCallback(
    (step: WizardStep) => {
      const targetIndex = ACTIVE_STEPS.indexOf(step)
      const currentIndex = ACTIVE_STEPS.indexOf(state.currentStep)
      if (targetIndex <= currentIndex || state.completedSteps.includes(step)) {
        setState((prev) => ({ ...prev, currentStep: step }))
      }
    },
    [state.completedSteps, state.currentStep],
  )

  const exitWizard = useCallback(() => {
    navigate("/app/dashboard")
  }, [navigate])

  const verifyToken = useCallback(async (token: string) => {
    try {
      const res = await verifyWbToken(token)
      return { ok: Boolean((res as any)?.ok), shop_name: (res as any)?.shop_name || null, error: undefined }
    } catch (e: any) {
      return { ok: false, shop_name: null, error: e?.message || "Не удалось проверить токен" }
    }
  }, [])

  const startImport = useCallback(async () => {
    if (!state.shopId) return
    setBusy(true)
    setImportError(null)
    setImportJobIds([])
    setState((prev) => ({
      ...prev,
      importStarted: true,
      importStatuses: {
        reviews: "running",
        questions: "running",
        chats: "running",
      },
    }))
    try {
      const result = await syncDashboardAll({ shop_id: state.shopId })
      const jobIds = Array.isArray(result?.job_ids) ? result.job_ids.filter((item) => Number.isFinite(item) && item > 0) : []
      if (!jobIds.length) {
        setState((prev) => ({
          ...prev,
          importStarted: true,
          importStatuses: {
            reviews: "done",
            questions: "done",
            chats: "done",
          },
        }))
        markCompleted("import")
        return
      }
      setImportJobIds(jobIds)
    } catch (e: any) {
      const message = e?.message || "Не удалось запустить импорт"
      setImportError(message)
      setState((prev) => ({
        ...prev,
        importStarted: false,
        importStatuses: {
          reviews: "error",
          questions: "error",
          chats: "error",
        },
      }))
    } finally {
      setBusy(false)
    }
  }, [markCompleted, state.shopId])

  useEffect(() => {
    if (state.currentStep !== "import") return
    if (!state.shopId || state.importStarted || importJobIds.length > 0) return
    void startImport()
  }, [importJobIds.length, startImport, state.currentStep, state.importStarted, state.shopId])

  useEffect(() => {
    if (state.currentStep !== "import") return
    if (!importJobIds.length) return
    let active = true
    let timer: number | null = null

    const poll = async () => {
      try {
        const jobs = (await Promise.all(importJobIds.map((jobId) => getJobStatus(jobId)))) as Array<{ status?: string } | null>
        if (!active) return

        const reviews = aggregateImportStatus(jobs.slice(0, 2))
        const questions = aggregateImportStatus(jobs.slice(2, 4))
        const chats = aggregateImportStatus(jobs.slice(4, 5))

        setState((prev) => ({
          ...prev,
          importStatuses: { reviews, questions, chats },
        }))

        if ([reviews, questions, chats].some((status) => status === "error")) {
          setImportError("Один из этапов импорта завершился с ошибкой. Попробуйте запустить импорт снова.")
          return
        }

        if (reviews === "done" && questions === "done" && chats === "done") {
          markCompleted("import")
          return
        }

        timer = window.setTimeout(poll, 1000)
      } catch (e: any) {
        if (!active) return
        setImportError(e?.message || "Не удалось получить статус импорта")
      }
    }

    void poll()
    return () => {
      active = false
      if (timer) window.clearTimeout(timer)
    }
  }, [importJobIds, markCompleted, state.currentStep])

  const saveSettingsToBackend = useCallback(async () => {
    if (!state.shopId || !state.automationMode) throw new Error("shop_id not set")

    const replyMode = state.automationMode === "autopilot" ? "auto" : state.automationMode === "control" ? "semi" : "manual"
    const ratingModeMap = buildRatingModeMap(state.automationMode)

    await updateSettings(state.shopId, {
      automation_enabled: state.automationMode === "autopilot",
      auto_sync: true,
      auto_draft: state.automationMode !== "manual",
      auto_publish: state.automationMode === "autopilot",
      reply_mode: replyMode,
      rating_mode_map: ratingModeMap,
      questions_reply_mode: replyMode,
      questions_auto_draft: state.automationMode !== "manual",
      questions_auto_publish: state.automationMode === "autopilot",
      tone: state.tone,
      signature: null,
      signatures: [],
      config: {
        onboarding: {
          done: true,
          dashboard_intro_seen: false,
          automation_mode: state.automationMode,
        },
        advanced: {
          address_format: mapAddressFormat(),
          use_buyer_name: true,
          mention_product_name: false,
          emoji_enabled: true,
          photo_reaction_enabled: true,
          answer_length: "default",
          tone_of_voice: {
            positive: state.tone,
            neutral: state.tone,
            negative: state.tone,
            question: state.tone,
          },
        },
      },
    })
  }, [state.automationMode, state.shopId, state.tone])

  const nextStep = useCallback(async () => {
    setError(null)

    if (state.currentStep === "connection") {
      if (state.shopId && state.storeConnected) {
        markCompleted("connection")
        setState((prev) => ({ ...prev, currentStep: "import" }))
        return
      }

      if (!state.isTokenValid || !state.token.trim()) return

      setBusy(true)
      try {
        const shop = await createShop({ wb_token: state.token.trim(), name: null })
        setSelectedShopId(shop.id)
        markCompleted("connection")
        setState((prev) => ({
          ...prev,
          shopId: shop.id,
          storeConnected: true,
          storeName: shop.name,
          currentStep: "import",
          importStarted: false,
          importStatuses: {
            reviews: "pending",
            questions: "pending",
            chats: "pending",
          },
        }))
      } catch (e: any) {
        setError(e?.message || "Не удалось создать магазин")
      } finally {
        setBusy(false)
      }
      return
    }

    if (state.currentStep === "import") {
      setState((prev) => ({ ...prev, currentStep: "mode" }))
      return
    }

    if (state.currentStep === "mode") {
      markCompleted("mode")
      setState((prev) => ({ ...prev, currentStep: "tone" }))
      return
    }

    if (state.currentStep === "tone") {
      setBusy(true)
      try {
        await saveSettingsToBackend()
        markCompleted("tone")
        setState((prev) => ({ ...prev, currentStep: "complete" }))
      } catch (e: any) {
        setError(e?.message || "Не удалось сохранить настройки")
      } finally {
        setBusy(false)
      }
    }
  }, [markCompleted, saveSettingsToBackend, state])

  const prevStep = useCallback(() => {
    setError(null)
    setState((prev) => ({ ...prev, currentStep: prevStepOf(prev.currentStep) }))
  }, [])

  const finishAndGo = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {}
    navigate("/app/dashboard", { replace: true })
    // refresh not needed in SPA
  }, [navigate])

  const openSettings = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {}
    navigate("/app/settings")
  }, [navigate])

  const openFeedbacks = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {}
    navigate("/app/feedbacks")
  }, [navigate])

  const currentIndex = useMemo(() => ACTIVE_STEPS.indexOf(state.currentStep), [state.currentStep])
  const isComplete = state.currentStep === "complete"
  const importDone =
    state.importStatuses.reviews === "done" && state.importStatuses.questions === "done" && state.importStatuses.chats === "done"
  const canProceed =
    state.currentStep === "connection"
      ? state.isTokenValid && !busy
      : state.currentStep === "import"
        ? importDone && !busy
        : state.currentStep === "mode"
          ? Boolean(state.automationMode) && !busy
          : state.currentStep === "tone"
            ? Boolean(state.tone) && !busy
            : false

  const renderStep = () => {
    if (state.currentStep === "connection") {
      return (
        <ConnectionStep
          isConnected={state.storeConnected}
          storeName={state.storeName}
          token={state.token}
          isTokenValid={state.isTokenValid}
          onVerifyToken={verifyToken}
          onUpdate={(data) => setState((prev) => ({ ...prev, ...data }))}
        />
      )
    }

    if (state.currentStep === "import") {
      return (
        <ImportProgressStep
          tokenVerified={state.isTokenValid}
          shopCreated={Boolean(state.shopId)}
          statuses={state.importStatuses}
          isRunning={Boolean(importJobIds.length) || busy}
          error={importError}
          onRetry={() => void startImport()}
        />
      )
    }

    if (state.currentStep === "mode") {
      return (
        <ModeStep
          selectedMode={state.automationMode}
          onSelectMode={(automationMode) => setState((prev) => ({ ...prev, automationMode }))}
        />
      )
    }

    if (state.currentStep === "tone") {
      return (
        <ToneStep
          selectedTone={state.tone}
          onSelectTone={(tone) => setState((prev) => ({ ...prev, tone }))}
          tones={toneOptions}
          loading={toneLoading}
        />
      )
    }

    return <CompleteStep onFinish={finishAndGo} onOpenSettings={openSettings} onOpenFeedbacks={openFeedbacks} />
  }

  return (
    <div className="min-h-screen bg-background">
      {!isComplete ? (
        <header className="border-b border-border bg-card px-4 py-4 sm:px-6">
          <WizardProgress currentStep={state.currentStep} completedSteps={state.completedSteps} onStepClick={goToStep} />
        </header>
      ) : null}

      <main className="flex min-h-[calc(100vh-81px)] items-center justify-center p-4 sm:p-6">
        <Card className="w-full max-w-3xl rounded-[28px] border border-border shadow-[0_12px_40px_rgba(15,23,42,0.08)]">
          <CardContent className="px-5 pb-6 pt-8 sm:px-8">
            {renderStep()}

            {error ? <div className="mt-6 text-sm text-destructive">{error}</div> : null}

            {!isComplete ? (
              <WizardNavigation
                currentStep={state.currentStep}
                canSkip={false}
                canGoBack={currentIndex > 0 && !busy}
                canProceed={canProceed}
                isLastStep={state.currentStep === "tone"}
                onNext={() => void nextStep()}
                onPrev={prevStep}
                onSkip={() => undefined}
                onExit={exitWizard}
              />
            ) : null}

            {busy ? <div className="mt-4 text-xs text-muted-foreground">Подождите…</div> : null}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
