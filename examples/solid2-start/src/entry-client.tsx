// The client entry (the authored pair's other half): hydrates the document as the plugin's generated
// entry does, and runs the hand checks' reports (@wardic/example-hand-checks).
//
// `hydrate` holds its start until the server's shell has arrived (Solid 2 waits for it, the script
// being async in the head), so what the server painted is read in the function it calls, right as
// hydration starts: /ssr's snapshot (#41), and /appear's mark (#48). /appear's recorder runs from
// first paint, every frame.
//
// `?hydrate=<ms>` hydrates that much later, as a slow network would (#48): an Appear animation plays
// in CSS until then, and the engine takes it over mid-flight. Read leniently: a link copied with a
// trailing comma (`?hydrate=1500,`) is still 1500.
import { markHydration, startAppearRecorder } from "@wardic/example-hand-checks/appear-report"
import { reportWhenHydrated, snapshotServerMarkup } from "@wardic/example-hand-checks/hydration-report"
import { hydrate } from "@solidjs/web"
import App from "./App.tsx"
import Document from "./Document.tsx"
import { SSR_EXPECTED } from "./ssr-expected.ts"

startAppearRecorder()

const start = (): void => {
  hydrate(() => {
    snapshotServerMarkup()
    reportWhenHydrated(SSR_EXPECTED)
    markHydration()
    return (
      <Document>
        <App />
      </Document>
    )
  }, document)
}

const delay = Number.parseInt(new URLSearchParams(location.search).get("hydrate") ?? "0", 10)
if (delay > 0) setTimeout(start, delay)
else start()
