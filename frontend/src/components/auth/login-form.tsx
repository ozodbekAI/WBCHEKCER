import type React from "react"
import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"

import { MessageSquareText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/use-toast"

import { getMe, login } from "@/lib/api"
import { getErrorMessage } from "@/lib/error-message"

interface LoginFormProps {
  onSuccess?: () => void
  nextPath?: string | null
  registrationOpen?: boolean
}

export default function LoginForm({ onSuccess, nextPath, registrationOpen = false }: LoginFormProps) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")

  const safeNextPath = nextPath && nextPath.startsWith("/") ? nextPath : null
  const fallbackPath = safeNextPath && safeNextPath !== "/" ? safeNextPath : "/app/dashboard"

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) { setError("Введите email и пароль"); return }

    setIsLoading(true)
    setError("")

    try {
      await login(email.trim(), password)
      try {
        const me = await getMe()
        if (me?.role === "super_admin" || me?.role === "support_admin") {
          navigate(safeNextPath || "/admin/dashboard", { replace: true })
          onSuccess?.()
          return
        }
      } catch {}

      onSuccess?.()
      navigate(fallbackPath, { replace: true })
    } catch (error) {
      const message = getErrorMessage(error, "Не удалось войти")
      setError(message)
      toast({ title: "Не удалось войти", description: message, variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left brand panel — desktop only */}
      <div className="hidden lg:flex lg:w-[480px] flex-col justify-between bg-primary-soft px-10 py-10">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
            <MessageSquareText className="h-4.5 w-4.5 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold text-gradient-brand">AVEOTVET</span>
        </Link>

        <div>
          <h2 className="text-2xl font-bold text-[hsl(var(--text-strong))] leading-tight">
            Управляйте отзывами<br />Wildberries эффективно
          </h2>
          <p className="mt-3 text-sm text-[hsl(var(--text-default))] leading-relaxed max-w-xs">
            Отвечайте быстрее, контролируйте тон, автоматизируйте рутину — всё в одном кабинете.
          </p>
        </div>

        <p className="text-xs text-[hsl(var(--text-muted))]">© {new Date().getFullYear()} AVEOTVET</p>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-[440px]">
          {/* Mobile logo */}
          <div className="mb-8 flex flex-col items-center gap-3 lg:hidden">
            <Link to="/" className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
                <MessageSquareText className="h-4.5 w-4.5 text-primary-foreground" />
              </div>
              <span className="text-lg font-bold text-gradient-brand">AVEOTVET</span>
            </Link>
          </div>

          <div className="rounded-2xl border border-border bg-card p-8 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
            <div className="mb-7">
              <h1 className="text-xl font-bold text-[hsl(var(--text-strong))]">Войти в кабинет</h1>
              <p className="mt-1.5 text-sm text-[hsl(var(--text-muted))]">Введите данные вашего аккаунта для входа</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-[hsl(var(--text-strong))]">Email</label>
                <Input
                  type="email"
                  placeholder="user@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-[hsl(var(--text-strong))]">Пароль</label>
                  <Link to="/reset-password" className="text-xs text-primary hover:text-primary/80 transition-colors">
                    Забыли пароль?
                  </Link>
                </div>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <div className="rounded-xl border border-destructive/20 bg-danger-soft px-4 py-3">
                  <p className="text-sm font-medium text-destructive">{error}</p>
                </div>
              )}

              <Button type="submit" disabled={isLoading} className="w-full h-12">
                {isLoading ? "Входим…" : "Войти"}
              </Button>
            </form>
          </div>

          {/* Bottom links */}
          <div className="mt-5 text-center">
            {registrationOpen ? (
              <p className="text-sm text-[hsl(var(--text-muted))]">
                Нет аккаунта?{" "}
                <Link
                  to={nextPath ? `/register?next=${encodeURIComponent(nextPath)}` : "/register"}
                  className="text-primary font-medium hover:text-primary/80"
                >
                  Создать аккаунт
                </Link>
              </p>
            ) : (
              <p className="text-xs text-[hsl(var(--text-muted))] leading-relaxed">
                Доступ по приглашению владельца магазина.<br />
                Нужна помощь? <a href="mailto:support@aveotvet.com" className="text-primary hover:text-primary/80">support@aveotvet.com</a>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
