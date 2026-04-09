import React from "react"
import { useNavigate } from "react-router-dom"
import {
  ArrowRight,
  BrainCircuit,
  CreditCard,
  HelpCircle,
  Receipt,
  RefreshCw,
  TrendingDown,
  Wallet,
  Zap,
} from "lucide-react"

import { useShop } from "@/components/shop-context"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatusPill, StateBanner, InlineHelper, StateEmpty } from "@/components/shared/system-state"
import { cn } from "@/lib/utils"

/* ── Helpers ── */

function fmtMoney(value: number | null | undefined) {
  const safe = typeof value === "number" && Number.isFinite(value) ? value : 0
  return safe.toLocaleString("ru-RU")
}

function ledgerReasonLabel(reason: string | null | undefined) {
  if (!reason) return "Операция"
  const map: Record<string, string> = {
    payment_topup: "Пополнение баланса",
    publish: "Публикация",
    publish_refund: "Возврат за публикацию",
    chat_draft: "Черновик для чата",
    question_draft: "Черновик для вопроса",
    feedback_draft: "Черновик для отзыва",
    classification: "Классификация отзывов",
    analytics_reserve: "Резерв на аналитику",
    analytics_release: "Возврат резерва",
  }
  return map[reason] || reason.replace(/_/g, " ")
}

/* ── Sub-components ── */

