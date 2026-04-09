import { useEffect, useMemo, useState } from "react"

import type { ColumnDef } from "@tanstack/react-table"

import { AdminDataGrid } from "@/components/admin/admin-data-grid"
import {
  AdminCompactEmpty,
  AdminError,
  AdminKpi,
  AdminSectionCard,
  AdminSectionHeader,
} from "@/components/admin/admin-ui"
import ShopSelect from "@/components/admin/shop-select"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { adminExportLogs, adminListLogs } from "@/lib/api"
import { fmtShortTime, fmtDateFull } from "@/lib/admin-formatters"
import { cn } from "@/lib/utils"
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Info,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react"

type LogRow = {
  id?: number
  created_at?: string
  time?: string
  level?: string
  severity?: string
  event?: string
  message?: string
  shop_id?: number
}

function levelChip(level: string | undefined) {
  const l = (level || "").toLowerCase()
  if (l === "error" || l === "critical") return (
    <div className="flex items-center gap-1">
      <XCircle className="h-3 w-3 text-red-500" />
      <span className="text-[10px] font-semibold text-red-600 uppercase">{level}</span>
    </div>
  )
  if (l === "warning" || l === "warn") return (
    <div className="flex items-center gap-1">
      <AlertTriangle className="h-3 w-3 text-amber-500" />
      <span className="text-[10px] font-semibold text-amber-600 uppercase">{level}</span>
    </div>
  )
  if (l === "info") return (
    <div className="flex items-center gap-1">
      <Info className="h-3 w-3 text-blue-500" />
      <span className="text-[10px] font-semibold text-blue-600 uppercase">{level}</span>
    </div>
  )
  return (
    <div className="flex items-center gap-1">
      <CheckCircle2 className="h-3 w-3 text-muted-foreground/50" />
      <span className="text-[10px] font-semibold text-muted-foreground uppercase">{level || "—"}</span>
    </div>
  )
}

