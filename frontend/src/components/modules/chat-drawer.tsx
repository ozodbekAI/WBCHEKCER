import * as React from "react"
import { ExternalLink, X, Paperclip, Image as ImageIcon } from "lucide-react"

import type { ChatSessionRow } from "@/lib/api"
import { getChatEvents, generateChatDraft, sendChatMessage } from "@/lib/api"

import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { getErrorMessage } from "@/lib/error-message"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  session: ChatSessionRow | null
  onSent?: () => void
  onPrev?: () => void
  onNext?: () => void
  currentIndex?: number
  totalCount?: number
}

type AttachmentImage = {
  url?: string
  downloadID?: string
  date?: string
}

type AttachmentFile = {
  url?: string
  downloadID?: string
  name?: string
  contentType?: string
  size?: number
  date?: string
}

type Attachments = {
  images?: AttachmentImage[]
  files?: AttachmentFile[]
  goodCard?: any
}

type ChatMsg = {
  id: string
  text: string
  ts: number | null
  fromMe: boolean
  attachments?: Attachments | null
}

function safeText(v: any): string {
  if (v == null) return ""
  if (typeof v === "string") return v
  if (typeof v === "number") return String(v)
  if (typeof v === "object") {
    if (typeof v.text === "string") return v.text
    if (typeof v.message === "string") return v.message
  }
  return ""
}

function formatTime(ts: number | null) {
  if (!ts) return ""
  const dt = new Date(ts)
  if (Number.isNaN(dt.getTime())) return ""
  return dt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
}

function pickProductLink(goodCard: any): string | null {
  const nmId = goodCard?.nmId || goodCard?.nmID || goodCard?.nm
  if (typeof nmId === "number" || typeof nmId === "string") {
    return `https://www.wildberries.ru/catalog/${nmId}/detail.aspx`
  }
  return null
}

function pickProductTitle(goodCard: any): string {
  return goodCard?.name || goodCard?.goodName || goodCard?.title || "Товар"
}

function pickProductImage(goodCard: any): string | null {
  const p = goodCard?.photo || goodCard?.image || goodCard?.img || null
  if (typeof p === "string") return p
  const photos = goodCard?.photos || goodCard?.images
  if (Array.isArray(photos) && photos.length) {
    const first = photos[0]
    if (typeof first === "string") return first
    if (typeof first?.small === "string") return first.small
    if (typeof first?.url === "string") return first.url
  }
  return null
}

function isSellerSender(raw: any): boolean {
  // WB events: raw.sender can be "seller" / "client"
  const s = String(raw?.sender || raw?.from || raw?.author || "").toLowerCase()
  if (!s) return false
  return s.includes("seller")
}

function normalizeAttachments(att: any): Attachments | null {
  if (!att || typeof att !== "object") return null
  const images = Array.isArray(att.images) ? att.images : []
  const files = Array.isArray(att.files) ? att.files : []
  return {
    images: images.map((x: any) => ({
      url: typeof x?.url === "string" ? x.url : undefined,
      downloadID: typeof x?.downloadID === "string" ? x.downloadID : undefined,
      date: typeof x?.date === "string" ? x.date : undefined,
    })),
    files: files.map((x: any) => ({
      url: typeof x?.url === "string" ? x.url : undefined,
      downloadID: typeof x?.downloadID === "string" ? x.downloadID : undefined,
      name: typeof x?.name === "string" ? x.name : undefined,
      contentType: typeof x?.contentType === "string" ? x.contentType : undefined,
      size: typeof x?.size === "number" ? x.size : undefined,
      date: typeof x?.date === "string" ? x.date : undefined,
    })),
    goodCard: att.goodCard,
  }
}

