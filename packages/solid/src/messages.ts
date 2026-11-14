/**
 * The texts of the errors an app can hit (#746, ADR-0067 *Amendment (#746)*, decision 7), shared by
 * both bindings: each development's fix, and the one line a production build throws in its place.
 * Each binding chooses under its own Solid's `DEV`, so a production build drops the fix it never
 * names.
 *
 * @module
 */

/**
 * What a provider fails with when its `env` waits as it builds, in development and on a server: the
 * fix, where Effect's own `AsyncFiberError` names neither.
 */
export const WAITING_ENV_FIX =
  "The WardicProvider's env waits as it builds, and a provider builds it at once, as its first element renders. Build the Layer that waits, such as DevTools.layer(), before the app renders, and give its services in the env: Layer.succeedContext(await Effect.runPromise(Layer.buildWithScope(layer, scope))). See https://wardic.dev/guides/observability."

/** {@link WAITING_ENV_FIX} in a production client build: one line, and where the fix is. */
export const WAITING_ENV_LINE = "The WardicProvider's env waits as it builds. See https://wardic.dev/guides/observability."

/** A wrapped component that renders an element but forwards its ref to none, in development: the fix. `label` names the wrap. */
export const unforwardedRefFix = (label: string): string =>
  `${label}: the wrapped component rendered an element but did not forward its ref to it. ` +
  "The component must forward props.ref to a single root DOM element " +
  "(e.g. <div ref={props.ref}>...</div>). Element-only motion is wired through the ref."

/** {@link unforwardedRefFix} in a production build: one line. */
export const unforwardedRefLine = (label: string): string => `${label}: the wrapped component didn't forward props.ref to its element.`
