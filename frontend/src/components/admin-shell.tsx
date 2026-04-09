import type React from "react"

import { useMemo, useState } from "react"
import { Link, useNavigate, useLocation } from "react-router-dom"
import {
  Activity,
  Bot,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Settings2,
  Shield,
  Store,
  Users,
  Wrench,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataErrorState } from "@/components/ui/data-state"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { getMe, logout } from "@/lib/api"
import { getErrorMessage } from "@/lib/error-message"
import { cn } from "@/lib/utils"
import { useAsyncData } from "@/hooks/use-async-data"
import { toast } from "sonner"

type Me = { id: number; email: string; role: string }

type NavItem = {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles?: string[]
}

const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Обзор",
    items: [
      { href: "/admin/dashboard", label: "Сводка", icon: LayoutDashboard, roles: ["super_admin"] },
    ],
  },
  {
    title: "Управление",
    items: [
      { href: "/admin/shops", label: "Магазины", icon: Store },
      { href: "/admin/users", label: "Пользователи", icon: Users },
      { href: "/admin/payments", label: "Платежи", icon: CreditCard, roles: ["super_admin"] },
    ],
  },
  {
    title: "AI / Политики",
    items: [
      { href: "/admin/ai", label: "Лаборатория ИИ", icon: Bot, roles: ["super_admin"] },
      { href: "/admin/prompts", label: "Промпты", icon: Settings2, roles: ["super_admin"] },
      { href: "/admin/generation-logs", label: "Генерации ИИ", icon: Bot },
    ],
  },
  {
    title: "Операции",
    items: [{ href: "/admin/ops", label: "Операции", icon: Activity }],
  },
  {
    title: "Аудит",
    items: [
      { href: "/admin/logs", label: "Логи", icon: Wrench },
      { href: "/admin/audit", label: "Аудит", icon: ScrollText },
    ],
  },
]

function roleMeta(role?: string | null) {
  if (role === "super_admin") return { label: "Суперадмин", tone: "default" as const }
  if (role === "support_admin") return { label: "Поддержка", tone: "secondary" as const }
  return { label: role || "—", tone: "outline" as const }
}

function visibleGroups(role?: string | null) {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.roles || i.roles.includes(role || "")),
  })).filter((g) => g.items.length > 0)
}

function currentLabel(pathname: string, groups: ReturnType<typeof visibleGroups>) {
  for (const g of groups) for (const i of g.items) if (pathname === i.href || pathname.startsWith(`${i.href}/`)) return i.label
  return "Админ"
}

function NavGroups({ pathname, groups, onNavigate }: { pathname: string; groups: ReturnType<typeof visibleGroups>; onNavigate?: () => void }) {
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.title}>
          <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/60">{group.title}</div>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
              const Icon = item.icon
              return (
                <Link key={item.href} to={item.href} onClick={onNavigate}>
                  <div className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors",
                    active
                      ? "bg-foreground/[0.06] text-foreground font-medium"
                      : "text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground"
                  )}>
                    <Icon className={cn("h-4 w-4 shrink-0", active ? "text-foreground" : "text-muted-foreground/60")} />
                    <span>{item.label}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const meQuery = useAsyncData<Me>(async () => getMe(), [], {
    keepPreviousData: true,
    fallbackError: "Не удалось загрузить профиль",
  })
  const me = meQuery.data
  const groups = useMemo(() => visibleGroups(me?.role), [me?.role])
  const role = roleMeta(me?.role)
  const sectionLabel = currentLabel(pathname, groups)

  const handleLogout = async () => {
    try { await logout() } catch (e) { toast("Сеанс завершён", { description: getErrorMessage(e) }) }
    finally { navigate("/login") }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-[240px] shrink-0 border-r border-border bg-card xl:flex">
          <div className="flex w-full flex-col px-3 py-4">
            {/* Brand */}
            <div className="px-3 pb-4 border-b border-border/40">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/[0.06]">
                  <Shield className="h-4 w-4 text-foreground" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">AVEOTVET</div>
                  <div className="text-[10px] text-muted-foreground">Админ-панель</div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Badge variant={role.tone} className="text-[10px]">{role.label}</Badge>
                <span className="text-[10px] text-muted-foreground truncate">{me?.email || "…"}</span>
              </div>
            </div>

            <ScrollArea className="mt-3 flex-1 pr-1">
              <NavGroups pathname={pathname} groups={groups} />
            </ScrollArea>

            <div className="pt-3 border-t border-border/40">
              <Button variant="ghost" size="sm" onClick={handleLogout} className="w-full justify-start text-muted-foreground hover:text-foreground text-xs gap-2">
                <LogOut className="h-3.5 w-3.5" /> Выйти
              </Button>
            </div>
          </div>
        </aside>

        {/* Main */}
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
            <div className="flex h-12 items-center justify-between gap-3 px-4 md:px-6">
              <div className="flex items-center gap-3">
                <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                  <SheetTrigger asChild>
                    <Button variant="ghost" size="sm" className="xl:hidden h-8 w-8 p-0">
                      <Menu className="h-4 w-4" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-[260px] p-0">
                    <SheetHeader className="border-b border-border px-4 py-3">
                      <SheetTitle className="text-sm">Навигация</SheetTitle>
                      <div className="flex items-center gap-2">
                        <Badge variant={role.tone} className="text-[10px]">{role.label}</Badge>
                        <span className="text-[10px] text-muted-foreground">{me?.email}</span>
                      </div>
                    </SheetHeader>
                    <div className="flex flex-col h-full px-3 py-3">
                      <ScrollArea className="flex-1">
                        <NavGroups pathname={pathname} groups={groups} onNavigate={() => setMenuOpen(false)} />
                      </ScrollArea>
                      <Button variant="ghost" size="sm" onClick={handleLogout} className="mt-3 justify-start text-xs gap-2">
                        <LogOut className="h-3.5 w-3.5" /> Выйти
                      </Button>
                    </div>
                  </SheetContent>
                </Sheet>

                <div>
                  <div className="text-sm font-medium text-foreground">{sectionLabel}</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge variant="outline" className="hidden md:flex text-[10px]">
                  {role.label}
                </Badge>
                <div className="text-[10px] text-muted-foreground hidden lg:block">
                  Админ-панель
                </div>
              </div>
            </div>

            {meQuery.error && (
              <div className="px-4 pb-3 md:px-6">
                <DataErrorState compact title="Профиль не загружен" description={meQuery.error} onAction={() => void meQuery.refresh()} />
              </div>
            )}
          </header>

          <main className="px-4 py-5 md:px-6">
            <div className="mx-auto w-full max-w-content">{children}</div>
          </main>
        </div>
      </div>
    </div>
  )
}
