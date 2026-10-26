/**
 * When a page hydrates (#388, #366): at once, or as its `?hydrate=` asks. The proxy hands the root
 * layout the page's `?hydrate=` as a header; the layout adds a `beforeInteractive` script that the
 * `hold-hydration` route sends late, or never, and Next.js hydrates once it has loaded.
 */
import { hydrationOf } from "@wardic/example-storefront-shared/hydration"

export const HYDRATE_HEADER = "x-storefront-hydrate"

/** The hold's script for a page's `?hydrate=`: none to hydrate at once. */
export const holdOf = (value: string | null): string | undefined => {
  const hydration = hydrationOf(value)
  if (hydration.kind === "off") return "/hold-hydration?ms=off"
  if (hydration.kind === "late") return `/hold-hydration?ms=${hydration.ms}`
  return undefined
}
