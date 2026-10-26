/** The shop's frame (#296): its header, with the visitor's switches and the store's, and its footer. */
import { revalidate } from "@solidjs/router"
import type { JSX } from "@solidjs/web"
import type { Settings } from "@wardic/example-storefront-shared/server"
import { COG, ICON, turnOf } from "@wardic/example-storefront-shared/micro"
import { AnimatePresence, ward, wardic } from "@wardic/solid/unstable/v2"
import { action, createEffect, createMemo, createSignal, For, Loading, Show } from "solid-js"
import { type Arrival, arrivalId, arrivals, landed } from "~/lib/arrivals.ts"
import { type Theme, usePreferences } from "~/lib/preferences.tsx"
import { cart, settings } from "~/lib/store.ts"
import { setSettings } from "~/server/store.ts"

const THEME_LABEL: Record<Theme, string> = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" }
const THEME_ICON: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" }

/** The store's switches: the delay on each request, and "fail the next one". */
function StoreSettings() {
  const [open, setOpen] = createSignal(false)
  return (
    <div class="settings">
      <wardic.button
        class="icon-button"
        variants={ICON}
        initial="rest"
        animate="rest"
        whileHover="hover"
        whileTap="press"
        aria-expanded={String(open()) as "true" | "false"}
        aria-label="Store settings"
        title="Store settings"
        onClick={() => setOpen(!open())}
      >
        <wardic.span class="glyph" variants={COG}>
          ⚙
        </wardic.span>
      </wardic.button>
      <Show when={open()}>
        <div class="settings-panel" role="dialog" aria-label="Store settings">
          <strong>The store</strong>
          <Loading fallback={<p class="muted">Loading…</p>}>
            <SettingsForm />
          </Loading>
        </div>
      </Show>
    </div>
  )
}

/** Save the switches, then read them again. */
const saveSettings = action(function* (next: Settings) {
  yield setSettings(next)
  revalidate(settings.key)
})

/** The switches, read through an async memo, read again after each save. */
function SettingsForm() {
  const now = createMemo(() => settings())
  return (
    <>
      <label>
        <span>
          Delay on each request: <strong>{now().delay} ms</strong>
        </span>
        <input
          type="range"
          min="0"
          max="2000"
          step="100"
          value={now().delay}
          onChange={(event) => saveSettings({ delay: Number(event.currentTarget.value), failNext: now().failNext })}
        />
      </label>
      <label class="switch">
        <input type="checkbox" checked={now().failNext} onChange={(event) => saveSettings({ delay: now().delay, failNext: event.currentTarget.checked })} />
        <span>Fail the next request</span>
      </label>
    </>
  )
}

/** The cart's count, which pops each time it changes: a new count is a new element, growing in. */
function CartButton() {
  const current = createMemo(() => cart())
  const count = () => current().lines.reduce((sum, line) => sum + line.quantity, 0)
  return (
    <wardic.a class="icon-button cart-button" href="/layout/cart-drawer" variants={ICON} initial="rest" animate="rest" whileHover="hover" whileTap="press" title="Cart" aria-label="Cart">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M6 7h12l-1 13H7L6 7Z M9 7a3 3 0 0 1 6 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
      </svg>
      <Loading>
        <Show when={count()} keyed>
          {(n) => (
            <wardic.span class="cart-count" initial={{ scale: 1.5 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }}>
              {n}
            </wardic.span>
          )}
        </Show>
      </Loading>
      <AnimatePresence>
        <For each={arrivals()}>{(piece) => <CartArrival piece={piece} />}</For>
      </AnimatePresence>
    </wardic.a>
  )
}

/**
 * A piece moved to the cart from Saved for later: its photo's twin, sharing its row photo's
 * `layoutId`, so Wardic flies it here from the row it left. Landed, it shrinks into the icon.
 */
function CartArrival(props: { readonly piece: Arrival }) {
  // Its ward holds what it hears, its layout (#398): its landing lets it go.
  const flight = ward({ layoutId: arrivalId(props.piece.id) })
  createEffect(flight.when("layoutComplete"), () => landed(props.piece.id))
  return (
    <wardic.img
      class="cart-arrival"
      wardRef={flight}
      src={props.piece.src}
      alt=""
      transition={{ layout: { type: "tween", duration: 0.6, ease: [0.45, 0, 0.55, 1] } }}
      exit={{ scale: 0.3, opacity: 0, transition: { type: "tween", duration: 0.25 } }}
    />
  )
}

export function Shell(props: { readonly children: JSX.Element }) {
  const preferences = usePreferences()
  // Each theme switch turns its icon half a turn on (#365).
  const [switches, setSwitches] = createSignal(0)
  return (
    <>
      <header class="site-header">
        <div class="page">
          <a class="brand" href="/">
            Wardic Northlight <small>Solid 2</small>
          </a>
          <nav class="site-nav" aria-label="Main">
            <a href="/" >
              Examples
            </a>
          </nav>
          <div class="header-tools">
            <label class="switch">
              <input type="checkbox" checked={preferences.reduceMotion()} onChange={(event) => preferences.setReduceMotion(event.currentTarget.checked)} />
              <span>Reduce motion</span>
            </label>
            <wardic.button
              class="icon-button"
              variants={ICON}
              initial="rest"
              animate="rest"
              whileHover="hover"
              whileTap="press"
              aria-label={THEME_LABEL[preferences.theme()]}
              title={THEME_LABEL[preferences.theme()]}
              onClick={() => {
                setSwitches((n) => n + 1)
                preferences.cycleTheme()
              }}
            >
              <wardic.span class="glyph" animate={turnOf(switches())}>
                {THEME_ICON[preferences.theme()]}
              </wardic.span>
            </wardic.button>
            <StoreSettings />
            <CartButton />
          </div>
        </div>
      </header>
      {props.children}
      <footer class="site-footer">
        <div class="page">
          <span>Wardic Northlight is a made-up shop: a showcase of Wardic on Solid 2.</span>
          <span>Photos: CC0, from museums' open-access collections.</span>
        </div>
      </footer>
    </>
  )
}
