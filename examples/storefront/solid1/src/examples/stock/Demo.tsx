import { createAsync } from "@solidjs/router"
import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { photoOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { w } from "~/lib/wardic.ts"
import { createSignal, For, Suspense, useTransition } from "solid-js"
import { stock } from "~/lib/store.ts"

/** When the stock is counted: now, or after the next delivery. */
type When = "now" | "delivery"

/** A shelf holds eight of a piece: a full meter. */
const SHELF = 8

const PIECES = PRODUCTS.filter((product) => ["blossom-jar", "bottle-vase", "tulip-bowl", "lagoon-vase"].includes(product.id))

const FILL = { type: "spring", stiffness: 140, damping: 22 } as const

export default function Stock() {
  const [when, setWhen] = createSignal<When>("now")
  // A switch in a transition: `<Suspense>` keeps the bars while the next count loads.
  const [checking, start] = useTransition()
  // Each piece's count, from the store. Under `<Suspense>` the meters wait as a skeleton for the first.
  const levels = createAsync(() => stock(when()))
  const choose = (next: When) => start(() => setWhen(next))
  return (
    <div class="stock">
      <div class="stock-head">
        <div class="segmented" role="group" aria-label="When">
          <button aria-pressed={when() === "now"} onClick={() => choose("now")}>
            Now
          </button>
          <button aria-pressed={when() === "delivery"} onClick={() => choose("delivery")}>
            After the delivery
          </button>
        </div>
      </div>
      <Suspense fallback={<Skeleton />}>
        <p class="stock-status muted" aria-live="polite">
          {checking() ? "Checking the store…" : "The store's count"}
        </p>
        <ul class="stock-list">
          <For each={PIECES}>{(piece) => <StockRow piece={piece} left={() => levels()?.[piece.id] ?? 0} />}</For>
        </ul>
      </Suspense>
    </div>
  )
}

function StockRow(props: { readonly piece: Product; readonly left: () => number }) {
  // Solid 1 hears the bar's animation through its callbacks: one starts, one lands.
  const [filling, setFilling] = createSignal(true)
  const label = () => (filling() ? "filling…" : `✓ ${props.left()} left`)
  return (
    <li class="stock-row">
      <img src={photoOf(props.piece.id).small} width="48" height="48" alt="" />
      <span class="name">{props.piece.name}</span>
      <span class="meter">
        <w.span
          class="meter-fill"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: props.left() / SHELF }}
          transition={FILL}
          onAnimationStart={() => setFilling(true)}
          onAnimationComplete={() => setFilling(false)}
        />
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
