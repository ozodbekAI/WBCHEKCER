import { Link } from "react-router-dom"
import { useNavigate } from "react-router-dom"
import * as React from "react"

import { MessageSquareText } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { completePasswordReset, getPasswordResetPreview, type PasswordResetPreview } from "@/lib/api"
import { getErrorMessage } from "@/lib/error-message"

function formatDate(value?: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date)
}

function statusLabel(status: PasswordResetPreview["status"]) {
  if (status === "pending") return "Ссылка активна"
  if (status === "used") return "Пароль уже обновлен"
  if (status === "expired") return "Срок действия истек"
  if (status === "revoked") return "Ссылка отозвана"
  return status
}

export default function PasswordResetPage({ token }: { token: string }) {
  const navigate = useNavigate()
  const [preview, setPreview] = React.useState<PasswordResetPreview | null>(null)
  const [password, setPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setPreview(await getPasswordResetPreview(token)) }
    catch (error) { setError(getErrorMessage(error, "Не удалось открыть ссылку сброса")) }
    finally { setLoading(false) }
  }, [token])

  React.useEffect(() => { void load() }, [load])

  const canSubmit = preview?.status === "pending"

  const handleSubmit = React.useCallback(async () => {
    if (!canSubmit) return
    if (!password || !confirmPassword) { setError("Заполните пароль и подтверждение"); return }
    if (password !== confirmPassword) { setError("Пароли не совпадают"); return }
    if (password.length < 8) { setError("Пароль должен содержать минимум 8 символов"); return }

    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      await completePasswordReset({ token, password })
      setSuccess("Пароль обновлен. Перенаправляем в кабинет.")
      navigate("/")
    } catch (error) {
      setError(getErrorMessage(error, "Не удалось обновить пароль"))
    } finally { setSubmitting(false) }
  }, [canSubmit, confirmPassword, password, navigate, token])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-[440px]">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
              <MessageSquareText className="h-4.5 w-4.5 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold text-gradient-brand">AVEOTVET</span>
          </Link>
        </div>

        <div className="rounded-2xl border border-border bg-card p-8 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <div className="space-y-6">
            <div>
              <h1 className="text-xl font-bold text-[hsl(var(--text-strong))]">Сброс пароля</h1>
              <p className="mt-1.5 text-sm text-[hsl(var(--text-muted))]">Установите новый пароль для доступа к кабинету.</p>
            </div>

            {loading && (
              <div className="rounded-xl border border-border bg-secondary/30 px-4 py-4 text-sm text-[hsl(var(--text-muted))]">
                Проверяем ссылку сброса...
              </div>
            )}

            {error && <Alert variant="destructive"><AlertTitle>Не удалось продолжить</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
            {success && <Alert><AlertTitle>Готово</AlertTitle><AlertDescription>{success}</AlertDescription></Alert>}

            {preview && (
              <div className="space-y-5">
                <div className="rounded-xl border border-border bg-secondary/20 p-4">
                  <div className="text-xs text-[hsl(var(--text-muted))]">Email</div>
                  <div className="mt-1 text-base font-semibold text-[hsl(var(--text-strong))]">{preview.email}</div>
                  <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <div className="text-[hsl(var(--text-muted))]">Статус</div>
                      <div className="font-medium text-[hsl(var(--text-strong))]">{statusLabel(preview.status)}</div>
                    </div>
                    <div>
                      <div className="text-[hsl(var(--text-muted))]">Действует до</div>
                      <div className="font-medium text-[hsl(var(--text-strong))]">{formatDate(preview.expires_at)}</div>
                    </div>
                  </div>
                </div>

                {preview.status === "pending" && (
                  <div className="space-y-4 rounded-xl border border-border bg-card p-5">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-[hsl(var(--text-strong))]">Новый пароль</label>
                      <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-[hsl(var(--text-strong))]">Подтвердите пароль</label>
                      <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" />
                    </div>
                    <p className="text-xs text-[hsl(var(--text-muted))]">Минимум 8 символов.</p>
                  </div>
                )}

                {preview.status === "used" && <Alert><AlertTitle>Ссылка уже использована</AlertTitle><AlertDescription>Пароль по этой ссылке уже обновлен. Войдите с новым паролем.</AlertDescription></Alert>}
                {preview.status === "expired" && <Alert><AlertTitle>Срок действия ссылки истек</AlertTitle><AlertDescription>Попросите администратора отправить новую ссылку сброса пароля.</AlertDescription></Alert>}
                {preview.status === "revoked" && <Alert><AlertTitle>Ссылка больше недействительна</AlertTitle><AlertDescription>Запрос сброса был отменен. Попросите администратора создать новую ссылку.</AlertDescription></Alert>}

                <div className="flex flex-wrap gap-2.5">
                  {canSubmit && <Button onClick={handleSubmit} disabled={submitting} className="h-12">{submitting ? "Сохраняем..." : "Сохранить пароль"}</Button>}
                  <Button asChild variant="outline" className="h-12"><Link to="/login">Перейти ко входу</Link></Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
