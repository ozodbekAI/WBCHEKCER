import * as React from "react"

import {
  applyReviewAiLearning,
  deleteReviewAiLearningEntry,
  getReviewAiLearning,
  getSettings,
  getShop,
  getShopBrands,
  getToneOptions,
  resetReviewAiLearning,
  toggleReviewAiLearning,
  updateSettings,
  type ReviewAiLearningState,
} from "@/lib/api"
import { useToast } from "@/components/ui/use-toast"
import { getErrorMessage } from "@/lib/error-message"
import { useAsyncData } from "@/hooks/use-async-data"
import type {
  ReplyMode,
  SaveStateMeta,
  Settings,
  SettingsPageData,
  SignatureItem,
  ToneOption,
  WorkMode,
} from "@/components/modules/settings/settings-types"
import {
  coerceBool,
  getNested,
  getRatingMapForMode,
  getWorkMode,
  normalizeSignature,
  prettyDateTime,
  setNested,
} from "@/components/modules/settings/settings-utils"

const FALLBACK_TONE_OPTIONS: ToneOption[] = [
  { value: "none", label: "Без тональности", hint: "Настройка по умолчанию. Тональность отключена." },
  { value: "business", label: "Деловая", hint: "Подходит для официальных ответов." },
  { value: "friendly", label: "Дружелюбная", hint: "Создаёт ощущение личного контакта." },
  { value: "joking", label: "Шутливая", hint: "Разряжает обстановку." },
  { value: "serious", label: "Серьёзная", hint: "Подходит для извинений, важных заявлений." },
  { value: "empathetic", label: "Эмпатичная", hint: "Подходит для сложных и чувствительных ситуаций." },
]

type SettingsLayer = "basic" | "advanced"

