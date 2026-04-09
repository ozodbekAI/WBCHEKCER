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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { adminAuditList } from "@/lib/api"
import { fmtShortTime, fmtDateFull } from "@/lib/admin-formatters"
import { cn } from "@/lib/utils"
import {
  ClipboardList,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  Shield,
  User,
  Zap,
} from "lucide-react"

type AuditRow = {
  id?: number
  created_at?: string
  actor_id?: number
  action?: string
  event_type?: string
  entity?: string
  scope?: string
  details?: unknown
  meta?: unknown
}

const actionColors: Record<string, string> = {
  create: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  update: "bg-blue-500/10 text-blue-700 border-blue-500/20",
  delete: "bg-red-500/10 text-red-700 border-red-500/20",
  login: "bg-primary/10 text-primary border-primary/20",
}

function actionChip(action: string | undefined) {
  const a = (action || "").toLowerCase()
  const color = Object.entries(actionColors).find(([k]) => a.includes(k))?.[1] || "bg-muted/30 text-foreground border-border/50"
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold", color)}>{action || "—"}</span>
}

export default function AuditPage() {
  const [shopId, setShopId] = useState<number | null>(null)
  const [rows, setRows] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedRow, setSelectedRow] = useState<AuditRow | null>(null)
  const [searchQ, setSearchQ] = useState("")
  const [actorFilter, setActorFilter] = useState<string>("all")
  const [actionFilter, setActionFilter] = useState<string>("all")

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const list = await adminAuditList(shopId ? { shop_id: shopId } : undefined)
      setRows(Array.isArray(list) ? list : [])
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить аудит")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const uniqueActors = useMemo(() => [...new Set(rows.map((r) => r.actor_id).filter(Boolean))], [rows])
  const uniqueActions = useMemo(() => [...new Set(rows.map((r) => r.action || r.event_type).filter(Boolean))], [rows])

  const filtered = useMemo(() => {
    let list = rows
    if (actorFilter !== "all") list = list.filter((r) => String(r.actor_id) === actorFilter)
    if (actionFilter !== "all") list = list.filter((r) => (r.action || r.event_type) === actionFilter)
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase()
      list = list.filter((r) =>
        (r.action || "").toLowerCase().includes(q) ||
        (r.event_type || "").toLowerCase().includes(q) ||
        (r.entity || "").toLowerCase().includes(q) ||
        (r.scope || "").toLowerCase().includes(q) ||
        String(r.actor_id || "").includes(q) ||
        JSON.stringify(r.details || r.meta || {}).toLowerCase().includes(q)
      )
    }
    return list
  }, [rows, actorFilter, actionFilter, searchQ])

  const columns = useMemo<ColumnDef<AuditRow>[]>(
    () => [
      {
        header: "Время",
        accessorKey: "created_at",
        size: 110,
        cell: ({ row }) => <span className="text-[11px] tabular-nums text-muted-foreground" title={fmtDateFull(row.original.created_at)}>{fmtShortTime(row.original.created_at)}</span>,
      },
      {
        header: "Автор",
        accessorKey: "actor_id",
        size: 80,
        cell: ({ row }) => row.original.actor_id ? (
          <div className="flex items-center gap-1">
            <User className="h-3 w-3 text-muted-foreground/50" />
            <span className="text-[11px] font-medium tabular-nums text-foreground">#{row.original.actor_id}</span>
          </div>
        ) : <span className="text-[11px] text-muted-foreground/40">—</span>,
      },
      {
        header: "Действие",
        accessorKey: "action",
        size: 140,
        cell: ({ row }) => actionChip(row.original.action || row.original.event_type),
      },
      {
        header: "Сущность",
        accessorKey: "entity",
        size: 120,
        cell: ({ row }) => {
          const entity = row.original.entity || row.original.scope
          return entity ? <Badge variant="outline" className="text-[10px] font-medium">{entity}</Badge> : <span className="text-[11px] text-muted-foreground/40">—</span>
        },
      },
      {
        header: "Детали",
        cell: ({ row }) => {
          const data = row.original.details ?? row.original.meta ?? {}
          const text = JSON.stringify(data)
          if (text === "{}" || text === "null") return <span className="text-[11px] text-muted-foreground/40">—</span>
          return <span className="text-[10px] text-muted-foreground truncate block max-w-[300px] font-mono" title={text}>{text}</span>
        },
      },
    ],
    [],
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-foreground">Аудит</h1>
          <p className="text-[12px] text-muted-foreground">Журнал административных действий</p>
        </div>
        <Button size="sm" onClick={load} disabled={loading} className="h-8 text-[12px] gap-1.5">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Обновить
        </Button>
      </div>

      <AdminError message={error} />

      <div className="grid grid-cols-3 gap-2">
        <AdminKpi label="Событий" value={filtered.length} icon={<ClipboardList className="h-3.5 w-3.5" />} tone="accent" />
        <AdminKpi label="Авторов" value={uniqueActors.length} icon={<Shield className="h-3.5 w-3.5" />} />
        <AdminKpi label="Типов действий" value={uniqueActions.length} icon={<Zap className="h-3.5 w-3.5" />} />
      </div>

      {/* Filter toolbar */}
      <AdminSectionCard>
        <AdminSectionHeader title="Фильтры" icon={<Search className="h-3.5 w-3.5" />} />
        <div className="p-3 grid gap-2 grid-cols-2 md:grid-cols-5">
          <div className="space-y-1 col-span-2 md:col-span-1">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Поиск</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
              <Input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Действие, сущность…" className="h-8 text-[12px] pl-8" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Магазин</Label>
            <ShopSelect value={shopId} onChange={setShopId} />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Автор</Label>
            <Select value={actorFilter} onValueChange={setActorFilter}>
              <SelectTrigger className="h-8 text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                {uniqueActors.map((a) => <SelectItem key={a} value={String(a)}>#{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Действие</Label>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="h-8 text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                {uniqueActions.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button size="sm" variant="outline" onClick={load} disabled={loading} className="h-8 text-[12px] px-4 w-full">Применить</Button>
          </div>
        </div>
      </AdminSectionCard>

      {/* Audit table */}
      <AdminSectionCard>
        <AdminSectionHeader
          title="События аудита"
          icon={<FileText className="h-3.5 w-3.5" />}
          actions={<span className="text-[11px] text-muted-foreground tabular-nums">{filtered.length} записей</span>}
        />
        {!filtered.length && !loading ? (
          <AdminCompactEmpty text="Событий не найдено — измените фильтры" icon={<ClipboardList className="h-5 w-5" />} />
        ) : (
          <AdminDataGrid
            data={filtered}
            columns={columns}
            onRowClick={(row) => setSelectedRow(row.original)}
            emptyTitle="Событий нет"
            emptyDescription="Записей не найдено."
            maxHeight="calc(100vh - 320px)"
            compact
            enableSorting
            enablePagination
            pageSize={50}
          />
        )}
      </AdminSectionCard>

      {/* Detail drawer */}
      <Sheet open={selectedRow !== null} onOpenChange={(open) => !open && setSelectedRow(null)}>
        <SheetContent side="right" className="w-[min(520px,100vw)] border-l border-border/50 bg-background p-0 sm:max-w-[520px]">
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b border-border/30 px-4 py-3 bg-muted/20">
              <div className="flex items-center gap-2 pr-8">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0">
                  <SheetTitle className="text-left text-sm">Запись аудита</SheetTitle>
                  {selectedRow && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {actionChip(selectedRow.action || selectedRow.event_type)}
                      {(selectedRow.entity || selectedRow.scope) && <Badge variant="outline" className="text-[9px] h-4">{selectedRow.entity || selectedRow.scope}</Badge>}
                    </div>
                  )}
                </div>
              </div>
            </SheetHeader>
            <ScrollArea className="flex-1">
              {selectedRow && (
                <div className="p-4 space-y-3">
                  <div className="rounded-xl border border-border/50 overflow-hidden">
                    <div className="px-3 py-2 bg-muted/20 border-b border-border/30">
                      <span className="text-[11px] font-semibold">Информация</span>
                    </div>
                    <div className="px-3 py-1 divide-y divide-border/20">
                      {[
                        ["ID", selectedRow.id ?? "—"],
                        ["Время", fmtDateFull(selectedRow.created_at)],
                        ["Автор", selectedRow.actor_id ? `#${selectedRow.actor_id}` : "—"],
                        ["Действие", selectedRow.action || selectedRow.event_type || "—"],
                        ["Сущность", selectedRow.entity || selectedRow.scope || "—"],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="flex items-center justify-between py-1.5 text-[12px]">
                          <span className="text-muted-foreground">{label}</span>
                          <span className="font-medium text-foreground text-right truncate max-w-[60%]">{String(value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/50 overflow-hidden">
                    <div className="px-3 py-2 bg-muted/20 border-b border-border/30">
                      <span className="text-[11px] font-semibold">Детали (payload)</span>
                    </div>
                    <div className="px-3 py-2">
                      <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[10px] leading-5 text-muted-foreground bg-muted/10 rounded-md p-2">
                        {JSON.stringify(selectedRow.details ?? selectedRow.meta ?? {}, null, 2)}
                      </pre>
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
