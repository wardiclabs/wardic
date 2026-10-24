/**
 * The visitor the middleware found or made for this request (#296): what every server function
 * runs the store for. Server-only, for the modules that declare server functions.
 */
import { getRequestEvent } from "@solidjs/web"
import type { VisitorInfo } from "@wardic/example-storefront-shared/server"

export const visitor = (): VisitorInfo => {
  const known = getRequestEvent()?.locals.visitor as VisitorInfo | undefined
  if (known === undefined) throw new Error("No visitor on the request: is the middleware wired?")
  return known
}
