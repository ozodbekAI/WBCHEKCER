import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { roleLabel } from "@/components/modules/team/team-utils"
import type { ShopRole } from "@/lib/api"
import { Info, MailPlus } from "lucide-react"

type TeamInviteDialogProps = {
  open: boolean
  email: string
  role: ShopRole
  roleOptions: ShopRole[]
  loading: boolean
  trigger: React.ReactNode
  onOpenChange: (open: boolean) => void
  onEmailChange: (value: string) => void
  onRoleChange: (value: ShopRole) => void
  onSubmit: () => void
}

export function TeamInviteDialog({
  open,
  email,
  role,
  roleOptions,
  loading,
  trigger,
  onOpenChange,
  onEmailChange,
  onRoleChange,
  onSubmit,
}: TeamInviteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-[540px] p-0 gap-0">
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-border/40">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/8">
              <MailPlus className="h-3.5 w-3.5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-[14px]">Пригласить сотрудника</DialogTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Отправьте email-приглашение для доступа к магазину
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="px-5 py-4 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[11px]">Email сотрудника</Label>
            <Input
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              placeholder="user@example.com"
              className="h-9 text-[13px]"
              type="email"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px]">Роль</Label>
            <Select value={role} onValueChange={(v) => onRoleChange(v as ShopRole)}>
              <SelectTrigger className="h-9 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((opt) => (
                  <SelectItem key={opt} value={opt} className="text-[12px]">
                    {roleLabel(opt)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2">
            <Info className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Приглашение будет отправлено на email. Ссылка действует 24 часа. Доступ откроется после принятия.
            </p>
          </div>
        </div>

        <DialogFooter className="px-5 py-3 border-t border-border/40">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={loading} className="h-8 text-[12px]">
            Отмена
          </Button>
          <Button size="sm" onClick={onSubmit} disabled={loading || !email.trim()} className="h-8 text-[12px] gap-1.5">
            <MailPlus className="h-3 w-3" />
            Отправить приглашение
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
