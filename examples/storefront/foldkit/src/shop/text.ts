/** The text a visitor reads for a shop failure: the store's own words, or that it didn't answer; and a Command's shape over a call. */
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import { messageOf } from "@wardic/example-storefront-shared/server"
import type { Shop, ShopError } from "~/shop.ts"

export const textOf = (error: ShopError): string => {
  if (Predicate.isTagged(error, "StoreUnreachable")) return `The store didn't answer: ${error.reason}`
  return messageOf(error)
}

/** A Command's Effect over a shop `call`: its answer as a Message, or its failure as one with the text a visitor reads. */
export const asked = <A, Answered, Failed>(call: Effect.Effect<A, ShopError, Shop>, answered: (value: A) => Answered, failed: (reason: string) => Failed): Effect.Effect<Answered | Failed, never, Shop> =>
  call.pipe(
    Effect.map(answered),
    Effect.catch((error) => Effect.succeed(failed(textOf(error)))),
  )
