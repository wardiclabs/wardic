"use client"
/** The header's switches (#296): reduce motion, the theme, the store's settings, and the cart. */
import type { Cart, Settings } from "@wardic/example-storefront-shared/server"
import { COG, ICON, turnOf } from "@wardic/example-storefront-shared/micro"
import { AnimatePresence, arc, m } from "motion/react"
import Link from "next/link"
import { Suspense, startTransition, use, useState } from "react"
import { type Arrival, arrivalId, landed, useArrivals } from "~/lib/arrivals.ts"
import { type Theme, usePreferences } from "~/lib/preferences.tsx"
import { getSettings, setSettings } from "~/lib/store.ts"

const THEME_LABEL: Record<Theme, string> = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" }
const THEME_ICON: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" }

const MotionLink = m.create(Link)

/** The store's switches: the delay on each request, and "fail the next one". */
function StoreSettings() {
  const [settings, setShown] = useState<Promise<Settings> | null>(null)
  // Opening the panel fetches the switches; closing it lets them go.
  const toggle = () => setShown(settings === null ? getSettings() : null)
  const save = (next: Settings) =>
    startTransition(async () => {
      await setSettings(next)
      startTransition(() => setShown(getSettings()))
    })
  return (
    <div className="settings">
      <m.button
        className="icon-button"
        variants={ICON}
        initial="rest"
        animate="rest"
        whileHover="hover"
        whileTap="press"
        aria-expanded={settings !== null}
        aria-label="Store settings"
        title="Store settings"
        onClick={toggle}
      >
        <m.span className="glyph" variants={COG}>
          ⚙
        </m.span>
      </m.button>
      {settings !== null && (
        <div className="settings-panel" role="dialog" aria-label="Store settings">
          <strong>The store</strong>
          <Suspense fallback={<p className="muted">Loading…</p>}>
            <SettingsForm settings={settings} save={save} />
          </Suspense>
        </div>
      )}
    </div>
  )
}

/** The switches, read from the promise the panel holds, fetched again after each save. */
function SettingsForm({ settings, save }: { readonly settings: Promise<Settings>; readonly save: (next: Settings) => void }) {
  const now = use(settings)
  return (
    <>
      <label>
        <span>
          Delay on each request: <strong>{now.delay} ms</strong>
        </span>
        <input type="range" min="0" max="2000" step="100" defaultValue={now.delay} onChange={(event) => save({ delay: Number(event.currentTarget.value), failNext: now.failNext })} />
      </label>
      <label className="switch">
        <input type="checkbox" checked={now.failNext} onChange={(event) => save({ delay: now.delay, failNext: event.currentTarget.checked })} />
        <span>Fail the next request</span>
      </label>
    </>
  )
}

/** The cart's count, which pops each time it changes: a new count is a new element, growing in. */
function CartCount({ cart }: { readonly cart: Promise<Cart> }) {
  const count = use(cart).lines.reduce((sum, line) => sum + line.quantity, 0)
  if (count === 0) return null
  return (
    <m.span key={count} className="cart-count" initial={{ scale: 1.5 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }}>
      {count}
    </m.span>
  )
}

// The flight into the cart bows along an arc (#438), one value for every flight, as its side is kept.
const TOSS = arc()

/**
 * A piece moved to the cart from Saved for later: its photo's twin, sharing its row photo's
 * `layoutId`, so Motion flies it here from the row it left. Landed, it shrinks into the icon. One photo
 * flies, not the row's and this one crossfading (`layoutCrossfade={false}`, #442): the row's is
 * hidden as this one takes over.
 */
function CartArrival({ piece }: { readonly piece: Arrival }) {
  return (
    <m.img
      className="cart-arrival"
      layoutId={arrivalId(piece.id)}
      layoutCrossfade={false}
      src={piece.src}
      alt=""
      transition={{ layout: { type: "tween", duration: 0.6, ease: [0.45, 0, 0.55, 1], path: TOSS } }}
      exit={{ scale: 0.3, opacity: 0, transition: { type: "tween", duration: 0.25 } }}
      onLayoutAnimationComplete={() => landed(piece.id)}
    />
  )
}

function CartButton({ cart }: { readonly cart: Promise<Cart> }) {
  const arrivals = useArrivals()
  return (
    <MotionLink
      className="icon-button cart-button"
      href="/layout/cart-drawer"
      prefetch={false}
      variants={ICON}
      initial="rest"
      animate="rest"
      whileHover="hover"
      whileTap="press"
      title="Cart"
      aria-label="Cart"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M6 7h12l-1 13H7L6 7Z M9 7a3 3 0 0 1 6 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
      <Suspense>
        <CartCount cart={cart} />
      </Suspense>
      <AnimatePresence>
        {arrivals.map((piece) => (
          <CartArrival key={piece.id} piece={piece} />
        ))}
      </AnimatePresence>
    </MotionLink>
  )
}

export function HeaderTools({ cart }: { readonly cart: Promise<Cart> }) {
  const preferences = usePreferences()
  // Each theme switch turns its icon half a turn on (#365).
  const [switches, setSwitches] = useState(0)
  return (
    <div className="header-tools">
      <label className="switch">
        <input type="checkbox" checked={preferences.reduceMotion} onChange={(event) => preferences.setReduceMotion(event.currentTarget.checked)} />
        <span>Reduce motion</span>
      </label>
      <m.button
        className="icon-button"
        variants={ICON}
        initial="rest"
        animate="rest"
        whileHover="hover"
        whileTap="press"
        aria-label={THEME_LABEL[preferences.theme]}
        title={THEME_LABEL[preferences.theme]}
        onClick={() => {
          setSwitches((n) => n + 1)
          preferences.cycleTheme()
        }}
      >
        <m.span className="glyph" animate={turnOf(switches)}>
          {THEME_ICON[preferences.theme]}
        </m.span>
      </m.button>
      <StoreSettings />
      <CartButton cart={cart} />
    </div>
  )
}
