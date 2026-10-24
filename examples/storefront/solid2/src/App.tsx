/**
 * The storefront showcase on Solid 2 (#296): the router over the file routes, every page inside the
 * shop's frame and one `<WardicProvider>`, whose `reducedMotion` follows the header's switch.
 */
import "@wardic/example-storefront-shared/styles.css"
import { DomLive } from "@wardic/dom"
import { WardicProvider } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import { Loading } from "solid-js"
import { Shell } from "~/components/Shell.tsx"
import { PreferencesProvider, usePreferences } from "~/lib/preferences.tsx"
import { Router } from "~/router.ts"

const REDUCED: Record<string, "always" | "user"> = { true: "always", false: "user" }

function Motion(props: { readonly children: JSX.Element }) {
  const preferences = usePreferences()
  return (
    <WardicProvider env={DomLive} reducedMotion={REDUCED[String(preferences.reduceMotion())]}>
      {props.children}
    </WardicProvider>
  )
}

export default function App() {
  return (
    <PreferencesProvider>
      <Motion>
        <Router>
          {(props) => (
            <Shell>
              <Loading fallback={<main class="page hero muted">Loading…</main>}>{props.children}</Loading>
            </Shell>
          )}
        </Router>
      </Motion>
    </PreferencesProvider>
  )
}
