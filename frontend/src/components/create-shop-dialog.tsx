import * as React from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { createShop, verifyWbToken } from "@/lib/api"

type ShopOut = {
  id: number
  name: string
  wb_token?: string | null
}

type Props = {
  onCreated?: (shop: ShopOut) => void
  trigger?: React.ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (v: boolean) => void
}

export default function CreateShopDialog({ onCreated, trigger, defaultOpen, open, onOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = React.useState(Boolean(defaultOpen))
  const isControlled = typeof open === "boolean"
  const actualOpen = isControlled ? Boolean(open) : internalOpen
  const setOpen = (v: boolean) => {
    onOpenChange?.(v)
    if (!isControlled) setInternalOpen(v)
  }
  const [wbToken, setWbToken] = React.useState("")
  const [resolvedName, setResolvedName] = React.useState("")
  const [verifying, setVerifying] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const verify = async () => {
    const t = wbToken.trim()
    if (!t) {
      setError("Введите WB токен")
      return
    }
    try {
      setVerifying(true)
      setError(null)
      const info = await verifyWbToken(t)
      const shopName = String(info?.shop_name || info?.tradeMark || info?.name || "").trim()
      if (!info?.ok || !shopName) {
        setResolvedName("")
        setError("Токен не подошёл. Проверьте доступ к API в кабинете WB.")
        return
      }
      setResolvedName(shopName)
    } catch (e: any) {
      setError(e?.message || "Не удалось проверить токен")
    } finally {
      setVerifying(false)
    }
  }

  const submit = async () => {
    const t = wbToken.trim()

    if (!t) {
      setError("Введите WB токен")
      return
    }

    if (!resolvedName) {
      setError("Сначала нажмите «Проверить токен», чтобы подтянуть название магазина")
      return
    }
    
    try {
      setLoading(true)
      setError(null)
      const shop = await createShop({ wb_token: t })
      setWbToken("")
      setResolvedName("")
      setOpen(false)
      onCreated?.(shop as ShopOut)
    } catch (e: any) {
      setError(e?.message || "Не удалось создать магазин")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={actualOpen} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[520px]">

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wb-token">WB токен</Label>
            <Input 
              id="wb-token"
              value={wbToken} 
              onChange={(e) => setWbToken(e.target.value)} 
              placeholder="Введите токен Wildberries"
              disabled={loading || verifying}
              type="password"
            />
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={verify} disabled={loading || verifying || !wbToken.trim()}>
                {verifying ? "Проверка…" : "Проверить токен"}
              </Button>
              {resolvedName ? (
                <div className="text-sm text-muted-foreground">Найдено: <b className="text-foreground">{resolvedName}</b></div>
              ) : null}
            </div>
            <div className="text-sm text-muted-foreground">
              Токен нужен для интеграции с Wildberries API
            </div>
          </div>

          {error ? <div className="text-sm text-destructive">{error}</div> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={loading}>
            {loading ? "Создание…" : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}