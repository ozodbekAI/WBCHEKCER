import { MailPlus, RefreshCw, Users, Clock3 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { TeamInviteDialog } from "@/components/modules/team/team-invite-dialog"
import type { ShopRole } from "@/lib/api"
import { cn } from "@/lib/utils"

type TeamHeaderProps = {
  shopId: number
  shopLabel: string
  canEdit: boolean
  loading: boolean
  addOpen: boolean
  addEmail: string
  addRole: ShopRole
  roleOptions: ShopRole[]
  membersCount: number
  pendingCount: number
  onRefresh: () => void
  onOpenChange: (open: boolean) => void
  onEmailChange: (value: string) => void
  onRoleChange: (value: ShopRole) => void
  onInvite: () => void
}

export function TeamHeader({
  shopId,
  shopLabel,
  canEdit,
  loading,
  addOpen,
  addEmail,
  addRole,
  roleOptions,
  membersCount,
  pendingCount,
  onRefresh,
  onOpenChange,
  onEmailChange,
  onRoleChange,
  onInvite,
}: TeamHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-2.5">
      <div className="flex items-center gap-3 min-w-0">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[15px] font-semibold">Команда</h1>
            <span className="text-[11px] text-muted-foreground">·</span>
            <span className="text-[11px] text-muted-foreground truncate">{shopLabel || `#${shopId}`}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5 gap-1">
              <Users className="h-2.5 w-2.5" />
              {membersCount}
            </Badge>
            {pendingCount > 0 && (
              <Badge variant="warning" className="text-[10px] h-4 px-1.5 gap-1">
                <Clock3 className="h-2.5 w-2.5" />
                {pendingCount} ожидает
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="icon" onClick={onRefresh} disabled={loading} className="h-7 w-7">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>

        {canEdit && (
          <TeamInviteDialog
            open={addOpen}
            email={addEmail}
            role={addRole}
            roleOptions={roleOptions}
            loading={loading}
            onOpenChange={onOpenChange}
            onEmailChange={onEmailChange}
            onRoleChange={onRoleChange}
            onSubmit={onInvite}
            trigger={
              <Button size="sm" className="h-7 gap-1.5 text-[12px] px-3" disabled={loading}>
                <MailPlus className="h-3 w-3" />
                Пригласить
              </Button>
            }
          />
        )}
      </div>
    </div>
  )
}
