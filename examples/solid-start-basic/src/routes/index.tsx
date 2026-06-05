import { VERSION as coreVersion } from "@wardic/core"
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
        <ul>
          <li>@wardic/core — v{coreVersion}</li>
          <li>@wardic/dom — v{domVersion}</li>
          <li>@wardic/solid — v{solidVersion}</li>
        </ul>
      </main>
    </WardicProvider>
  )
}
