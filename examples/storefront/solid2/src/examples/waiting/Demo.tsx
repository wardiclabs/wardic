/**
 * A piece's page that waits for the store (#479), on Solid 2 only: the catalogue's two routes under
 * one layout, the piece's details an async memo over the store. The routes:
 * `routes/transitions/waiting.tsx` renders `Waiting` around its outlet, `waiting/index.tsx` the
 * `WaitingList`, and `waiting/[id].tsx` a `WaitingPiece`.
 */
import { useIsRouting, useParams } from "@solidjs/router"
import type { JSX } from "@solidjs/web"
import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, w } from "@wardic/solid/unstable/v2"
import { type Accessor, createContext, createMemo, createSignal, For, Loading, Show, useContext } from "solid-js"
import { getProduct } from "~/server/store.ts"

const PIECES = PRODUCTS.slice(0, 6)
const HOME = "/transitions/waiting"

const pieceOf = (id: string | undefined): Product | undefined => PIECES.find((piece) => piece.id === id)

/** How a piece's page waits for its details: a skeleton at once, or the catalogue kept until they land. */
type Wait = "skeleton" | "hold"

/** The switch's choice, from the layout to the piece's page. */
const WaitContext = createContext<Accessor<Wait>>()

// Each page fades in and out; what the two share flies on top of that.
const page = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { type: "tween", duration: 0.25 },
} as const

/** The layout: the switch, what the router says while a page is held, and a presence around the outlet. */
export default function Waiting(props: { readonly children?: JSX.Element }) {
  const [wait, setWait] = createSignal<Wait>("skeleton")
  // True while a navigation waits for what its page reads.
  const routing = useIsRouting()
  return (
    <WaitContext value={wait}>
      <div class="waiting-bar">
        <div class="segmented" role="group" aria-label="While the details load">
          <button aria-pressed={String(wait() === "skeleton") as "true" | "false"} onClick={() => setWait("skeleton")}>
            Show a skeleton
          </button>
          <button aria-pressed={String(wait() === "hold") as "true" | "false"} onClick={() => setWait("hold")}>
            Keep the catalogue
          </button>
        </div>
        <span class="waiting-status muted" aria-live="polite">
          <Show when={routing()}>Opening…</Show>
        </span>
      </div>
      <div class="catalogue">
        <AnimatePresence mode="popLayout">{props.children}</AnimatePresence>
      </div>
    </WaitContext>
  )
}

function Photo(props: { readonly piece: Product; readonly sizes: string }) {
  // The piece may be `<Show>`'s, so its photo is read where it's followed (#460).
  const photo = createMemo(() => photoOf(props.piece.id))
  return (
    // The card's photo and the piece's hero: one `layoutId`, so it flies from one page to the other.
    <w.div class="photo" layoutId={`waiting-${props.piece.id}`}>
      <img src={photo().small} srcset={srcsetOf(photo())} sizes={props.sizes} width={photo().width} height={photo().height} alt={props.piece.name} />
    </w.div>
  )
}

/** The catalogue: `/transitions/waiting`. Its names and photos are the page's own; the store isn't asked. */
export function WaitingList() {
  return (
    <w.ul class="catalogue-list" {...page}>
      <For each={PIECES}>
        {(piece) => (
          <li>
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
    </w.ul>
  )
}

/** A piece's page: `/transitions/waiting/:id`. */
export function WaitingPiece() {
  const params = useParams()
  return (
    <w.article class="catalogue-piece" {...page}>
      <nav class="catalogue-nav">
        <a href={HOME} noscroll>
          ← The catalogue
        </a>
      </nav>
      <Show when={pieceOf(params.id)} fallback={<p class="muted">That piece isn't in the catalogue.</p>}>
        {(piece) => <PieceBody piece={piece()} />}
      </Show>
    </w.article>
  )
}

function PieceBody(props: { readonly piece: Product }) {
  const wait = useContext(WaitContext)
  // The store's answer: an async memo, so whatever reads it waits for it. From the server function
  // itself: the router's `query` would answer a piece opened again within a few seconds from its cache.
  const details = createMemo(() => getProduct(props.piece.id))
  return (
    <div class="catalogue-hero">
      {/* Outside any `Loading`: the photo mounts with the page, so it has the card to fly from. */}
      <Photo piece={props.piece} sizes="(max-width: 640px) 100vw, 320px" />
      <div class="catalogue-text">
        <h2>{props.piece.name}</h2>
        {/* A `Loading` new to this page shows its skeleton rather than hold the navigation. Without
            one, the details are read under the app's, and the router's transition waits for them. */}
        <Show when={wait() === "skeleton"} fallback={<Details details={details()} />}>
          <Loading fallback={<DetailsSkeleton />}>
            <Details details={details()} />
          </Loading>
        </Show>
      </div>
    </div>
  )
}

function Details(props: { readonly details: Product }) {
  return (
    <>
      <p class="price">{formatPrice(props.details.price)}</p>
      <p>{props.details.description}</p>
      <ul class="details">
        <For each={props.details.details}>{(detail) => <li>{detail}</li>}</For>
      </ul>
    </>
  )
}

function DetailsSkeleton() {
  return (
    <div class="waiting-skeleton" aria-busy="true">
      <span class="skeleton" />
      <span class="skeleton" />
      <span class="skeleton" />
      <span class="skeleton" />
    </div>
  )
}
