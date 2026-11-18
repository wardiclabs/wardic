/** The text a visitor reads for a shop failure: the store's own words, or that it didn't answer. */
import * as Predicate from "effect/Predicate"
import { messageOf } from "@wardic/example-storefront-shared/server"
import type { ShopError } from "~/shop.ts"

export const textOf = (error: ShopError): string => {
  if (Predicate.isTagged(error, "StoreUnreachable")) return `The store didn't answer: ${error.reason}`
  return messageOf(error)
}
