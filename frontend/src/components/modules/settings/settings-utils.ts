import type { ReplyMode, SignatureItem, WorkMode } from "@/components/modules/settings/settings-types"

export function getNested<T>(obj: any, path: string[], fallback: T): T {
  let cur = obj
  for (const key of path) {
    if (!cur || typeof cur !== "object" || !(key in cur)) return fallback
    cur = cur[key]
  }
  return (cur as T) ?? fallback
}

export function setNested(obj: any, path: string[], value: any) {
  const copy = { ...(obj || {}) }
  let cur: any = copy
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]
    cur[key] = { ...(cur[key] || {}) }
    cur = cur[key]
  }
  cur[path[path.length - 1]] = value
  return copy
}

export function coerceBool(v: any): boolean | null {
  if (v === null || v === undefined) return null
  if (typeof v === "boolean") return v
  if (typeof v === "number") return v === 1
  if (typeof v === "string") {
    const s = v.trim().toLowerCase()
    if (["true", "1", "yes"].includes(s)) return true
    if (["false", "0", "no"].includes(s)) return false
  }
  return null
}

export function normalizeSignature(x: string | SignatureItem): SignatureItem {
  if (typeof x === "string") {
    return { text: x, brand: "all", type: "all", rating: null, is_active: true }
  }

  const rawRating = typeof x.rating === "number" ? x.rating : null
  const rating = rawRating && rawRating >= 1 && rawRating <= 5 ? rawRating : null
  const type = x.type || "all"

  return {
    text: x.text,
    brand: x.brand || "all",
    type,
    rating,
    is_active: typeof x.is_active === "boolean" ? x.is_active : true,
    created_at: x.created_at,
  }
}

export function prettyDate(value?: string) {
  if (!value) return "—"
  try {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleDateString("ru-RU")
  } catch {
    return value
  }
}

export function prettyDateTime(value?: string | null) {
  if (!value) return "—"
  try {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleString("ru-RU")
  } catch {
    return value
  }
}

export function getWorkMode(ratingMap: Record<string, ReplyMode>): WorkMode {
  const modes = Object.values(ratingMap)
  const allAuto = modes.every((mode) => mode === "auto")
  const allManual = modes.every((mode) => mode === "manual")
  if (allAuto) return "autopilot"
  if (allManual) return "manual"
  return "control"
}

export function getRatingMapForMode(mode: WorkMode): Record<string, ReplyMode> {
  if (mode === "autopilot") {
    return { "1": "auto", "2": "auto", "3": "auto", "4": "auto", "5": "auto" }
  }
  if (mode === "manual") {
    return { "1": "manual", "2": "manual", "3": "manual", "4": "manual", "5": "manual" }
  }
  return { "1": "semi", "2": "semi", "3": "semi", "4": "auto", "5": "auto" }
}
