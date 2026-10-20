// The sandbox's home: proof the workspace chain (core -> dom -> solid's Solid 2 binding) resolves
// and renders under SSR, and links to the hand checks.
import corePackage from "@wardic/core/package.json"
import { DomLive, VERSION as domVersion } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid/unstable/v2"

export default function Home() {
  return (
    <WardicProvider env={DomLive}>
      <main style={{ "font-family": "system-ui, sans-serif", padding: "2rem", "max-width": "40rem" }}>
        <wardic.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          Wardic on Solid 2
        </wardic.h1>
        <p>
          The Solid 2 binding, <code>@wardic/solid/unstable/v2</code>, in <code>@solidjs/vite-plugin</code>'s start mode,
          rendered on the server and hydrated.
        </p>
        <p>
          <a href="/ssr" rel="external">/ssr</a>: every Wardic element rendered on the server, then hydrated, with a hydration
          report (#41). The link loads the page from the server; the router would render it client-side.
        </p>
        <p>
          <a href="/appear" rel="external">/appear</a>: Appear animations (#48), mount animations played in CSS from first
          paint and taken over at hydration, with a report; add <code>?hydrate=1500</code> to hydrate mid-flight, or{" "}
          <code>?data=1500</code> to stream its list in later.
        </p>
        <ul>
          <li>@wardic/core — v{corePackage.version}</li>
          <li>@wardic/dom — v{domVersion}</li>
        </ul>
      </main>
    </WardicProvider>
  )
}
