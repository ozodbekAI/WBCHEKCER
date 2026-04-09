import type React from "react"
import { useEffect, useMemo, useState } from "react"
import { Plus, X, PenLine } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { getShopBrands } from "@/lib/api"

import type { SignatureItem } from "./types"

interface BrandsStepProps {
  shopId: number | null
  items: SignatureItem[]
  onUpdate: (items: SignatureItem[]) => void
}

const suggestedSignatures = [
  "С уважением, команда магазина.",
  "Спасибо за выбор нашего бренда!",
  "Всегда рады помочь!",
  "Хороших покупок и отличного дня!",
  "Будем рады вашему повторному заказу!",
]

function normBrand(b: string) {
  const s = String(b || "").trim()
  return s || "all"
}

function normText(t: string) {
  return String(t || "").trim().replace(/\s+/g, " ")
}

export function BrandsStep({ shopId, items, onUpdate }: BrandsStepProps) {
  const [newText, setNewText] = useState("")

  const [brands, setBrands] = useState<string[]>([])
  const [brandsLoading, setBrandsLoading] = useState(false)
  const [brandsError, setBrandsError] = useState<string | null>(null)
  const [selectedBrand, setSelectedBrand] = useState<string>("all")

  // Load brands from backend (WB analytics proxy)
  useEffect(() => {
    let mounted = true
    if (!shopId) return
    ;(async () => {
      setBrandsLoading(true)
      setBrandsError(null)
      try {
        const res = await getShopBrands(shopId)
        const list = Array.isArray((res as any)?.data) ? ((res as any).data as string[]) : []
        if (!mounted) return
        const uniq: string[] = []
        const seen = new Set<string>()
        for (const b of list) {
          const x = String(b || "").trim()
          if (!x) continue
          const k = x.toLowerCase()
          if (seen.has(k)) continue
          seen.add(k)
          uniq.push(x)
        }
        setBrands(uniq)
      } catch (e: any) {
        if (!mounted) return
        setBrands([])
        setBrandsError(e?.message || "Не удалось загрузить бренды")
      } finally {
        if (mounted) setBrandsLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [shopId])

  // If current selected brand is not in list anymore, keep it (user may have saved older brand)
  const brandOptions = useMemo(() => {
    const base = ["all", ...brands]
    const cur = normBrand(selectedBrand)
    if (cur !== "all" && !base.includes(cur)) return ["all", cur, ...brands]
    return base
  }, [brands, selectedBrand])

  const visible = useMemo(() => {
    const b = normBrand(selectedBrand)
    return items
      .map((it, idx) => ({ it, idx }))
      .filter(({ it }) => normBrand(it.brand) === b)
  }, [items, selectedBrand])

  const addSignature = (text: string) => {
    const trimmed = normText(text)
    if (!trimmed) return

    const brand = normBrand(selectedBrand)
    const exists = items.some((s) => normBrand(s.brand) === brand && (s.type || "all") === "all" && normText(s.text) === trimmed)
    if (!exists) {
      onUpdate([
        ...items,
        {
          text: trimmed,
          type: "all",
          brand,
          is_active: true,
        },
      ])
    }
    setNewText("")
  }

  const removeAt = (idx: number) => {
    onUpdate(items.filter((_, i) => i !== idx))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      addSignature(newText)
    }
  }

  const existingTextsForBrand = useMemo(() => {
    const set = new Set<string>()
    for (const { it } of visible) set.add(normText(it.text))
    return set
  }, [visible])

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold mb-2">Подпись</h2>
        <p className="text-muted-foreground">
          Добавьте подпись, которая будет автоматически подставляться в конце ответа. Можно задать подписи для конкретных брендов.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Выберите бренд</Label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Select value={selectedBrand} onValueChange={setSelectedBrand}>
            <SelectTrigger className="w-full sm:w-[280px]">
              <SelectValue placeholder="Все бренды" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все бренды</SelectItem>
              {brandsLoading ? (
                <SelectItem value="__loading" disabled>
                  Загрузка брендов…
                </SelectItem>
              ) : null}
              {!brandsLoading && brandOptions.length <= 1 ? (
                <SelectItem value="__none" disabled>
                  Нет брендов (проверьте WB-токен)
                </SelectItem>
              ) : null}
              {!brandsLoading
                ? brandOptions
                    .filter((b) => b !== "all")
                    .map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))
                : null}
            </SelectContent>
          </Select>

          <div className="text-xs text-muted-foreground">
            {brandsError ? (
              <span className="text-destructive">{brandsError}</span>
            ) : (
              <span>Подпись для бренда применяется только к товарам этого бренда.</span>
            )}
          </div>
        </div>
      </div>

      {visible.length > 0 && (
        <div className="space-y-2">
          <Label className="text-sm font-medium flex items-center gap-2">
            <PenLine className="h-4 w-4" />
            Ваши подписи ({visible.length})
            {normBrand(selectedBrand) !== "all" ? (
              <span className="ml-2 text-xs text-muted-foreground">для “{selectedBrand}”</span>
            ) : null}
          </Label>

          <div className="flex flex-wrap gap-2 p-4 bg-muted/30 rounded-lg min-h-[60px]">
            {visible.map(({ it, idx }) => (
              <Badge
                key={`${idx}-${it.brand}-${it.text}`}
                variant="secondary"
                className="px-3 py-1.5 text-sm flex items-center gap-2 bg-primary/10 hover:bg-primary/20"
              >
                <PenLine className="h-3 w-3" />
                {it.text}
                <button onClick={() => removeAt(idx)} className="ml-1 hover:text-destructive transition-colors">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {visible.length === 0 && items.length > 0 && normBrand(selectedBrand) !== "all" ? (
        <p className="text-center text-sm text-muted-foreground py-2">
          Для выбранного бренда подписей пока нет. Добавьте подпись или выберите “Все бренды”.
        </p>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="newSignature" className="text-sm font-medium">
          Добавить подпись{normBrand(selectedBrand) !== "all" ? " для выбранного бренда" : ""}
        </Label>
        <div className="flex gap-2">
          <Input
            id="newSignature"
            placeholder="Например: С уважением, команда…"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1"
          />
          <Button type="button" onClick={() => addSignature(newText)} disabled={!newText.trim()}>
            <Plus className="h-4 w-4 mr-1" />
            Добавить
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium text-muted-foreground">Или выберите из примеров</Label>
        <div className="flex flex-wrap gap-2">
          {suggestedSignatures
            .filter((t) => !existingTextsForBrand.has(normText(t)))
            .map((t) => (
              <button
                key={t}
                onClick={() => addSignature(t)}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-full border-2 border-dashed",
                  "border-muted-foreground/30 text-muted-foreground",
                  "hover:border-primary hover:text-primary transition-all"
                )}
              >
                <Plus className="h-3 w-3 inline mr-1" />
                {t}
              </button>
            ))}
        </div>
      </div>

      {items.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-4">Добавьте хотя бы одну подпись для продолжения</p>
      )}
    </div>
  )
}