export default function LogsPage() {
  const [shopId, setShopId] = useState<number | null>(null)
  const [rows, setRows] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedRow, setSelectedRow] = useState<LogRow | null>(null)

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const list = await adminListLogs(shopId ? { shop_id: shopId } : undefined)
      setRows(Array.isArray(list) ? list : [])
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить логи")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const exportCsv = async () => {
    try {
      setLoading(true)
      setError(null)
      const result = await adminExportLogs(shopId ? { shop_id: shopId } : undefined)
      if (result?.url) window.open(result.url, "_blank")
    } catch (e: any) {
      setError(e?.message || "Не удалось экспортировать логи")
    } finally {
      setLoading(false)
    }
  }

  const errorCount = rows.filter((r) => ["error", "critical"].includes((r.level || r.severity || "").toLowerCase())).length
  const warnCount = rows.filter((r) => ["warning", "warn"].includes((r.level || r.severity || "").toLowerCase())).length

  const columns = useMemo<ColumnDef<LogRow>[]>(
    () => [
      {
        header: "Время",
        accessorKey: "created_at",
        size: 120,
        cell: ({ row }) => {
          const raw = row.original.created_at || row.original.time
          return <span className="text-[11px] tabular-nums text-muted-foreground" title={fmtDateFull(raw)}>{fmtShortTime(raw)}</span>
        },
      },
      {
        header: "Уровень",
        accessorKey: "level",
        size: 80,
        cell: ({ row }) => levelChip(row.original.level || row.original.severity),
      },
      {
        header: "Событие",
        accessorKey: "event",
        cell: ({ row }) => <span className="text-[12px] text-foreground truncate block">{row.original.event || row.original.message || "—"}</span>,
      },
      {
        header: "Магазин",
        accessorKey: "shop_id",
        size: 70,
        cell: ({ row }) => row.original.shop_id
          ? <span className="text-[11px] tabular-nums text-muted-foreground">#{row.original.shop_id}</span>
          : <span className="text-[11px] text-muted-foreground/40">—</span>,
      },
    ],
    [],
  )

  return (
    <div className="space-y-3">
      {/* Header + Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-foreground">Логи</h1>
          <p className="text-[12px] text-muted-foreground">События платформы</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={loading} className="h-8 text-[12px] gap-1.5">
            <Download className="h-3.5 w-3.5" /> Экспорт
          </Button>
          <Button size="sm" onClick={load} disabled={loading} className="h-8 text-[12px] gap-1.5">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Обновить
          </Button>
        </div>
      </div>

      <AdminError message={error} />

      {/* KPI + Filter row */}
      <div className="flex items-end gap-2 flex-wrap">
        <AdminKpi label="Записей" value={rows.length} icon={<FileText className="h-3.5 w-3.5" />} tone="accent" />
        <AdminKpi label="Ошибки" value={errorCount} icon={<XCircle className="h-3.5 w-3.5" />} tone={errorCount > 0 ? "error" : "default"} />
        <AdminKpi label="Предупреждения" value={warnCount} icon={<AlertTriangle className="h-3.5 w-3.5" />} />
        <div className="flex-1" />
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Магазин</label>
            <ShopSelect value={shopId} onChange={setShopId} />
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading} className="h-9 text-[12px] px-4">
            Применить
          </Button>
        </div>
      </div>

      {/* Logs table */}
      <AdminSectionCard>
        <AdminSectionHeader
          title="Лента событий"
          icon={<FileText className="h-3.5 w-3.5" />}
          actions={<span className="text-[11px] text-muted-foreground tabular-nums">{rows.length} записей</span>}
        />
        {!rows.length && !loading ? (
          <AdminCompactEmpty text="Логи не найдены — измените фильтры или нажмите «Обновить»" icon={<FileText className="h-5 w-5" />} />
        ) : (
          <AdminDataGrid
            data={rows}
            columns={columns}
            onRowClick={(row) => setSelectedRow(row.original)}
            searchPlaceholder="Поиск по логам…"
            emptyTitle="Логи не найдены"
            emptyDescription="Записей не найдено."
            maxHeight="calc(100vh - 280px)"
            compact
            enableSorting
            enablePagination
            pageSize={50}
          />
        )}
      </AdminSectionCard>

      {/* Detail drawer */}
      <Sheet open={selectedRow !== null} onOpenChange={(open) => !open && setSelectedRow(null)}>
        <SheetContent side="right" className="w-[min(480px,100vw)] border-l border-border/50 bg-background p-0 sm:max-w-[480px]">
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b border-border/30 px-4 py-3 bg-muted/20">
              <div className="flex items-center gap-2 pr-8">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <SheetTitle className="text-left text-sm">Детали записи</SheetTitle>
              </div>
            </SheetHeader>
            <ScrollArea className="flex-1">
              {selectedRow && (
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    {levelChip(selectedRow.level || selectedRow.severity)}
                    <span className="text-[11px] text-muted-foreground tabular-nums">{fmtDateFull(selectedRow.created_at || selectedRow.time)}</span>
                  </div>

                  <div className="rounded-xl border border-border/50 overflow-hidden">
                    <div className="px-3 py-2 bg-muted/20 border-b border-border/30">
                      <span className="text-[11px] font-semibold">Информация</span>
                    </div>
                    <div className="px-3 py-1 divide-y divide-border/20">
                      {[
                        ["ID", selectedRow.id ?? "—"],
                        ["Уровень", selectedRow.level || selectedRow.severity || "—"],
                        ["Магазин", selectedRow.shop_id ? `#${selectedRow.shop_id}` : "—"],
                        ["Время", fmtDateFull(selectedRow.created_at || selectedRow.time)],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="flex items-center justify-between py-1.5 text-[12px]">
                          <span className="text-muted-foreground">{label}</span>
                          <span className="font-mono text-[11px] text-foreground">{String(value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/50 overflow-hidden">
                    <div className="px-3 py-2 bg-muted/20 border-b border-border/30">
                      <span className="text-[11px] font-semibold">Событие</span>
                    </div>
                    <div className="px-3 py-2.5">
                      <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground">{selectedRow.event || selectedRow.message || "—"}</div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/50 overflow-hidden">
                    <div className="px-3 py-2 bg-muted/10 border-b border-border/30">
                      <span className="text-[11px] font-semibold">Raw data</span>
                    </div>
                    <div className="px-3 py-2">
                      <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[10px] leading-5 text-muted-foreground">{JSON.stringify(selectedRow, null, 2)}</pre>
                    </div>
                  </div>
                </div>
              )}
            </ScrollArea>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
