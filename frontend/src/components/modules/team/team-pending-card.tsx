import { Clock3, Send, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ShopInvite } from "@/lib/api"
import { formatDate, roleLabel } from "@/components/modules/team/team-utils"

type TeamPendingCardProps = {
  pendingCount: number
  latestPendingInvite: ShopInvite | null
  loading: boolean
  onResend: (inviteId: number) => void
  onRevoke: (inviteId: number) => void
}

export function TeamPendingCard({
  pendingCount,
  latestPendingInvite,
  loading,
  onResend,
  onRevoke,
}: TeamPendingCardProps) {
  if (pendingCount === 0 && !latestPendingInvite) return null

  return (
    <div className="rounded-xl border border-primary/15 bg-primary/3 px-4 py-3">
      <div className="flex items-center gap-2">
        <Clock3 className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-medium">
          {pendingCount} {pendingCount === 1 ? "приглашение" : "приглашений"} ожидает
        </span>
        <span className="text-[12px] text-muted-foreground">· ссылки действуют 24ч</span>
      </div>

      {latestPendingInvite && (
        <div className="mt-2.5 flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-background px-3 py-2">
          <div className="min-w-0">
            <span className="text-sm font-medium truncate block">{latestPendingInvite.email}</span>
            <span className="text-[12px] text-muted-foreground">
              {roleLabel(latestPendingInvite.role)} · до {formatDate(latestPendingInvite.expires_at)}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button variant="outline" size="sm" onClick={() => onResend(latestPendingInvite.id)} disabled={loading} className="h-7 gap-1.5 text-[12px] px-2.5">
              <Send className="h-3 w-3" />
              Повторить
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onRevoke(latestPendingInvite.id)} disabled={loading} className="h-7 w-7 text-destructive hover:text-destructive">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
