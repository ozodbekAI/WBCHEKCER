import { useEffect, useMemo, useState } from "react"

import type { ColumnDef } from "@tanstack/react-table"

import { AdminDataGrid } from "@/components/admin/admin-data-grid"
import { AdminEmptyState, AdminError, AdminKpi } from "@/components/admin/admin-ui"
import ShopSelect from "@/components/admin/shop-select"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import {
  adminGetGenerationLog,
  adminListGenerationLogs,
  type AdminGenerationLogDetail,
  type AdminGenerationLogListItem,
} from "@/lib/api"
import { fmtDate, fmtDateFull, safeText } from "@/lib/admin-formatters"
import { cn } from "@/lib/utils"
import {
  Activity,
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  Filter,
  Layers3,
  Loader2,
  RefreshCw,
  Search,
  XCircle,
  Zap,
} from "lucide-react"

/* ── helpers ── */

function asIso(value: string) {
  if (!value) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed.toISOString()
}

function DetailRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium text-foreground text-right truncate max-w-[65%]", mono && "font-mono text-[11px]")}>{value}</span>
    </div>
  )
}

/* ── main ── */

export default function GenerationLogsPage() {
  const [shopId, setShopId] = useState<number | null>(null)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [rating, setRating] = useState<string>("all")
  const [operationType, setOperationType] = useState<string>("all")
  const [provider, setProvider] = useState<string>("all")
  const [status, setStatus] = useState<string>("all")
  const [search, setSearch] = useState("")
  const [rows, setRows] = useState<AdminGenerationLogListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<AdminGenerationLogDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(true)

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await adminListGenerationLogs({
        shop_id: shopId,
        date_from: asIso(dateFrom),
        date_to: asIso(dateTo),
        rating: rating === "all" ? null : Number(rating),
        q: search.trim() || null,
        operation_type: operationType === "all" ? null : operationType,
        provider: provider === "all" ? null : provider,
        status: status === "all" ? null : status,
        limit: 100,
        offset: 0,
      })
      setRows(Array.isArray(data?.items) ? data.items : [])
      setTotal(Number(data?.total || 0))
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить журнал генераций")
    } finally {
      setLoading(false)
    }
  }

  const openDetail = async (traceId: number) => {
    try {
      setSelectedId(traceId)
      setDetailLoading(true)
      setDetail(null)
      const data = await adminGetGenerationLog(traceId)
      setDetail(data)
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить детали генерации")
    } finally {
      setDetailLoading(false)
    }
  }

  const resetFilters = () => {
    setShopId(null)
    setDateFrom("")
    setDateTo("")
    setRating("all")
    setOperationType("all")
    setProvider("all")
    setStatus("all")
    setSearch("")
  }

  useEffect(() => { void load() }, [])

  const successCount = rows.filter((r) => r.status === "success").length
  const errorCount = rows.filter((r) => r.status === "error").length
  const providerCount = new Set(rows.map((r) => r.provider).filter(Boolean)).size

  const columns = useMemo<ColumnDef<AdminGenerationLogListItem>[]>(
    () => [
      {
        header: "Время",
        size: 130,
        cell: ({ row }) => (
          <span className="text-[11px] tabular-nums text-muted-foreground">{fmtDate(row.original.created_at)}</span>
        ),
      },
      {
        header: "Магазин",
        size: 120,
        cell: ({ row }) => (
          <span className="text-[12px] font-medium text-foreground truncate">{row.original.shop_name || `#${row.original.shop_id}`}</span>
        ),
      },
      {
        header: "Операция",
        size: 130,
        cell: ({ row }) => {
          const op = row.original.operation_type
          const opLabel: Record<string, string> = {
            review_draft: "Отзыв",
            question_draft: "Вопрос",
            chat_reply: "Чат",
            review_probe: "Проба",
            review_preview: "Превью",
          }
          return (
            <Badge variant="outline" className="text-[10px] font-medium">
              {opLabel[op] || op}
            </Badge>
          )
        },
      },
      {
        header: "Провайдер",
        size: 140,
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <div className={cn("h-1.5 w-1.5 rounded-full shrink-0", row.original.provider === "gemini" ? "bg-blue-500" : row.original.provider === "openai" ? "bg-emerald-500" : "bg-muted-foreground/30")} />
            <span className="text-[12px] font-medium text-foreground">{row.original.provider || "—"}</span>
            <span className="text-[10px] text-muted-foreground truncate">{row.original.model || ""}</span>
          </div>
        ),
      },
      {
        header: "Объект",
        size: 120,
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-foreground truncate">{row.original.entity_wb_id || row.original.entity_id || "—"}</div>
            <div className="text-[10px] text-muted-foreground truncate">{row.original.user_name || ""}</div>
          </div>
        ),
      },
      {
        header: "★",
        size: 40,
        cell: ({ row }) => <span className="text-[12px] tabular-nums">{row.original.rating ?? "—"}</span>,
      },
      {
        header: "Статус",
        size: 80,
        cell: ({ row }) => {
          const s = row.original.status
          return (
            <div className="flex items-center gap-1">
              {s === "success" ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-red-500" />
              )}
              <span className={cn("text-[11px] font-medium", s === "success" ? "text-emerald-600" : "text-red-600")}>{s === "success" ? "OK" : "Ошибка"}</span>
            </div>
          )
        },
      },
    ],
    [],
  )

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-foreground">Генерации ИИ</h1>
          <p className="text-[12px] text-muted-foreground">Журнал всех генераций с полным trace</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={resetFilters} disabled={loading} className="h-8 text-[12px]">Сбросить</Button>
          <Button variant="outline" size="sm" onClick={() => setFiltersOpen((p) => !p)} className="h-8 text-[12px] gap-1.5">
            <Filter className="h-3.5 w-3.5" /> Фильтры
            <ChevronDown className={cn("h-3 w-3 transition-transform", filtersOpen && "rotate-180")} />
          </Button>
          <Button size="sm" onClick={load} disabled={loading} className="h-8 text-[12px] gap-1.5">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Загрузить
          </Button>
        </div>
      </div>

      <AdminError message={error} />

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-2">
        <AdminKpi label="Всего записей" value={total} icon={<FileText className="h-3.5 w-3.5" />} tone="accent" />
        <AdminKpi label="Успешных" value={successCount} icon={<CheckCircle2 className="h-3.5 w-3.5" />} tone="success" />
        <AdminKpi label="Ошибок" value={errorCount} icon={<AlertTriangle className="h-3.5 w-3.5" />} tone={errorCount > 0 ? "error" : "default"} />
        <AdminKpi label="Провайдеров" value={providerCount} icon={<Bot className="h-3.5 w-3.5" />} />
      </div>

      {/* Collapsible filters */}
      {filtersOpen && (
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/20 border-b border-border/30 flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-muted-foreground/60" />
            <span className="text-[13px] font-semibold text-foreground">Фильтры</span>
          </div>
          <div className="p-3 grid gap-2 grid-cols-2 md:grid-cols-4 xl:grid-cols-8">
            <div className="space-y-1 col-span-2 xl:col-span-2">
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Поиск</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ID, WB ID, имя…" className="h-8 text-[12px] pl-8" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Магазин</Label>
              <ShopSelect value={shopId} onChange={setShopId} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Операция</Label>
              <Select value={operationType} onValueChange={setOperationType}>
                <SelectTrigger className="h-8 text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  <SelectItem value="review_draft">Отзыв</SelectItem>
                  <SelectItem value="question_draft">Вопрос</SelectItem>
                  <SelectItem value="chat_reply">Чат</SelectItem>
                  <SelectItem value="review_probe">Проба</SelectItem>
                  <SelectItem value="review_preview">Превью</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Провайдер</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger className="h-8 text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="gemini">Gemini</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Статус</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-8 text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  <SelectItem value="success">Успех</SelectItem>
                  <SelectItem value="error">Ошибка</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Рейтинг</Label>
              <Select value={rating} onValueChange={setRating}>
                <SelectTrigger className="h-8 text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  {[1, 2, 3, 4, 5].map((v) => <SelectItem key={v} value={String(v)}>{v}★</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="px-3 pb-3 grid gap-2 grid-cols-2 md:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Дата от</Label>
              <Input type="datetime-local" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-[12px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Дата до</Label>
              <Input type="datetime-local" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-[12px]" />
            </div>
            <div className="col-span-2 flex items-end">
              <Button onClick={load} disabled={loading} size="sm" className="h-8 text-[12px] px-6">
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                Применить
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Log table */}
      <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
        <div className="px-4 py-2.5 bg-muted/20 border-b border-border/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-muted-foreground/60" />
            <span className="text-[13px] font-semibold text-foreground">Журнал генераций</span>
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums">{total} записей</span>
        </div>
        <div className="p-0">
          {!rows.length && !loading ? (
            <div className="flex flex-col items-center py-10 text-center">
              <FileText className="h-5 w-5 text-muted-foreground/20 mb-1.5" />
              <p className="text-[12px] text-muted-foreground">Генерации не найдены</p>
              <p className="text-[10px] text-muted-foreground/50">Измените фильтры или нажмите «Загрузить»</p>
            </div>
          ) : (
            <AdminDataGrid
              data={rows}
              columns={columns}
              onRowClick={(row) => void openDetail(row.original.id)}
              selectedRowKey={selectedId}
              getRowKey={(row) => String(row.id)}
              maxHeight="calc(100vh - 340px)"
              compact
            />
          )}
        </div>
      </div>

      {/* Detail drawer */}
      <Sheet open={selectedId !== null} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent side="right" className="w-[min(720px,100vw)] border-l border-border/50 bg-background p-0 sm:max-w-[720px]">
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b border-border/30 px-5 py-3 bg-muted/20">
              <div className="flex items-center gap-3 pr-8">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                  <Zap className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <SheetTitle className="text-left text-sm">Trace #{selectedId}</SheetTitle>
                  {detail && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {detail.status === "success" ? (
                        <Badge variant="outline" className="text-[9px] h-4 text-emerald-600 border-emerald-500/30 bg-emerald-500/5">Успех</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] h-4 text-red-600 border-red-500/30 bg-red-500/5">Ошибка</Badge>
                      )}
                      <Badge variant="outline" className="text-[9px] h-4">{detail.operation_type}</Badge>
                      <Badge variant="outline" className="text-[9px] h-4">{detail.provider}</Badge>
                    </div>
                  )}
                </div>
              </div>
            </SheetHeader>

            <div className="min-h-0 flex-1">
              <ScrollArea className="h-full">
                {detailLoading && !detail ? (
                  <div className="flex items-center gap-2 px-5 py-10 text-[12px] text-muted-foreground justify-center">
                    <Loader2 className="h-4 w-4 animate-spin" /> Загрузка...
                  </div>
                ) : !detail ? (
                  <div className="px-5 py-10 text-center">
                    <p className="text-[12px] text-muted-foreground">Trace не загружен</p>
                  </div>
                ) : (
                  <div className="space-y-3 p-4">
                    {/* Error message */}
                    {detail.error_message && (
                      <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[12px] text-red-600">
                        <span className="font-semibold">Ошибка:</span> {detail.error_message}
                      </div>
                    )}

                    {/* Summary grid */}
                    <div className="rounded-xl border border-border/50 overflow-hidden">
                      <div className="px-3 py-2 bg-muted/20 border-b border-border/30">
                        <span className="text-[11px] font-semibold text-foreground">Сводка</span>
                      </div>
                      <div className="px-3 py-1 divide-y divide-border/20">
                        <DetailRow label="Создано" value={fmtDateFull(detail.created_at)} />
                        <DetailRow label="Магазин" value={`#${detail.shop_id}`} />
                        <DetailRow label="Провайдер" value={safeText(detail.provider)} />
                        <DetailRow label="Модель" value={safeText(detail.model)} mono />
                        <DetailRow label="Операция" value={safeText(detail.operation_type)} />
                        <DetailRow label="Покупатель" value={safeText(detail.user_name, "—")} />
                        <DetailRow label="Рейтинг" value={detail.rating ?? "—"} />
                        <DetailRow label="Объект" value={safeText(detail.entity_wb_id || detail.entity_id)} mono />
                        <DetailRow label="Latency" value={detail.latency_ms ? `${detail.latency_ms} мс` : "—"} />
                        <DetailRow label="Prompt tokens" value={detail.prompt_tokens ?? "—"} />
                        <DetailRow label="Completion tokens" value={detail.completion_tokens ?? "—"} />
                        <DetailRow label="Источник" value={safeText(detail.source)} />
                      </div>
                    </div>

                    {/* Output */}
                    <div className="rounded-xl border border-border/50 overflow-hidden">
                      <div className="px-3 py-2 bg-emerald-500/5 border-b border-emerald-500/10 flex items-center gap-1.5">
                        <Check className="h-3 w-3 text-emerald-600" />
                        <span className="text-[11px] font-semibold text-foreground">Ответ модели</span>
                      </div>
                      <div className="px-3 py-2.5">
                        <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground">{safeText(detail.output_text)}</div>
                      </div>
                    </div>

                    {/* Runtime */}
                    <div className="rounded-xl border border-border/50 overflow-hidden">
                      <div className="px-3 py-2 bg-muted/20 border-b border-border/30 flex items-center gap-1.5">
                        <Layers3 className="h-3 w-3 text-muted-foreground" />
                        <span className="text-[11px] font-semibold text-foreground">Runtime</span>
                      </div>
                      <div className="px-3 py-1 divide-y divide-border/20">
                        <DetailRow label="Источник выбора" value={safeText(detail.runtime_source)} />
                        <DetailRow label="Причина" value={safeText(detail.runtime_reason)} />
                        <DetailRow label="Response ID" value={safeText(detail.response_id)} mono />
                        <DetailRow label="Тип сущности" value={safeText(detail.entity_type)} />
                        <DetailRow label="Draft ID" value={detail.draft_id ?? "—"} mono />
                      </div>
                    </div>

                    {/* Instructions + Input */}
                    <Accordion type="multiple" className="space-y-2">
                      {detail.instructions && (
                        <AccordionItem value="instructions" className="rounded-xl border border-border/50 overflow-hidden">
                          <AccordionTrigger className="px-3 py-2 text-[12px] hover:no-underline bg-muted/10">Инструкции</AccordionTrigger>
                          <AccordionContent className="px-3 pb-2">
                            <Textarea value={String(detail.instructions)} readOnly className="min-h-[140px] text-[11px] font-mono" />
                          </AccordionContent>
                        </AccordionItem>
                      )}
                      {detail.input_text && (
                        <AccordionItem value="input" className="rounded-xl border border-border/50 overflow-hidden">
                          <AccordionTrigger className="px-3 py-2 text-[12px] hover:no-underline bg-muted/10">Входной текст</AccordionTrigger>
                          <AccordionContent className="px-3 pb-2">
                            <Textarea value={String(detail.input_text)} readOnly className="min-h-[100px] text-[11px] font-mono" />
                          </AccordionContent>
                        </AccordionItem>
                      )}

                      {/* Technical data */}
                      {detail.settings_snapshot && (
                        <AccordionItem value="settings" className="rounded-xl border border-border/50 overflow-hidden">
                          <AccordionTrigger className="px-3 py-2 text-[12px] hover:no-underline bg-muted/10">Settings snapshot</AccordionTrigger>
                          <AccordionContent className="px-3 pb-2">
                            <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[10px] leading-5 text-muted-foreground bg-muted/20 rounded-md p-2">{JSON.stringify(detail.settings_snapshot, null, 2)}</pre>
                          </AccordionContent>
                        </AccordionItem>
                      )}
                      {detail.build_params && (
                        <AccordionItem value="build" className="rounded-xl border border-border/50 overflow-hidden">
                          <AccordionTrigger className="px-3 py-2 text-[12px] hover:no-underline bg-muted/10">Build params</AccordionTrigger>
                          <AccordionContent className="px-3 pb-2">
                            <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[10px] leading-5 text-muted-foreground bg-muted/20 rounded-md p-2">{JSON.stringify(detail.build_params, null, 2)}</pre>
                          </AccordionContent>
                        </AccordionItem>
                      )}
                      {detail.context && (
                        <AccordionItem value="context" className="rounded-xl border border-border/50 overflow-hidden">
                          <AccordionTrigger className="px-3 py-2 text-[12px] hover:no-underline bg-muted/10">Context</AccordionTrigger>
                          <AccordionContent className="px-3 pb-2">
                            <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[10px] leading-5 text-muted-foreground bg-muted/20 rounded-md p-2">{JSON.stringify(detail.context, null, 2)}</pre>
                          </AccordionContent>
                        </AccordionItem>
                      )}
                      {detail.raw_messages && (
                        <AccordionItem value="raw" className="rounded-xl border border-border/50 overflow-hidden">
                          <AccordionTrigger className="px-3 py-2 text-[12px] hover:no-underline bg-muted/10">Raw messages</AccordionTrigger>
                          <AccordionContent className="px-3 pb-2">
                            <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[10px] leading-5 text-muted-foreground bg-muted/20 rounded-md p-2">{JSON.stringify(detail.raw_messages, null, 2)}</pre>
                          </AccordionContent>
                        </AccordionItem>
                      )}
                      {detail.debug_report && (
                        <AccordionItem value="debug" className="rounded-xl border border-border/50 overflow-hidden">
                          <AccordionTrigger className="px-3 py-2 text-[12px] hover:no-underline bg-muted/10">Debug report</AccordionTrigger>
                          <AccordionContent className="px-3 pb-2">
                            <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[10px] leading-5 text-muted-foreground bg-muted/20 rounded-md p-2">{JSON.stringify(detail.debug_report, null, 2)}</pre>
                          </AccordionContent>
                        </AccordionItem>
                      )}
                    </Accordion>
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
