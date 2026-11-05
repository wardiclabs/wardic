/**
 * Pieces on their way to the cart (Saved for later): each moved piece's photo has a twin in the
 * header's cart button, sharing its `layoutId`, so Wardic flies it there from the row it left. Written
 * only by a click, so a server's render never has one. Each shell has its own (#618, S4): one request's
 * render can never read another's, as module-level signals could.
 */
import type { JSX } from "@solidjs/web"
import type { Feature } from "@wardic/solid/unstable/v2"
import { type Accessor, createContext, createSignal, useContext } from "solid-js"

/** A piece arriving at the cart: its photo. */
export interface Arrival {
  readonly id: string
  readonly src: string
}

/** What's on its way to the cart, and what moves it. */
export interface Arrivals {
  /** The pieces on their way to the cart's icon. */
  readonly arrivals: Accessor<ReadonlyArray<Arrival>>
  /**
   * The `layout` Feature the cart button's fly-in section brings (#526), from the page that moved the
   * first piece: the shell ships none, so a page that never flies a photo never loads the projection
   * engine. It comes with that first arrival, so the section has it as it first renders: a Feature
   * takes effect from its arrival on, and a flight begun before it would jump.
   */
  readonly flightLayout: Accessor<Feature | undefined>
  /**
   * A piece moved to the cart from a page that lays out, with that page's `layout`: its twin appears in
   * the cart button, in the same update as its row leaves.
   */
  readonly arrive: (piece: Arrival, layout: Feature) => void
  /** A piece landed in the cart's icon: its twin goes. */
  readonly landed: (id: string) => void
  /**
   * A piece the store refused: its twin goes from the cart button as its row comes back, and the row's
   * photo flies back from it.
   */
  readonly recall: (id: string) => void
}

const ArrivalsContext = createContext<Arrivals>()

/** The shell's arrivals, for the cart button and the pages inside it. */
export function ArrivalsProvider(props: { readonly children: JSX.Element }) {
  const [arrivals, setArrivals] = createSignal<ReadonlyArray<Arrival>>([])
  const [flightLayout, setFlightLayout] = createSignal<Feature>()
  const landed = (id: string): void => void setArrivals((now) => now.filter((one) => one.id !== id))
  const value: Arrivals = {
    arrivals,
    flightLayout,
    arrive: (piece, layout) => {
      setFlightLayout(layout)
      setArrivals((now) => [...now.filter((one) => one.id !== piece.id), piece])
    },
    landed,
    recall: landed,
  }
  return <ArrivalsContext value={value}>{props.children}</ArrivalsContext>
}

/** The shell's arrivals. Outside `<ArrivalsProvider>`, Solid throws its `ContextNotFoundError`. */
export const useArrivals = (): Arrivals => useContext(ArrivalsContext)

/** The `layoutId` a saved piece's photo shares with its twin in the cart button. */
export const arrivalId = (id: string): string => `saved-${id}`
