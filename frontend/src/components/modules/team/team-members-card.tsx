import { Crown, Trash2, User } from "lucide-react"

import { Button } from "@/components/ui/button"
import { StatusPill } from "@/components/shared/system-state"
import type { ShopMember } from "@/lib/api"
import { roleLabel } from "@/components/modules/team/team-utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

type TeamMembersCardProps = {
  members: ShopMember[]
  currentUserId?: number | null
  canEdit: boolean
  loading: boolean
  onRemove: (userId: number) => void
}

function getInitials(email?: string | null) {
  if (!email) return "?"
  return email.charAt(0).toUpperCase()
}

export function TeamMembersCard({ members, currentUserId, canEdit, loading, onRemove }: TeamMembersCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col">
      <div className="flex items-center justify-between border-b border-border/40 px-3.5 py-2">
        <h3 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">Сотрудники</h3>
        <span className="text-[11px] text-muted-foreground tabular-nums">{members.length}</span>
      </div>

      {members.length ? (
        <div className="divide-y divide-border/20">
          {members.map((member) => {
            const isSelf = Boolean(currentUserId && member.user_id === currentUserId)
            const isOwner = member.role === "owner"
            const canRemove = canEdit && !isSelf && !isOwner

            return (
              <div key={member.user_id} className="flex items-center justify-between gap-2 px-3.5 py-1.5 hover:bg-muted/20 transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <Avatar className="h-6 w-6 text-[10px]">
                    <AvatarFallback className={isOwner ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}>
                      {isOwner ? <Crown className="h-3 w-3" /> : getInitials(member.email)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-[12px] font-medium truncate">
                    {member.email || `ID ${member.user_id}`}
                  </span>
                  {isSelf && <span className="text-[10px] text-muted-foreground">(вы)</span>}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <StatusPill
                    status={isOwner ? "ready" : "running"}
                    label={roleLabel(member.role)}
                    size="xs"
                  />
                  {canRemove && (
                    <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive/50 hover:text-destructive" onClick={() => onRemove(member.user_id)} disabled={loading}>
                      <Trash2 className="h-2.5 w-2.5" />
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="px-4 py-6 text-center">
          <User className="h-4 w-4 text-muted-foreground/40 mx-auto mb-1" />
          <p className="text-[11px] text-muted-foreground">Пригласите менеджера для делегирования задач.</p>
        </div>
      )}
    </div>
  )
}
