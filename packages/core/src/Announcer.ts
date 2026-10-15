/**
 * The `Announcer` module: how an Environment speaks an **Announcement** to assistive technology
 * (ADR-0037). Core words the message; the Environment delivers it, through its platform's own
 * channel (`@wardic/dom`'s `AnnouncerDomLive`). Each announcement replaces the last.
 *
 * A Context service, as `ReducedMotion.PositionalKeys` is: core names the contract and no
 * Environment's syntax (ADR-0036). A plain call: an announcement answers a key just pressed, on no
 * frame's path.
 *
 * Tier 2 (ADR-0008): for Environment and binding authors.
 */
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"

/** An Environment's channel to assistive technology. */
export class Announcer extends Context.Service<Announcer, {
  /** Speak `message`, replacing the last announcement. */
  readonly announce: (message: string) => void
}>()("@wardic/Announcer") {}

/** An Announcer that says nothing: a headless Environment's (the Test Environment's), with no assistive technology to reach. */
export const silent: Layer.Layer<Announcer> = Layer.succeed(Announcer, { announce: () => {} })
