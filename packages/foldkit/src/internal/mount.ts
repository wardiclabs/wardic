/**
 * The fused Mount (ADR-0071, decisions 18 and 31): the seam that differs on Foldkit's preview. A `w.*`
 * element runs one Mount: Wardic's part, which gets the Handle's Provider (built by the first element
 * to mount, *Amendment (#791)*) and mounts the element on it, merged with the user's own `OnMount` when
 * there is one. With a
 * user Mount, the fused one is `{ ...userAction, f }`, so it keeps the user's name and args, and a Scene
 * test resolves the user's Mount as it would; without one, it's named `Wardic.Provider` or
 * `Wardic.Element`, what a Scene test resolves by (#791, Q15; decision 36).
 *
 * @module
 */
import * as Report from "@wardic/dom/Report"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import type { MountAction, ViewState } from "foldkit/mount"
import type * as Ward from "../Ward.ts"
import { patchTouched } from "./delivery.ts"
import { mountElement } from "./element.ts"
import { joined, providerFor, type State } from "./services.ts"

/** The names a Scene test resolves Wardic's Mounts by (decision 36). */
export const PROVIDER_NAME = "Wardic.Provider"
export const ELEMENT_NAME = "Wardic.Element"

/** A Mount's `f`: what runs on the element. */
type MountFn<Message> = MountAction<Message>["f"]

/** What a Mount's setup failing is reported as: contained at the binding's edge (decision 13), the element left at its Starting style. */
const FAILED = "wardic.mount: a w.* element's mount failed; it stays at its Starting style"

/**
 * Wardic's part of a `w.*` element's Mount: gets the Handle's Provider, building it when it's the first
 * element to mount, and takes the root when the element carries `w.Provider(options)`; mounts the
 * element on it; follows the view's state for DevTools replay (decision 34); and holds its Scope until
 * the Mount's destroy, which runs the release before Foldkit removes the element. It never fails: a failure is reported, and the Stream
 * stays open (decision 13). Emits no Message in slice 1's PR 1; PR 2's callbacks come through here.
 */
const wardicPart =
  <Message>(state: State, provider: Ward.ProviderOptions | undefined): MountFn<Message> =>
  (element, viewStateChanges) =>
    Stream.callback<Message>((queue) =>
      Effect.gen(function* () {
        // The element's callbacks (PR 2) leave as Messages through its own Stream (P7).
        const offer = (message: unknown): void => {
          Queue.offerUnsafe(queue, message as Message)
        }
        let paused = false
        yield* Effect.forkScoped(Stream.runForEach(viewStateChanges, (view: ViewState) => Effect.sync(() => {
          paused = view === "Paused"
        })))
        const on = yield* providerFor(state, element, provider)
        const left = joined(state, on, element)
        const release = mountElement(on, element as HTMLElement, () => paused, offer, state.rootConfig)
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            release()
            left()
          }),
        )
        patchTouched()
        return yield* Effect.never
      }).pipe(Effect.catchDefect((defect) => Effect.andThen(Report.failure(FAILED, Cause.die(defect)), Effect.never))),
    )

/** What a `w.*` element's Mount is made of. */
export interface Parts<Message> {
  /** `w.Provider()`'s options, when the element carries it. */
  readonly provider: Ward.ProviderOptions | undefined
  /** The user's own `OnMount`, when the element has one. */
  readonly user: MountAction<Message> | undefined
}

/** A `w.*` element's one Mount (above). */
export const mountOf = <Message>(state: State, parts: Parts<Message>): MountAction<Message> => {
  const wardic = wardicPart<Message>(state, parts.provider)
  const user = parts.user
  if (Predicate.isUndefined(user)) {
    if (Predicate.isNotUndefined(parts.provider)) return { name: PROVIDER_NAME, f: wardic }
    return { name: ELEMENT_NAME, f: wardic }
  }
  // Wardic's part first, so it starts before the user's (decision 31).
  return { ...user, f: (element, viewStateChanges) => Stream.merge(wardic(element, viewStateChanges), user.f(element, viewStateChanges)) }
}
