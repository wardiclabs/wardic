/**
 * The theme (#558): the system's, light or dark, kept for the visitor in `localStorage` and set on
 * `<html>` as `data-theme`, which the tokens read (Northlight's, shared with the storefronts). The
 * server can't know the choice: `THEME_SCRIPT` sets it before the first paint, and the button reads it
 * once the page has hydrated.
 */
import { w } from "@wardic/solid/unstable/v2"
import { createSignal, Match, onSettled, Switch } from "solid-js"

type Theme = "system" | "light" | "dark"

const KEY = "wardic-theme"

/** Run in `<head>` before the body paints: the stored theme, if any, on `<html>`. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`

const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" }
const LABEL: Record<Theme, string> = { system: "Theme: the system's", light: "Theme: light", dark: "Theme: dark" }

const stored = (): Theme => {
  try {
    const value = localStorage.getItem(KEY)
    if (value === "light" || value === "dark") return value
  } catch {}
  return "system"
}

const apply = (theme: Theme): void => {
  try {
    if (theme === "system") {
      localStorage.removeItem(KEY)
      delete document.documentElement.dataset.theme
      return
    }
    localStorage.setItem(KEY, theme)
  } catch {}
  document.documentElement.dataset.theme = theme
}

export function ThemeToggle() {
  const [theme, setTheme] = createSignal<Theme>("system")
  onSettled(() => {
    setTheme(stored())
  })
  const cycle = () => {
    const next = NEXT[theme()]
    apply(next)
    setTheme(next)
  }
  return (
    <w.button class="icon-button" type="button" aria-label={LABEL[theme()]} title={LABEL[theme()]} onClick={cycle} whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.94 }}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <Switch>
          <Match when={theme() === "light"}>
            <circle cx="12" cy="12" r="4.5" />
            <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
          </Match>
          <Match when={theme() === "dark"}>
            <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
          </Match>
          <Match when={theme() === "system"}>
            <rect x="3" y="4.5" width="18" height="12" rx="2" />
            <path d="M8.5 20h7M12 16.5V20" />
          </Match>
        </Switch>
      </svg>
    </w.button>
  )
}
