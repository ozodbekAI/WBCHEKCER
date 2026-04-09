import { useState } from "react"
import { Link, useLocation } from "react-router-dom"

import {
  MessageSquare,
  HelpCircle,
  Settings,
  MessageCircle,
  Home,
  Wallet,
  UsersRound,
  BarChart2,
  MessageSquareText,
  ChevronRight,
} from "lucide-react"

import type { ShopBilling, ShopOut, ShopRole } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface SidebarProps {
  shops: ShopOut[]
  selectedShopId: number | null
  onShopChange: (shopId: number) => void
  onAddShop?: () => void
  selectedShopRole?: ShopRole | null
  shopBilling?: ShopBilling | null
  shopBillingLoading?: boolean
  canCreateShop?: boolean
  settingsDot?: boolean
  pendingDraftsCount?: number
  unansweredCount?: number
}

export type StoreNavItem = {
  href: string
  label: string
  icon: typeof Home
  count: number
  dot: boolean
  group: "main" | "work" | "manage"
}

function roleRank(role: ShopRole | null | undefined) {
  switch (role) {
    case "owner": return 4
    case "manager": return 3
    default: return 0
  }
}

function can(role: ShopRole | null | undefined, min: ShopRole) {
  return roleRank(role) >= roleRank(min)
}

export function buildStoreNav({
  selectedShopRole,
  settingsDot,
  pendingDraftsCount,
  unansweredCount,
}: {
  selectedShopRole?: ShopRole | null
  settingsDot?: boolean
  pendingDraftsCount?: number
  unansweredCount?: number
}): StoreNavItem[] {
  const hasPendingDrafts = (pendingDraftsCount ?? 0) > 0

  const nav: StoreNavItem[] = [
    { href: "/app/dashboard", label: "Главная", icon: Home, count: 0, dot: false, group: "main" },
    { href: "/app/feedbacks", label: "Отзывы", icon: MessageSquare, count: unansweredCount || 0, dot: hasPendingDrafts, group: "work" },
    { href: "/app/questions", label: "Вопросы", icon: HelpCircle, count: 0, dot: false, group: "work" },
    { href: "/app/chat", label: "Чаты", icon: MessageCircle, count: 0, dot: false, group: "work" },
    { href: "/app/analytics", label: "Аналитика", icon: BarChart2, count: 0, dot: false, group: "work" },
  ]

  const canSettings = Boolean(can(selectedShopRole, "manager"))
  if (canSettings) {
    nav.push({ href: "/app/settings", label: "Настройки", icon: Settings, count: 0, dot: Boolean(settingsDot), group: "manage" })
  }

  if (selectedShopRole === "owner") {
    nav.push({ href: "/app/team", label: "Команда", icon: UsersRound, count: 0, dot: false, group: "manage" })
    nav.push({ href: "/app/billing", label: "Баланс", icon: Wallet, count: 0, dot: false, group: "manage" })
  }

  return nav
}

const GROUP_LABELS: Record<string, string> = {
  main: "",
  work: "Работа",
  manage: "Управление",
}

export default function Sidebar({ selectedShopRole, settingsDot, pendingDraftsCount, unansweredCount }: SidebarProps) {
  const { pathname } = useLocation()
  const [expanded, setExpanded] = useState(false)
  const nav = buildStoreNav({ selectedShopRole, settingsDot, pendingDraftsCount, unansweredCount })

  const groups = ["main", "work", "manage"] as const
  const grouped = groups.map((g) => ({
    key: g,
    label: GROUP_LABELS[g],
    items: nav.filter((item) => item.group === g),
  })).filter((g) => g.items.length > 0)

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        className={cn(
          "flex h-full flex-col bg-card border-r border-border transition-all duration-200 ease-in-out overflow-hidden",
          expanded ? "w-[240px] 3xl:w-[256px]" : "w-[64px] 3xl:w-[68px]"
        )}
      >
        {/* Brand */}
        <Link to="/app/dashboard" className="block">
          <div className={cn(
            "flex items-center gap-2.5 py-4 3xl:py-5 hover:opacity-80 transition-all",
            expanded ? "px-4" : "justify-center"
          )}>
            <div className="flex h-9 w-9 3xl:h-10 3xl:w-10 shrink-0 items-center justify-center rounded-xl bg-primary">
              <MessageSquareText className="h-4.5 w-4.5 3xl:h-5 3xl:w-5 text-primary-foreground" />
            </div>
            {expanded && (
              <div className="overflow-hidden whitespace-nowrap">
                <div className="text-[15px] 3xl:text-base font-bold text-gradient-brand leading-none">AVEOTVET</div>
                <div className="text-[10px] 3xl:text-[11px] text-[hsl(var(--text-muted))] mt-0.5">Менеджер отзывов WB</div>
              </div>
            )}
          </div>
        </Link>

        <div className="h-px bg-border mx-3" />

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 3xl:py-4 space-y-4 3xl:space-y-5">
          {grouped.map((group) => (
            <div key={group.key}>
              {group.label && expanded && (
                <div className="px-3 mb-1.5 text-[10px] 3xl:text-[11px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-muted))] transition-opacity duration-200">
                  {group.label}
                </div>
              )}
              {group.label && !expanded && (
                <div className="mx-auto mb-1.5 h-px w-6 bg-border" />
              )}
              <div className="space-y-0.5 3xl:space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon
                  const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href + "/"))

                  const button = (
                    <Link key={item.href} to={item.href}>
                      <div
                        className={cn(
                          "flex items-center rounded-xl h-10 3xl:h-11 transition-all cursor-pointer relative",
                          expanded ? "gap-2.5 px-3" : "justify-center w-10 3xl:w-11 mx-auto",
                          active
                            ? "bg-primary/10 text-primary"
                            : "text-[hsl(var(--text-default))] hover:bg-secondary/80"
                        )}
                      >
                        <Icon className={cn(
                          "h-[18px] w-[18px] 3xl:h-5 3xl:w-5 shrink-0",
                          active ? "text-primary" : "text-[hsl(var(--text-muted))]"
                        )} />
                        {expanded && (
                          <span className="text-[13px] 3xl:text-sm font-medium whitespace-nowrap">
                            {item.label}
                          </span>
                        )}
                        {item.count > 0 && (
                          <span className={cn(
                            "flex h-[18px] min-w-[18px] 3xl:h-5 3xl:min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] 3xl:text-[11px] font-semibold text-primary-foreground",
                            expanded ? "ml-auto" : "absolute -top-0.5 -right-0.5 h-4 min-w-4 text-[9px]"
                          )}>
                            {item.count > 99 ? "99+" : item.count}
                          </span>
                        )}
                        {item.dot && !item.count && (
                          <span className={cn(
                            "h-2 w-2 rounded-full bg-primary",
                            expanded ? "ml-auto" : "absolute -top-0.5 -right-0.5"
                          )} />
                        )}
                      </div>
                    </Link>
                  )

                  if (!expanded) {
                    return (
                      <Tooltip key={item.href}>
                        <TooltipTrigger asChild>
                          {button}
                        </TooltipTrigger>
                        <TooltipContent side="right" className="text-xs 3xl:text-[13px]">
                          {item.label}
                          {item.count > 0 && ` (${item.count})`}
                        </TooltipContent>
                      </Tooltip>
                    )
                  }

                  return button
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Expand indicator */}
        <div className={cn(
          "flex items-center justify-center py-3 text-[hsl(var(--text-muted))] transition-all",
          expanded && "opacity-0"
        )}>
          <ChevronRight className="h-3.5 w-3.5" />
        </div>
      </aside>
    </TooltipProvider>
  )
}
