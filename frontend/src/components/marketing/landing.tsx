import { Link } from "react-router-dom"

import {
  ArrowRight,
  BadgeCheck,
  HelpCircle,
  MessageCircle,
  MessageSquare,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Wand2,
  Zap,
  Clock,
} from "lucide-react"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"

export default function Landing({ registrationOpen = false }: { registrationOpen?: boolean }) {
  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ── */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-content items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary">
              <MessageSquareText className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="text-base font-bold text-gradient-brand">AVEOTVET</span>
          </Link>

          <nav className="hidden items-center gap-6 text-sm text-[hsl(var(--text-muted))] md:flex">
            <a href="#how" className="transition-colors hover:text-[hsl(var(--text-strong))]">Как работает</a>
            <a href="#features" className="transition-colors hover:text-[hsl(var(--text-strong))]">Возможности</a>
            <a href="#faq" className="transition-colors hover:text-[hsl(var(--text-strong))]">Вопросы</a>
          </nav>

          <div className="flex items-center gap-2">
            {registrationOpen && (
              <Button asChild variant="ghost" size="sm">
                <Link to="/register">Регистрация</Link>
              </Button>
            )}
            <Button asChild size="sm">
              <Link to="/login">Войти</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-content px-5 pb-20">
        {/* ── HERO ── */}
        <section className="pt-16 md:pt-24" id="how">
          <div className="grid items-start gap-10 lg:grid-cols-[1fr_420px]">
            {/* Left */}
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-[hsl(var(--text-muted))]">
                <Zap className="h-3 w-3 text-primary" />
                Для продавцов Wildberries
              </div>

              <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight text-[hsl(var(--text-strong))] md:text-[2.75rem] md:leading-[1.12]">
                Отзывы, вопросы и чаты —{" "}
                <span className="text-gradient-brand">в одном кабинете</span>
              </h1>

              <p className="mt-4 max-w-lg text-base leading-relaxed text-[hsl(var(--text-default))]">
                AVEOTVET помогает продавцам Wildberries быстрее отвечать на отзывы, управлять вопросами и вести чаты.
                Задайте правила — система всё сделает по настройкам.
              </p>

              <div className="mt-7 space-y-3">
                {[
                  "Раздел «Ожидают ответа» — открыли отзыв, поле ответа сразу в фокусе",
                  "Подписи по брендам — выбираете бренд, задаёте подпись автоматически",
                  "Автоматизация по вашим правилам — черновики, автопубликация, тон",
                ].map((text) => (
                  <div key={text} className="flex items-start gap-2.5">
                    <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="text-sm text-[hsl(var(--text-default))]">{text}</span>
                  </div>
                ))}
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild size="lg">
                  <Link to="/login" className="inline-flex items-center gap-2">
                    Войти в кабинет <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                {registrationOpen && (
                  <Button asChild size="lg" variant="outline">
                    <Link to="/register">Создать аккаунт</Link>
                  </Button>
                )}
              </div>

              <p className="mt-3 text-xs text-[hsl(var(--text-muted))]">
                {registrationOpen
                  ? "После регистрации вы сразу перейдёте к подключению магазина."
                  : "Доступ по приглашению владельца магазина."}
              </p>
            </div>

            {/* Right — How it works card */}
            <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[hsl(var(--text-muted))]">Как это работает</h2>
              <ol className="mt-5 space-y-5">
                {[
                  { icon: Sparkles, title: "Получите доступ", desc: registrationOpen ? "Создайте аккаунт или войдите по приглашению." : "Войдите по приглашению владельца магазина." },
                  { icon: ShieldCheck, title: "Подключите магазин", desc: "Укажите WB Token — мы загрузим отзывы, вопросы и чаты." },
                  { icon: Wand2, title: "Настройте правила", desc: "Тон, подписи, автопубликация — вы контролируете всё." },
                ].map((step, i) => (
                  <li key={step.title} className="flex gap-3.5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                      <step.icon className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-[hsl(var(--text-strong))]">{i + 1}. {step.title}</div>
                      <div className="mt-0.5 text-sm text-[hsl(var(--text-muted))]">{step.desc}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ── Trust cards: Отзывы, Вопросы, Чаты ── */}
        <section className="mt-16 md:mt-20">
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { icon: MessageSquare, title: "Отзывы", desc: "Фильтры, статусы, быстрый ответ и AI-черновики", color: "text-primary", bg: "bg-primary-soft" },
              { icon: HelpCircle, title: "Вопросы", desc: "Список вопросов покупателей с быстрым переходом", color: "text-info", bg: "bg-info-soft" },
              { icon: MessageCircle, title: "Чаты", desc: "Общение с покупателями в реальном времени", color: "text-success", bg: "bg-success-soft" },
            ].map((card) => (
              <div key={card.title} className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${card.bg}`}>
                    <card.icon className={`h-4.5 w-4.5 ${card.color}`} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-[hsl(var(--text-strong))]">{card.title}</div>
                    <div className="mt-0.5 text-sm text-[hsl(var(--text-muted))]">{card.desc}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Operational highlights ── */}
        <section className="mt-12 md:mt-16">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Ожидают ответа", desc: "Открыли — сразу поле ввода" },
              { label: "Черновики AI", desc: "Проверка перед публикацией" },
              { label: "Автоматизация", desc: "Работает по вашим настройкам" },
              { label: "Аналитика", desc: "Рейтинги и скорость ответов" },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-border bg-card px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                <div className="text-xs font-medium text-[hsl(var(--text-muted))]">{item.label}</div>
                <div className="mt-1 text-sm font-medium text-[hsl(var(--text-strong))]">{item.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Features ── */}
        <section className="mt-16 md:mt-24" id="features">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-[hsl(var(--text-strong))]">Возможности</h2>
            <p className="mt-2 max-w-xl text-sm text-[hsl(var(--text-muted))]">
              Всё для ежедневной работы с отзывами: быстрое открытие, правила, черновики и подписи по брендам.
            </p>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {[
              { icon: MessageSquareText, title: "Отзывы, вопросы и чаты", desc: "Всё в одном кабинете: фильтры, статусы, быстрый переход к нужному отзыву." },
              { icon: Zap, title: "Автоматизация по правилам", desc: "Автопубликация, черновики и синхронизация — включайте только то, что нужно." },
              { icon: Wand2, title: "Тон и шаблоны", desc: "Выберите тон ответов и подписи по брендам — ответы выглядят единообразно." },
              { icon: Clock, title: "Быстрый ввод ответа", desc: "В «Ожидают ответа» сразу открывается поле ввода — без лишних кликов." },
              { icon: ShieldCheck, title: "Безопасность токена", desc: "Токен WB хранится зашифрованным и используется только для вашего магазина." },
              { icon: Sparkles, title: "Понятная настройка", desc: "Мастер подключения: добавили магазин → выбрали правила → сохранили." },
            ].map((feature) => (
              <div key={feature.title} className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                    <feature.icon className="h-4 w-4" />
                  </div>
                  <div className="text-sm font-semibold text-[hsl(var(--text-strong))]">{feature.title}</div>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--text-muted))]">{feature.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="mt-16 md:mt-24" id="faq">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
            <h2 className="text-lg font-semibold text-[hsl(var(--text-strong))]">Частые вопросы</h2>
            <div className="mt-4">
              <Accordion type="single" collapsible className="w-full">
                {[
                  { q: "Что будет после входа?", a: "Вы перейдёте к подключению магазина: проверите токен, выберете базовые правила и попадёте в кабинет." },
                  { q: "Какие данные нужны для подключения?", a: "Email и пароль для доступа, а также WB Token вашего магазина. Токен обязателен — без него нельзя получать отзывы и бренды." },
                  { q: "Можно ли выключить автоматизацию?", a: "Да. В настройках вы включаете/выключаете авто-синхронизацию, черновики и автопубликацию. Ручной режим всегда доступен." },
                  { q: "Как работают подписи по брендам?", a: "Мы подтягиваем бренды из WB. Вы выбираете бренд и добавляете подпись — она автоматически подставляется в ответы." },
                ].map((item, i) => (
                  <AccordionItem key={i} value={`item-${i}`}>
                    <AccordionTrigger className="text-sm text-[hsl(var(--text-strong))]">{item.q}</AccordionTrigger>
                    <AccordionContent className="text-sm text-[hsl(var(--text-muted))]">{item.a}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </div>
        </section>

        {/* ── Bottom CTA ── */}
        <section className="mt-16 flex flex-col items-center gap-4 text-center">
          <h3 className="text-xl font-semibold text-[hsl(var(--text-strong))]">
            {registrationOpen ? "Готовы начать?" : "Уже есть приглашение?"}
          </h3>
          <p className="max-w-md text-sm text-[hsl(var(--text-muted))]">
            {registrationOpen
              ? "Создайте аккаунт, подключите магазин и настройте правила ответов."
              : "Войдите по приглашению владельца магазина и начните работу."}
          </p>
          <Button asChild size="lg">
            <Link to={registrationOpen ? "/register" : "/login"} className="inline-flex items-center gap-2">
              {registrationOpen ? "Создать аккаунт" : "Войти в кабинет"} <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex max-w-content flex-col gap-2 px-5 py-6 text-xs text-[hsl(var(--text-muted))] sm:flex-row sm:items-center sm:justify-between">
          <div>© {new Date().getFullYear()} AVEOTVET</div>
          <div>Поддержка: support@aveotvet.com</div>
        </div>
      </footer>
    </div>
  )
}
