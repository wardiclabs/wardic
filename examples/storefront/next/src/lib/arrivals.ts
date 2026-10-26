"use client"
/**
 * Pieces on their way to the cart (Saved for later): each moved piece's photo has a twin in the
 * header's cart button, sharing its `layoutId`, so Motion flies it there from the row it left. A
 * small store outside React, as the header and the page are far apart in the tree.
 */
import { useSyncExternalStore } from "react"

/** A piece arriving at the cart: its photo. */
export interface Arrival {
  readonly id: string
  readonly src: string
}

let arriving: ReadonlyArray<Arrival> = []
const listeners = new Set<() => void>()

const set = (next: ReadonlyArray<Arrival>): void => {
  arriving = next
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

const NONE: ReadonlyArray<Arrival> = []

/** The pieces on their way to the cart's icon. */
export const useArrivals = (): ReadonlyArray<Arrival> =>
  useSyncExternalStore(
    subscribe,
    () => arriving,
    () => NONE,
  )

/** A piece moved to the cart: its twin appears in the cart button, in the same render as its row leaves. */
export const arrive = (piece: Arrival): void => set([...arriving.filter((one) => one.id !== piece.id), piece])

/** A piece landed in the cart's icon: its twin goes. */
export const landed = (id: string): void => set(arriving.filter((one) => one.id !== id))

/** A piece the store refused: its twin goes from the cart button as its row comes back, and the row's photo flies back to it. */
export const recall = landed

/** The `layoutId` a saved piece's photo shares with its twin in the cart button. */
export const arrivalId = (id: string): string => `saved-${id}`
