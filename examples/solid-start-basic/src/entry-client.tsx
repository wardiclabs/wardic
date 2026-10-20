// @refresh reload
import { mount, StartClient } from "@solidjs/start/client"
import { markHydration, startAppearRecorder } from "@wardic/example-hand-checks/appear-report"
import { reportWhenHydrated, snapshotServerMarkup } from "@wardic/example-hand-checks/hydration-report"
import { SSR_EXPECTED } from "./ssr-expected.ts"

// The /ssr route's hydration report (#41): keep what the server painted before hydrating,
// then judge each element once the route has hydrated. Other routes have nothing to judge.
snapshotServerMarkup()
reportWhenHydrated(SSR_EXPECTED)
// The /appear route's report (#48): every frame from first paint, judged after hydration.
startAppearRecorder()

const start = (): void => {
  markHydration()
  mount(() => <StartClient />, document.getElementById("app")!)
}

// `?hydrate=<ms>` hydrates that much later, as a slow network would (#48): an Appear animation
// plays in CSS until then, and the engine takes it over mid-flight.
// Read leniently: a link copied with a trailing comma (`?hydrate=1500,`) is still 1500.
const delay = Number.parseInt(new URLSearchParams(location.search).get("hydrate") ?? "0", 10)
if (delay > 0) setTimeout(start, delay)
else start()
