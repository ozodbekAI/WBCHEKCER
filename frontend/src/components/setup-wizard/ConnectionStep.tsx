import { useState } from "react"
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, AlertCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

interface VerifyResult {
  ok: boolean
  shop_name?: string | null
  error?: string
}

interface ConnectionStepProps {
  isConnected: boolean
  storeName: string
  token: string
  isTokenValid: boolean
  onUpdate: (data: { storeName?: string; token?: string; isTokenValid?: boolean }) => void
  onVerifyToken: (token: string) => Promise<VerifyResult>
}

type ValidationState = "idle" | "validating" | "success" | "error"

export function ConnectionStep({
  isConnected,
  storeName,
  token,
  isTokenValid,
  onUpdate,
  onVerifyToken,
}: ConnectionStepProps) {
  const [tokenHelpOpen, setTokenHelpOpen] = useState(false)
  const [validationState, setValidationState] = useState<ValidationState>(isTokenValid ? "success" : "idle")
  const [errorMessage, setErrorMessage] = useState("")

  const handleValidateToken = async () => {
    const t = token.trim()
    if (!t) return

    setValidationState("validating")
    setErrorMessage("")

    try {
      const res = await onVerifyToken(t)
      if (res.ok) {
        setValidationState("success")
        onUpdate({ isTokenValid: true, storeName: (res.shop_name || "").toString() })
      } else {
        setValidationState("error")
        setErrorMessage(res.error || "Не удалось проверить токен")
        onUpdate({ isTokenValid: false, storeName: "" })
      }
    } catch (e: any) {
      setValidationState("error")
      setErrorMessage(e?.message || "Не удалось проверить токен")
      onUpdate({ isTokenValid: false })
    }
  }

  const canValidate = token.trim().length > 0 && validationState !== "validating"
  const isTokenValidated = validationState === "success"

  if (isConnected) {
    return (
      <div className="text-center py-12">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 text-green-600 mb-4">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h3 className="text-xl font-semibold mb-2">Магазин подключен!</h3>
        <p className="text-muted-foreground">Теперь настроим, как система будет работать с вашими отзывами</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-bold mb-2">Добавьте магазин</h2>
        <p className="text-muted-foreground">
          Вставьте WB token и нажмите «Проверить». Название магазина подставим автоматически.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="wbToken">WB token</Label>
          <div className="flex gap-2">
            <Input
              id="wbToken"
              type="password"
              placeholder="Вставьте токен"
              value={token}
              onChange={(e) => {
                onUpdate({ token: e.target.value, isTokenValid: false, storeName: "" })
                if (validationState !== "idle") {
                  setValidationState("idle")
                  setErrorMessage("")
                }
              }}
              disabled={validationState === "validating"}
              className={isTokenValidated ? "border-green-500 focus:ring-green-500" : ""}
            />
            <Button
              type="button"
              variant={isTokenValidated ? "outline" : "secondary"}
              onClick={handleValidateToken}
              disabled={!canValidate}
              className={isTokenValidated ? "border-green-500 text-green-600" : ""}
            >
              {validationState === "validating" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isTokenValidated ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : validationState === "error" ? (
                <RefreshCw className="h-4 w-4" />
              ) : (
                "Проверить"
              )}
            </Button>
          </div>
        </div>

        {isTokenValidated && (
          <div className="space-y-2">
            <Label>Название магазина</Label>
            <Input value={storeName || "—"} disabled className="bg-muted/30" />
          </div>
        )}

        {validationState === "error" && errorMessage && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        {isTokenValidated && (
          <Alert className="border-green-200 bg-green-50 text-green-800">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription>Токен проверен и работает!</AlertDescription>
          </Alert>
        )}

        <Collapsible open={tokenHelpOpen} onOpenChange={setTokenHelpOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-between border rounded-lg px-4 py-3 h-auto"
              disabled={validationState === "validating"}
            >
              <span>Где взять токен?</span>
              {tokenHelpOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="bg-muted/50 rounded-lg p-4 mt-2 space-y-2 text-sm text-muted-foreground">
            <p>1. Откройте личный кабинет Wildberries для продавцов.</p>
            <p>2. Перейдите в раздел настроек / доступ к API.</p>
            <p>3. Создайте (или скопируйте) API-токен и вставьте его сюда.</p>
            <p className="text-xs mt-3">После проверки токен используется для подключения магазина и синхронизации данных.</p>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {!isTokenValidated && token.trim() && (
        <p className="text-xs text-center text-muted-foreground">Сначала проверьте токен, чтобы продолжить</p>
      )}
    </div>
  )
}
