// @refresh reload
import { mount, StartClient } from "@solidjs/start/client"
import { reportWhenHydrated, snapshotServerMarkup } from "./hydration-report.ts"

// The /ssr route's hydration report (#41): keep what the server painted before hydrating,
// then judge each element once the route has hydrated. Other routes have nothing to judge.
snapshotServerMarkup()
reportWhenHydrated()

mount(() => <StartClient />, document.getElementById("app")!)
