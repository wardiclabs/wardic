/**
 * Pieces on their way to the cart (Saved for later): each moved piece's photo has a twin in the
 * header's cart button, sharing its `layoutId`, so Wardic flies it there from the row it left. Written
 * only by a click, so a server's render never has one.
 */
import type { Feature } from "@wardic/solid"
import { createSignal } from "solid-js"

/** A piece arriving at the cart: its photo. */
export interface Arrival {
  readonly id: string
  readonly src: string
}

const [arriving, setArriving] = createSignal<ReadonlyArray<Arrival>>([])

/** The pieces on their way to the cart's icon. */
export const arrivals = arriving

const [carried, setCarried] = createSignal<Feature>()

/**
 * The `layout` Feature the cart button's fly-in section brings (#526), from the page that moved the
 * first piece: the shell ships none, so a page that never flies a photo never loads the projection
 * engine. It comes with that first arrival, so the section has it as it first renders: a Feature
 * takes effect from its arrival on, and a flight begun before it would jump.
 */
export const flightLayout = carried

/**
 * A piece moved to the cart from a page that lays out, with that page's `layout`: its twin appears in
 * the cart button, in the same update as its row leaves.
 */
export const arrive = (piece: Arrival, layout: Feature): void => {
  setCarried(layout)
  setArriving((now) => [...now.filter((one) => one.id !== piece.id), piece])
}

/** A piece landed in the cart's icon: its twin goes. */
export const landed = (id: string): void => void setArriving((now) => now.filter((one) => one.id !== id))

/**
 * A piece the store refused: its twin goes from the cart button as its row comes back, and the row's
 * photo flies back from it.
 */
export const recall = landed

/** The `layoutId` a saved piece's photo shares with its twin in the cart button. */
export const arrivalId = (id: string): string => `saved-${id}`
