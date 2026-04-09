import { TeamHeader } from "@/components/modules/team/team-header"
import { TeamInvitesCard } from "@/components/modules/team/team-invites-card"
import { TeamMembersCard } from "@/components/modules/team/team-members-card"
import { useTeamController } from "@/components/modules/team/use-team-controller"
import { StateEmpty, StateLoading, StateError, StateBanner } from "@/components/shared/system-state"
import { UsersRound, ShieldAlert, UserCheck } from "lucide-react"

export default function TeamModule() {
  const team = useTeamController()

  if (!team.shopId) {
    return <StateEmpty icon={<UsersRound className="h-5 w-5" />} title="Магазин не выбран" description="Выберите магазин, чтобы управлять командой." />
  }

  if (!team.canView) {
    return <StateEmpty icon={<ShieldAlert className="h-5 w-5" />} title="Доступ ограничен" description="Управление командой доступно только владельцу магазина." />
  }

  if (team.teamQuery.isInitialLoading && !team.teamQuery.data) {
    return <StateLoading title="Загружаем команду" description="Подготавливаем сотрудников и приглашения." />
  }

  if (!team.teamQuery.data && team.teamQuery.error) {
    return <StateError title="Не удалось открыть команду" description={team.teamQuery.error} onRetry={() => void team.load()} />
  }

  return (
    <div className="flex flex-col gap-2">
      <TeamHeader
        shopId={team.shopId}
        shopLabel={team.selectedShop?.name ?? ""}
        canEdit={team.canEdit}
        loading={team.loading}
        addOpen={team.addOpen}
        addEmail={team.addEmail}
        addRole={team.addRole}
        roleOptions={team.ROLE_OPTIONS}
        membersCount={team.members.length}
        pendingCount={team.pendingInvites.length}
        onRefresh={() => void team.load()}
        onOpenChange={team.setAddOpen}
        onEmailChange={team.setAddEmail}
        onRoleChange={team.setAddRole}
        onInvite={() => void team.handleInvite()}
      />

      {/* Notices */}
      {team.teamQuery.error && team.teamQuery.data && (
        <StateBanner tone="danger" icon={<ShieldAlert className="h-4 w-4" />} title="Ошибка обновления" description={team.teamQuery.error} compact />
      )}
      {team.actionError && (
        <StateBanner tone="danger" icon={<ShieldAlert className="h-4 w-4" />} title="Ошибка" description={team.actionError} compact />
      )}
      {team.actionNotice && (
        <StateBanner tone="success" icon={<UserCheck className="h-4 w-4" />} title={team.actionNotice.title} description={team.actionNotice.description} compact />
      )}

      {/* Two-column layout on wider screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        <TeamMembersCard
          members={team.members}
          currentUserId={team.me?.id}
          canEdit={team.canEdit}
          loading={team.loading}
          onRemove={(id) => void team.handleRemove(id)}
        />

        <TeamInvitesCard
          invites={team.invites}
          pendingInvites={team.pendingInvites}
          loading={team.loading}
          onResend={(id) => void team.handleResend(id)}
          onRevoke={(id) => void team.handleRevoke(id)}
        />
      </div>
    </div>
  )
}
