import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { photoOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { ward, wardic } from "@wardic/solid/unstable/v2"
import { createMemo, createSignal, For, isPending, Loading } from "solid-js"
import { stock } from "~/lib/store.ts"

/** When the stock is counted: now, or after the next delivery. */
type When = "now" | "delivery"

/** A shelf holds eight of a piece: a full meter. */
const SHELF = 8

const PIECES = PRODUCTS.filter((product) => ["blossom-jar", "bottle-vase", "tulip-bowl", "lagoon-vase"].includes(product.id))

const FILL = { type: "spring", stiffness: 140, damping: 22 } as const

export default function Stock() {
  const [when, setWhen] = createSignal<When>("now")
  // Each piece's count, from the store: an async memo, so what reads it waits for it. Under
  // `<Loading>` the meters wait as a skeleton for the first count; a later one keeps the bars where
  // they are until it lands.
  const levels = createMemo(() => stock(when()))
  return (
    <div class="stock">
      <div class="stock-head">
        <div class="segmented" role="group" aria-label="When">
          <button aria-pressed={String(when() === "now") as "true" | "false"} onClick={() => setWhen("now")}>
            Now
          </button>
          <button aria-pressed={String(when() === "delivery") as "true" | "false"} onClick={() => setWhen("delivery")}>
            After the delivery
          </button>
        </div>
      </div>
      <Loading fallback={<Skeleton />}>
        <p class="stock-status muted" aria-live="polite">
          {isPending(() => levels()) ? "Checking the store…" : "The store's count"}
        </p>
        <ul class="stock-list">
          <For each={PIECES}>{(piece) => <StockRow piece={piece} left={() => levels()[piece.id] ?? 0} />}</For>
        </ul>
      </Loading>
    </div>
  )
}

function StockRow(props: { readonly piece: Product; readonly left: () => number }) {
  // The bar's ward only listens: its own props fill it.
  const bar = ward()
  // While its animation runs, its last landing is pending: "filling…", then the count once it lands.
  const label = () => (isPending(() => bar.settled()) ? "filling…" : `✓ ${props.left()} left`)
  return (
    <li class="stock-row">
      <img src={photoOf(props.piece.id).small} width="48" height="48" alt="" />
      <span class="name">{props.piece.name}</span>
      <span class="meter">
        <wardic.span class="meter-fill" wardRef={bar} initial={{ scaleX: 0 }} animate={{ scaleX: props.left() / SHELF }} transition={FILL} />
      </span>
      <span class="stock-label">{label()}</span>
    </li>
  )
}

function Skeleton() {
  return (
    <ul class="stock-list" aria-busy="true">
      <For each={PIECES}>
        {() => (
          <li class="stock-row">
            <span class="skeleton stock-skeleton-photo" />
            <span class="skeleton stock-skeleton-line" />
          </li>
        )}
      </For>
    </ul>
  )
}
