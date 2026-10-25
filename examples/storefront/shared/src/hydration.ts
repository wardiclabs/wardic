/**
 * When a page hydrates (#388): at once, or as its `?hydrate=` asks. `?hydrate=2000` hydrates two
 * seconds late, as a slow network would; `?hydrate=off` never does, as with JavaScript off. Both
 * apps' client entries wait on it, and the before-hydration example links to both.
 */

export type Hydration =
  | { readonly kind: "now" }
  | { readonly kind: "late"; readonly ms: number }
  | { readonly kind: "off" }

/**
 * A page's hydration, from its `?hydrate=` value. Read leniently: anything but `off` or a positive
 * number of milliseconds hydrates at once.
 */
export const hydrationOf = (value: string | null | undefined): Hydration => {
  if (value === "off") return { kind: "off" }
  const ms = Number.parseInt(value ?? "", 10)
  if (ms > 0) return { kind: "late", ms }
  return { kind: "now" }
}

/** Calls `start` when this page's `?hydrate=` says: at once, that much later, or never. */
export const hydrateWhenAsked = (start: () => void): void => {
  const hydration = hydrationOf(new URLSearchParams(location.search).get("hydrate"))
  if (hydration.kind === "now") start()
  else if (hydration.kind === "late") setTimeout(start, hydration.ms)
}
