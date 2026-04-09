import * as React from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Send, Loader2, Zap, FileUp, MessageCircle } from "lucide-react"

import { downloadChatFile, getSettings, getChatEvents, sendChatMessage, generateChatDraft } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/components/ui/use-toast"
import { getErrorMessage } from "@/lib/error-message"

function safeText(value: any): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text
    if (typeof value.message === "string") return value.message
    if (value.message && typeof value.message.text === "string") return value.message.text
    try {
      return JSON.stringify(value)
    } catch {
      return ""
    }
  }
  return ""
}

function fmtTime(ts?: string | null) {
  if (!ts) return ""
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

export default function ChatThreadModule({ shopId, chatId }: { shopId: number; chatId: string }) {
  const navigate = useNavigate()
  const { toast } = useToast()

  const [events, setEvents] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(false)
  const [compose, setCompose] = React.useState("")
  const [files, setFiles] = React.useState<File[]>([])

  const [confirmSend, setConfirmSend] = React.useState(true)
  const [confirmAiInsert, setConfirmAiInsert] = React.useState(true)

  const [aiLoading, setAiLoading] = React.useState(false)

  const [sendConfirmOpen, setSendConfirmOpen] = React.useState(false)
  const pendingSendRef = React.useRef<{ message?: string; useLatestDraft?: boolean; files?: File[] } | null>(null)

  const loadSettings = React.useCallback(async () => {
    try {
      const s: any = await getSettings(shopId)
      const chat = s?.config?.chat
      setConfirmSend(chat?.confirm_send ?? true)
      setConfirmAiInsert(chat?.confirm_ai_insert ?? true)
    } catch {
      // fallback to defaults
    }
  }, [shopId])

  const loadEvents = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await getChatEvents(shopId, chatId, { limit: 200, offset: 0 })
      setEvents(Array.isArray(data) ? data : [])
    } catch (error) {
      toast({ title: "Не удалось загрузить чат", description: getErrorMessage(error, "Попробуйте ещё раз.") })
    } finally {
      setLoading(false)
    }
  }, [shopId, chatId, toast])

  React.useEffect(() => {
    void loadSettings()
    void loadEvents()
  }, [loadSettings, loadEvents])

  const doSend = async (opts: { message?: string; useLatestDraft?: boolean; files?: File[] }) => {
    try {
      await sendChatMessage(shopId, chatId, opts)
      setCompose("")
      setFiles([])
      toast({ title: "Сообщение отправлено" })
      await loadEvents()
    } catch (error) {
      toast({ title: "Не удалось отправить", description: getErrorMessage(error, "Попробуйте снова.") })
    }
  }

  const handleSendClick = async (useLatestDraft = false) => {
    const message = compose.trim()
    const payload = {
      message: useLatestDraft ? undefined : message,
      useLatestDraft,
      files: files.length ? files : undefined,
    }

    if (!useLatestDraft && !message && files.length === 0) {
      toast({ title: "Введите сообщение или прикрепите файл" })
      return
    }

    if (confirmSend) {
      pendingSendRef.current = payload
      setSendConfirmOpen(true)
      return
    }

    await doSend(payload)
  }

  const handleSuggestAi = async () => {
    setAiLoading(true)
    try {
      const draft = await generateChatDraft(shopId, chatId)
      const text = safeText(draft?.text)

      if (!text) {
        toast({ title: "ИИ не вернул текст" })
        return
      }

      if (confirmAiInsert) {
        const ok = window.confirm("Вставить ответ ИИ в поле ввода?")
        if (!ok) return
      }

      setCompose(text)
    } catch (error) {
      toast({ title: "Не удалось получить ответ ИИ", description: getErrorMessage(error, "Попробуйте снова.") })
    } finally {
      setAiLoading(false)
    }
  }

  const handleDownload = async (downloadId: string) => {
    try {
      const blob = await downloadChatFile(shopId, downloadId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = downloadId
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast({ title: "Не удалось скачать файл", description: getErrorMessage(error, "Попробуйте снова.") })
    }
  }

  const extractDownloadIds = (raw: any): string[] => {
    const out: string[] = []
    const walk = (v: any) => {
      if (!v) return
      if (typeof v === "string") return
      if (Array.isArray(v)) return v.forEach(walk)
      if (typeof v === "object") {
        for (const [k, val] of Object.entries(v)) {
          if (typeof val === "string" && (k === "download_id" || k === "downloadId" || k === "download")) {
            out.push(val)
          }
          walk(val)
        }
      }
    }
    walk(raw)
    return Array.from(new Set(out)).filter(Boolean)
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="border-b border-border bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/app/chat")}
              className="gap-2 text-primary hover:bg-primary/10"
            >
              <ArrowLeft className="w-4 h-4" />
              Назад
            </Button>
            <div>
              <h1 className="text-xl font-bold text-foreground">Чат</h1>
              <p className="text-xs text-muted-foreground">ID: {chatId}</p>
            </div>
          </div>
          <Button variant="outline" onClick={() => loadEvents()} disabled={loading} size="sm">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Обновить"}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <Card className="bg-white border-border">
          <CardHeader className="border-b border-border">
            <CardTitle>Сообщения</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span className="ml-2 text-sm text-muted-foreground">Загрузка...</span>
              </div>
            ) : events.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Нет событий</p>
              </div>
            ) : (
              <div className="space-y-4">
                {events.map((ev: any) => {
                  const msg = ev?.message ?? ev?.raw ?? ev
                  const text = safeText(msg)
                  const ts = ev?.raw?.addTimestamp ? undefined : ev?.raw?.date || ev?.raw?.createdAt
                  const downloadIds = extractDownloadIds(ev?.raw)

                  return (
                    <div key={ev?.event_id ?? `${ev?.event_type}-${ev?.add_timestamp_ms ?? Math.random()}`}>
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-primary px-2 py-1 bg-primary/10 rounded">
                            {ev?.event_type || "event"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {ev?.add_timestamp_ms ? new Date(ev.add_timestamp_ms).toLocaleString() : ""}
                            {ts ? ` • ${fmtTime(ts)}` : ""}
                          </span>
                        </div>
                        <div className="p-3 bg-background rounded border border-border/50">
                          <p className="text-sm whitespace-pre-wrap text-foreground">{text || "(нет текста)"}</p>
                        </div>
                        {downloadIds.length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-2">
                            {downloadIds.map((id) => (
                              <Button
                                key={id}
                                size="sm"
                                variant="outline"
                                onClick={() => handleDownload(id)}
                                className="text-xs"
                              >
                                Скачать файл
                              </Button>
                            ))}
                          </div>
                        )}
                      </div>
                      <Separator className="mt-4" />
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="border-t border-border bg-white p-6 shadow-lg">
        <Card className="bg-background border-border">
          <CardHeader className="border-b border-border pb-4">
            <CardTitle className="text-base">Ответить</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSuggestAi}
                disabled={aiLoading}
                className="gap-2 text-primary hover:bg-primary/10 bg-transparent"
              >
                {aiLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Генерация...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    Ответ ИИ
                  </>
                )}
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleSendClick(true)}>
                Последний черновик
              </Button>
            </div>

            <Textarea
              value={compose}
              onChange={(e) => setCompose(e.target.value)}
              placeholder="Напишите ответ..."
              className="min-h-[100px] bg-background border-border text-foreground"
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer px-3 py-2 bg-background border border-border rounded hover:bg-muted transition">
                  <FileUp className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Файл</span>
                  <Input
                    type="file"
                    multiple
                    onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])}
                    className="hidden"
                  />
                </label>
                {files.length > 0 && (
                  <span className="text-xs text-muted-foreground px-2 py-1 bg-background rounded border border-border">
                    {files.length} файл{files.length > 1 ? "ов" : ""}
                  </span>
                )}
              </div>
              <Button
                onClick={() => handleSendClick(false)}
                className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                <Send className="w-4 h-4" />
                Отправить
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={sendConfirmOpen} onOpenChange={setSendConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Подтвердить отправку</AlertDialogTitle>
            <AlertDialogDescription>Вы уверены, что хотите отправить это сообщение?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const payload = pendingSendRef.current
                pendingSendRef.current = null
                setSendConfirmOpen(false)
                if (payload) await doSend(payload)
              }}
              className="bg-primary hover:bg-primary/90"
            >
              Отправить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
