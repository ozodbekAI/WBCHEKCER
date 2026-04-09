import type { ShopInviteStatus, ShopRole } from "@/lib/api"
import type { SystemStatus } from "@/components/shared/system-state"

export function roleLabel(role: ShopRole | string) {
  if (role === "owner") return "Владелец"
  if (role === "manager") return "Менеджер"
  return role
}

export function inviteStatusLabel(status: ShopInviteStatus | string) {
  if (status === "invited") return "Ожидает"
  if (status === "accepted") return "Принято"
  if (status === "expired") return "Истекло"
  if (status === "revoked") return "Отозвано"
  return status
}

export function inviteSystemStatus(status: ShopInviteStatus | string): SystemStatus {
  if (status === "invited") return "running"
  if (status === "accepted") return "ready"
  if (status === "expired") return "stale"
  if (status === "revoked") return "disabled"
  return "disabled"
}

export function formatDate(value?: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function deliveryText(deliveryState: string) {
  if (deliveryState === "logged") {
    return "Приглашение подготовлено. В dev-режиме ссылка зафиксирована в серверных логах."
  }
  if (deliveryState === "pending_configuration") {
    return "Приглашение сохранено, но email-отправка еще не настроена."
  }
  return "Приглашение сохранено."
}
