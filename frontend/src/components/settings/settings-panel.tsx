import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Save, AlertCircle } from "lucide-react"

interface Settings {
  auto_sync: boolean
  reply_mode: string
  auto_draft: boolean
  auto_publish: boolean
  language: string
  tone: string
  signature: string
}

interface SettingsPanelProps {
  shopId: number
  token: string
}

export default function SettingsPanel({ shopId, token }: SettingsPanelProps) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/settings/${shopId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.ok) {
        const data = await res.json()
        setSettings(data)
      }
    } catch (err) {
      console.error("Failed to load settings:", err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSaveSettings = async () => {
    if (!settings) return

    setIsSaving(true)
    try {
      const res = await fetch(`/api/settings/${shopId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(settings),
      })

      if (res.ok) {
        alert("Настройки сохранены!")
        loadSettings()
      }
    } catch (err) {
      console.error("Failed to save settings:", err)
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading settings...</div>
  }

  if (!settings) {
    return <div className="p-8 text-center text-muted-foreground">Failed to load settings</div>
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure automation and response templates</p>
      </div>

      <div className="space-y-6">
        {/* Feedback Automation */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold text-foreground mb-4">Автоматизация отзывов</h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-card/50 rounded-lg">
              <div>
                <p className="font-medium text-foreground">Авто-синхронизация</p>
                <p className="text-sm text-muted-foreground">Автоматически синхронизировать отзывы с Wildberries</p>
              </div>
              <input
                type="checkbox"
                checked={settings.auto_sync}
                onChange={(e) => setSettings({ ...settings, auto_sync: e.target.checked })}
                className="w-5 h-5"
              />
            </div>

            <div className="flex items-center justify-between p-3 bg-card/50 rounded-lg">
              <div>
                <p className="font-medium text-foreground">Авто-черновик</p>
                <p className="text-sm text-muted-foreground">Автоматически генерировать черновики ответов</p>
              </div>
              <input
                type="checkbox"
                checked={settings.auto_draft}
                onChange={(e) => setSettings({ ...settings, auto_draft: e.target.checked })}
                className="w-5 h-5"
              />
            </div>

            <div className="flex items-center justify-between p-3 bg-card/50 rounded-lg">
              <div>
                <p className="font-medium text-foreground">Авто-публикация</p>
                <p className="text-sm text-muted-foreground">Автоматически публиковать ответы</p>
              </div>
              <input
                type="checkbox"
                checked={settings.auto_publish}
                onChange={(e) => setSettings({ ...settings, auto_publish: e.target.checked })}
                className="w-5 h-5"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Режим ответов</label>
              <select
                value={settings.reply_mode}
                onChange={(e) => setSettings({ ...settings, reply_mode: e.target.value })}
                className="w-full mt-2 px-3 py-2 bg-input border border-border rounded-md text-foreground"
              >
                <option value="manual">Ручной</option>
                <option value="semi">Полуавтомат</option>
                <option value="auto">Полный автомат</option>
              </select>
            </div>
          </div>
        </Card>

        {/* Content Settings */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold text-foreground mb-4">Содержание ответов</h2>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground">Язык</label>
              <select
                value={settings.language}
                onChange={(e) => setSettings({ ...settings, language: e.target.value })}
                className="w-full mt-2 px-3 py-2 bg-input border border-border rounded-md text-foreground"
              >
                <option value="en">Английский</option>
                <option value="ru">Русский</option>
                <option value="uz">Узбекский</option>
              </select>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Тон</label>
              <select
                value={settings.tone}
                onChange={(e) => setSettings({ ...settings, tone: e.target.value })}
                className="w-full mt-2 px-3 py-2 bg-input border border-border rounded-md text-foreground"
              >
                <option value="professional">Профессиональный</option>
                <option value="friendly">Дружелюбный</option>
                <option value="formal">Формальный</option>
              </select>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Подпись</label>
              <Textarea
                value={settings.signature}
                onChange={(e) => setSettings({ ...settings, signature: e.target.value })}
                placeholder="Добавьте подпись к ответам"
                className="mt-2 min-h-24"
              />
            </div>
          </div>
        </Card>

        {/* Save Button */}
        <div className="flex gap-2">
          <Button onClick={handleSaveSettings} disabled={isSaving} className="gap-2">
            <Save className="w-4 h-4" />
            {isSaving ? "Сохраняется..." : "Сохранить настройки"}
          </Button>

          <div className="flex items-center gap-2 text-sm text-yellow-600 ml-auto">
            <AlertCircle className="w-4 h-4" />
            Changes may affect automation behavior
          </div>
        </div>
      </div>
    </div>
  )
}
