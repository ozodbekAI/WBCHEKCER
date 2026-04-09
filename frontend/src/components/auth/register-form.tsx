import type React from "react"
import { useState } from "react"
import { useNavigate, Link } from "react-router-dom"

import { MessageSquareText, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/use-toast"

import { register } from "@/lib/api"
import { getErrorMessage } from "@/lib/error-message"

export default function RegisterForm({ registrationOpen = false }: { registrationOpen?: boolean }) {
  const navigate = useNavigate()
  const { toast } = useToast()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")

  /* ─── Invite-only page ─── */
  if (!registrationOpen) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-[440px]">
          <div className="mb-8 flex flex-col items-center gap-3">
            <Link to="/" className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
                <MessageSquareText className="h-4.5 w-4.5 text-primary-foreground" />
              </div>
              <span className="text-lg font-bold text-gradient-brand">AVEOTVET</span>
            </Link>
          </div>

          <div className="rounded-2xl border border-border bg-card p-8 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
            <h1 className="text-xl font-bold text-[hsl(var(--text-strong))]">Регистрация по приглашению</h1>
            <p className="mt-2 text-sm text-[hsl(var(--text-muted))] leading-relaxed">
              Самостоятельная регистрация сейчас закрыта. Для получения доступа вам нужно приглашение от владельца магазина.
            </p>

            <div className="mt-6 rounded-xl border border-border bg-secondary/30 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-[hsl(var(--text-strong))]">Как получить доступ</h3>
              {[
                { step: "1", text: "Получите приглашение на рабочий email" },
                { step: "2", text: "Перейдите по ссылке из письма" },
                { step: "3", text: "Создайте пароль и войдите в кабинет" },
              ].map((item) => (
                <div key={item.step} className="flex items-start gap-2.5 text-sm text-[hsl(var(--text-default))]">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                    {item.step}
                  </span>
                  <span>{item.text}</span>
                </div>
              ))}
            </div>

            <div className="mt-6 space-y-2.5">
              <Button asChild className="w-full h-12">
                <Link to="/login">Войти в аккаунт</Link>
              </Button>
              <Button asChild variant="ghost" className="w-full">
                <Link to="/" className="inline-flex items-center gap-1.5">
                  <ArrowLeft className="h-3.5 w-3.5" /> На главную
                </Link>
              </Button>
            </div>
          </div>

          <div className="mt-5 text-center">
            <p className="text-xs text-[hsl(var(--text-muted))]">
              Нужна помощь? <a href="mailto:support@aveotvet.com" className="text-primary hover:text-primary/80">support@aveotvet.com</a>
            </p>
          </div>
        </div>
      </div>
    )
  }

  /* ─── Open registration form ─── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password || !confirmPassword) { setError("Заполните все поля"); return }
    if (password !== confirmPassword) { setError("Пароли не совпадают"); return }
    if (password.length < 8) { setError("Пароль должен содержать минимум 8 символов"); return }

    setIsLoading(true)
    setError("")

    try {
      await register(email.trim(), password)
      navigate("/app/onboarding")
    } catch (error) {
      const message = getErrorMessage(error, "Не удалось создать аккаунт")
      setError(message)
      toast({ title: "Не удалось создать аккаунт", description: message, variant: "destructive" })
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
            Начните работу<br />за 2 минуты
          </h2>
          <p className="mt-3 text-sm text-[hsl(var(--text-default))] leading-relaxed max-w-xs">
            Создайте аккаунт, подключите WB Token, задайте правила — готово.
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
              <h1 className="text-xl font-bold text-[hsl(var(--text-strong))]">Создайте аккаунт</h1>
              <p className="mt-1.5 text-sm text-[hsl(var(--text-muted))]">После регистрации вы перейдёте к подключению магазина</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-[hsl(var(--text-strong))]">Email</label>
                <Input type="email" placeholder="user@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-[hsl(var(--text-strong))]">Пароль</label>
                <Input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
                <p className="text-xs text-[hsl(var(--text-muted))]">Минимум 8 символов</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-[hsl(var(--text-strong))]">Подтвердите пароль</label>
                <Input type="password" placeholder="••••••••" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required autoComplete="new-password" />
              </div>

              {error && (
                <div className="rounded-xl border border-destructive/20 bg-danger-soft px-4 py-3">
                  <p className="text-sm font-medium text-destructive">{error}</p>
                </div>
              )}

              <Button type="submit" disabled={isLoading} className="w-full h-12">
                {isLoading ? "Создаём аккаунт…" : "Продолжить"}
              </Button>
            </form>
          </div>

          <div className="mt-5 text-center">
            <p className="text-sm text-[hsl(var(--text-muted))]">
              Уже есть аккаунт?{" "}
              <Link to="/login" className="text-primary font-medium hover:text-primary/80">Войти</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
