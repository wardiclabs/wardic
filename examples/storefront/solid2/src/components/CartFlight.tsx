/**
 * The cart's fly-in (#526): a piece moved to the cart from Saved for later flies here, with the `layout`
 * of the page that moved it, handed over at runtime (`arrive(piece, layout)`). So its Features are a
 * section's, not a Wardic instance's (#516): the shell never imports `layout`, the page that moves a
 * piece does, and its elements are the binding's own `w`, which has the Features its section gives.
 */
import { AnimatePresence, arc, LazyWardic, w } from "@wardic/solid/unstable/v2"
import { createEffect, For, Show } from "solid-js"
import { type Arrival, arrivalId, useArrivals } from "~/lib/arrivals.tsx"

/** The fly-in's section, once a page has handed it `layout`, and the pieces on their way. */
export function CartFlight() {
  const { arrivals, flightLayout } = useArrivals()
  return (
    <Show when={flightLayout()}>
      {(layout) => (
        <LazyWardic features={layout()}>
          <AnimatePresence>
            <For each={arrivals()}>{(piece) => <CartArrival piece={piece} />}</For>
          </AnimatePresence>
        </LazyWardic>
      )}
    </Show>
  )
}

// The flight into the cart bows along an arc (#438), one value for every flight, as its side is kept.
const TOSS = arc()

/**
 * A piece moved to the cart from Saved for later: its photo's twin, sharing its row photo's
 * `layoutId`, so Wardic flies it here from the row it left. Landed, it shrinks into the icon. One photo
 * flies, not the row's and this one crossfading (`layoutCrossfade={false}`, #442): the row's is
 * hidden as this one takes over.
 */
function CartArrival(props: { readonly piece: Arrival }) {
  const { landed } = useArrivals()
  // Its ward holds what it hears, its layout (#398): its landing lets it go.
  const flight = w.ward({ layoutId: arrivalId(props.piece.id) })
  createEffect(flight.when("layoutComplete"), () => landed(props.piece.id))
  return (
    <w.img
      class="cart-arrival"
      wardRef={flight}
      layoutCrossfade={false}
      src={props.piece.src}
      alt=""
      transition={{ layout: { type: "tween", duration: 0.6, ease: [0.45, 0, 0.55, 1], path: TOSS } }}
      exit={{ scale: 0.3, opacity: 0, transition: { type: "tween", duration: 0.25 } }}
    />
  )
}
