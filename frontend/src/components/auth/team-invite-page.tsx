import { Link, useNavigate } from "react-router-dom"
import * as React from "react"

import { MessageSquareText, Store, Shield, Clock, RefreshCw } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ContentStatusBadge } from "@/components/shared/content-status-badge"
import { acceptShopInvite, getTeamInvitePreview, type TeamInvitePreview } from "@/lib/api"
import { getErrorMessage } from "@/lib/error-message"

function roleLabel(role: string) {
  if (role === "manager") return "Менеджер"
  if (role === "owner") return "Владелец"
  return role
}

function mapInviteStatus(status: TeamInvitePreview["status"]): "pending" | "accepted" | "expired" | "revoked" {
  if (status === "invited") return "pending"
  if (status === "accepted") return "accepted"
  if (status === "expired") return "expired"
  if (status === "revoked") return "revoked"
  return "pending"
}

function formatDate(value?: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date)
}

export default function TeamInvitePage({ token }: { token: string }) {
  const navigate = useNavigate()
  const [preview, setPreview] = React.useState<TeamInvitePreview | null>(null)
  const [password, setPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setPreview(await getTeamInvitePreview(token)) }
    catch (error) { setError(getErrorMessage(error, "Не удалось загрузить приглашение")) }
    finally { setLoading(false) }
  }, [token])

  React.useEffect(() => { load() }, [load])

  const loginHref = React.useMemo(() => `/login?next=${encodeURIComponent(`/invite/${token}`)}`, [token])

  const canSetPassword = Boolean(preview && preview.status === "invited" && preview.can_set_password && (!preview.is_authenticated || preview.email_matches_current_user))
  const canAcceptLoggedInAccount = Boolean(preview && preview.status === "invited" && preview.is_authenticated && preview.email_matches_current_user && !preview.requires_login && !preview.can_set_password)

  const handleAccept = React.useCallback(async () => {
    if (!preview) return
    if (canSetPassword) {
      if (!password || !confirmPassword) { setError("Заполните пароль и подтверждение"); return }
      if (password !== confirmPassword) { setError("Пароли не совпадают"); return }
      if (password.length < 8) { setError("Пароль должен содержать минимум 8 символов"); return }
    }

    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      await acceptShopInvite({ token, password: canSetPassword ? password : undefined })
      setSuccess("Приглашение принято. Перенаправляем в кабинет…")
      navigate("/")
    } catch (error) {
      setError(getErrorMessage(error, "Не удалось принять приглашение"))
    } finally { setSubmitting(false) }
  }, [canSetPassword, confirmPassword, password, preview, navigate, token])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-[480px]">
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
              <h1 className="text-xl font-bold text-[hsl(var(--text-strong))]">Вы приглашены в команду</h1>
              <p className="mt-1.5 text-sm text-[hsl(var(--text-muted))]">
                Примите приглашение, чтобы получить доступ к отзывам, вопросам и чатам магазина.
              </p>
            </div>

            {loading && (
              <div className="flex items-center gap-2.5 rounded-xl border border-border bg-secondary/30 px-4 py-4 text-sm text-[hsl(var(--text-muted))]">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Загружаем данные приглашения…
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertTitle>Ошибка</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {success && (
              <Alert>
                <AlertTitle>Готово</AlertTitle>
                <AlertDescription>{success}</AlertDescription>
              </Alert>
            )}

            {preview && (
              <>
                <div className="rounded-xl border border-border bg-secondary/20 p-5 space-y-4">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-soft text-primary">
                      <Store className="h-4 w-4" />
                    </div>
                    <span className="text-base font-semibold text-[hsl(var(--text-strong))]">{preview.shop_name}</span>
                  </div>
                  <div className="grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <div className="text-xs text-[hsl(var(--text-muted))]">Email</div>
                      <div className="mt-0.5 font-medium text-[hsl(var(--text-strong))]">{preview.email}</div>
                    </div>
                    <div>
                      <div className="text-xs text-[hsl(var(--text-muted))]">Роль</div>
                      <div className="mt-0.5 flex items-center gap-1.5 font-medium text-[hsl(var(--text-strong))]">
                        <Shield className="h-3.5 w-3.5 text-[hsl(var(--text-muted))]" />
                        {roleLabel(preview.role)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[hsl(var(--text-muted))]">Статус</div>
                      <div className="mt-0.5"><ContentStatusBadge status={mapInviteStatus(preview.status)} /></div>
                    </div>
                    <div>
                      <div className="text-xs text-[hsl(var(--text-muted))]">Действует до</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-sm text-[hsl(var(--text-strong))]">
                        <Clock className="h-3.5 w-3.5 text-[hsl(var(--text-muted))]" />
                        {formatDate(preview.expires_at)}
                      </div>
                    </div>
                  </div>
                </div>

                {preview.status === "invited" && preview.requires_login && (
                  <Alert>
                    <AlertTitle>Войдите в аккаунт</AlertTitle>
                    <AlertDescription>
                      Для <span className="font-medium text-[hsl(var(--text-strong))]">{preview.email}</span> уже существует аккаунт. Войдите, затем вернитесь к приглашению.
                    </AlertDescription>
                  </Alert>
                )}

                {preview.status === "invited" && preview.is_authenticated && !preview.email_matches_current_user && (
                  <Alert>
                    <AlertTitle>Вы вошли под другим email</AlertTitle>
                    <AlertDescription>
                      Приглашение для <span className="font-medium text-[hsl(var(--text-strong))]">{preview.email}</span>. Войдите под нужным аккаунтом.
                    </AlertDescription>
                  </Alert>
                )}

                {canSetPassword && (
                  <div className="space-y-4 rounded-xl border border-border bg-card p-5">
                    <div>
                      <h2 className="text-sm font-semibold text-[hsl(var(--text-strong))]">Создайте пароль</h2>
                      <p className="mt-0.5 text-xs text-[hsl(var(--text-muted))]">Аккаунт для этого email ещё не создан. После подтверждения вы сразу попадёте в кабинет.</p>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-[hsl(var(--text-strong))]">Пароль</label>
                      <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-[hsl(var(--text-strong))]">Подтвердите пароль</label>
                      <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
                    </div>
                    <p className="text-xs text-[hsl(var(--text-muted))]">Минимум 8 символов.</p>
                  </div>
                )}

                {preview.status === "accepted" && (
                  <Alert><AlertTitle>Приглашение уже принято</AlertTitle><AlertDescription>Доступ к магазину открыт. Войдите, чтобы продолжить.</AlertDescription></Alert>
                )}
                {preview.status === "expired" && (
                  <Alert><AlertTitle>Срок действия истёк</AlertTitle><AlertDescription>Попросите владельца магазина отправить новое приглашение.</AlertDescription></Alert>
                )}
                {preview.status === "revoked" && (
                  <Alert><AlertTitle>Приглашение отозвано</AlertTitle><AlertDescription>Владелец магазина отменил приглашение. При необходимости запросите новое.</AlertDescription></Alert>
                )}

                <div className="flex flex-wrap gap-2.5">
                  {(canSetPassword || canAcceptLoggedInAccount) && (
                    <Button onClick={handleAccept} disabled={submitting} className="h-12">
                      {submitting ? "Подтверждаем…" : "Принять приглашение"}
                    </Button>
                  )}

                  {preview.status === "invited" && preview.requires_login && (
                    <Button asChild className="h-12"><Link to={loginHref}>Войти</Link></Button>
                  )}

                  {preview.status === "accepted" && (
                    preview.is_authenticated
                      ? <Button onClick={() => navigate("/")} className="h-12">Открыть кабинет</Button>
                      : <Button asChild className="h-12"><Link to={loginHref}>Войти</Link></Button>
                  )}

                  <Button variant="outline" onClick={load} disabled={loading || submitting} className="h-12">Обновить</Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
