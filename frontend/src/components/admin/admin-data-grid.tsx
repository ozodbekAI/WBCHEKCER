import * as React from "react"

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type SortingState,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from "lucide-react"

import { AdminEmptyState } from "@/components/admin/admin-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

export type AdminColumnDef<TData> = ColumnDef<TData>

export function AdminDataGrid<TData>({
  data,
  columns,
  searchPlaceholder,
  emptyTitle = "Записей нет",
  emptyDescription = "По текущим фильтрам ничего не найдено.",
  onRowClick,
  selectedRowKey,
  getRowKey,
  className,
  maxHeight,
  compact = false,
  pageSize: initialPageSize = 50,
  enablePagination = false,
  enableSorting = true,
}: {
  data: TData[]
  columns: AdminColumnDef<TData>[]
  searchPlaceholder?: string
  emptyTitle?: string
  emptyDescription?: string
  onRowClick?: (row: Row<TData>) => void
  selectedRowKey?: string | number | null
  getRowKey?: (row: TData) => string
  className?: string
  maxHeight?: string
  compact?: boolean
  pageSize?: number
  enablePagination?: boolean
  enableSorting?: boolean
}) {
  const [globalFilter, setGlobalFilter] = React.useState("")
  const [sorting, setSorting] = React.useState<SortingState>([])

  const table = useReactTable({
    data,
    columns,
    state: { globalFilter, sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    ...(enableSorting ? { getSortedRowModel: getSortedRowModel() } : {}),
    ...(enablePagination
      ? {
          getPaginationRowModel: getPaginationRowModel(),
          initialState: { pagination: { pageSize: initialPageSize } },
        }
      : {}),
    globalFilterFn: (row, _columnId, filterValue) => {
      const query = String(filterValue || "").trim().toLowerCase()
      if (!query) return true
      const haystack = JSON.stringify(row.original).toLowerCase()
      return haystack.includes(query)
    },
  })

  const rows = table.getRowModel().rows
  const totalRows = table.getFilteredRowModel().rows.length
  const pageCount = table.getPageCount()
  const currentPage = table.getState().pagination?.pageIndex ?? 0

  return (
    <div className={cn("space-y-0", className)}>
      {searchPlaceholder && (
        <div className="relative max-w-sm px-3 py-2 border-b border-border/30">
          <Search className="pointer-events-none absolute left-6 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 pl-9 rounded-lg text-xs"
          />
        </div>
      )}

      {!rows.length ? (
        <AdminEmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          <div className="w-full overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id} className="border-b border-border bg-muted/50 hover:bg-muted/50">
                    {headerGroup.headers.map((header) => {
                      const canSort = enableSorting && header.column.getCanSort()
                      const sorted = header.column.getIsSorted()
                      return (
                        <TableHead
                          key={header.id}
                          className={cn(
                            "h-9 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
                            canSort && "cursor-pointer select-none hover:text-foreground transition-colors",
                          )}
                          onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                        >
                          <div className="flex items-center gap-1">
                            {header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                            {canSort && (
                              <span className="shrink-0">
                                {sorted === "asc" ? (
                                  <ArrowUp className="h-3 w-3" />
                                ) : sorted === "desc" ? (
                                  <ArrowDown className="h-3 w-3" />
                                ) : (
                                  <ArrowUpDown className="h-3 w-3 opacity-30" />
                                )}
                              </span>
                            )}
                          </div>
                        </TableHead>
                      )
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const currentRowKey = getRowKey ? getRowKey(row.original) : row.id
                  const isSelected =
                    selectedRowKey !== null &&
                    selectedRowKey !== undefined &&
                    String(selectedRowKey) === String(currentRowKey)
                  return (
                    <TableRow
                      key={row.id}
                      data-state={isSelected ? "selected" : undefined}
                      className={cn(
                        "border-b border-border/40 transition-colors",
                        onRowClick && "cursor-pointer hover:bg-primary/[0.06]",
                        isSelected && "bg-primary/[0.08] hover:bg-primary/[0.10]",
                      )}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            "px-3 align-middle whitespace-normal text-[13px]",
                            compact ? "py-1.5" : "py-2.5",
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination footer */}
          {enablePagination && pageCount > 1 && (
            <div className="flex items-center justify-between border-t border-border/30 bg-muted/10 px-3 py-1.5">
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {totalRows} записей · стр. {currentPage + 1} из {pageCount}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={!table.getCanPreviousPage()}
                  onClick={() => table.previousPage()}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={!table.getCanNextPage()}
                  onClick={() => table.nextPage()}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
                <Select
                  value={String(table.getState().pagination.pageSize)}
                  onValueChange={(v) => table.setPageSize(Number(v))}
                >
                  <SelectTrigger className="h-7 w-[72px] text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[25, 50, 100].map((s) => (
                      <SelectItem key={s} value={String(s)}>
                        {s} / стр
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
