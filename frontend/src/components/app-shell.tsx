import type React from "react"

import { Link } from "react-router-dom"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import {
  Activity,
  CheckCircle2,
  LogOut,
  Menu,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Wand2,
} from "lucide-react"

import Sidebar, { buildStoreNav } from "@/components/layout/sidebar"
import { ShopProvider } from "@/components/shop-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataErrorState, DataLoadingState } from "@/components/ui/data-state"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import {
  getBillingShop,
  getDashboardMain,
  getMe,
  getSettings,
  listShops,
  logout,
  syncDashboardAll,
  updateSettings,
  type DashboardMainOut,
  type ShopBilling,
  type ShopOut,
} from "@/lib/api"
import { getErrorMessage } from "@/lib/error-message"
import { cn } from "@/lib/utils"
import { useSyncPolling } from "@/hooks/use-sync-polling"
import { useAsyncData } from "@/hooks/use-async-data"
import { toast } from "sonner"

const SELECTED_SHOP_KEY = "wb_otveto_selected_shop_id"
const WIZARD_STORAGE_KEYS = ["wb_otveto_setup_wizard_v2", "wb_otveto_setup_wizard_v3"]

function formatSyncTime(value: string | null | undefined) {
  if (!value) return "Не синхронизировано"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Не синхронизировано"
  return `${date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })}`
}

