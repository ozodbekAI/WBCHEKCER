import * as React from "react"

import { zodResolver } from "@hookform/resolvers/zod"
import type { ColumnDef } from "@tanstack/react-table"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { AdminAccessDenied, AdminEmptyState, AdminError, AdminPage, AdminPanel, AdminStatCard } from "@/components/admin/admin-ui"
import { AdminDataGrid } from "@/components/admin/admin-data-grid"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  adminCreateReviewCategory,
  adminCreateTone,
  adminDeleteReviewCategory,
  adminDeleteTone,
  adminGetPrompts,
  adminListReviewCategories,
  adminListTones,
  adminUpdatePrompts,
  adminUpdateReviewCategory,
  adminUpdateTone,
  getMe,
} from "@/lib/api"
import { FolderKanban, Paintbrush } from "lucide-react"

type UiOption = { value: string; label: string; hint?: string | null }

type PromptBundle = {
  review_instructions_template: string
  question_instructions_template: string
  chat_instructions_template: string
  address_format_options: UiOption[]
  address_format_map: Record<string, string>
  answer_length_options: UiOption[]
  answer_length_map: Record<string, string>
  emoji_rule_map: Record<string, string>
}

type Tone = {
  id: number
  code: string
  label: string
  hint?: string | null
  instruction?: string | null
  example?: string | null
  sort_order: number
  is_active: boolean
}

type ReviewCategory = {
  id: number
  code: string
  label: string
  positive_prompt: string
  negative_prompt: string
  sort_order: number
  is_active: boolean
}

const toneSchema = z.object({
  label: z.string().min(1, "Введите название"),
  hint: z.string().optional(),
  instruction: z.string().optional(),
  example: z.string().optional(),
  is_active: z.boolean(),
})

const categorySchema = z.object({
  label: z.string().min(1, "Введите название"),
  positive_prompt: z.string().min(1, "Введите позитивный промпт"),
  negative_prompt: z.string().min(1, "Введите негативный промпт"),
  is_active: z.boolean(),
})

type ToneFormValues = z.infer<typeof toneSchema>
type CategoryFormValues = z.infer<typeof categorySchema>

const DEFAULT_ADDRESS_FORMAT_OPTIONS: UiOption[] = [
  { value: "vy_caps", label: "Вы (с большой буквы)", hint: "Вежливое обращение: Вы/Ваш/Вам" },
  { value: "vy_lower", label: "вы (с маленькой буквы)", hint: "Вежливое обращение: вы/ваш/вам" },
  { value: "ty", label: "ты", hint: "Неформальное обращение: ты/твой" },
]

const DEFAULT_ANSWER_LENGTH_OPTIONS: UiOption[] = [
  { value: "short", label: "Коротко", hint: "1-2 предложения" },
  { value: "default", label: "Обычно", hint: "Стандартная длина" },
  { value: "long", label: "Развернуто", hint: "До 5 предложений" },
]

