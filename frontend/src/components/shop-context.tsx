import { createContext, useContext } from "react"

import type { ShopBilling, ShopOut, ShopRole } from "@/lib/api"

type ShopContextValue = {
  shopId: number | null
  setShopId: (shopId: number | null) => void

  shops: ShopOut[]
  selectedShop: ShopOut | null
  shopRole: ShopRole | null

  me: { id: number; email: string; role: string } | null
  isSuperAdmin: boolean

  billing: ShopBilling | null
  refresh: () => Promise<void>
}

const ShopContext = createContext<ShopContextValue | null>(null)

export function ShopProvider({ value, children }: { value: ShopContextValue; children: React.ReactNode }) {
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>
}

export function useShopId() {
  const ctx = useContext(ShopContext)
  if (!ctx || ctx.shopId === null || ctx.shopId === undefined) {
    return null
  }
  return ctx.shopId
}

export function useShop() {
  const ctx = useContext(ShopContext)
  if (!ctx) {
    return {
      shopId: null,
      selectedShop: null,
      shopRole: null,
      isSuperAdmin: false,
      me: null,
      shops: [],
      billing: null,
      setShopId: (_: number | null) => {},
      refresh: async () => {},
    } as const
  }
  return ctx
}

export function useShopRole() {
  return useShop().shopRole
}

export function useIsSuperAdmin() {
  return useShop().isSuperAdmin
}
