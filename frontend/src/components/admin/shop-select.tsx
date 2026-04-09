import * as React from "react"

import { adminListShops, type AdminShop } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { ChevronsUpDown, Check } from "lucide-react"

type Props = {
  value: number | null
  onChange: (shopId: number | null) => void
  disabled?: boolean
  placeholder?: string
  allowAll?: boolean
}

export default function ShopSelect({ value, onChange, disabled, placeholder = "Выберите магазин", allowAll = true }: Props) {
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [shops, setShops] = React.useState<AdminShop[]>([])
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        const list = await adminListShops()
        if (!mounted) return
        setShops(Array.isArray(list) ? list : [])
      } catch (e: any) {
        if (!mounted) return
        setError(e?.message || "Не удалось загрузить магазины")
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const selected = React.useMemo(() => shops.find((s) => s.id === value) || null, [shops, value])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="w-full min-w-0 justify-between"
        >
          <span className="truncate">
            {selected ? selected.name : allowAll && value === null ? "Все магазины" : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[280px] max-w-[min(420px,calc(100vw-2rem))] p-0" align="start">
        <Command>
          <CommandInput placeholder="Поиск по названию..." />
          <CommandList>
            <CommandEmpty>
              {loading ? "Загрузка..." : error ? "Ошибка загрузки" : "Ничего не найдено"}
            </CommandEmpty>
            <CommandGroup>
              {allowAll ? (
                <CommandItem
                  value="all"
                  onSelect={() => {
                    onChange(null)
                    setOpen(false)
                  }}
                >
                  <Check className={"mr-2 h-4 w-4 " + (value === null ? "opacity-100" : "opacity-0")} />
                  Все магазины
                </CommandItem>
              ) : null}
              {shops.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`${s.name} ${s.id}`}
                  onSelect={() => {
                    onChange(s.id)
                    setOpen(false)
                  }}
                >
                  <Check className={"mr-2 h-4 w-4 " + (s.id === value ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{s.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
