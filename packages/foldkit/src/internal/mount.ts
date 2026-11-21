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
import * as Arr from "effect/Array"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import type * as Scheduler from "effect/Scheduler"
import * as Stream from "effect/Stream"
import type { MountAction } from "foldkit/mount"
import type * as Ward from "../Ward.ts"
import { patchTouched } from "./delivery.ts"
import { mountElement } from "./element.ts"
import { mountPresence } from "./presence.ts"
import { mountReorderGroup } from "./reorder.ts"
import { flushPresences, joined, providerFor, type State } from "./services.ts"
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

/** What a Mount whose setup failed runs: a Stream that stays open, sending nothing. */
const OPEN: Stream.Stream<never> = Stream.never

/** A Mount's Messages: what its callbacks offer, and the pull its Stream takes them by. */
interface Mailbox<Message> {
  readonly offer: (message: unknown) => void
  readonly pull: Effect.Effect<Arr.NonEmptyReadonlyArray<Message>>
}

/**
 * A Mount's Messages, held until its Stream pulls them (#849, E4). The buffer is made at the element's
 * first Message, so an element that sends none, as most don't, holds only its pull, which waits on a
 * callback as `Effect.never` does. A Message offered while the pull waits wakes it a scheduler task
 * later, as `Queue`'s offer does, so the Messages of one task leave together.
 */
const mailbox = <Message>(): Mailbox<Message> => {
  let messages: Array<Message> | undefined
  let resume: ((effect: Effect.Effect<void>) => void) | undefined
  let scheduler: Scheduler.Scheduler | undefined
  let dispatcher: Scheduler.SchedulerDispatcher | undefined
  let waking = false
  const wake = (): void => {
    waking = false
    const waiting = resume
    resume = undefined
    if (Predicate.isNotUndefined(waiting)) waiting(Effect.void)
  }
  const offer = (message: unknown): void => {
    if (Predicate.isUndefined(messages)) messages = []
    messages.push(message as Message)
    if (Predicate.isUndefined(resume) || Predicate.isUndefined(scheduler) || waking) return
    waking = true
    // The fiber's own dispatcher is what `Queue` wakes through; made here, at the first wake.
    if (Predicate.isUndefined(dispatcher)) dispatcher = scheduler.makeDispatcher()
    dispatcher.scheduleTask(wake, 0)
  }
  const wait = Effect.callback<void>(function (this: Scheduler.Scheduler, waiting) {
    scheduler = this
    resume = waiting
  })
  const take = (): Effect.Effect<Arr.NonEmptyReadonlyArray<Message>> => {
    const taken = messages
    messages = undefined
    if (Predicate.isUndefined(taken) || !Arr.isArrayNonEmpty(taken)) return waitThenTake
    return Effect.succeed(taken)
  }
  const pull = Effect.suspend(take)
  const waitThenTake = Effect.flatMap(wait, () => pull)
  return { offer, pull }
}

/**
 * Wardic's part of a `w.*` element's Mount: gets the Handle's Provider, building it when it's the first
 * element to mount, and takes the root when the element carries `w.Provider(options)`; has the provider
 * follow the view's state for DevTools replay (decision 34), the first Mount's stream serving every
 * element's; mounts the element on it; and holds its Scope until
 * the Mount's destroy, which runs the release before Foldkit removes the element. It never fails: a failure is reported, and the Stream
 * stays open (decision 13). Emits no Message in slice 1's PR 1; PR 2's callbacks come through here.
 *
 * The setup runs as the Stream starts, on the Mount's own fiber, and returns the Stream of its Messages
 * (#849, Q3): no fiber of its own waiting on `Effect.never`, as `Stream.callback`'s was, and the
 * release a finalizer of the Stream's Scope, which Foldkit's interrupt closes.
 */
const wardicPart =
  <Message>(state: State, provider: Ward.ProviderOptions | undefined): MountFn<Message> =>
  (element, viewStateChanges) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // The element's callbacks (PR 2) leave as Messages through its own Stream (P7).
        const box = mailbox<Message>()
        const offer = box.offer
        const on = yield* providerFor(state, element, provider)
        // The view state is the program's (decision 34): the provider follows it once, for every element (#849, Q2).
        yield* on.followViewState(viewStateChanges)
        const left = joined(state, on, element)
        const isPaused = on.paused
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
            left()
          }),
        )
        patchTouched()
        return Stream.fromPull(Effect.succeed(box.pull))
      }).pipe(Effect.catchDefect((defect) => Effect.as(Report.failure(FAILED, Cause.die(defect)), OPEN))),
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
