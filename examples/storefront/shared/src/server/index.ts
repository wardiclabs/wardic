/**
 * The store's edge (#296): what each app's `"use server"` functions call. One `ManagedRuntime` per
 * server process over the store's services; `runFor` provides the calling visitor, runs a call, and
 * turns a typed failure into a plain `Error` with a message a person can read, since a framework's
 * server functions send what they reject with to the client as a thrown error.
 */
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Match from "effect/Match"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Predicate from "effect/Predicate"
import { type Store, StoreLive, type StoreError, Visitor, type VisitorInfo } from "./store.ts"

export * from "./model.ts"
export {
  addToCart,
  getCart,
  getProduct,
  getSettings,
  InvalidArguments,
  listProducts,
  setCartQuantity,
  setSettings,
  SimulatedFailure,
  UnknownProduct,
  visitorFromId,
  type VisitorInfo,
} from "./store.ts"

/** The store, built once per server process, shared by every visitor of it. */
const runtime = ManagedRuntime.make(StoreLive)

/** What a visitor reads when a call fails. */
const messageOf: (error: StoreError) => string = Match.type<StoreError>().pipe(
  Match.tag("SimulatedFailure", () => "The store didn't answer: you asked the next request to fail."),
  Match.tag("UnknownProduct", (error) => `There's no product "${error.id}".`),
  Match.tag("InvalidArguments", (error) => `That request wasn't valid: ${error.reason}`),
  Match.exhaustive,
)

/** Whether a squashed cause is one of the store's typed failures. */
const isStoreError = (u: unknown): u is StoreError => Predicate.hasProperty(u, "_tag")

/** Run a store call for `visitor`: its value, or a rejection with a readable message. */
export const runFor = <A>(visitor: VisitorInfo, call: Effect.Effect<A, StoreError, Store | Visitor>): Promise<A> =>
  runtime.runPromiseExit(Effect.provideService(call, Visitor, visitor)).then(
    Exit.match({
      onSuccess: (value) => value,
      onFailure: (cause) => {
        const error = Cause.squash(cause)
        if (isStoreError(error)) throw new Error(messageOf(error))
        throw new Error("Something went wrong in the store.")
      },
    }),
  )
