/**
 * The storefront showcase on Solid 1 (#296): SolidStart 2.1 with Solid Router's file routes, every
 * page inside the shop's frame and one `<WardicProvider>`, whose `reducedMotion` follows the
 * header's switch.
 */
import "@wardic/example-storefront-shared/styles.css"
import { Router } from "@solidjs/router"
import { FileRoutes } from "@solidjs/start/router"
import { DomLive } from "@wardic/dom"
import { WardicProvider } from "@wardic/solid"
import { type JSX, Suspense } from "solid-js"
import { Shell } from "~/components/Shell.tsx"
import { PreferencesProvider, usePreferences } from "~/lib/preferences.tsx"

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
    <Router
      root={(props) => (
        <PreferencesProvider>
          <Motion>
            <Shell>
              <Suspense>{props.children}</Suspense>
            </Shell>
          </Motion>
        </PreferencesProvider>
      )}
    >
      <FileRoutes />
    </Router>
  )
}
