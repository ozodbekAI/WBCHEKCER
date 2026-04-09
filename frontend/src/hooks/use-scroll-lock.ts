import { useEffect } from "react"

/**
 * Locks scrolling on a specific scroll container (NOT the body).
 * Needed because Radix Dialog locks the body, but our app scrolls inside <main>.
 */
export function useScrollLock(locked: boolean, selector = "main[data-scroll-container]") {
  useEffect(() => {
    if (typeof document === "undefined") return
    const el = document.querySelector<HTMLElement>(selector)
    if (!el) return

    const prevOverflow = el.style.overflow
    const prevPaddingRight = el.style.paddingRight

    // Preserve layout when scrollbar disappears
    const scrollbarWidth = el.offsetWidth - el.clientWidth

    if (locked) {
      el.style.overflow = "hidden"
      if (scrollbarWidth > 0) {
        el.style.paddingRight = `${scrollbarWidth}px`
      }
    }

    return () => {
      el.style.overflow = prevOverflow
      el.style.paddingRight = prevPaddingRight
    }
  }, [locked, selector])
}
