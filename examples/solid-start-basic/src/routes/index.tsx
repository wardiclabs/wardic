import corePackage from "@wardic/core/package.json"
import { DomLive, VERSION as domVersion } from "@wardic/dom"
import { VERSION as solidVersion, WardicProvider } from "@wardic/solid"

// Importing a marker from each package proves the whole workspace chain
// (core -> dom -> solid) resolves and builds under SSR. Replace this page with
// real animation demos as the packages gain functionality.
export default function Home() {
  return (
    <WardicProvider env={DomLive}>
      <main style={{ "font-family": "system-ui, sans-serif", "padding": "2rem", "max-width": "40rem" }}>
        <h1>Wardic dev sandbox</h1>
        <p>The packages are wired up and rendering through SSR. Start building primitives in @wardic/core.</p>
        <p>
          <a href="/ssr" rel="external">/ssr</a>: every Wardic element rendered on the server, then hydrated, with a hydration
          report (#41). The link loads the page from the server; the router would render it client-side.
        </p>
        <p>
          <a href="/appear" rel="external">/appear</a>: Appear animations (#48), mount animations played in CSS from first
          paint and taken over at hydration, with a report; add <code>?hydrate=1500</code> to hydrate mid-flight.
        </p>
        <ul>
          <li>@wardic/core — v{corePackage.version}</li>
          <li>@wardic/dom — v{domVersion}</li>
          <li>@wardic/solid — v{solidVersion}</li>
        </ul>
      </main>
    </WardicProvider>
  )
}
