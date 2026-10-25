import { useLocation } from "@solidjs/router"
import { type Hydration, hydrationOf } from "@wardic/example-storefront-shared/hydration"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import { wardic } from "@wardic/solid"
import { createSignal, onMount, Show } from "solid-js"

// The banner names a variant; its photo and lines follow, one after another. Nothing here asks for
// the server: Wardic writes this entrance into the page's CSS, so it plays from the first paint.
const banner = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
}

const photo = {
  hidden: { opacity: 0, scale: 1.12 },
  shown: { opacity: 1, scale: 1, transition: { duration: 1.6, ease: "easeOut" } },
} as const

const line = {
  hidden: { opacity: 0, y: 18 },
  shown: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 140, damping: 20 } },
} as const

const vase = photoOf("lagoon-vase")

/** When the JavaScript took over, in ms from the page's start: once, so a replay keeps it. */
let tookOver: number | undefined

/** What the server says is coming, before the JavaScript arrives. */
const waiting = (hydration: Hydration): string => {
  if (hydration.kind === "off") return "No JavaScript on this page: what moved is the server's HTML and CSS alone."
  if (hydration.kind === "late") return `Waiting for the JavaScript, held back ${hydration.ms / 1000} s…`
  return "Waiting for the JavaScript…"
}

/** What the JavaScript is doing: the server says what's coming, the browser when it arrived. */
function HydrationStatus() {
  const location = useLocation()
  const [at, setAt] = createSignal(tookOver)
  onMount(() => {
    tookOver ??= Math.round(performance.now())
    setAt(tookOver)
  })
  return (
    <p class="hydration-status" role="status">
      <Show when={at()} fallback={waiting(hydrationOf(new URLSearchParams(location.search).get("hydrate")))}>
        {(ms) => <>The JavaScript took over at {ms()} ms; the banner had been moving since the first paint.</>}
      </Show>
    </p>
  )
}

export default function BeforeHydration() {
  return (
    <>
      <wardic.section class="season" variants={banner} initial="hidden" animate="shown">
        <div class="season-photo">
          <wardic.img variants={photo} src={vase.large} srcset={srcsetOf(vase)} sizes="(max-width: 640px) 100vw, 480px" width={vase.width} height={vase.height} alt="The Lagoon Vase" />
        </div>
        <div class="season-copy">
          <wardic.p class="eyebrow" variants={line}>
            New this season
          </wardic.p>
          <wardic.h2 variants={line}>Glazes that ran in the kiln</wardic.h2>
          <wardic.p variants={line}>Two glazes poured over each other, left to find their own way in the heat. No two came out alike.</wardic.p>
          <wardic.a class="button accent" href="/entrances/product-grid" variants={line} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}>
            See the pieces
          </wardic.a>
        </div>
      </wardic.section>
      <div class="hydration">
        <HydrationStatus />
        {/* Full page loads, not the router's: `rel="external"`. */}
        <nav class="hydration-links" aria-label="Load this page again">
          <a class="button quiet" rel="external" href="/server/before-hydration?hydrate=2000">
            Hydrate 2 s late
          </a>
          <a class="button quiet" rel="external" href="/server/before-hydration?hydrate=off">
            Don't hydrate
          </a>
          <a class="button quiet" rel="external" href="/server/before-hydration">
            Hydrate at once
          </a>
        </nav>
      </div>
    </>
  )
}
