import { useLocation } from "@solidjs/router"
import { ARCHIVE } from "@wardic/example-storefront-shared/archive"
import { colourOf } from "@wardic/example-storefront-shared/glazes"
import { type Hydration, hydrationOf } from "@wardic/example-storefront-shared/hydration"
import { createBatch, stagger } from "@wardic/solid"
import { createSignal, For, onSettled, Show } from "solid-js"

/** When the JavaScript took over, in ms from the page's start: once, so a replay keeps it. */
let tookOver: number | undefined

/** What the server says is coming, before the JavaScript arrives. */
const waiting = (hydration: Hydration): string => {
  if (hydration.kind === "off") return "No JavaScript on this page: the wall is the server's HTML and CSS alone."
  if (hydration.kind === "late") return `Waiting for the JavaScript, held back ${hydration.ms / 1000} s…`
  return "Waiting for the JavaScript…"
}

/** Every piece in the archive on one wall, oldest first: one Batch, its entrance played from the first paint. */
export default function Wall() {
  const location = useLocation()
  const [at, setAt] = createSignal(tookOver)
  onSettled(() => {
    tookOver ??= Math.round(performance.now())
    setAt(tookOver)
  })

  // `appear`: the server writes the entrance into the page's CSS, so the tiles rise in from the first
  // paint; as the page hydrates, the Batch takes each one over where its CSS has got to. The grid
  // places them, so the server needn't know how wide the page is: the Batch moves only what enters.
  const tiles = createBatch({
    appear: true,
    count: ARCHIVE.length,
    initial: { opacity: 0, scale: 0.5, y: 12 },
    animate: () => ({ opacity: 1, scale: 1, y: 0 }),
    transition: { type: "spring", visualDuration: 0.5, bounce: 0.25, delay: stagger(0.004) },
  })

  return (
    <div class="wall-demo">
      <div class="wall" role="list" aria-label={`The archive's ${ARCHIVE.length} pieces, oldest first`}>
        <For each={ARCHIVE}>
          {(piece, i) => <span class="wall-tile" role="listitem" title={`${piece.name}, ${piece.year}`} {...tiles.at(i(), { style: { background: colourOf(piece.glaze) } })} />}
        </For>
      </div>
      <div class="hydration">
        <p class="hydration-status" role="status">
          <Show when={at()} fallback={waiting(hydrationOf(new URLSearchParams(location.search).get("hydrate")))}>
            {(ms) => <>The JavaScript took over at {ms()} ms; the wall had been rising since the first paint.</>}
          </Show>
        </p>
        {/* Full page loads, not the router's: `rel="external"`. */}
        <nav class="hydration-links" aria-label="Load this page again">
          <a class="button quiet" rel="external" href="/server/wall?hydrate=2000">
            Hydrate 2 s late
          </a>
          <a class="button quiet" rel="external" href="/server/wall?hydrate=off">
            Don't hydrate
          </a>
          <a class="button quiet" rel="external" href="/server/wall">
            Hydrate at once
          </a>
        </nav>
      </div>
    </div>
  )
}
