/**
 * Pieces on their way to the cart (Saved for later): each moved piece's photo has a twin in the
 * header's cart button, sharing its `layoutId`, so Wardic flies it there from the row it left. Written
 * only by a click, so a server's render never has one.
 */
import { createSignal } from "solid-js"

/** A piece arriving at the cart: its photo. */
export interface Arrival {
  readonly id: string
  readonly src: string
}

const [arriving, setArriving] = createSignal<ReadonlyArray<Arrival>>([])

/** The pieces on their way to the cart's icon. */
export const arrivals = arriving

/** A piece moved to the cart: its twin appears in the cart button, in the same update as its row leaves. */
export const arrive = (piece: Arrival): void => void setArriving((now) => [...now.filter((one) => one.id !== piece.id), piece])

/** A piece landed in the cart's icon: its twin goes. */
export const landed = (id: string): void => void setArriving((now) => now.filter((one) => one.id !== id))

/**
 * A piece the store refused: its twin goes from the cart button as its row comes back, and the row's
 * photo flies back from it.
 */
export const recall = landed

/** The `layoutId` a saved piece's photo shares with its twin in the cart button. */
export const arrivalId = (id: string): string => `saved-${id}`