function excerpt(value: string | null | undefined, max = 120) {
  const text = String(value || "").trim()
  if (!text) return "—"
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function normalizeUiOption(input: any): UiOption {
  const value = typeof input?.value === "string" ? input.value.trim() : ""
  const label = typeof input?.label === "string" ? input.label.trim() : ""
  const hint = typeof input?.hint === "string" ? input.hint.trim() : ""
  return {
    value: value.slice(0, 64),
    label: (label || value || "").slice(0, 120),
    hint: hint ? hint.slice(0, 220) : null,
  }
}

function ensureBundle(input: any): PromptBundle {
  const addressOptions = (Array.isArray(input?.address_format_options) ? input.address_format_options : DEFAULT_ADDRESS_FORMAT_OPTIONS)
    .map(normalizeUiOption)
    .filter((item: UiOption) => item.value && item.label)
  const answerOptions = (Array.isArray(input?.answer_length_options) ? input.answer_length_options : DEFAULT_ANSWER_LENGTH_OPTIONS)
    .map(normalizeUiOption)
    .filter((item: UiOption) => item.value && item.label)

  return {
    review_instructions_template: String(input?.review_instructions_template || ""),
    question_instructions_template: String(input?.question_instructions_template || ""),
    chat_instructions_template: String(input?.chat_instructions_template || ""),
    address_format_options: addressOptions.length ? addressOptions : DEFAULT_ADDRESS_FORMAT_OPTIONS,
    address_format_map: input?.address_format_map && typeof input.address_format_map === "object" ? input.address_format_map : {},
    answer_length_options: answerOptions.length ? answerOptions : DEFAULT_ANSWER_LENGTH_OPTIONS,
    answer_length_map: input?.answer_length_map && typeof input.answer_length_map === "object" ? input.answer_length_map : {},
    emoji_rule_map: input?.emoji_rule_map && typeof input.emoji_rule_map === "object" ? input.emoji_rule_map : {},
  }
}

function OptionRuleEditor({
  title,
  options,
  rules,
  onChange,
}: {
  title: string
  options: UiOption[]
  rules: Record<string, string>
  onChange: (nextOptions: UiOption[], nextRules: Record<string, string>) => void
}) {
  const updateOption = (index: number, patch: Partial<UiOption>) => {
    const nextOptions = options.map((option, currentIndex) => (currentIndex === index ? { ...option, ...patch } : option))
    onChange(nextOptions, rules)
  }

  const updateRule = (value: string, text: string) => {
    const nextRules = { ...rules }
    if (!text.trim()) {
      delete nextRules[value]
    } else {
      nextRules[value] = text
    }
    onChange(options, nextRules)
  }

  return (
    <AdminPanel title={title} description="Здесь вместе редактируются подпись, подсказка и правило для модели.">
      <div className="space-y-4">
        {options.map((option, index) => (
          <div key={option.value} className="rounded-[22px] border border-border/70 bg-background/80 p-4">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge variant="outline">{option.value}</Badge>
              <div className="text-sm font-medium text-foreground">{option.label}</div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <Label>Название</Label>
                <Input value={option.label} onChange={(event) => updateOption(index, { label: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Подсказка</Label>
                <Input value={option.hint || ""} onChange={(event) => updateOption(index, { hint: event.target.value })} />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <Label>Правило для ИИ</Label>
              <Textarea value={rules[option.value] || ""} onChange={(event) => updateRule(option.value, event.target.value)} className="min-h-[120px]" />
            </div>
          </div>
        ))}
      </div>
    </AdminPanel>
  )
}

function ToneDrawer({
  open,
  onOpenChange,
  initial,
  onSubmit,
  saving,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
  initial: Tone | null
  onSubmit: (payload: ToneFormValues) => Promise<void>
  saving: boolean
}) {
  const form = useForm<ToneFormValues>({
    resolver: zodResolver(toneSchema),
    defaultValues: {
      label: "",
      hint: "",
      instruction: "",
      example: "",
      is_active: true,
    },
  })

  React.useEffect(() => {
    form.reset({
      label: initial?.label || "",
      hint: initial?.hint || "",
      instruction: initial?.instruction || "",
      example: initial?.example || "",
      is_active: initial?.is_active ?? true,
    })
  }, [form, initial, open])

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="right-0 w-full max-w-2xl border-l border-border/70 bg-stone-50">
        <DrawerHeader>
          <DrawerTitle>{initial ? "Редактирование тональности" : "Новая тональность"}</DrawerTitle>
          <DrawerDescription>Здесь редактируются только рабочие поля. Код и порядок система ведёт сама.</DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto px-5 pb-5">
          <Form {...form}>
            <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
              <FormField
                control={form.control}
                name="label"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Название</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Тёплая и уверенная" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="hint"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Короткая подсказка</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Как эта тональность должна восприниматься оператором" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="instruction"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Инструкция</FormLabel>
                    <FormControl>
                      <Textarea {...field} className="min-h-[180px]" placeholder="Опишите, как модель должна держать этот тон." />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="example"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Пример ответа</FormLabel>
                    <FormControl>
                      <Textarea {...field} className="min-h-[150px]" placeholder="Пример готового ответа" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="is_active"
                render={({ field }) => (
                  <FormItem className="rounded-[22px] border border-border/70 bg-background/80 px-4 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <FormLabel>Активна</FormLabel>
                        <div className="text-sm text-muted-foreground">Только активные тональности доступны в настройках магазина.</div>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </div>
                  </FormItem>
                )}
              />
              <DrawerFooter className="px-0 pb-0">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                  Отмена
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Сохранение..." : "Сохранить"}
                </Button>
              </DrawerFooter>
            </form>
          </Form>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function CategoryDrawer({
  open,
  onOpenChange,
  initial,
  onSubmit,
  saving,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
  initial: ReviewCategory | null
  onSubmit: (payload: CategoryFormValues) => Promise<void>
  saving: boolean
}) {
  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      label: "",
      positive_prompt: "",
      negative_prompt: "",
      is_active: true,
    },
  })

  React.useEffect(() => {
    form.reset({
      label: initial?.label || "",
      positive_prompt: initial?.positive_prompt || "",
      negative_prompt: initial?.negative_prompt || "",
      is_active: initial?.is_active ?? true,
    })
  }, [form, initial, open])

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="right-0 w-full max-w-3xl border-l border-border/70 bg-stone-50">
        <DrawerHeader>
          <DrawerTitle>{initial ? "Редактирование категории" : "Новая категория"}</DrawerTitle>
          <DrawerDescription>Укажите название категории и отдельные промпты для позитивного и негативного сентимента.</DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto px-5 pb-5">
          <Form {...form}>
            <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
              <FormField
                control={form.control}
                name="label"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Название</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Размер / посадка" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 xl:grid-cols-2">
                <FormField
                control={form.control}
                name="positive_prompt"
                render={({ field }) => (
                  <FormItem>
                      <FormLabel>Позитивный промпт</FormLabel>
                      <FormControl>
                        <Textarea {...field} className="min-h-[220px]" placeholder="Как модель должна учитывать эту категорию, если сентимент позитивный." />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                control={form.control}
                name="negative_prompt"
                render={({ field }) => (
                  <FormItem>
                      <FormLabel>Негативный промпт</FormLabel>
                      <FormControl>
                        <Textarea {...field} className="min-h-[220px]" placeholder="Как модель должна учитывать эту категорию, если сентимент негативный." />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="is_active"
                render={({ field }) => (
                  <FormItem className="rounded-[22px] border border-border/70 bg-background/80 px-4 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <FormLabel>Активна</FormLabel>
                        <div className="text-sm text-muted-foreground">Только активные категории участвуют в классификации ИИ.</div>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </div>
                  </FormItem>
                )}
              />
              <DrawerFooter className="px-0 pb-0">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                  Отмена
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Сохранение..." : "Сохранить"}
                </Button>
              </DrawerFooter>
            </form>
          </Form>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

export default function AdminPromptsPage() {
  const [allowed, setAllowed] = React.useState<boolean | null>(null)
  const [bundle, setBundle] = React.useState<PromptBundle | null>(null)
  const [reviewCategories, setReviewCategories] = React.useState<ReviewCategory[]>([])
  const [tones, setTones] = React.useState<Tone[]>([])
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [toneDrawerOpen, setToneDrawerOpen] = React.useState(false)
  const [categoryDrawerOpen, setCategoryDrawerOpen] = React.useState(false)
  const [editingTone, setEditingTone] = React.useState<Tone | null>(null)
  const [editingCategory, setEditingCategory] = React.useState<ReviewCategory | null>(null)
  const [selectedToneId, setSelectedToneId] = React.useState<number | null>(null)
  const [selectedCategoryId, setSelectedCategoryId] = React.useState<number | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const me = await getMe()
      const isSuperAdmin = me?.role === "super_admin"
      setAllowed(isSuperAdmin)
      if (!isSuperAdmin) {
        setBundle(null)
        setReviewCategories([])
        setTones([])
        return
      }

      const [nextBundle, nextTones, nextCategories] = await Promise.all([
        adminGetPrompts(),
        adminListTones(),
        adminListReviewCategories(),
      ])

      const normalizedBundle = ensureBundle(nextBundle)
      const normalizedTones = Array.isArray(nextTones) ? nextTones : []
      const normalizedCategories = Array.isArray(nextCategories) ? nextCategories : []

      setBundle(normalizedBundle)
      setTones(normalizedTones)
      setReviewCategories(normalizedCategories)
      setSelectedToneId((prev) => prev ?? normalizedTones[0]?.id ?? null)
      setSelectedCategoryId((prev) => prev ?? normalizedCategories[0]?.id ?? null)
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить настройки промптов")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const saveBundle = async () => {
    if (!bundle) return
    setSaving(true)
    setError(null)
    try {
      await adminUpdatePrompts(bundle)
      await load()
    } catch (e: any) {
      setError(e?.message || "Не удалось сохранить набор промптов")
    } finally {
      setSaving(false)
    }
  }

  const submitTone = async (payload: ToneFormValues) => {
    setSaving(true)
    setError(null)
    try {
      if (editingTone?.id) {
        await adminUpdateTone(editingTone.id, payload)
      } else {
        await adminCreateTone(payload as any)
      }
      setToneDrawerOpen(false)
      setEditingTone(null)
      await load()
    } catch (e: any) {
      setError(e?.message || "Не удалось сохранить тональность")
    } finally {
      setSaving(false)
    }
  }

  const submitCategory = async (payload: CategoryFormValues) => {
    setSaving(true)
    setError(null)
    try {
      if (editingCategory?.id) {
        await adminUpdateReviewCategory(editingCategory.id, payload)
      } else {
        await adminCreateReviewCategory(payload as any)
      }
      setCategoryDrawerOpen(false)
      setEditingCategory(null)
      await load()
    } catch (e: any) {
      setError(e?.message || "Не удалось сохранить категорию")
    } finally {
      setSaving(false)
    }
  }

  const removeTone = async (toneId: number) => {
    setError(null)
    try {
      await adminDeleteTone(toneId)
      await load()
    } catch (e: any) {
      setError(e?.message || "Не удалось удалить тональность")
    }
  }

  const removeCategory = async (categoryId: number) => {
    setError(null)
    try {
      await adminDeleteReviewCategory(categoryId)
      await load()
    } catch (e: any) {
      setError(e?.message || "Не удалось удалить категорию")
    }
  }

  const selectedTone = tones.find((tone) => tone.id === selectedToneId) || tones[0] || null
  const selectedCategory = reviewCategories.find((category) => category.id === selectedCategoryId) || reviewCategories[0] || null

  const toneColumns = React.useMemo<ColumnDef<Tone>[]>(
    () => [
      {
        header: "Тональность",
        accessorKey: "label",
        cell: ({ row }) => (
          <div className="space-y-1">
            <div className="font-medium text-foreground">{row.original.label}</div>
            <div className="text-sm text-muted-foreground">{excerpt(row.original.hint || row.original.example || row.original.instruction, 72)}</div>
          </div>
        ),
      },
      {
        header: "Статус",
        cell: ({ row }) => <Badge variant={row.original.is_active ? "default" : "secondary"}>{row.original.is_active ? "Активна" : "Неактивна"}</Badge>,
      },
    ],
    [],
  )

  const categoryColumns = React.useMemo<ColumnDef<ReviewCategory>[]>(
    () => [
      {
        header: "Категория",
        accessorKey: "label",
        cell: ({ row }) => (
          <div className="space-y-1">
            <div className="font-medium text-foreground">{row.original.label}</div>
            <div className="text-sm text-muted-foreground">{excerpt(row.original.positive_prompt, 72)}</div>
          </div>
        ),
      },
      {
        header: "Статус",
        cell: ({ row }) => <Badge variant={row.original.is_active ? "default" : "secondary"}>{row.original.is_active ? "Активна" : "Неактивна"}</Badge>,
      },
    ],
    [],
  )

  if (allowed === false) {
    return <AdminAccessDenied description="Управление промптами доступно только суперадмину." />
  }

  return (
    <AdminPage
      title="Промпт-центр"
      description="Здесь управляются базовые промпты, тональности и категории отзывов для генерации ИИ."
      actions={
        <>
          <Button variant="outline" onClick={load} disabled={loading || saving}>
            Обновить
          </Button>
          <Button onClick={saveBundle} disabled={!bundle || loading || saving}>
            {saving ? "Сохранение..." : "Сохранить промпты"}
          </Button>
        </>
      }
    >
      <AdminError message={error} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <AdminStatCard label="Базовые шаблоны" value={bundle ? 3 : "—"} hint="Системные промпты для отзывов, вопросов и чата" tone="accent" />
        <AdminStatCard label="Тональности" value={tones.length} hint={`Активно: ${tones.filter((tone) => tone.is_active).length}`} />
        <AdminStatCard label="Категории отзывов" value={reviewCategories.length} hint={`Активно: ${reviewCategories.filter((category) => category.is_active).length}`} />
      </div>

      <Tabs defaultValue="templates" className="space-y-6">
        <TabsList className="w-full justify-start overflow-x-auto rounded-full bg-muted/30 p-1">
          <TabsTrigger value="templates">Шаблоны</TabsTrigger>
          <TabsTrigger value="categories">Категории</TabsTrigger>
          <TabsTrigger value="tones">Тональности</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-3">
            <AdminPanel title="Инструкции для отзывов" description="Главный системный промпт для ответов на отзывы." tone="accent">
              <Textarea
                value={bundle?.review_instructions_template || ""}
                onChange={(event) => setBundle((prev) => (prev ? { ...prev, review_instructions_template: event.target.value } : prev))}
                className="min-h-[260px]"
              />
            </AdminPanel>
            <AdminPanel title="Инструкции для вопросов" description="Главный промпт для ответов на вопросы маркетплейса.">
              <Textarea
                value={bundle?.question_instructions_template || ""}
                onChange={(event) => setBundle((prev) => (prev ? { ...prev, question_instructions_template: event.target.value } : prev))}
                className="min-h-[260px]"
              />
            </AdminPanel>
            <AdminPanel title="Инструкции для чата" description="Базовый промпт для внутренних chat-сценариев.">
              <Textarea
                value={bundle?.chat_instructions_template || ""}
                onChange={(event) => setBundle((prev) => (prev ? { ...prev, chat_instructions_template: event.target.value } : prev))}
                className="min-h-[260px]"
              />
            </AdminPanel>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <OptionRuleEditor
              title="Варианты обращения"
              options={bundle?.address_format_options || DEFAULT_ADDRESS_FORMAT_OPTIONS}
              rules={bundle?.address_format_map || {}}
              onChange={(nextOptions, nextRules) =>
                setBundle((prev) =>
                  prev
                    ? {
                        ...prev,
                        address_format_options: nextOptions,
                        address_format_map: nextRules,
                      }
                    : prev,
                )
              }
            />

            <OptionRuleEditor
              title="Варианты длины ответа"
              options={bundle?.answer_length_options || DEFAULT_ANSWER_LENGTH_OPTIONS}
              rules={bundle?.answer_length_map || {}}
              onChange={(nextOptions, nextRules) =>
                setBundle((prev) =>
                  prev
                    ? {
                        ...prev,
                        answer_length_options: nextOptions,
                        answer_length_map: nextRules,
                      }
                    : prev,
                )
              }
            />
          </div>

          <AdminPanel title="Правила для эмодзи" description="Отдельные инструкции для режимов с эмодзи и без них.">
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-2">
                <Label>Эмодзи включены</Label>
                <Textarea
                  value={bundle?.emoji_rule_map?.on || ""}
                  onChange={(event) =>
                    setBundle((prev) =>
                      prev
                        ? {
                            ...prev,
                            emoji_rule_map: {
                              ...prev.emoji_rule_map,
                              on: event.target.value,
                            },
                          }
                        : prev,
                    )
                  }
                  className="min-h-[160px]"
                />
              </div>
              <div className="space-y-2">
                <Label>Эмодзи выключены</Label>
                <Textarea
                  value={bundle?.emoji_rule_map?.off || ""}
                  onChange={(event) =>
                    setBundle((prev) =>
                      prev
                        ? {
                            ...prev,
                            emoji_rule_map: {
                              ...prev.emoji_rule_map,
                              off: event.target.value,
                            },
                          }
                        : prev,
                    )
                  }
                  className="min-h-[160px]"
                />
              </div>
            </div>
          </AdminPanel>
        </TabsContent>

        <TabsContent value="categories" className="space-y-6">
          <div className="grid gap-6 2xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <AdminPanel
              title="Категории отзывов"
              description="Список категорий, которые участвуют в классификации отзывов."
              actions={
                <Button
                  onClick={() => {
                    setEditingCategory(null)
                    setCategoryDrawerOpen(true)
                  }}
                >
                  Добавить категорию
                </Button>
              }
            >
              <AdminDataGrid
                data={reviewCategories}
                columns={categoryColumns}
                searchPlaceholder="Поиск по категориям"
                emptyTitle="Категорий пока нет"
                emptyDescription="Создайте первую категорию и задайте для неё позитивный и негативный промпты."
                onRowClick={(row) => setSelectedCategoryId(row.original.id)}
                selectedRowKey={selectedCategory?.id || null}
                getRowKey={(row) => String(row.id)}
                maxHeight="460px"
              />
            </AdminPanel>

            <AdminPanel title="Карточка категории" description="Просмотр выбранной категории и связанных с ней промптов." tone="accent">
              {!selectedCategory ? (
                <AdminEmptyState title="Выберите категорию" description="Нажмите на строку слева, чтобы посмотреть детали категории." icon={<FolderKanban className="size-5" />} />
              ) : (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={selectedCategory.is_active ? "default" : "secondary"}>{selectedCategory.is_active ? "Активна" : "Неактивна"}</Badge>
                    <Badge variant="outline">{selectedCategory.code}</Badge>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold tracking-tight text-foreground">{selectedCategory.label}</div>
                  </div>
                  <div className="grid gap-4 xl:grid-cols-2">
                    <AdminPanel title="Позитивный промпт" description="Используется, когда ИИ возвращает эту категорию с позитивным сентиментом.">
                      <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">{selectedCategory.positive_prompt}</div>
                    </AdminPanel>
                    <AdminPanel title="Негативный промпт" description="Используется, когда ИИ возвращает эту категорию с негативным сентиментом.">
                      <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">{selectedCategory.negative_prompt}</div>
                    </AdminPanel>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditingCategory(selectedCategory)
                        setCategoryDrawerOpen(true)
                      }}
                    >
                      Редактировать
                    </Button>
                    <Button variant="outline" onClick={() => removeCategory(selectedCategory.id)}>
                      Удалить
                    </Button>
                  </div>
                </div>
              )}
            </AdminPanel>
          </div>
        </TabsContent>

        <TabsContent value="tones" className="space-y-6">
          <div className="grid gap-6 2xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <AdminPanel
              title="Тональности"
              description="Список тональностей, доступных в настройках магазина и в карте сентимента."
              actions={
                <Button
                  onClick={() => {
                    setEditingTone(null)
                    setToneDrawerOpen(true)
                  }}
                >
                  Добавить тональность
                </Button>
              }
            >
              <AdminDataGrid
                data={tones}
                columns={toneColumns}
                searchPlaceholder="Поиск по тональностям"
                emptyTitle="Тональностей пока нет"
                emptyDescription="Создайте первую тональность для магазинов и карты сентимента."
                onRowClick={(row) => setSelectedToneId(row.original.id)}
                selectedRowKey={selectedTone?.id || null}
                getRowKey={(row) => String(row.id)}
                maxHeight="460px"
              />
            </AdminPanel>

            <AdminPanel title="Карточка тональности" description="Просмотр выбранной тональности и связанных инструкций." tone="accent">
              {!selectedTone ? (
                <AdminEmptyState title="Выберите тональность" description="Нажмите на строку слева, чтобы посмотреть инструкцию и пример." icon={<Paintbrush className="size-5" />} />
              ) : (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={selectedTone.is_active ? "default" : "secondary"}>{selectedTone.is_active ? "Активна" : "Неактивна"}</Badge>
                    <Badge variant="outline">{selectedTone.code}</Badge>
                  </div>
                  <div className="text-2xl font-semibold tracking-tight text-foreground">{selectedTone.label}</div>
                  <div className="grid gap-4 xl:grid-cols-3">
                    <AdminPanel title="Подсказка" description="Короткое пояснение для оператора.">
                      <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">{selectedTone.hint || "—"}</div>
                    </AdminPanel>
                    <AdminPanel title="Инструкция" description="Промпт-инструкция, которую получает модель." className="xl:col-span-2">
                      <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">{selectedTone.instruction || "—"}</div>
                    </AdminPanel>
                  </div>
                  <AdminPanel title="Пример" description="Опорный пример ответа для команды.">
                    <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">{selectedTone.example || "—"}</div>
                  </AdminPanel>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditingTone(selectedTone)
                        setToneDrawerOpen(true)
                      }}
                    >
                      Редактировать
                    </Button>
                    <Button variant="outline" onClick={() => removeTone(selectedTone.id)}>
                      Удалить
                    </Button>
                  </div>
                </div>
              )}
            </AdminPanel>
          </div>
        </TabsContent>
      </Tabs>

      <ToneDrawer open={toneDrawerOpen} onOpenChange={setToneDrawerOpen} initial={editingTone} onSubmit={submitTone} saving={saving} />
      <CategoryDrawer open={categoryDrawerOpen} onOpenChange={setCategoryDrawerOpen} initial={editingCategory} onSubmit={submitCategory} saving={saving} />
    </AdminPage>
  )
}
