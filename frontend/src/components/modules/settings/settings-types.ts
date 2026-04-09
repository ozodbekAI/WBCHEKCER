export type ReplyMode = "manual" | "semi" | "auto"
export type WorkMode = "autopilot" | "control" | "manual"

export type ToneOption = {
  value: string
  label: string
  hint?: string | null
  example?: string | null
}

export type SignatureItem = {
  text: string
  brand: string
  type?: "all" | "review" | "question" | "chat"
  rating?: number | null
  is_active?: boolean
  created_at?: string
}

export type Settings = {
  shop_id: number
  automation_enabled?: boolean
  auto_sync?: boolean
  reply_mode?: string
  auto_draft?: boolean
  auto_publish?: boolean
  auto_draft_limit_per_sync?: number
  language?: string
  tone?: string
  signature?: string | null
  blacklist_keywords?: any[]
  whitelist_keywords?: any[]
  templates?: Record<string, any>
  chat_enabled?: boolean
  chat_auto_reply?: boolean
  rating_mode_map: Record<string, ReplyMode>
  questions_reply_mode: ReplyMode
  questions_auto_draft: boolean
  questions_auto_publish: boolean
  signatures: Array<string | SignatureItem>
  config: Record<string, any>
}

export type SettingsPageData = {
  normalized: Settings
  shopName: string | null
  brands: string[]
  warnings: string[]
}

export type SaveStateMeta = {
  badge: string
  tone: string
  hint: string
}
