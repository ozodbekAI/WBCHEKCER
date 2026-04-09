import { useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ChevronDown, ChevronUp, CheckCircle2, XCircle } from "lucide-react"

export type SellerInfo = {
  ok: boolean
  name?: string | null
  sid?: string | null
  tradeMark?: string | null
  shop_name?: string | null
}

interface AddStoreModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onVerifyToken: (token: string) => Promise<SellerInfo>
  onCreateShop: (token: string, resolvedShopName: string | null) => Promise<void>
}

const AddStoreModal = ({ open, onOpenChange, onVerifyToken, onCreateShop }: AddStoreModalProps) => {
  const [wbToken, setWbToken] = useState("")
  const [tokenHelpOpen, setTokenHelpOpen] = useState(false)

  const [verifying, setVerifying] = useState(false)
  const [creating, setCreating] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [seller, setSeller] = useState<SellerInfo | null>(null)

  const resolvedName = useMemo(() => {
    const t = (seller?.tradeMark || "").trim()
    const n = (seller?.name || "").trim()
    return (t || n || "").trim()
  }, [seller])

  const isTokenReady = wbToken.trim().length >= 20
  const isTokenValid = Boolean(seller?.ok && resolvedName)

  const handleVerify = async () => {
    setVerifyError(null)
    setSeller(null)
    if (!isTokenReady) {
      setVerifyError("Вставьте WB токен")
      return
    }
    setVerifying(true)
    try {
      const info = await onVerifyToken(wbToken.trim())
      setSeller(info)
      if (!info.ok) {
        setVerifyError("Токен не подошёл. Проверьте доступ к API в кабинете WB.")
      }
    } catch (e: any) {
      setVerifyError(e?.message || "Не удалось проверить токен")
    } finally {
      setVerifying(false)
    }
  }

  const handleSubmit = async () => {
    setVerifyError(null)
    if (!isTokenValid) {
      setVerifyError("Сначала нажмите «Проверить токен», чтобы подтянуть название магазина")
      return
    }
    setCreating(true)
    try {
      await onCreateShop(wbToken.trim(), resolvedName || null)
      setWbToken("")
      setSeller(null)
      onOpenChange(false)
    } catch (e: any) {
      setVerifyError(e?.message || "Не удалось создать магазин")
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">Добавьте магазин</DialogTitle>
        </DialogHeader>

        <p className="text-muted-foreground">
          Это займёт 1–2 минуты. Вставьте WB token — мы автоматически подтянем название магазина.
        </p>

        <div className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="modalWbToken">WB token</Label>
            <Input
              id="modalWbToken"
              type="password"
              placeholder="Вставьте токен"
              value={wbToken}
              onChange={(e) => setWbToken(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleVerify}
              disabled={!isTokenReady || verifying || creating}
            >
              {verifying ? "Проверяем…" : "Проверить токен"}
            </Button>
            {seller ? (
              seller.ok ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : (
                <XCircle className="h-5 w-5 text-destructive" />
              )
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="modalStoreName">Название магазина</Label>
            <Input
              id="modalStoreName"
              placeholder="Появится после проверки токена"
              value={resolvedName}
              readOnly
              className="border-primary focus:ring-primary"
            />
          </div>

          <Collapsible open={tokenHelpOpen} onOpenChange={setTokenHelpOpen}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-between border rounded-lg px-4 py-3 h-auto"
              >
                <span>Где взять токен?</span>
                {tokenHelpOpen ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="bg-muted/50 rounded-lg p-4 mt-2 space-y-2 text-sm text-muted-foreground">
              <p>1. Откройте личный кабинет Wildberries для продавцов.</p>
              <p>2. Перейдите в раздел настроек / доступ к API.</p>
              <p>3. Создайте (или скопируйте) API-токен и вставьте его сюда.</p>
              <p className="text-xs mt-3">Токен хранится у нас в зашифрованном виде.</p>
            </CollapsibleContent>
          </Collapsible>

          {verifyError ? <div className="text-sm text-destructive">{verifyError}</div> : null}
        </div>

        <div className="flex justify-end mt-4">
          <Button onClick={handleSubmit} disabled={!isTokenValid || creating || verifying}>
            {creating ? "Создаём…" : "Далее"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default AddStoreModal
