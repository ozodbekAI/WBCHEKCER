import { Switch } from "@/components/ui/switch"
import type { SaveStateMeta } from "@/components/modules/settings/settings-types"

function ToggleRow({
  title,
  description,
  checked,
  onCheckedChange,
  disabled = false,
}: {
  title: string
  description: string
  checked: boolean
  onCheckedChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5 3xl:px-5 3xl:py-4 rounded-lg cursor-pointer transition-colors hover:bg-muted/40" onClick={() => !disabled && onCheckedChange(!checked)}>
      <div>
        <div className="text-sm 3xl:text-[15px] font-medium">{title}</div>
        <div className="text-[13px] 3xl:text-[14px] text-muted-foreground">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  )
}

type SettingsChatsSectionProps = {
  chatEnabled: boolean
  chatAutoReply: boolean
  onChatEnabledChange: (value: boolean) => void
  onChatAutoReplyChange: (value: boolean) => void
  saveStateMeta: SaveStateMeta
}

export function SettingsChatsSection({
  chatEnabled,
  chatAutoReply,
  onChatEnabledChange,
  onChatAutoReplyChange,
}: SettingsChatsSectionProps) {
  return (
    <div className="space-y-5 3xl:space-y-7">
      <div>
        <h2 className="text-base 3xl:text-lg font-semibold">Чаты</h2>
        <p className="text-[13px] 3xl:text-[14px] text-muted-foreground mt-0.5">
          Управление AI-участием в чатах с покупателями.
        </p>
      </div>

      <div className="rounded-xl border border-border/50 divide-y divide-border/40">
        <ToggleRow
          title="AI-ответы в чатах"
          description="Разрешить AI помогать в чатах"
          checked={chatEnabled}
          onCheckedChange={onChatEnabledChange}
        />
        <ToggleRow
          title="Автоответы в чатах"
          description="Автоматическая отправка после генерации"
          checked={chatAutoReply}
          onCheckedChange={onChatAutoReplyChange}
          disabled={!chatEnabled}
        />
      </div>
    </div>
  )
}

type SettingsChatsBehaviorSectionProps = {
  confirmSend: boolean
  confirmAiInsert: boolean
  onConfirmSendChange: (value: boolean) => void
  onConfirmAiInsertChange: (value: boolean) => void
  saveStateMeta: SaveStateMeta
}

export function SettingsChatsBehaviorSection({
  confirmSend,
  confirmAiInsert,
  onConfirmSendChange,
  onConfirmAiInsertChange,
}: SettingsChatsBehaviorSectionProps) {
  return (
    <div className="space-y-5 3xl:space-y-7">
      <div>
        <h2 className="text-base 3xl:text-lg font-semibold">Поведение чатов</h2>
        <p className="text-[13px] 3xl:text-[14px] text-muted-foreground mt-0.5">
          Подтверждения и UX-настройки интерфейса чатов.
        </p>
      </div>

      <div className="rounded-xl border border-border/50 divide-y divide-border/40">
        <ToggleRow
          title="Подтверждать отправку"
          description="Окно подтверждения перед отправкой сообщения"
          checked={confirmSend}
          onCheckedChange={onConfirmSendChange}
        />
        <ToggleRow
          title="Подтверждать вставку AI"
          description="Окно подтверждения перед вставкой подсказки AI"
          checked={confirmAiInsert}
          onCheckedChange={onConfirmAiInsertChange}
        />
      </div>
    </div>
  )
}
