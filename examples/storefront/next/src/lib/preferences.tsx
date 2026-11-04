"use client"
/**
 * The visitor's preferences (#296 Q12): the theme, and "Reduce motion", which sets `MotionConfig`'s
 * `reducedMotion`, so anyone can see the reduced version of every demo (#366 Q7). And the app's one
 * `LazyMotion` (#526).
 *
 * Motion reads `reducedMotion` as each element mounts, and never again. So the switch is a cookie,
 * for the visit, which the server reads to render with it, and the page's content mounts again when
 * it changes (`PageScope`). The theme is kept for the visit too (`sessionStorage`), read once the
 * page has hydrated, so the server's markup and hydration agree.
 */
import { domMax, LazyMotion, MotionConfig } from "motion/react"
import { createContext, Fragment, type ReactNode, use, useEffect, useState } from "react"
import { REDUCE_MOTION_COOKIE } from "./reduce-motion.ts"

export type Theme = "system" | "light" | "dark"

interface Preferences {
  readonly theme: Theme
  readonly cycleTheme: () => void
  readonly reduceMotion: boolean
  readonly setReduceMotion: (on: boolean) => void
}

const PreferencesContext = createContext<Preferences | null>(null)

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

const applyTheme = (theme: Theme): void => {
  if (theme === "system") delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
}

export function Preferences({ reduceMotion: fromCookie, children }: { readonly reduceMotion: boolean; readonly children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("system")
  const [reduceMotion, setReduce] = useState(fromCookie)
  useEffect(() => {
    const saved = read("storefront-theme")
    if (saved === "light" || saved === "dark") {
      setTheme(saved)
      applyTheme(saved)
    }
  }, [])
  const preferences: Preferences = {
    theme,
    cycleTheme: () => {
      const next = NEXT_THEME[theme]
      setTheme(next)
      applyTheme(next)
      write("storefront-theme", next)
    },
    reduceMotion,
    setReduceMotion: (on) => {
      setReduce(on)
      // A session cookie: it lasts the visit.
      document.cookie = `${REDUCE_MOTION_COOKIE}=${on}; path=/; samesite=lax`
    },
  }
  return (
    <PreferencesContext value={preferences}>
      {/* "user" follows the system's setting; the switch makes it "always". */}
      <MotionConfig reducedMotion={reduceMotion ? "always" : "user"}>
        {/* Every element is Motion's `m` (#526), with the shell's Features: its cart's fly-in needs
            `layoutId`, which only `domMax` has, so every page has `drag` too. `strict` makes a
            `motion` element an error. */}
        <LazyMotion features={domMax} strict>
          {children}
        </LazyMotion>
      </MotionConfig>
    </PreferencesContext>
  )
}

export const usePreferences = (): Preferences => {
  const preferences = use(PreferencesContext)
  if (preferences === null) throw new Error("usePreferences outside <Preferences>")
  return preferences
}

/**
 * The page's content, mounted again when the switch changes, so its elements take the new
 * `reducedMotion` (Motion reads it as each mounts). The header's own buttons keep theirs until the
 * next page load: mounting them again would take the focus from the switch.
 */
export function PageScope({ children }: { readonly children: ReactNode }) {
  return <Fragment key={String(usePreferences().reduceMotion)}>{children}</Fragment>
}
