/**
 * The catalogue and a piece's page, two routes under one layout (#479). The routes:
 * `routes/transitions/catalogue.tsx` renders `Catalogue` around its outlet, `catalogue/index.tsx`
 * the `CatalogueList`, and `catalogue/[id].tsx` a `CataloguePiece`.
 */
import { revalidate, useParams } from "@solidjs/router"
import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import type { JSX } from "@solidjs/web"
import { AnimatePresence, arc, LazyWardic, w } from "@wardic/solid/unstable/v2"
import { action, createSignal, For, Match, onSettled, Show, Switch } from "solid-js"
import { cart } from "~/lib/store.ts"
import { addToCart } from "~/server/store.ts"
import { layout } from "~/lib/layout-feature.ts"

const PIECES = PRODUCTS.slice(0, 6)
const HOME = "/transitions/catalogue"

const pieceOf = (id: string | undefined): Product | undefined => PIECES.find((piece) => piece.id === id)
const nextOf = (piece: Product): Product => PIECES[(PIECES.indexOf(piece) + 1) % PIECES.length] as Product

// Each page fades in and out; what the two share flies on top of that.
const page = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { type: "tween", duration: 0.25 },
} as const

// Another piece on the same page slides on, the last one off the other way.
const slide = {
  initial: { opacity: 0, x: 32 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -32 },
} as const

/**
 * The layout: a presence around the router's outlet. A navigation hands the outlet the next page's
 * nodes, so the page that was there leaves on its own; `popLayout` takes it out of the flow where it
 * was, so the next one is in place at once and a shared `layoutId` flies between them.
 */
/** The demo, with this page's `layout` beside the shell's Features (#526): a page that doesn't lay out ships none. */
export default function Catalogue(props: { readonly children?: JSX.Element }) {
  return (
    <LazyWardic features={[layout]}>
      <CatalogueDemo {...props} />
    </LazyWardic>
  )
}

function CatalogueDemo(props: { readonly children?: JSX.Element }) {
  return (
    <div class="catalogue">
      <AnimatePresence mode="popLayout">{props.children}</AnimatePresence>
    </div>
  )
}

// The photo's flight bows a little (#438): Motion's default layout tween, along an arc.
const FLIGHT = { layout: { type: "tween", duration: 0.45, ease: [0.4, 0, 0.1, 1], path: arc({ strength: 0.25 }) } } as const

function Photo(props: { readonly piece: Product; readonly sizes: string }) {
  const photo = photoOf(props.piece.id)
  return (
    // The card's photo and the piece's hero: one `layoutId`, so it flies from one page to the other.
    <w.div class="photo" layoutId={`catalogue-${props.piece.id}`} transition={FLIGHT}>
      <img src={photo.small} srcset={srcsetOf(photo)} sizes={props.sizes} width={photo.width} height={photo.height} alt={props.piece.name} />
    </w.div>
  )
}

/** What a card's "Add" says: its piece going into the cart, then whether it went. */
type Adding = "idle" | "adding" | "added" | "failed"

/**
 * A card's "Add" (#439): its press is its own (`propagate={{ tap: false }}`), so the card around it
 * doesn't squeeze as it's pressed. It sits beside the card's link, not in it, so a click on it opens
 * nothing: `propagate` keeps a press from the card's, not a click from the link's.
 */
function AddButton(props: { readonly piece: Product }) {
  const [state, setState] = createSignal<Adding>("idle")
  let reset: ReturnType<typeof setTimeout> | undefined
  onSettled(() => () => clearTimeout(reset))
  const settle = (ended: Adding) => {
    setState(ended)
    clearTimeout(reset)
    reset = setTimeout(() => setState("idle"), 2000)
  }
  const buy = action(function* (id: string) {
    setState("adding")
    try {
      yield addToCart(id, 1)
      // The cart has changed: the header's count reads it again.
      revalidate(cart.key)
      settle("added")
    } catch {
      settle("failed")
    }
  })
  return (
    <w.button
      class="button catalogue-add"
      aria-label={`Add ${props.piece.name} to the cart`}
      disabled={state() === "adding"}
      whileTap={{ scale: 0.9 }}
      propagate={{ tap: false }}
      onClick={() => buy(props.piece.id)}
    >
      <Switch fallback="Add">
        <Match when={state() === "adding"}>Adding…</Match>
        <Match when={state() === "added"}>Added ✓</Match>
        <Match when={state() === "failed"}>Not added</Match>
      </Switch>
    </w.button>
  )
}

/** The catalogue: `/transitions/catalogue`. */
export function CatalogueList() {
  return (
    <w.ul class="catalogue-list" {...page}>
      <For each={PIECES}>
        {(piece) => (
          // The card squeezes a little as it's pressed, though not as its "Add" is.
          <w.li class="catalogue-item" whileTap={{ scale: 0.97 }}>
            {/* noscroll: the demo sits partway down the page, so the router leaves its scroll be. */}
            <a class="catalogue-card" href={`${HOME}/${piece.id}`} noscroll>
              <Photo piece={piece} sizes="160px" />
              <span class="line">
                <span class="name">{piece.name}</span>
                <span class="price">{formatPrice(piece.price)}</span>
              </span>
            </a>
            <AddButton piece={piece} />
          </w.li>
        )}
      </For>
    </w.ul>
  )
}

/** A piece's page: `/transitions/catalogue/:id`. */
export function CataloguePiece() {
  const params = useParams()
  return (
    <w.article class="catalogue-piece" {...page}>
      <Show when={pieceOf(params.id)} fallback={<p class="muted">That piece isn't in the catalogue.</p>}>
        {(piece) => (
          <nav class="catalogue-nav">
            <a href={HOME} noscroll>
              ← The catalogue
            </a>
            <a href={`${HOME}/${nextOf(piece()).id}`} noscroll>
              Next piece →
            </a>
          </nav>
        )}
      </Show>
      {/* Another id keeps this route, and so this page's nodes: its content, keyed on the id, leaves
          and enters in a presence of its own. Not on the page's first render, where the photo flies. */}
      <AnimatePresence mode="popLayout" initial={false}>
        <Show when={pieceOf(params.id)} keyed>
          {(piece) => (
            <w.div class="catalogue-hero" {...slide}>
              <Photo piece={piece} sizes="(max-width: 640px) 100vw, 320px" />
              <div class="catalogue-text">
                <h2>{piece.name}</h2>
                <p class="price">{formatPrice(piece.price)}</p>
                <p>{piece.description}</p>
                <ul class="details">
                  <For each={piece.details}>{(detail) => <li>{detail}</li>}</For>
                </ul>
              </div>
            </w.div>
          )}
        </Show>
      </AnimatePresence>
    </w.article>
  )
}