export function useSettingsController(shopId: number | null) {
  const { toast } = useToast()

  const [shopName, setShopName] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [lastSavedAt, setLastSavedAt] = React.useState<string | null>(null)
  const [settingsLayer, setSettingsLayer] = React.useState<SettingsLayer>("basic")
  const [onboardingDone, setOnboardingDone] = React.useState<boolean | null>(null)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<Settings | null>(null)
  const [brands, setBrands] = React.useState<string[]>([])
  const [lastSavedDraft, setLastSavedDraft] = React.useState<Settings | null>(null)

  const [signatureOpen, setSignatureOpen] = React.useState(false)
  const [sigBrand, setSigBrand] = React.useState<string>("all")
  const [sigRating, setSigRating] = React.useState<string>("all")
  const [sigText, setSigText] = React.useState<string>("")
  const [sigEditingTarget, setSigEditingTarget] = React.useState<SignatureItem | null>(null)
  const [filterBrand, setFilterBrand] = React.useState<string>("all")
  const [filterRating, setFilterRating] = React.useState<string>("all")

  const [learningState, setLearningState] = React.useState<ReviewAiLearningState | null>(null)
  const [learningLoading, setLearningLoading] = React.useState(false)
  const [learningBusy, setLearningBusy] = React.useState(false)
  const [learningError, setLearningError] = React.useState<string | null>(null)
  const [enableConfirmOpen, setEnableConfirmOpen] = React.useState(false)
  const [resetConfirmOpen, setResetConfirmOpen] = React.useState(false)
  const [manualRuleOpen, setManualRuleOpen] = React.useState(false)
  const [manualInstruction, setManualInstruction] = React.useState("")
  const [manualAnswerExample, setManualAnswerExample] = React.useState("")

  const toneOptionsQuery = useAsyncData(
    async () => {
      const options = await getToneOptions()
      return Array.isArray(options) && options.length ? options : FALLBACK_TONE_OPTIONS
    },
    [],
    {
      initialData: FALLBACK_TONE_OPTIONS,
      keepPreviousData: true,
      fallbackError: "Не удалось загрузить список тонов",
    },
  )

  const toneOptions = toneOptionsQuery.data?.length ? toneOptionsQuery.data : FALLBACK_TONE_OPTIONS

  const refreshLearning = React.useCallback(async () => {
    if (!shopId) return
    setLearningLoading(true)
    setLearningError(null)
    try {
      const next = await getReviewAiLearning(shopId)
      setLearningState(next)
    } catch (error) {
      setLearningError(getErrorMessage(error, "Не удалось загрузить обучение ИИ"))
    } finally {
      setLearningLoading(false)
    }
  }, [shopId])

  const settingsQuery = useAsyncData<SettingsPageData>(
    async () => {
      if (!shopId) {
        throw new Error("Сначала выберите магазин.")
      }

      const [settingsResult, shopResult, brandsResult] = await Promise.allSettled([
        getSettings(shopId) as Promise<Settings>,
        getShop(shopId),
        getShopBrands(shopId),
      ])

      if (settingsResult.status === "rejected") {
        throw settingsResult.reason
      }

      const settings = settingsResult.value
      const rawBrands =
        brandsResult.status === "fulfilled" && Array.isArray(brandsResult.value?.data) ? brandsResult.value.data : []
      const uniq = Array.from(new Set(rawBrands.filter((item) => typeof item === "string" && item.trim())))
      uniq.sort((a, b) => a.localeCompare(b, "ru"))

      return {
        normalized: {
          ...settings,
          shop_id: settings.shop_id,
          auto_sync: settings.auto_sync ?? true,
          automation_enabled: settings.automation_enabled ?? false,
          reply_mode: settings.reply_mode ?? "semi",
          auto_draft: settings.auto_draft ?? true,
          auto_publish: settings.auto_publish ?? false,
          auto_draft_limit_per_sync:
            typeof settings.auto_draft_limit_per_sync === "number" ? settings.auto_draft_limit_per_sync : 0,
          language: settings.language ?? "ru",
          tone: settings.tone ?? "polite",
          signature: settings.signature ?? null,
          blacklist_keywords: settings.blacklist_keywords ?? [],
          whitelist_keywords: settings.whitelist_keywords ?? [],
          templates: settings.templates ?? {},
          chat_enabled: settings.chat_enabled ?? true,
          chat_auto_reply: settings.chat_auto_reply ?? false,
          rating_mode_map:
            settings.rating_mode_map || { "1": "manual", "2": "manual", "3": "semi", "4": "auto", "5": "auto" },
          questions_reply_mode: settings.questions_reply_mode || "manual",
          questions_auto_draft: coerceBool(settings.questions_auto_draft) ?? false,
          questions_auto_publish: coerceBool(settings.questions_auto_publish) ?? false,
          signatures: Array.isArray(settings.signatures) ? settings.signatures : [],
          config: settings.config || {},
        },
        shopName: shopResult.status === "fulfilled" ? shopResult.value?.name ?? null : null,
        brands: uniq,
        warnings: [
          shopResult.status === "rejected" ? getErrorMessage(shopResult.reason, "Не удалось загрузить название магазина") : null,
          brandsResult.status === "rejected" ? getErrorMessage(brandsResult.reason, "Не удалось загрузить список брендов") : null,
        ].filter((value): value is string => Boolean(value)),
      }
    },
    [shopId],
    {
      enabled: Boolean(shopId),
      keepPreviousData: true,
      fallbackError: "Не удалось загрузить настройки",
    },
  )

  React.useEffect(() => {
    if (!settingsQuery.data) return
    setShopName(settingsQuery.data.shopName)
    setBrands(settingsQuery.data.brands)
    setOnboardingDone(Boolean(settingsQuery.data.normalized.config?.onboarding?.done))
    setDraft(settingsQuery.data.normalized)
    setLastSavedDraft(settingsQuery.data.normalized)
    setLastSavedAt(new Date().toISOString())
    setSaveError(null)
  }, [settingsQuery.data])

  React.useEffect(() => {
    if (!shopId) return
    void refreshLearning()
  }, [shopId, refreshLearning])

  React.useEffect(() => {
    if (!draft || !shopId || draft === lastSavedDraft) return

    const timer = setTimeout(async () => {
      setSaving(true)
      setSaveError(null)
      try {
        await updateSettings(shopId, {
          auto_sync: draft.auto_sync ?? true,
          automation_enabled: draft.automation_enabled ?? false,
          reply_mode: draft.reply_mode ?? "semi",
          auto_draft: draft.auto_draft ?? true,
          auto_publish: draft.auto_publish ?? false,
          auto_draft_limit_per_sync: draft.auto_draft_limit_per_sync ?? 0,
          rating_mode_map: draft.rating_mode_map,
          language: draft.language ?? "ru",
          tone: draft.tone ?? "polite",
          signature: draft.signature ?? null,
          signatures: draft.signatures,
          blacklist_keywords: draft.blacklist_keywords ?? [],
          whitelist_keywords: draft.whitelist_keywords ?? [],
          templates: draft.templates ?? {},
          chat_enabled: draft.chat_enabled ?? true,
          chat_auto_reply: draft.chat_auto_reply ?? false,
          questions_reply_mode: draft.questions_reply_mode,
          questions_auto_draft: draft.questions_auto_draft,
          questions_auto_publish: draft.questions_auto_publish,
          config: draft.config || {},
        })
        setLastSavedDraft(draft)
        setLastSavedAt(new Date().toISOString())
        setSaveError(null)
      } catch (error) {
        setSaveError(getErrorMessage(error, "Не удалось сохранить настройки"))
      } finally {
        setSaving(false)
      }
    }, 1500)

    return () => clearTimeout(timer)
  }, [draft, lastSavedDraft, shopId])

  const cfg = draft?.config || {}
  const adv = getNested(cfg, ["advanced"], {} as Record<string, unknown>)
  const chats = getNested(cfg, ["chat"], {} as Record<string, unknown>)

  const emojiEnabled = Boolean(getNested(adv, ["emoji_enabled"], false))
  const photoReactionEnabled = Boolean(getNested(adv, ["photo_reaction_enabled"], false))
  const deliveryMethod = getNested<string | null>(adv, ["delivery_method"], null)
  const stopWords = getNested<string[]>(adv, ["stop_words"], [])
  const reviewStopWords = learningState?.enabled ? learningState.stop_words : stopWords
  const tov = getNested<Record<string, string>>(adv, ["tone_of_voice"], {})
  const baseTone = draft?.tone || "none"
  const tonePositive = getNested<string>(tov, ["positive"], "none")
  const toneNeutral = getNested<string>(tov, ["neutral"], "none")
  const toneNegative = getNested<string>(tov, ["negative"], "none")
  const toneQuestion = getNested<string>(tov, ["question"], "none")

  const addressFormat = getNested<string>(adv, ["address_format"], "vy_caps")
  const answerLength = getNested<string>(adv, ["answer_length"], "default")
  const useCustomerName = Boolean(getNested(adv, ["use_buyer_name"], getNested(adv, ["use_customer_name"], true)))
  const useProductName = Boolean(getNested(adv, ["mention_product_name"], getNested(adv, ["use_product_name"], true)))

  const availableToneOptions = React.useMemo(() => {
    const next = [...toneOptions]
    for (const value of [baseTone, tonePositive, toneNeutral, toneNegative, toneQuestion].filter(Boolean)) {
      if (!next.some((item) => item.value === value)) {
        next.push({
          value,
          label: value === "polite" ? "Вежливая (legacy)" : value,
          hint: "Текущее значение сохранено в магазине. Можно заменить на один из поддерживаемых вариантов.",
        })
      }
    }
    return next
  }, [toneOptions, baseTone, tonePositive, toneNeutral, toneNegative, toneQuestion])

  const confirmSend = Boolean(getNested(chats, ["confirm_send"], true))
  const confirmAiInsert = Boolean(getNested(chats, ["confirm_ai_insert"], true))
  const hasPendingChanges = Boolean(draft && lastSavedDraft && draft !== lastSavedDraft)
  const saveState = saveError ? "error" : saving ? "saving" : hasPendingChanges ? "pending" : lastSavedAt ? "saved" : "idle"

  const saveStateMeta: SaveStateMeta = (() => {
    if (saveState === "saving") {
      return {
        badge: "Сохраняем…",
        tone: "border-border bg-muted text-muted-foreground",
        hint: "Изменения сохраняются автоматически.",
      }
    }
    if (saveState === "pending") {
      return {
        badge: "Есть изменения",
        tone: "border-warning/30 bg-warning/10 text-warning",
        hint: "Подождите пару секунд, и настройки сохранятся автоматически.",
      }
    }
    if (saveState === "error") {
      return {
        badge: "Ошибка сохранения",
        tone: "border-destructive/30 bg-destructive/10 text-destructive",
        hint: saveError || "Не удалось сохранить настройки.",
      }
    }
    if (saveState === "saved" && lastSavedAt) {
      return {
        badge: "Сохранено",
        tone: "border-success/30 bg-success/10 text-success",
        hint: `Последнее сохранение: ${prettyDateTime(lastSavedAt)}`,
      }
    }
    return {
      badge: "Автосохранение",
      tone: "border-border bg-muted/50 text-muted-foreground",
      hint: "Изменения сохраняются автоматически.",
    }
  })()

  const allSignatures = (draft?.signatures || []).map(normalizeSignature)
  const filteredSignatures = allSignatures.filter((signature) => {
    const byBrand = filterBrand === "all" || signature.brand === filterBrand
    const byRating =
      filterRating === "all"
        ? true
        : filterRating === "none"
          ? signature.rating == null
          : signature.rating === Number(filterRating)
    return byBrand && byRating
  })

  const setAdvanced = React.useCallback((path: string[], value: unknown) => {
    setDraft((prev) => (prev ? { ...prev, config: setNested(prev.config || {}, ["advanced", ...path], value) } : prev))
  }, [])

  const setChatCfg = React.useCallback((path: string[], value: unknown) => {
    setDraft((prev) => (prev ? { ...prev, config: setNested(prev.config || {}, ["chat", ...path], value) } : prev))
  }, [])

  const setTone = React.useCallback(
    (bucket: "positive" | "neutral" | "negative" | "question", value: string) => {
      setDraft((prev) => {
        if (!prev) return prev
        const nextConfig = setNested(prev.config || {}, ["advanced", "tone_of_voice"], {
          ...(getNested(prev.config || {}, ["advanced", "tone_of_voice"], {} as Record<string, string>) || {}),
          [bucket]: value,
        })
        return { ...prev, config: nextConfig }
      })
    },
    [],
  )

  const workMode = draft ? getWorkMode(draft.rating_mode_map) : "control"
  const questionsMode = draft?.questions_reply_mode || "manual"
  const languageOptions = Array.from(new Set([draft?.language || "ru", "ru", "en", "uz"]))

  const setWorkMode = React.useCallback((mode: WorkMode) => {
    setDraft((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        rating_mode_map: getRatingMapForMode(mode),
        auto_draft: mode !== "manual",
        auto_publish: mode === "autopilot",
        automation_enabled: mode !== "manual",
      }
    })
  }, [])

  const setQuestionsMode = React.useCallback((mode: ReplyMode) => {
    setDraft((prev) => {
      if (!prev) return prev
      if (mode === "manual") {
        return { ...prev, questions_reply_mode: "manual", questions_auto_draft: false, questions_auto_publish: false }
      }
      if (mode === "semi") {
        return { ...prev, questions_reply_mode: "semi", questions_auto_draft: true, questions_auto_publish: false }
      }
      return { ...prev, questions_reply_mode: "auto", questions_auto_draft: true, questions_auto_publish: true }
    })
  }, [])

  const closeSignatureDialog = React.useCallback(() => {
    setSignatureOpen(false)
    setSigEditingTarget(null)
    setSigBrand("all")
    setSigRating("all")
    setSigText("")
  }, [])

  const saveSignature = React.useCallback(() => {
    const text = sigText.trim()
    if (!text) return

    const parsedRating = sigRating === "all" ? NaN : Number(sigRating)
    const rating: number | null = Number.isInteger(parsedRating) && parsedRating >= 1 && parsedRating <= 5 ? parsedRating : null

    const item: SignatureItem = {
      text,
      brand: sigBrand || "all",
      type: "review",
      rating,
      is_active: true,
      created_at: new Date().toISOString(),
    }

    setDraft((prev) => {
      if (!prev) return prev

      if (sigEditingTarget) {
        const normalized = (prev.signatures || []).map(normalizeSignature)
        const index = normalized.findIndex(
          (signature) =>
            signature.text === sigEditingTarget.text &&
            signature.brand === sigEditingTarget.brand &&
            (signature.type || "all") === (sigEditingTarget.type || "all") &&
            (signature.rating ?? null) === (sigEditingTarget.rating ?? null) &&
            (signature.created_at || "") === (sigEditingTarget.created_at || ""),
        )

        if (index !== -1) {
          const next = [...(prev.signatures || [])]
          const prevType = normalized[index]?.type || "review"
          next[index] = {
            ...normalizeSignature(next[index] as string | SignatureItem),
            text: item.text,
            brand: item.brand,
            rating: item.rating,
            type: prevType,
          }
          return { ...prev, signatures: next }
        }
      }

      return { ...prev, signatures: [...(prev.signatures || []), item] }
    })

    closeSignatureDialog()
  }, [closeSignatureDialog, sigBrand, sigEditingTarget, sigRating, sigText])

  const openCreateSignature = React.useCallback(() => {
    setSigEditingTarget(null)
    setSigBrand("all")
    setSigRating("all")
    setSigText("")
    setSignatureOpen(true)
  }, [])

  const editSignatureAt = React.useCallback(
    (index: number) => {
      const target = filteredSignatures[index]
      if (!target) return
      setSigEditingTarget(target)
      setSigBrand(target.brand || "all")
      setSigRating(target.rating == null ? "all" : String(target.rating))
      setSigText(target.text || "")
      setSignatureOpen(true)
    },
    [filteredSignatures],
  )

  const removeSignatureAt = React.useCallback(
    (index: number) => {
      const target = filteredSignatures[index]
      if (!target) return
      setDraft((prev) => {
        if (!prev) return prev
        const normalized = (prev.signatures || []).map(normalizeSignature)
        const originalIndex = normalized.findIndex(
          (signature) =>
            signature.text === target.text &&
            signature.brand === target.brand &&
            (signature.type || "all") === (target.type || "all") &&
            (signature.rating ?? null) === (target.rating ?? null),
        )
        if (originalIndex === -1) return prev
        const next = [...(prev.signatures || [])]
        next.splice(originalIndex, 1)
        return { ...prev, signatures: next }
      })
    },
    [filteredSignatures],
  )

  const handleToggleLearning = React.useCallback(
    async (enabled: boolean) => {
      if (!shopId) return
      setLearningBusy(true)
      setLearningError(null)
      try {
        await toggleReviewAiLearning(shopId, enabled)
        await refreshLearning()
        toast({
          title: enabled ? "Обучение ИИ включено" : "Обучение ИИ выключено",
          description: enabled
            ? "Для магазина создана отдельная копия review-промптов и категорий."
            : "Магазин снова использует общие настройки без shop-специфичных правил.",
        })
      } catch (error) {
        const message = getErrorMessage(error, "Не удалось изменить состояние обучения ИИ")
        setLearningError(message)
        toast({ title: "Ошибка", description: message, variant: "destructive" })
      } finally {
        setLearningBusy(false)
      }
    },
    [refreshLearning, shopId, toast],
  )

  const handleDeleteLearningEntry = React.useCallback(
    async (entryId: number) => {
      if (!shopId) return
      setLearningBusy(true)
      setLearningError(null)
      try {
        await deleteReviewAiLearningEntry(shopId, entryId)
        await refreshLearning()
        toast({ title: "Правило удалено", description: "Изменение больше не влияет на ответы магазина." })
      } catch (error) {
        const message = getErrorMessage(error, "Не удалось удалить правило")
        setLearningError(message)
        toast({ title: "Ошибка", description: message, variant: "destructive" })
      } finally {
        setLearningBusy(false)
      }
    },
    [refreshLearning, shopId, toast],
  )

  const handleResetLearning = React.useCallback(async () => {
    if (!shopId) return
    setLearningBusy(true)
    setLearningError(null)
    try {
      await resetReviewAiLearning(shopId)
      await refreshLearning()
      setResetConfirmOpen(false)
      toast({
        title: "Обучение ИИ сброшено",
        description: "Копия промптов и категорий для магазина пересоздана из базовых настроек.",
      })
    } catch (error) {
      const message = getErrorMessage(error, "Не удалось сбросить обучение ИИ")
      setLearningError(message)
      toast({ title: "Ошибка", description: message, variant: "destructive" })
    } finally {
      setLearningBusy(false)
    }
  }, [refreshLearning, shopId, toast])

  const handleCreateLearningRule = React.useCallback(async () => {
    if (!shopId) return
    const instruction = manualInstruction.trim()
    if (!instruction) return

    setLearningBusy(true)
    setLearningError(null)
    try {
      const result = await applyReviewAiLearning(shopId, {
        instruction,
        answer_text: manualAnswerExample.trim() || undefined,
      })
      await refreshLearning()
      setManualRuleOpen(false)
      setManualInstruction("")
      setManualAnswerExample("")
      toast({
        title: result.actions_count > 0 ? "Правило добавлено" : "Изменений не потребовалось",
        description:
          result.actions_count > 0
            ? "AI добавил новое правило в настройки этого магазина."
            : "Такое правило уже есть в shop-настройках магазина.",
      })
    } catch (error) {
      const message = getErrorMessage(error, "Не удалось добавить правило")
      setLearningError(message)
      toast({ title: "Ошибка", description: message, variant: "destructive" })
    } finally {
      setLearningBusy(false)
    }
  }, [manualAnswerExample, manualInstruction, refreshLearning, shopId, toast])

  return {
    draft,
    settingsQuery,
    toneOptionsQuery,
    settingsLayer,
    setSettingsLayer,
    onboardingDone,
    shopLabel: shopName ?? (shopId ? `#${shopId}` : "—"),
    saveStateMeta,
    workMode,
    questionsMode,
    warnings: settingsQuery.data?.warnings || [],
    automationSectionProps: {
      automationEnabled: draft?.automation_enabled ?? false,
      autoDraft: draft?.auto_draft ?? true,
      autoPublish: draft?.auto_publish ?? false,
      autoSync: draft?.auto_sync ?? true,
      autoDraftLimitPerSync: draft?.auto_draft_limit_per_sync ?? 0,
      onAutomationEnabledChange: (value: boolean) =>
        setDraft((prev) => {
          if (!prev) return prev
          if (!value) {
            return { ...prev, automation_enabled: false, auto_draft: false, auto_publish: false }
          }
          return { ...prev, automation_enabled: true }
        }),
      onAutoDraftChange: (value: boolean) =>
        setDraft((prev) => (prev ? { ...prev, auto_draft: value, auto_publish: value ? prev.auto_publish : false } : prev)),
      onAutoPublishChange: (value: boolean) =>
        setDraft((prev) => (prev ? { ...prev, auto_publish: value } : prev)),
      onAutoSyncChange: (value: boolean) => setDraft((prev) => (prev ? { ...prev, auto_sync: value } : prev)),
      onAutoDraftLimitChange: (value: number) =>
        setDraft((prev) => (prev ? { ...prev, auto_draft_limit_per_sync: value } : prev)),
      saveStateMeta,
    },
    generalSectionProps: {
      workMode,
      autoSync: draft?.auto_sync ?? true,
      autoDraftLimitPerSync: draft?.auto_draft_limit_per_sync ?? 0,
      onWorkModeChange: setWorkMode,
      onAutoSyncChange: (value: boolean) => setDraft((prev) => (prev ? { ...prev, auto_sync: value } : prev)),
      onAutoDraftLimitChange: (value: number) =>
        setDraft((prev) => (prev ? { ...prev, auto_draft_limit_per_sync: value } : prev)),
      saveStateMeta,
    },
    questionsSectionProps: {
      questionsMode,
      onQuestionsModeChange: setQuestionsMode,
      saveStateMeta,
    },
    chatsSectionProps: {
      chatEnabled: draft?.chat_enabled ?? true,
      chatAutoReply: draft?.chat_auto_reply ?? false,
      onChatEnabledChange: (value: boolean) =>
        setDraft((prev) =>
          prev
            ? {
                ...prev,
                chat_enabled: value,
                chat_auto_reply: value ? prev.chat_auto_reply : false,
              }
            : prev,
        ),
      onChatAutoReplyChange: (value: boolean) =>
        setDraft((prev) => (prev ? { ...prev, chat_auto_reply: value } : prev)),
      saveStateMeta,
    },
    styleSectionProps: {
      languageOptions,
      language: draft?.language || "ru",
      baseTone,
      availableToneOptions,
      addressFormat,
      answerLength,
      useCustomerName,
      useProductName,
      onLanguageChange: (value: string) => setDraft((prev) => (prev ? { ...prev, language: value } : prev)),
      onBaseToneChange: (value: string) => setDraft((prev) => (prev ? { ...prev, tone: value } : prev)),
      onAddressFormatChange: (value: string) => setAdvanced(["address_format"], value),
      onAnswerLengthChange: (value: string) => setAdvanced(["answer_length"], value),
      onUseCustomerNameChange: (value: boolean) => setAdvanced(["use_buyer_name"], value),
      onUseProductNameChange: (value: boolean) => setAdvanced(["mention_product_name"], value),
      saveStateMeta,
    },
    brandSectionProps: {
      brands,
      filterBrand,
      filterRating,
      filteredSignatures,
      onFilterBrandChange: setFilterBrand,
      onFilterRatingChange: setFilterRating,
      onOpenCreate: openCreateSignature,
      onEdit: editSignatureAt,
      onRemove: removeSignatureAt,
      saveStateMeta,
    },
    advancedSectionProps: {
      learningEnabled: Boolean(learningState?.enabled),
      stopWordsCount: reviewStopWords.length,
      customRulesCount: learningState?.entries.length || 0,
      chatConfirmationEnabled: confirmSend || confirmAiInsert,
      saveStateMeta,
    },
    reviewModesSectionProps: {
      ratingModeMap: draft?.rating_mode_map || {},
      onRatingModeChange: (rating: string, mode: ReplyMode) =>
        setDraft((prev) =>
          prev
            ? {
                ...prev,
                rating_mode_map: { ...prev.rating_mode_map, [rating]: mode },
              }
            : prev,
        ),
      saveStateMeta,
    },
    reviewRulesSectionProps: {
      emojiEnabled,
      photoReactionEnabled,
      deliveryMethod,
      tonePositive,
      toneNeutral,
      toneNegative,
      toneQuestion,
      availableToneOptions,
      reviewStopWords,
      learningEnabled: Boolean(learningState?.enabled),
      onEmojiEnabledChange: (value: boolean) => setAdvanced(["emoji_enabled"], value),
      onPhotoReactionEnabledChange: (value: boolean) => setAdvanced(["photo_reaction_enabled"], value),
      onDeliveryMethodChange: (value: string | null) => setAdvanced(["delivery_method"], value),
      onToneChange: setTone,
      onStopWordsChange: (value: string[]) => setAdvanced(["stop_words"], value),
      saveStateMeta,
    },
    chatsBehaviorSectionProps: {
      confirmSend,
      confirmAiInsert,
      onConfirmSendChange: (value: boolean) => setChatCfg(["confirm_send"], value),
      onConfirmAiInsertChange: (value: boolean) => setChatCfg(["confirm_ai_insert"], value),
      saveStateMeta,
    },
    aiSectionProps: {
      learningState,
      learningLoading,
      learningBusy,
      learningError,
      saveStateMeta,
      onEnable: () => setEnableConfirmOpen(true),
      onOpenManualRule: () => setManualRuleOpen(true),
      onReset: () => setResetConfirmOpen(true),
      onDisable: () => void handleToggleLearning(false),
      onDeleteEntry: (entryId: number) => void handleDeleteLearningEntry(entryId),
    },
    dialogsProps: {
      signature: {
        open: signatureOpen,
        brands,
        sigBrand,
        sigRating,
        sigText,
        sigEditingTarget,
        onOpenChange: (open: boolean) => {
          if (open) {
            setSignatureOpen(true)
            return
          }
          closeSignatureDialog()
        },
        onBrandChange: setSigBrand,
        onRatingChange: setSigRating,
        onTextChange: setSigText,
        onSave: saveSignature,
      },
      learning: {
        learningBusy,
        learningEnabled: Boolean(learningState?.enabled),
        enableConfirmOpen,
        resetConfirmOpen,
        manualRuleOpen,
        manualInstruction,
        manualAnswerExample,
        onEnableConfirmChange: setEnableConfirmOpen,
        onConfirmEnable: () => {
          setEnableConfirmOpen(false)
          void handleToggleLearning(true)
        },
        onResetConfirmChange: setResetConfirmOpen,
        onConfirmReset: () => void handleResetLearning(),
        onManualRuleOpenChange: (open: boolean) => {
          setManualRuleOpen(open)
          if (!open) {
            setManualInstruction("")
            setManualAnswerExample("")
          }
        },
        onManualInstructionChange: setManualInstruction,
        onManualAnswerExampleChange: setManualAnswerExample,
        onCreateManualRule: () => void handleCreateLearningRule(),
      },
    },
  }
}
