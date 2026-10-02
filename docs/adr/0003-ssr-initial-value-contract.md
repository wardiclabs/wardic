# SSR initial-value contract

The initial style for an animated element is resolved **synchronously and purely** as `project(resolveInitial(config))` — never by running the engine or a Stream — so the server emits it with zero runtime spin-up and the client hydrates with a bit-identical seed (no mismatch). That single resolved value is the one source of truth: it seeds the SSR style, the hydration seed, **and** the animation Stream's `from`, so frame 1 flows continuously out of the seed with no snap. A *static or variant-name* `initial` is SSR-serialized; a *function* `initial` is treated as client-only first-frame (it may flash), because "is it a function?" is decidable whereas "is it pure?" is not.

## Considered Options

- **Run the engine for one `dt=0` frame to extract the initial** — rejected: requires an Effect runtime + one-tick Clock spin-up per animated element on every server render, and a fragile synchronous `runSync` extraction, to buy "no drift" that pinning `from` to the resolved value already gives for free.
- **Run a function `initial` on the server** — rejected: it reads runtime state (signals, `window`, time) that differs server↔client, producing hydration mismatches, and runs arbitrary user code in the synchronous render path.
- **Two-pass / resumability serialization** — deferred: guarantees a match even for computed initial, but couples Wardic to a specific SSR framework's hydration mechanism; revisit only if computed-initial-SSR becomes a real demand.

## Consequences

Measurement-dependent initial (`%`→`px`, `layout`/FLIP starts) cannot be resolved on the server and will flash — a hard boundary, since layout is post-mount. A function `initial` silently forfeits SSR, so the binding should dev-warn when it sees one. The reactive render path writes a signal per frame (N writes/frame for N elements); the imperative `applyTo` path is cheaper at scale and exists partly for that reason.

## Amendment (#41, 2026-10-01): the server builds nothing; a hydrating client holds the server's values

The contract holds as written, and ADR-0021 implements it: a server render builds no runtime, and DomLive fails if it's built on a server. One addition: the Starting style is also what a hydrating client renders until the element mounts. So is every other value the server rendered, such as a client-only hook's `false` (the **Hydration hold**, ADR-0021, decision 8). The engine starts at mount from the Starting style, as before.

## Amendment (#47, 2026-10-02): a key `initial` doesn't set starts from its Base value

The seed holds for every key `initial` sets. A key it doesn't set (an `animate` key, a gesture's, an exit's) has no Starting style. The animation's `from` for it is its Base value's start links: its `style` value, else the element's Own value, read on the client after mount, never on a server (ADR-0022). Before, it started at 0, and a hydrating client blinked such a key to 0 at mount.