function currentSectionLabel(pathname: string, nav: ReturnType<typeof buildStoreNav>) {
  const active = nav.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
  return active?.label || "Кабинет"
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const [selectedShopId, setSelectedShopId] = useState<number | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [automationSaving, setAutomationSaving] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { isPolling, pollJobs } = useSyncPolling()

  const accountQuery = useAsyncData<{ me: { id: number; email: string; role: string } | null; meError: string | null; shops: ShopOut[] }>(
    async () => {
      const [meResult, shopsResult] = await Promise.allSettled([getMe(), listShops()])
      if (shopsResult.status === "rejected") throw shopsResult.reason
      return {
        me: meResult.status === "fulfilled" ? meResult.value : null,
        meError: meResult.status === "rejected" ? getErrorMessage(meResult.reason, "Не удалось загрузить профиль пользователя") : null,
        shops: shopsResult.value || [],
      }
    },
    [],
    { keepPreviousData: true, fallbackError: "Не удалось загрузить список магазинов" },
  )

  const shops = accountQuery.data?.shops || []
  const me = accountQuery.data?.me || null
  const meError = accountQuery.data?.meError
  const loadingShops = accountQuery.isLoading
  const shopsLoaded = accountQuery.hasLoaded
  const shopsError = accountQuery.error

  const selectedShop = useMemo(() => shops.find((shop) => shop.id === selectedShopId) || null, [shops, selectedShopId])
  const selectedShopRole = useMemo(() => (selectedShop?.my_role as any) || null, [selectedShop])
  const canSeeBalance = selectedShopRole === "owner"
  const userInitial = useMemo(() => (me?.email?.trim()?.[0] || "A").toUpperCase(), [me?.email])

  const summaryQuery = useAsyncData<DashboardMainOut | null>(
    async () => {
      if (!selectedShopId) return null
      return getDashboardMain({ shop_id: selectedShopId, period: "all" })
    },
    [selectedShopId],
    { enabled: Boolean(selectedShopId), keepPreviousData: true, fallbackError: "Не удалось загрузить сводку магазина" },
  )

  const billingQuery = useAsyncData<ShopBilling | null>(
    async () => {
      if (!selectedShopId || !canSeeBalance) return null
      return getBillingShop(selectedShopId)
    },
    [selectedShopId, canSeeBalance],
    { enabled: Boolean(selectedShopId && canSeeBalance), keepPreviousData: true, fallbackError: "Не удалось загрузить баланс магазина" },
  )

  const statusQuery = useAsyncData<{ automationEnabled: boolean; onboardingNeeded: boolean } | null>(
    async () => {
      if (!selectedShopId) return null
      const settings: any = await getSettings(selectedShopId)
      return {
        automationEnabled: Boolean(settings?.automation_enabled),
        onboardingNeeded: !Boolean(settings?.config?.onboarding?.done),
      }
    },
    [selectedShopId],
    { enabled: Boolean(selectedShopId), keepPreviousData: true, fallbackError: "Не удалось загрузить состояние автоматизации" },
  )

  const shopBilling = billingQuery.data
  const dashboardSummary = summaryQuery.data
  const automationEnabled = statusQuery.data?.automationEnabled ?? null
  const onboardingNeeded = statusQuery.data?.onboardingNeeded ?? false
  const summaryLoading = summaryQuery.isLoading || summaryQuery.isRefreshing
  const automationLoading = statusQuery.isLoading || statusQuery.isRefreshing || automationSaving

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(SELECTED_SHOP_KEY) : null
    const savedId = saved ? Number.parseInt(saved, 10) : null
    if (savedId && Number.isFinite(savedId)) setSelectedShopId(savedId)
  }, [])

  useEffect(() => {
    if (selectedShopId && typeof window !== "undefined") window.localStorage.setItem(SELECTED_SHOP_KEY, String(selectedShopId))
  }, [selectedShopId])

  useEffect(() => {
    if (!shops.length) { setSelectedShopId(null); return }
    setSelectedShopId((prev) => {
      if (prev && shops.some((shop) => shop.id === prev)) return prev
      return shops[0].id
    })
  }, [shops])

  useEffect(() => {
    if (!shopsLoaded || loadingShops || shopsError) return
    if (shops.length === 0 && pathname.startsWith("/app") && pathname !== "/app/onboarding") {
      navigate("/app/onboarding", { replace: true })
    }
  }, [loadingShops, pathname, navigate, shops.length, shopsError, shopsLoaded])

  const refresh = useCallback(async () => {
    await accountQuery.refresh({ background: true })
    if (!selectedShopId) return
    await Promise.all([summaryQuery.refresh({ background: true }), billingQuery.refresh({ background: true }), statusQuery.refresh({ background: true })])
  }, [accountQuery, billingQuery, selectedShopId, statusQuery, summaryQuery])

  const handleSyncAll = useCallback(async () => {
    if (!selectedShopId || isSyncing || isPolling) return
    setIsSyncing(true)
    try {
      const response = await syncDashboardAll({ shop_id: selectedShopId })
      const ids = (response.job_ids || []).filter((value) => Number.isFinite(value) && value > 0)
      if (ids.length) { pollJobs(ids, async () => { await refresh() }) } else { await refresh() }
    } catch (error) {
      toast.error("Не удалось запустить синхронизацию", { description: getErrorMessage(error, "Проверьте подключение магазина и попробуйте снова.") })
    } finally { setIsSyncing(false) }
  }, [isPolling, isSyncing, pollJobs, refresh, selectedShopId])

  const toggleAutomation = async () => {
    if (!selectedShopId || automationEnabled === null || onboardingNeeded) return
    const next = !automationEnabled
    try {
      setAutomationSaving(true)
      await updateSettings(selectedShopId, { automation_enabled: next })
      statusQuery.setData((prev) => (prev ? { ...prev, automationEnabled: next } : prev))
    } catch (error) {
      toast.error("Не удалось обновить автоматизацию", { description: getErrorMessage(error, "Попробуйте ещё раз.") })
    } finally { setAutomationSaving(false) }
  }

  const handleShopChange = (shopId: number) => setSelectedShopId(shopId)

  const handleAddShop = () => {
    if (typeof window !== "undefined") { for (const key of WIZARD_STORAGE_KEYS) window.localStorage.removeItem(key) }
    navigate("/app/onboarding?new=1")
  }

  const handleLogout = async () => {
    try { await logout() } catch (error) { toast("Сеанс завершён локально", { description: getErrorMessage(error, "Не удалось корректно завершить сеанс") }) }
    finally { navigate("/login") }
  }

  const allowNoShop = pathname === "/app/onboarding"
  const navItems = useMemo(
    () => buildStoreNav({
      selectedShopRole,
      settingsDot: onboardingNeeded,
      pendingDraftsCount: dashboardSummary?.feedbacks?.draftsReady || 0,
      unansweredCount: dashboardSummary?.feedbacks?.unanswered || 0,
    }),
    [dashboardSummary?.feedbacks?.draftsReady, dashboardSummary?.feedbacks?.unanswered, onboardingNeeded, selectedShopRole],
  )
  const primaryMobileNav = navItems.filter((item) =>
    ["/app/dashboard", "/app/feedbacks", "/app/questions", "/app/chat", "/app/settings"].includes(item.href),
  )
  const syncLabel = formatSyncTime(dashboardSummary?.lastSyncAt)
  const balanceLabel = selectedShopRole === "owner" ? `${shopBilling?.credits_balance ?? 0} кр.` : null
  const shellWarnings = Array.from(new Set([meError, statusQuery.error, summaryQuery.error, billingQuery.error].filter(Boolean) as string[]))
  const noShopState = loadingShops ? "loading" : shopsError ? "error" : "ready"

  return (
    <div className="h-screen bg-background lg:flex overflow-hidden">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block h-screen sticky top-0">
        <Sidebar
          shops={shops}
          selectedShopId={selectedShopId}
          onShopChange={handleShopChange}
          selectedShopRole={selectedShopRole}
          shopBilling={shopBilling}
          shopBillingLoading={billingQuery.isLoading || billingQuery.isRefreshing}
          canCreateShop={true}
          onAddShop={handleAddShop}
          settingsDot={onboardingNeeded}
          pendingDraftsCount={dashboardSummary?.feedbacks?.draftsReady || 0}
          unansweredCount={dashboardSummary?.feedbacks?.unanswered || 0}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col h-screen overflow-hidden">
        {/* Compact Top Bar — scales with desktop */}
        <header className="shrink-0 z-20 sticky top-0 border-b border-border bg-card/95 backdrop-blur-sm">
          <div className="flex h-14 3xl:h-16 4xl:h-[68px] items-center justify-between gap-3 px-5 3xl:px-7 4xl:px-8">
            {/* Left: mobile menu + store selector group */}
            <div className="flex min-w-0 items-center gap-3">
              {/* Mobile hamburger */}
              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="icon-sm" className="lg:hidden">
                    <Menu className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[92vw] max-w-sm border-r border-border p-0">
                  <SheetHeader className="border-b border-border px-5 py-5 text-left">
                    <SheetTitle className="text-left">AVEOTVET</SheetTitle>
                    <SheetDescription className="text-left">Менеджер отзывов Wildberries</SheetDescription>
                  </SheetHeader>
                  <div className="flex h-full flex-col gap-4 px-4 py-4">
                    <div className="rounded-2xl border border-border bg-secondary/30 p-4">
                      <div className="text-xs text-[hsl(var(--text-muted))]">Пользователь</div>
                      <div className="mt-1 break-all text-sm font-medium text-[hsl(var(--text-strong))]">{me?.email || "Загрузка..."}</div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-[hsl(var(--text-muted))]">Магазин</div>
                      <div className="flex items-center gap-2">
                        <Select value={selectedShopId ? selectedShopId.toString() : ""} onValueChange={(v) => handleShopChange(Number.parseInt(v, 10))} disabled={!shops.length}>
                          <SelectTrigger className="h-12 rounded-xl bg-card"><SelectValue placeholder={shops.length ? "Выберите магазин" : "Магазинов нет"} /></SelectTrigger>
                          <SelectContent>{shops.map((shop) => <SelectItem key={shop.id} value={shop.id.toString()}>{shop.name}</SelectItem>)}</SelectContent>
                        </Select>
                        <Button variant="outline" size="icon-lg" onClick={handleAddShop}><Plus className="h-4 w-4" /></Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {navItems.map((item) => {
                        const Icon = item.icon
                        const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
                        return (
                          <Link key={item.href} to={item.href} onClick={() => setMobileMenuOpen(false)}>
                            <div className={cn("flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition-colors", active ? "bg-primary-soft text-primary" : "text-[hsl(var(--text-default))] hover:bg-secondary")}>
                              <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-[hsl(var(--text-muted))]")} />
                              <span className="font-medium">{item.label}</span>
                              {item.count > 0 && <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground">{item.count > 99 ? "99+" : item.count}</span>}
                            </div>
                          </Link>
                        )
                      })}
                    </div>
                    <div className="mt-auto space-y-3 border-t border-border pt-4">
                      <Button variant="outline" className="h-11 w-full justify-start" onClick={() => { setMobileMenuOpen(false); void handleSyncAll() }} disabled={isSyncing || isPolling || !selectedShopId}>
                        <RefreshCw className={cn("mr-2 h-4 w-4", (isSyncing || isPolling) && "animate-spin")} />
                        {isSyncing || isPolling ? "Синхронизация..." : "Синхронизировать"}
                      </Button>
                      <Button variant="outline" className="h-11 w-full justify-start" onClick={handleLogout}>
                        <LogOut className="mr-2 h-4 w-4" />Выйти
                      </Button>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>

              {/* Store selector compact group */}
              <div className="flex items-center gap-2 3xl:gap-3">
                <Select value={selectedShopId ? selectedShopId.toString() : ""} onValueChange={(v) => handleShopChange(Number.parseInt(v, 10))} disabled={!shops.length}>
                  <SelectTrigger className="hidden h-9 3xl:h-10 min-w-[180px] 3xl:min-w-[200px] rounded-xl border-border bg-card text-sm sm:flex">
                    <SelectValue placeholder={shops.length ? "Магазин" : "Нет магазинов"} />
                  </SelectTrigger>
                  <SelectContent>{shops.map((shop) => <SelectItem key={shop.id} value={shop.id.toString()}>{shop.name}</SelectItem>)}</SelectContent>
                </Select>
                <Button variant="outline" size="icon-sm" onClick={handleAddShop} className="hidden sm:flex" aria-label="Добавить магазин">
                  <Plus className="h-3.5 w-3.5" />
                </Button>

                {/* Automation toggle inline */}
                {selectedShopId && (selectedShopRole === "owner" || selectedShopRole === "manager") ? (
                  onboardingNeeded ? (
                    <Button onClick={() => navigate("/app/onboarding")} size="sm" className="hidden lg:flex">
                      <Wand2 className="mr-1.5 h-3.5 w-3.5" />Настроить
                    </Button>
                  ) : (
                    <button
                      onClick={toggleAutomation}
                      disabled={automationLoading || automationEnabled === null}
                      className={cn(
                        "hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors lg:flex 3xl:px-4 3xl:py-2 3xl:text-[13px]",
                        automationEnabled
                          ? "border-success/30 bg-success-soft text-success"
                          : "border-border bg-secondary text-[hsl(var(--text-muted))]"
                      )}
                    >
                      {automationEnabled ? <Play className="h-3 w-3 3xl:h-3.5 3xl:w-3.5" /> : <Pause className="h-3 w-3 3xl:h-3.5 3xl:w-3.5" />}
                      {automationEnabled ? "Авто вкл." : "Авто выкл."}
                    </button>
                  )
                ) : null}
              </div>
            </div>

            {/* Right: sync + balance + settings + logout */}
            <div className="flex items-center gap-2 3xl:gap-3">
              <div className="hidden items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs 3xl:text-[13px] text-[hsl(var(--text-muted))] md:flex">
                <Activity className="h-3 w-3 3xl:h-3.5 3xl:w-3.5 text-info" />
                {summaryLoading ? "..." : syncLabel}
              </div>

              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => void handleSyncAll()}
                disabled={isSyncing || isPolling || !selectedShopId}
                aria-label="Синхронизировать"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", (isSyncing || isPolling) && "animate-spin")} />
              </Button>

              {balanceLabel && (
                <Link to="/app/billing">
                  <div className="hidden items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs 3xl:text-[13px] font-medium text-[hsl(var(--text-default))] hover:bg-secondary transition-colors md:flex">
                    {balanceLabel}
                  </div>
                </Link>
              )}

              <Link to="/app/settings" className="hidden md:block">
                <Button variant="ghost" size="icon-sm" aria-label="Настройки">
                  <Settings className="h-4 w-4 text-[hsl(var(--text-muted))]" />
                </Button>
              </Link>

              <div className="flex h-8 w-8 3xl:h-9 3xl:w-9 items-center justify-center rounded-full bg-primary-soft text-xs 3xl:text-sm font-semibold text-primary">
                {userInitial}
              </div>

              <Button variant="ghost" size="icon-sm" onClick={handleLogout} className="hidden lg:flex" aria-label="Выйти">
                <LogOut className="h-4 w-4 text-[hsl(var(--text-muted))]" />
              </Button>
            </div>
          </div>

          {/* Warnings */}
          {(shopsError || shellWarnings.length > 0) && (
            <div className="border-t border-border px-4 py-2 sm:px-6">
              {shopsError ? (
                <div className="flex items-center gap-3 rounded-xl bg-danger-soft px-4 py-2.5 text-sm text-destructive">
                  <span>{shopsError}</span>
                  <Button variant="outline" size="sm" onClick={() => void accountQuery.refresh()}>Повторить</Button>
                </div>
              ) : shellWarnings.length ? (
                <div className="flex items-center gap-3 rounded-xl bg-warning-soft px-4 py-2.5 text-sm text-warning">
                  <span>{shellWarnings[0]}</span>
                  <Button variant="outline" size="sm" onClick={() => void refresh()}>Обновить</Button>
                </div>
              ) : null}
            </div>
          )}
        </header>

        <ShopProvider
          value={{
            shopId: selectedShopId,
            setShopId: setSelectedShopId,
            shops,
            selectedShop,
            shopRole: selectedShopRole,
            me,
            isSuperAdmin: false,
            billing: shopBilling,
            refresh,
          }}
        >
          <main id="app-scroll" data-scroll-container className="flex-1 overflow-auto">
            <div className="flex w-full flex-col px-4 py-4 lg:px-5 lg:py-5 pb-24 lg:pb-5 3xl:px-7 3xl:py-6 4xl:px-8 4xl:py-6" style={{ minHeight: '100%' }}>
              {!selectedShopId && !allowNoShop ? (
                noShopState === "loading" ? (
                  <DataLoadingState className="mx-auto max-w-xl" title="Загружаем магазины" description="Подготавливаем список подключённых магазинов." />
                ) : noShopState === "error" ? (
                  <DataErrorState className="mx-auto max-w-xl" title="Не удалось открыть кабинет" description={shopsError} onAction={() => void accountQuery.refresh()} />
                ) : (
                  <div className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-8">
                    <div className="text-xl font-semibold text-[hsl(var(--text-strong))]">У вас пока нет магазинов</div>
                    <div className="mt-2 text-sm text-[hsl(var(--text-muted))]">Создайте первый магазин и подключите токен Wildberries.</div>
                    <Button onClick={handleAddShop} className="mt-5">Создать магазин</Button>
                  </div>
                )
              ) : children}
            </div>
          </main>
        </ShopProvider>

        {/* Mobile bottom nav */}
        <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 px-2 py-2 backdrop-blur lg:hidden">
          <div className="grid grid-cols-5 gap-1">
            {primaryMobileNav.slice(0, 5).map((item) => {
              const Icon = item.icon
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
              return (
                <Link key={item.href} to={item.href}>
                  <div className={cn("flex min-h-[52px] flex-col items-center justify-center rounded-xl px-2 text-center text-[11px] font-medium transition-colors", active ? "bg-primary-soft text-primary" : "text-[hsl(var(--text-muted))]")}>
                    <Icon className="h-4 w-4" />
                    <span className="mt-1 line-clamp-1">{item.label}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        </nav>
      </div>
    </div>
  )
}
