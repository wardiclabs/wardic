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
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import type { MountAction, ViewState } from "foldkit/mount"
import type * as Ward from "../Ward.ts"
import { patchTouched } from "./delivery.ts"
import { mountElement } from "./element.ts"
import { mountPresence } from "./presence.ts"
import { mountReorderGroup } from "./reorder.ts"
import { flushPresences, joined, type Provider, providerFor, type State } from "./services.ts"
import { markMounted } from "./tree.ts"

/** The names a Scene test resolves Wardic's Mounts by (decision 36). */
export const PROVIDER_NAME = "Wardic.Provider"
export const ELEMENT_NAME = "Wardic.Element"
export const PRESENCE_NAME = "Wardic.Presence"
export const REORDER_NAME = "Wardic.Reorder"

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
        // The element among the provider's paused views (decision 34), once the provider is known.
        const counted = MutableRef.make(Option.none<Provider>())
        const count = (): void => {
          Option.map(MutableRef.get(counted), (on) => Bool.match(paused, { onTrue: () => on.pausedViews.add(element), onFalse: () => on.pausedViews.delete(element) }))
        }
        yield* Effect.forkScoped(Stream.runForEach(viewStateChanges, (view: ViewState) => Effect.sync(() => {
          paused = view === "Paused"
          count()
        })))
        const on = yield* providerFor(state, element, provider)
        MutableRef.set(counted, Option.some(on))
        count()
        const left = joined(state, on, element)
        const isPaused = (): boolean => paused
        // The live presences deliver before this element registers anything (#840): Foldkit runs a Mount
        // in the patch's task, once the patch has committed and before the observers are told, and a
        // presence this element carries starts its children at its own mount, a `layoutId` twin among
        // them, which measures the one it takes over from where it is then: in a `popLayout` leaver an
        // outer presence hasn't pinned yet. Delivered before this element's key is registered, a key
        // re-entering during its exit is matched at the delivery its enrollment brings, a microtask on.
        flushPresences(state)
        const release = mountElement(on, state, element as HTMLElement, isPaused, offer, state.rootConfig)
        markMounted(element)
        // Its presence, when it carries `w.Presence` (decision 29): its children's exits, run by this Mount.
        const releasePresence = mountPresence(on, state, element, isPaused, offer)
        // Its Reorder group, when it carries `w.ReorderGroup` (decision 28): made by its first item's Mount or here, released here.
        const releaseReorder = mountReorderGroup(on, element as HTMLElement, isPaused, offer)
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            releaseReorder()
            releasePresence()
            release()
            on.pausedViews.delete(element)
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
  /** Whether the element carries `w.Presence` (decision 29): its Mount is then named `Wardic.Presence` (#792, Q19). */
  readonly presence: boolean
  /** Whether the element carries `w.ReorderGroup` (decision 28): its Mount is then named `Wardic.Reorder` (#793, Q18). */
  readonly reorder: boolean
}

/** A `w.*` element's one Mount (above). */
export const mountOf = <Message>(state: State, parts: Parts<Message>): MountAction<Message> => {
  const wardic = wardicPart<Message>(state, parts.provider)
  const user = parts.user
  if (Predicate.isUndefined(user)) {
    if (Predicate.isNotUndefined(parts.provider)) return { name: PROVIDER_NAME, f: wardic }
    if (parts.presence) return { name: PRESENCE_NAME, f: wardic }
    if (parts.reorder) return { name: REORDER_NAME, f: wardic }
    return { name: ELEMENT_NAME, f: wardic }
  }
  // Wardic's part first, so it starts before the user's (decision 31).
  return { ...user, f: (element, viewStateChanges) => Stream.merge(wardic(element, viewStateChanges), user.f(element, viewStateChanges)) }
}