export function ChatDrawer({ open, onOpenChange, session, onSent, onPrev, onNext, currentIndex, totalCount }: Props) {
  const [loading, setLoading] = React.useState(false)
  const [messages, setMessages] = React.useState<ChatMsg[]>([])
  const [text, setText] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const [drafting, setDrafting] = React.useState(false)

  const shopId = session?.shop_id ?? null
  const chatId = session?.chat_id ?? null

  const load = React.useCallback(async () => {
    if (!shopId || !chatId) return
    setLoading(true)
    try {
      const evs = ((await getChatEvents(shopId, chatId, { limit: 200, offset: 0 })) as any[]) || []

      const mapped: ChatMsg[] = evs.map((eventItem: any) => {
        const msgObj = eventItem?.message || {}
        const t = safeText(msgObj?.text ?? msgObj)

        // IMPORTANT:
        // WB addTimestamp is on event level (we store in add_timestamp_ms)
        const ts =
          typeof eventItem?.add_timestamp_ms === "number"
            ? eventItem.add_timestamp_ms
            : typeof msgObj?.addTimestamp === "number"
              ? msgObj.addTimestamp
              : null

        // IMPORTANT:
        // WB sender is on raw.sender ("seller"/"client"), not inside message
        const senderRole = String(eventItem?.sender_role || "").toLowerCase()
        const fromMe = senderRole ? senderRole === "seller" : isSellerSender(eventItem?.raw)

        const att = normalizeAttachments(msgObj?.attachments)

        return {
          id: String(eventItem?.event_id ?? eventItem?.id ?? Math.random()),
          text: t,
          ts,
          fromMe,
          attachments: att,
        }
      })

      // events endpoint returns newest first; reverse to display ascending
      mapped.reverse()
      setMessages(mapped)
    } catch (error) {
      toast.error(getErrorMessage(error, "Не удалось загрузить чат"))
    } finally {
      setLoading(false)
    }
  }, [shopId, chatId])

  React.useEffect(() => {
    if (open) load()
  }, [open, load])

  const onGenerate = async () => {
    if (!shopId || !chatId) return
    setDrafting(true)
    try {
      const res = await generateChatDraft(shopId, chatId)
      if (res?.text) setText(res.text)
      toast.success("Черновик сгенерирован")
    } catch (error) {
      toast.error(getErrorMessage(error, "Не удалось сгенерировать"))
    } finally {
      setDrafting(false)
    }
  }

  const onSendMessage = async () => {
    if (!shopId || !chatId) return
    if (!text.trim()) {
      toast.error("Введите текст сообщения")
      return
    }
    setSending(true)
    try {
      await sendChatMessage(shopId, chatId, { message: text.trim(), useLatestDraft: false })
      setText("")
      toast.success("Отправлено")
      await load()
      onSent?.()
    } catch (error) {
      toast.error(getErrorMessage(error, "Не удалось отправить"))
    } finally {
      setSending(false)
    }
  }

  const goodCard = session?.good_card
  const title = session?.product_title || pickProductTitle(goodCard)
  const link = pickProductLink(goodCard)
  const img = session?.product_thumb_url || pickProductImage(goodCard)

  const openDownload = (downloadID: string) => {
    // open backend proxy endpoint (so it can handle moderation/retry states if you later implement it)
    if (!shopId) return
    const url = `/api/chats/${shopId}/download/${downloadID}`
    window.open(url, "_blank", "noopener,noreferrer")
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      {/* WIDTH FIX: make it wide like WB (desktop ~920px) */}
      <DrawerContent className="p-0 h-screen !w-screen sm:!w-[700px] sm:!max-w-none">



        <DrawerHeader className="pb-3 px-5 pt-5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-3">
              <div className="h-12 w-12 overflow-hidden rounded-lg bg-muted">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt="" className="h-24 w-full rounded-lg object-cover" />
                ) : null}
              </div>
              <div className="min-w-0">
                <DrawerTitle className="truncate">{title}</DrawerTitle>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate">
                    {session?.shop_name ? `${session.shop_name} • ` : ""}
                    {session?.client_name || "Покупатель"}
                  </span>
                  {link ? (
                    <a
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Перейти к товару <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {onPrev && onNext && typeof totalCount === "number" && totalCount > 1 && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onPrev}
                    disabled={(currentIndex ?? 0) <= 0 || loading}
                  >
                    ← Назад
                  </Button>
                  <span>{(currentIndex ?? 0) + 1} / {totalCount}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onNext}
                    disabled={(currentIndex ?? 0) >= totalCount - 1 || loading}
                  >
                    Далее →
                  </Button>
                </div>
              )}
              <DrawerClose asChild>
                <Button variant="ghost" size="icon" aria-label="Закрыть">
                  <X className="h-4 w-4" />
                </Button>
              </DrawerClose>
            </div>
          </div>
        </DrawerHeader>

        <Separator />

        <div className="flex flex-col h-[calc(100vh-140px)] min-h-0">
          <ScrollArea className="flex-1 min-h-0 px-5 py-4">
            {loading ? (
              <div className="text-sm text-muted-foreground">Загрузка…</div>
            ) : messages.length === 0 ? (
              <div className="text-sm text-muted-foreground">Сообщений нет</div>
            ) : (
              <div className="flex flex-col gap-2">
                {messages.map((m) => {
                  const imgs = m.attachments?.images || []
                  const files = m.attachments?.files || []
                  return (
                    <div key={m.id} className={cn("flex", m.fromMe ? "justify-end" : "justify-start")}>
                      <div
                        className={cn(
                          "max-w-[85%] rounded-2xl border px-3 py-2 text-sm",
                          m.fromMe ? "bg-primary text-primary-foreground" : "bg-background",
                        )}
                      >
                        <div className="whitespace-pre-wrap break-words">{m.text || ""}</div>

                        {/* ATTACHMENTS: images */}
                        {imgs.length > 0 ? (
                          <div className="mt-2">
                            <div className={cn("mb-1 flex items-center gap-2 text-[11px]", m.fromMe ? "text-primary-foreground/80" : "text-muted-foreground")}>
                              <ImageIcon className="h-3 w-3" />
                              <span>Фото</span>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">

                              {imgs.map((img, i) => {
                                const hasDownload = Boolean(img.downloadID)
                                const href = hasDownload && shopId ? `/api/chats/${shopId}/download/${img.downloadID}` : (img.url || "#")
                                return (
                                  <button
                                    key={i}
                                    type="button"
                                    onClick={() => {
                                      if (hasDownload && img.downloadID) return openDownload(img.downloadID)
                                      if (img.url) window.open(img.url, "_blank", "noopener,noreferrer")
                                    }}
                                    className="block"
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={img.url || href}
                                      alt=""
                                      className="h-24 w-full rounded-lg object-cover"
                                    />
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        ) : null}

                        {/* ATTACHMENTS: files */}
                        {files.length > 0 ? (
                          <div className="mt-2 space-y-2">
                            <div className={cn("flex items-center gap-2 text-[11px]", m.fromMe ? "text-primary-foreground/80" : "text-muted-foreground")}>
                              <Paperclip className="h-3 w-3" />
                              <span>Файлы</span>
                            </div>
                            {files.map((f, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => {
                                  if (f.downloadID) return openDownload(f.downloadID)
                                  if (f.url) window.open(f.url, "_blank", "noopener,noreferrer")
                                }}
                                className={cn(
                                  "w-full text-left flex items-center justify-between gap-2 rounded-lg border px-3 py-2",
                                  m.fromMe ? "border-primary-foreground/20" : "border-border",
                                )}
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-sm">{f.name || "Файл"}</div>
                                  <div className={cn("text-[11px]", m.fromMe ? "text-primary-foreground/70" : "text-muted-foreground")}>
                                    {f.contentType || "—"}
                                  </div>
                                </div>
                                <div className={cn("text-[11px] whitespace-nowrap", m.fromMe ? "text-primary-foreground/70" : "text-muted-foreground")}>
                                  Открыть
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : null}

                        <div
                          className={cn(
                            "mt-1 text-[11px]",
                            m.fromMe ? "text-primary-foreground/70" : "text-muted-foreground",
                          )}
                        >
                          {formatTime(m.ts)}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </ScrollArea>

          <div className="border-t px-5 py-4">
            <div className="mb-2 flex items-center justify-between">
              <Button variant="secondary" onClick={onGenerate} disabled={drafting || sending || loading}>
                {drafting ? "Генерация…" : "Сгенерировать ответ"}
              </Button>
              <div className="text-xs text-muted-foreground">{text.length}/1000</div>
            </div>
            <div className="flex gap-2">
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Текст сообщения"
                maxLength={1000}
                disabled={sending}
              />
              <Button onClick={onSendMessage} disabled={sending || !text.trim()}>
                {sending ? "Отправка…" : "Отправить"}
              </Button>
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