function BalanceHero({ balance, reserved, reservedRemaining, spent, backfillActive }: {
  balance: number
  reserved: number
  reservedRemaining: number
  spent: number
  backfillActive: boolean
}) {
  const available = Math.max(0, balance - reservedRemaining)
  const hasReservation = reserved > 0
  const reserveUsed = reserved - reservedRemaining
  const reservePercent = reserved > 0 ? Math.round((reserveUsed / reserved) * 100) : 0

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {/* Main balance */}
      <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Wallet className="h-4 w-4 text-primary" />
          </div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Общий баланс</div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-3xl font-bold tabular-nums text-foreground">{fmtMoney(balance)}</span>
          <span className="text-sm text-muted-foreground">кредитов</span>
        </div>

        {hasReservation ? (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">Доступно для операций</span>
              <span className="font-semibold text-foreground">{fmtMoney(available)} кр.</span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">Потрачено всего</span>
              <span className="font-medium text-muted-foreground">{fmtMoney(spent)} кр.</span>
            </div>
          </div>
        ) : (
          <div className="mt-2 text-xs text-muted-foreground">
            Потрачено за всё время: <span className="font-semibold text-foreground">{fmtMoney(spent)}</span> кр.
          </div>
        )}

        {balance <= 0 && (
          <div className="mt-3">
            <StatusPill status="paused_insufficient_balance" label="Баланс исчерпан" showIcon size="sm" />
          </div>
        )}
      </div>

      {/* Analytics reservation card */}
      {hasReservation ? (
        <div className="rounded-xl border border-info/20 bg-[hsl(var(--info-soft))]/30 p-5">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-info/10">
              <BrainCircuit className="h-4 w-4 text-info" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">Резерв на AI-аналитику</div>
              {backfillActive && (
                <StatusPill status="running" label="Backfill активен" size="xs" showIcon className="mt-0.5" />
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-muted-foreground">Зарезервировано</span>
              <span className="font-semibold text-foreground">{fmtMoney(reserved)} кр.</span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-muted-foreground">Использовано из резерва</span>
              <span className="font-medium text-foreground">{fmtMoney(reserveUsed)} кр.</span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-muted-foreground">Остаток резерва</span>
              <span className="font-semibold text-info">{fmtMoney(reservedRemaining)} кр.</span>
            </div>
            <Progress value={reservePercent} className="h-1.5 mt-1" />
            <div className="text-[10px] text-muted-foreground text-right">{reservePercent}% использовано</div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-sm font-semibold text-foreground">Как работают кредиты</div>
          </div>
          <div className="space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2"><Zap className="h-3 w-3 text-primary shrink-0" /> Каждый AI-ответ расходует 1 кредит</div>
            <div className="flex items-center gap-2"><Zap className="h-3 w-3 text-primary shrink-0" /> AI-аналитика может зарезервировать бюджет</div>
            <div className="flex items-center gap-2"><Zap className="h-3 w-3 text-primary shrink-0" /> Ручные ответы бесплатны</div>
            <div className="flex items-center gap-2"><Zap className="h-3 w-3 text-primary shrink-0" /> Кредиты не сгорают</div>
          </div>
        </div>
      )}
    </div>
  )
}

function InsufficientBalanceBanner({ navigate }: { navigate: (path: string) => void }) {
  return (
    <StateBanner
      tone="warning"
      icon={<TrendingDown className="h-4 w-4" />}
      title="Недостаточно кредитов"
      description="Генерация черновиков и AI-аналитика приостановлены. Пополните баланс для возобновления работы."
      action={
        <Button variant="outline" size="sm" className="h-7 text-[11px] px-3 gap-1" onClick={() => navigate("/app/settings")}>
          Связаться с администратором
          <ArrowRight className="h-3 w-3" />
        </Button>
      }
    />
  )
}

function PaymentsTable({ payments }: { payments: any[] }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
        <h3 className="text-[13px] font-semibold text-foreground">Пополнения</h3>
        <Badge variant="secondary" className="text-[10px] font-semibold">{payments.length}</Badge>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="text-[11px] pl-4">Дата</TableHead>
            <TableHead className="text-[11px]">Статус</TableHead>
            <TableHead className="text-[11px]">Комментарий</TableHead>
            <TableHead className="text-[11px] text-right">Платёж</TableHead>
            <TableHead className="text-[11px] text-right pr-4">Зачислено</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.length ? payments.map((p) => (
            <TableRow key={String(p.id)}>
              <TableCell className="text-[12px] text-muted-foreground pl-4">
                {p.created_at ? new Date(p.created_at).toLocaleString("ru-RU") : "—"}
              </TableCell>
              <TableCell>
                <StatusPill status="ready" label="Зачислено" size="xs" />
              </TableCell>
              <TableCell className="text-[12px]">{p.comment || "—"}</TableCell>
              <TableCell className="text-right text-[12px] font-medium">{fmtMoney(p.amount_rub)} ₽</TableCell>
              <TableCell className="text-right text-[12px] font-semibold text-success pr-4">+{fmtMoney(p.credit_delta ?? 0)} кр.</TableCell>
            </TableRow>
          )) : (
            <TableRow>
              <TableCell colSpan={5} className="py-10 text-center">
                <div className="flex flex-col items-center gap-1">
                  <Receipt className="h-4 w-4 text-muted-foreground/40" />
                  <div className="text-[12px] text-muted-foreground">Пополнений пока не было</div>
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function OperationsTable({ operations }: { operations: any[] }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
        <h3 className="text-[13px] font-semibold text-foreground">Операции с кредитами</h3>
        <Badge variant="secondary" className="text-[10px] font-semibold">{operations.length}</Badge>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="text-[11px] pl-4">Дата</TableHead>
            <TableHead className="text-[11px]">Тип</TableHead>
            <TableHead className="text-[11px]">Причина</TableHead>
            <TableHead className="text-[11px] text-right pr-4">Изменение</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {operations.length ? operations.map((item, i) => (
            <TableRow key={String(item.id ?? i)}>
              <TableCell className="text-[12px] text-muted-foreground pl-4">
                {item.created_at ? new Date(item.created_at).toLocaleString("ru-RU") : "—"}
              </TableCell>
              <TableCell>
                <StatusPill
                  status={item.delta >= 0 ? "ready" : "disabled"}
                  label={item.delta >= 0 ? "Возврат" : "Списание"}
                  size="xs"
                />
              </TableCell>
              <TableCell className="text-[12px]">{ledgerReasonLabel(item.reason)}</TableCell>
              <TableCell className={cn("text-right text-[12px] font-semibold pr-4", item.delta >= 0 ? "text-success" : "text-foreground")}>
                {item.delta > 0 ? "+" : ""}{fmtMoney(item.delta)} кр.
              </TableCell>
            </TableRow>
          )) : (
            <TableRow>
              <TableCell colSpan={4} className="py-10 text-center">
                <div className="flex flex-col items-center gap-1">
                  <CreditCard className="h-4 w-4 text-muted-foreground/40" />
                  <div className="text-[12px] text-muted-foreground">Пока нет операций</div>
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

/* ── Main Module ── */

export default function BillingModule() {
  const { shopId, selectedShop, billing, shopRole, refresh } = useShop()
  const navigate = useNavigate()

  if (!shopId) {
    return <StateEmpty icon={<Wallet className="h-5 w-5" />} title="Магазин не выбран" description="Выберите магазин для просмотра баланса." />
  }

  if (shopRole !== "owner") {
    return <StateEmpty icon={<Wallet className="h-5 w-5" />} title="Раздел доступен владельцу" description="Баланс и операции доступны только владельцу магазина." />
  }

  const balance = billing?.credits_balance ?? 0
  const spent = billing?.credits_spent ?? 0
  const reserved = billing?.credits_reserved ?? 0
  const reservedRemaining = billing?.credits_reserved_remaining ?? 0
  const backfillActive = billing?.analytics_backfill_active ?? false
  const payments = billing?.payments ?? []
  const operations = (billing?.recent ?? []).filter((item) => item.reason !== "payment_topup")

  const isLowBalance = balance > 0 && (balance - reservedRemaining) <= 5
  const isZeroBalance = balance <= 0

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Баланс</h1>
          <p className="text-[12px] text-muted-foreground">{selectedShop?.name ?? `Магазин #${shopId}`}</p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} className="gap-1.5 rounded-xl h-8 text-[12px]">
          <RefreshCw className="h-3.5 w-3.5" />
          Обновить
        </Button>
      </div>

      {/* Insufficient balance warning */}
      {(isZeroBalance || isLowBalance) && <InsufficientBalanceBanner navigate={navigate} />}

      {/* Analytics reservation info */}
      {backfillActive && reserved > 0 && (
        <InlineHelper tone="info" icon={<BrainCircuit className="h-3.5 w-3.5" />}>
          AI-аналитика зарезервировала <strong>{fmtMoney(reserved)}</strong> кредитов для классификации отзывов.
          Зарезервированные кредиты недоступны для черновиков до завершения backfill.
        </InlineHelper>
      )}

      {/* Balance cards */}
      <BalanceHero
        balance={balance}
        reserved={reserved}
        reservedRemaining={reservedRemaining}
        spent={spent}
        backfillActive={backfillActive}
      />

      {/* Tables */}
      <PaymentsTable payments={payments} />
      <OperationsTable operations={operations} />
    </div>
  )
}
