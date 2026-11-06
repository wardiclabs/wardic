/**
 * The Announcer: how an Environment speaks a message to assistive technology, a screen reader, say.
 * Core words what's said, as a Reorder group's announcements, and the Environment delivers it through
 * its platform's own channel, as `@wardic/dom` does. Each announcement replaces the last.
 *
 * @example
 * import * as Announcer from "@wardic/core/Announcer"
 *
 * const announcer = yield* Announcer.Announcer
 * announcer.announce("Picked up Milk, position 2 of 5.")
 */
// An **Announcement** (ADR-0037); `@wardic/dom`'s `DomAnnouncer.layer`. A Context service, as
// `ReducedMotion.PositionalKeys` is: core names the contract and no Environment's syntax (ADR-0036). A
// plain call: an announcement answers a key just pressed, on no frame's path. Tier 2 (ADR-0008): for
// Environment and binding authors.
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"

/** An Environment's channel to assistive technology. */
export class Announcer extends Context.Service<Announcer, {
  /** Speaks `message`, replacing the last announcement. */
  readonly announce: (message: string) => void
}>()("@wardic/core/Announcer") {}

/** An Announcer that says nothing, for an Environment with no assistive technology to reach, as the test Environment's. */
export const silent: Layer.Layer<Announcer> = Layer.succeed(Announcer, { announce: () => {} })
