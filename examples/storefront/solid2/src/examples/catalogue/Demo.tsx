/**
 * The catalogue and a piece's page, two routes under one layout (#479). The routes:
 * `routes/transitions/catalogue.tsx` renders `Catalogue` around its outlet, `catalogue/index.tsx`
 * the `CatalogueList`, and `catalogue/[id].tsx` a `CataloguePiece`.
 */
import { useParams } from "@solidjs/router"
import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import type { JSX } from "@solidjs/web"
import { AnimatePresence, wardic } from "@wardic/solid/unstable/v2"
import { For, Show } from "solid-js"

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
export default function Catalogue(props: { readonly children?: JSX.Element }) {
  return (
    <div class="catalogue">
      <AnimatePresence mode="popLayout">{props.children}</AnimatePresence>
    </div>
  )
}

function Photo(props: { readonly piece: Product; readonly sizes: string }) {
  const photo = photoOf(props.piece.id)
  return (
    // The card's photo and the piece's hero: one `layoutId`, so it flies from one page to the other.
    <wardic.div class="photo" layoutId={`catalogue-${props.piece.id}`}>
      <img src={photo.small} srcset={srcsetOf(photo)} sizes={props.sizes} width={photo.width} height={photo.height} alt={props.piece.name} />
    </wardic.div>
  )
}

/** The catalogue: `/transitions/catalogue`. */
export function CatalogueList() {
  return (
    <wardic.ul class="catalogue-list" {...page}>
      <For each={PIECES}>
        {(piece) => (
          <li>
            {/* noscroll: the demo sits partway down the page, so the router leaves its scroll be. */}
            <a class="catalogue-card" href={`${HOME}/${piece.id}`} noscroll>
              <Photo piece={piece} sizes="160px" />
              <span class="line">
                <span class="name">{piece.name}</span>
                <span class="price">{formatPrice(piece.price)}</span>
              </span>
            </a>
          </li>
        )}
      </For>
    </wardic.ul>
  )
}

/** A piece's page: `/transitions/catalogue/:id`. */
export function CataloguePiece() {
  const params = useParams()
  return (
    <wardic.article class="catalogue-piece" {...page}>
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
            <wardic.div class="catalogue-hero" {...slide}>
              <Photo piece={piece} sizes="(max-width: 640px) 100vw, 320px" />
              <div class="catalogue-text">
                <h2>{piece.name}</h2>
                <p class="price">{formatPrice(piece.price)}</p>
                <p>{piece.description}</p>
                <ul class="details">
                  <For each={piece.details}>{(detail) => <li>{detail}</li>}</For>
                </ul>
              </div>
            </wardic.div>
          )}
        </Show>
      </AnimatePresence>
    </wardic.article>
  )
}
