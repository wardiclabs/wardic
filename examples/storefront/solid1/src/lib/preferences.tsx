/**
 * The visitor's preferences (#296 Q12): the theme, and "Reduce motion", which sets the provider's
 * `reducedMotion` so anyone can see the reduced version of every demo. Kept for the visit
 * (`sessionStorage`), read after hydration so the server's markup and the first client render agree.
 */
import { createReducedMotion } from "@wardic/solid"
import { type Accessor, createContext, createSignal, type JSX, onMount, useContext } from "solid-js"

export type Theme = "system" | "light" | "dark"

interface Preferences {
  readonly theme: () => Theme
  readonly cycleTheme: () => void
  readonly reduceMotion: () => boolean
  readonly setReduceMotion: (on: boolean) => void
}

const PreferencesContext = createContext<Preferences>()

const NEXT_THEME: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" }

const read = (key: string): string | null => {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string): void => {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // Storage blocked: the preference lasts until the page goes.
  }
}

export function PreferencesProvider(props: { readonly children: JSX.Element }) {
  const [theme, setTheme] = createSignal<Theme>("system")
  const [reduceMotion, setReduce] = createSignal(false)
  const applyTheme = (next: Theme): void => {
    setTheme(next)
    document.documentElement.dataset.theme = next
    if (next === "system") delete document.documentElement.dataset.theme
  }
  onMount(() => {
    const savedTheme = read("storefront-theme")
    if (savedTheme === "light" || savedTheme === "dark") applyTheme(savedTheme)
    setReduce(read("storefront-reduce-motion") === "true")
  })
  const preferences: Preferences = {
    theme,
    cycleTheme: () => {
      const next = NEXT_THEME[theme()]
      applyTheme(next)
      write("storefront-theme", next)
    },
    reduceMotion,
    setReduceMotion: (on) => {
      setReduce(on)
      write("storefront-reduce-motion", String(on))
    },
  }
  return <PreferencesContext.Provider value={preferences}>{props.children}</PreferencesContext.Provider>
}

export const usePreferences = (): Preferences => {
  const preferences = useContext(PreferencesContext)
  if (preferences === undefined) throw new Error("usePreferences outside <PreferencesProvider>")
  return preferences
}

/**
 * Whether to reduce motion (#388): the system's setting, through `createReducedMotion`, or the
 * header's switch. Wardic's own animations follow both by themselves, through the provider. Read this
 * for motion that's yours: a live value's spring, a scroll's parallax, a Web Animation.
 */
export const useReducedMotion = (): Accessor<boolean> => {
  const system = createReducedMotion()
  const preferences = usePreferences()
  return () => system() || preferences.reduceMotion()
}
