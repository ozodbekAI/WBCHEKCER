"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  MessageSquare,
  HelpCircle,
  Settings,
  MessageCircle,
  Home,
  Wallet,
  UsersRound,
} from "lucide-react"

import type { ShopBilling, ShopOut, ShopRole } from "@/lib/api"

interface SidebarProps {
  // kept for backward compatibility (shop switcher moved to header)
  shops: ShopOut[]
  selectedShopId: number | null
  onShopChange: (shopId: number) => void
  onAddShop?: () => void

  selectedShopRole?: ShopRole | null
  shopBilling?: ShopBilling | null
  shopBillingLoading?: boolean
  canCreateShop?: boolean

  /** Show a small dot next to Settings (e.g. onboarding unfinished) */
  settingsDot?: boolean
  
  /** Count of pending drafts to show in sidebar */
  pendingDraftsCount?: number
  
  /** Count of unanswered feedbacks */
  unansweredCount?: number
}

function roleRank(role: ShopRole | null | undefined) {
  switch (role) {
    case "owner":
      return 4
    case "manager":
      return 3
    default:
      return 0
  }
}

function can(role: ShopRole | null | undefined, min: ShopRole) {
  return roleRank(role) >= roleRank(min)
}

export default function Sidebar({ selectedShopRole, settingsDot, pendingDraftsCount, unansweredCount }: SidebarProps) {
  const pathname = usePathname()

  // Check if there are any pending drafts to show dot on Отзывы
  const hasPendingDrafts = (pendingDraftsCount ?? 0) > 0

  const nav = [
    { href: "/app/dashboard", label: "Главная", icon: Home, count: 0, dot: false },
    { href: "/app/feedbacks", label: "Отзывы", icon: MessageSquare, count: unansweredCount || 0, dot: hasPendingDrafts },
    { href: "/app/questions", label: "Вопросы", icon: HelpCircle, count: 0, dot: false },
    { href: "/app/chat", label: "Чаты", icon: MessageCircle, count: 0, dot: false },
  ]

  const isOwner = selectedShopRole === "owner"
  const canSettings = Boolean(can(selectedShopRole, "manager"))

  // billing + team are owner-only
  if (isOwner) {
    nav.push({ href: "/app/billing", label: "Баланс", icon: Wallet, count: 0, dot: false })
    nav.push({ href: "/app/team", label: "Команда", icon: UsersRound, count: 0, dot: false })
  }
  if (canSettings) {
    nav.push({ href: "/app/settings", label: "Настройки", icon: Settings, count: 0, dot: Boolean(settingsDot) })
  }

  return (
    <aside className="flex h-full w-64 flex-col bg-sidebar border-r border-sidebar-border">
      <Link href="/app/dashboard" className="block">
        <div className="p-4 hover:bg-secondary/70 rounded-lg transition-colors cursor-pointer m-2">
          <h1 className="text-2xl font-bold wb-gradient-text">AVEOTVET</h1>
          <p className="text-xs text-muted-foreground mt-1">Feedback Manager</p>
        </div>
      </Link>

      <Separator className="bg-sidebar-border" />

      <nav className="flex-1 p-4 space-y-1">
        {nav.map((item) => {
          const Icon = item.icon
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href + "/"))
          const showDot = item.dot

          return (
            <Link key={item.href} href={item.href} className="block">
              <Button
                variant="ghost"
                className={
                  "w-full justify-start text-sm rounded-xl transition-colors " +
                  (active
                    ? "bg-primary/10 text-primary hover:bg-primary/15"
                    : "text-sidebar-foreground hover:bg-secondary/70")
                }
              >
                <Icon className={"mr-2 h-4 w-4 " + (active ? "text-primary" : "text-muted-foreground")} />
                {item.label}
                <div className="ml-auto flex items-center gap-1.5">
                  {item.count > 0 && (
                    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
                      {item.count > 99 ? "99+" : item.count}
                    </span>
                  )}
                  {showDot && <span className="h-2 w-2 rounded-full bg-amber-400" />}
                </div>
              </Button>
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
