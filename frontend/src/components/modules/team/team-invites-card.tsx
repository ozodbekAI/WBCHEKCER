import { Send, X, Mail } from "lucide-react"

import { Button } from "@/components/ui/button"
import { StatusPill } from "@/components/shared/system-state"
import type { ShopInvite } from "@/lib/api"
import {
  formatDate,
  inviteStatusLabel,
  inviteSystemStatus,
  roleLabel,
} from "@/components/modules/team/team-utils"

type TeamInvitesCardProps = {
  invites: ShopInvite[]
  pendingInvites: ShopInvite[]
  loading: boolean
  onResend: (inviteId: number) => void
  onRevoke: (inviteId: number) => void
}

export function TeamInvitesCard({ invites, pendingInvites, loading, onResend, onRevoke }: TeamInvitesCardProps) {
  // Show pending first, then rest
  const sorted = [
    ...pendingInvites,
    ...invites.filter((i) => i.status !== "invited"),
  ]

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col">
      <div className="flex items-center justify-between border-b border-border/40 px-3.5 py-2">
        <h3 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">Приглашения</h3>
        <span className="text-[11px] text-muted-foreground tabular-nums">{invites.length}</span>
      </div>

      {sorted.length ? (
        <div className="divide-y divide-border/20">
          {sorted.map((invite) => {
            const canResend = invite.status === "invited" || invite.status === "expired" || invite.status === "revoked"
            const canRevoke = invite.status === "invited" || invite.status === "expired"

            return (
              <div key={invite.id} className="flex items-center justify-between gap-2 px-3.5 py-1.5 hover:bg-muted/20 transition-colors">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-[12px] font-medium truncate min-w-0">{invite.email}</span>
                  <StatusPill
                    status={inviteSystemStatus(invite.status)}
                    label={inviteStatusLabel(invite.status)}
                    size="xs"
                  />
                  <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:inline">
                    {roleLabel(invite.role)}
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0 hidden md:inline">
                    {formatDate(invite.last_sent_at || invite.invited_at)}
                  </span>
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                  {canResend && (
                    <Button variant="ghost" size="icon" onClick={() => onResend(invite.id)} disabled={loading} className="h-5 w-5" title="Отправить повторно">
                      <Send className="h-2.5 w-2.5" />
                    </Button>
                  )}
                  {canRevoke && (
                    <Button variant="ghost" size="icon" onClick={() => onRevoke(invite.id)} disabled={loading} className="h-5 w-5 text-destructive/50 hover:text-destructive" title="Отозвать">
                      <X className="h-2.5 w-2.5" />
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="px-4 py-6 text-center">
          <Mail className="h-4 w-4 text-muted-foreground/40 mx-auto mb-1" />
          <div className="text-[11px] text-muted-foreground">Приглашений пока нет</div>
        </div>
      )}
    </div>
  )
}
