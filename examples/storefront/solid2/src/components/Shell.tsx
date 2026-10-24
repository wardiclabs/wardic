/** The shop's frame (#296): its header, with the visitor's switches and the store's, and its footer. */
import type { JSX } from "@solidjs/web"
import { createMemo, createSignal, Loading, Show } from "solid-js"
import { type Theme, usePreferences } from "~/lib/preferences.tsx"
import { settings } from "~/lib/store.ts"
import { setSettings } from "~/server/store.ts"

const THEME_LABEL: Record<Theme, string> = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" }
const THEME_ICON: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" }

/** The store's switches: the delay on each request, and "fail the next one". */
function StoreSettings() {
  const [open, setOpen] = createSignal(false)
  return (
    <div class="settings">
      <button class="icon-button" aria-expanded={String(open()) as "true" | "false"} aria-label="Store settings" title="Store settings" onClick={() => setOpen(!open())}>
        ⚙
      </button>
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

/** The switches, read through an async memo: the router revalidates it when a save lands. */
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
          onChange={(event) => setSettings({ delay: Number(event.currentTarget.value), failNext: now().failNext })}
        />
      </label>
      <label class="switch">
        <input type="checkbox" checked={now().failNext} onChange={(event) => setSettings({ delay: now().delay, failNext: event.currentTarget.checked })} />
        <span>Fail the next request</span>
      </label>
    </>
  )
}

export function Shell(props: { readonly children: JSX.Element }) {
  const preferences = usePreferences()
  return (
    <>
      <header class="site-header">
        <div class="page">
          <a class="brand" href="/">
            Kiln & Co. <small>Wardic · Solid 2</small>
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
          <span>Kiln & Co. is a made-up shop: a showcase of Wardic on Solid 2.</span>
          <span>Photos: CC0, from museums' open-access collections.</span>
        </div>
      </footer>
    </>
  )
}
