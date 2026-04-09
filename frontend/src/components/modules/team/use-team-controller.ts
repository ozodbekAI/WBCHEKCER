import * as React from "react"

import { useShop } from "@/components/shop-context"
import {
  createShopInvite,
  deleteShopMember,
  listShopInvites,
  listShopMembers,
  resendShopInvite,
  revokeShopInvite,
  type ShopInvite,
  type ShopMember,
  type ShopRole,
} from "@/lib/api"
import { getErrorMessage } from "@/lib/error-message"
import { useAsyncData } from "@/hooks/use-async-data"
import { deliveryText } from "@/components/modules/team/team-utils"

const ROLE_OPTIONS: ShopRole[] = ["manager"]

type ActionNotice = {
  title: string
  description: string
}

export function useTeamController() {
  const { shopId, selectedShop, shopRole, refresh, me } = useShop()
  const canView = shopRole === "owner"
  const canEdit = shopRole === "owner"

  const [actionLoading, setActionLoading] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [addOpen, setAddOpen] = React.useState(false)
  const [addEmail, setAddEmail] = React.useState("")
  const [addRole, setAddRole] = React.useState<ShopRole>("manager")
  const [actionNotice, setActionNotice] = React.useState<ActionNotice | null>(null)

  const teamQuery = useAsyncData<{ members: ShopMember[]; invites: ShopInvite[] }>(
    async () => {
      if (!shopId || !canView) {
        return { members: [], invites: [] }
      }

      const [membersData, invitesData] = await Promise.all([listShopMembers(shopId), listShopInvites(shopId)])
      return {
        members: Array.isArray(membersData) ? membersData : [],
        invites: Array.isArray(invitesData) ? invitesData : [],
      }
    },
    [shopId, canView],
    {
      enabled: Boolean(shopId && canView),
      keepPreviousData: true,
      fallbackError: "Не удалось загрузить команду магазина",
    },
  )

  const members = teamQuery.data?.members ?? []
  const invites = teamQuery.data?.invites ?? []
  const loading = actionLoading || teamQuery.isRefreshing

  const pendingInvites = React.useMemo(
    () =>
      invites
        .filter((invite) => invite.status === "invited")
        .sort((left, right) => {
          const leftValue = new Date(left.last_sent_at || left.invited_at).getTime()
          const rightValue = new Date(right.last_sent_at || right.invited_at).getTime()
          return rightValue - leftValue
        }),
    [invites],
  )

  const latestPendingInvite = pendingInvites[0] ?? null

  const load = React.useCallback(async () => {
    setActionError(null)
    await teamQuery.refresh({ background: teamQuery.hasLoaded })
  }, [teamQuery])

  const handleInvite = React.useCallback(async () => {
    if (!shopId) return
    setActionLoading(true)
    setActionError(null)
    try {
      const result = await createShopInvite(shopId, { email: addEmail.trim(), role: addRole })
      setActionNotice({
        title: `Приглашение отправлено: ${result.email}`,
        description: deliveryText(result.delivery_state),
      })
      setAddEmail("")
      setAddRole("manager")
      setAddOpen(false)
      await Promise.all([load(), refresh()])
    } catch (error) {
      setActionError(getErrorMessage(error, "Не удалось отправить приглашение"))
    } finally {
      setActionLoading(false)
    }
  }, [shopId, addEmail, addRole, load, refresh])

  const handleRemove = React.useCallback(
    async (userId: number) => {
      if (!shopId) return
      if (!window.confirm("Удалить сотрудника из магазина?")) return
      setActionLoading(true)
      setActionError(null)
      try {
        await deleteShopMember(shopId, userId)
        setActionNotice({
          title: "Сотрудник удален",
          description: "Доступ к магазину для выбранного пользователя закрыт.",
        })
        await load()
      } catch (error) {
        setActionError(getErrorMessage(error, "Не удалось удалить сотрудника"))
      } finally {
        setActionLoading(false)
      }
    },
    [shopId, load],
  )

  const handleResend = React.useCallback(
    async (inviteId: number) => {
      if (!shopId) return
      setActionLoading(true)
      setActionError(null)
      try {
        const result = await resendShopInvite(shopId, inviteId)
        setActionNotice({
          title: `Приглашение отправлено повторно: ${result.email}`,
          description: deliveryText(result.delivery_state),
        })
        await load()
      } catch (error) {
        setActionError(getErrorMessage(error, "Не удалось переотправить приглашение"))
      } finally {
        setActionLoading(false)
      }
    },
    [shopId, load],
  )

  const handleRevoke = React.useCallback(
    async (inviteId: number) => {
      if (!shopId) return
      if (!window.confirm("Отозвать приглашение?")) return
      setActionLoading(true)
      setActionError(null)
      try {
        const result = await revokeShopInvite(shopId, inviteId)
        setActionNotice({
          title: `Приглашение отозвано: ${result.email}`,
          description: "Ссылка больше не действует. При необходимости можно отправить новое приглашение.",
        })
        await load()
      } catch (error) {
        setActionError(getErrorMessage(error, "Не удалось отозвать приглашение"))
      } finally {
        setActionLoading(false)
      }
    },
    [shopId, load],
  )

  return {
    ROLE_OPTIONS,
    actionError,
    actionLoading,
    actionNotice,
    addEmail,
    addOpen,
    addRole,
    canEdit,
    canView,
    invites,
    latestPendingInvite,
    loading,
    load,
    me,
    members,
    pendingInvites,
    selectedShop,
    setActionNotice,
    setAddEmail,
    setAddOpen,
    setAddRole,
    shopId,
    teamQuery,
    handleInvite,
    handleRemove,
    handleResend,
    handleRevoke,
  }
}
