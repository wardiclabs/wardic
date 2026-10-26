/** The shop's frame (#296): its header, with the visitor's switches and the store's, and its footer. */
import { A, createAsync, useAction } from "@solidjs/router"
import { COG, ICON, turnOf } from "@wardic/example-storefront-shared/micro"
import { AnimatePresence, wardic } from "@wardic/solid"
import { createSignal, For, type JSX, Show, Suspense } from "solid-js"
import { type Arrival, arrivalId, arrivals, landed } from "~/lib/arrivals.ts"
import { type Theme, usePreferences } from "~/lib/preferences.tsx"
import { cart, saveSettings, settings } from "~/lib/store.ts"

const THEME_LABEL: Record<Theme, string> = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" }
const THEME_ICON: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" }

/** A header link that answers as the icon buttons do (#365). */
const IconLink = wardic.create(A)

/** The store's switches: the delay on each request, and "fail the next one". */
function StoreSettings() {
  const [open, setOpen] = createSignal(false)
  const current = createAsync(() => settings())
  const save = useAction(saveSettings)
  return (
    <div class="settings">
      <wardic.button class="icon-button" variants={ICON} initial="rest" animate="rest" whileHover="hover" whileTap="press" aria-expanded={open()} aria-label="Store settings" title="Store settings" onClick={() => setOpen(!open())}>
        <wardic.span class="glyph" variants={COG}>
          ⚙
        </wardic.span>
      </wardic.button>
      <Show when={open()}>
        <div class="settings-panel" role="dialog" aria-label="Store settings">
          <strong>The store</strong>
          <Suspense fallback={<p class="muted">Loading…</p>}>
            <Show when={current()}>
              {(now) => (
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
                      onChange={(event) => save({ delay: Number(event.currentTarget.value), failNext: now().failNext })}
                    />
                  </label>
                  <label class="switch">
                    <input type="checkbox" checked={now().failNext} onChange={(event) => save({ delay: now().delay, failNext: event.currentTarget.checked })} />
                    <span>Fail the next request</span>
                  </label>
                </>
              )}
            </Show>
          </Suspense>
        </div>
      </Show>
    </div>
  )
}

/** The cart's count, which pops each time it changes: a new count is a new element, growing in. */
function CartButton() {
  const current = createAsync(() => cart())
  const count = () => {
    const lines = current()
    if (lines === undefined) return 0
    return lines.lines.reduce((sum, line) => sum + line.quantity, 0)
  }
  return (
    <IconLink class="icon-button cart-button" href="/layout/cart-drawer" variants={ICON} initial="rest" animate="rest" whileHover="hover" whileTap="press" aria-label={`Cart: ${count()} items`} title="Cart">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M6 7h12l-1 13H7L6 7Z M9 7a3 3 0 0 1 6 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
      </svg>
      <Suspense>
        <Show when={count()} keyed>
          {(n) => (
            <wardic.span class="cart-count" initial={{ scale: 1.5 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }}>
              {n}
            </wardic.span>
          )}
        </Show>
      </Suspense>
      <AnimatePresence>
        <For each={arrivals()}>{(piece) => <CartArrival piece={piece} />}</For>
      </AnimatePresence>
    </IconLink>
  )
}

/**
 * A piece moved to the cart from Saved for later: its photo's twin, sharing its row photo's
 * `layoutId`, so Wardic flies it here from the row it left. Landed, it shrinks into the icon.
 */
function CartArrival(props: { readonly piece: Arrival }) {
  return (
    <wardic.img
      class="cart-arrival"
      layoutId={arrivalId(props.piece.id)}
      src={props.piece.src}
      alt=""
      transition={{ layout: { type: "tween", duration: 0.6, ease: [0.45, 0, 0.55, 1] } }}
      exit={{ scale: 0.3, opacity: 0, transition: { type: "tween", duration: 0.25 } }}
      onLayoutAnimationComplete={() => landed(props.piece.id)}
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
          <A class="brand" href="/">
            Wardic Northlight
            <span class="badges">
              <span class="badge badge-binding">Solid 1</span>
            </span>
          </A>
          <nav class="site-nav" aria-label="Main">
            <A href="/" end>
              Examples
            </A>
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
          <span>Wardic Northlight is a made-up shop: a showcase of Wardic on Solid 1.</span>
          <span>Photos: CC0, from museums' open-access collections.</span>
        </div>
      </footer>
    </>
  )
}
