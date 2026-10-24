/** The shop's frame (#296): its header, with the visitor's switches and the store's, and its footer. */
import { A, createAsync, useAction } from "@solidjs/router"
import { createSignal, type JSX, Show, Suspense } from "solid-js"
import { type Theme, usePreferences } from "~/lib/preferences.tsx"
import { saveSettings, settings } from "~/lib/store.ts"

const THEME_LABEL: Record<Theme, string> = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" }
const THEME_ICON: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" }

/** The store's switches: the delay on each request, and "fail the next one". */
function StoreSettings() {
  const [open, setOpen] = createSignal(false)
  const current = createAsync(() => settings())
  const save = useAction(saveSettings)
  return (
    <div class="settings">
      <button class="icon-button" aria-expanded={open()} aria-label="Store settings" title="Store settings" onClick={() => setOpen(!open())}>
        ⚙
      </button>
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

export function Shell(props: { readonly children: JSX.Element }) {
  const preferences = usePreferences()
  return (
    <>
      <header class="site-header">
        <div class="page">
          <A class="brand" href="/">
            Kiln & Co. <small>Wardic · Solid 1</small>
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
            <button class="icon-button" aria-label={THEME_LABEL[preferences.theme()]} title={THEME_LABEL[preferences.theme()]} onClick={preferences.cycleTheme}>
              {THEME_ICON[preferences.theme()]}
            </button>
            <StoreSettings />
          </div>
        </div>
      </header>
      {props.children}
      <footer class="site-footer">
        <div class="page">
          <span>Kiln & Co. is a made-up shop: a showcase of Wardic on Solid 1.</span>
          <span>Photos: CC0, from museums' open-access collections.</span>
        </div>
      </footer>
    </>
  )
}
