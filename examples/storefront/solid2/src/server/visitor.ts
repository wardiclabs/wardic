/**
 * The visitor the middleware found or made for this request (#296): what every server function
 * runs the store for. Server-only, for the modules that declare server functions.
 */
import { getRequestEvent, markSafeError } from "@solidjs/web"
import * as Store from "@wardic/example-storefront-shared/server"
import type { VisitorInfo } from "@wardic/example-storefront-shared/server"

export const visitor = (): VisitorInfo => {
  const known = getRequestEvent()?.locals.visitor as VisitorInfo | undefined
  if (known === undefined) throw new Error("No visitor on the request: is the middleware wired?")
  return known
}

/**
 * A store call for this request's visitor: its value, or a rejection whose message is for a person to
 * read ("The store didn't answer: you asked the next request to fail."). Marked safe, so a production
 * build sends it as it is: Solid 2 sends any other thrown error to the browser as "Internal Server
 * Error", so it can't leak a server's details. The store's messages are written for the page.
 */
export const storeCall = <A>(call: Parameters<typeof Store.runFor<A>>[1]): Promise<A> =>
  Store.runFor(visitor(), call).catch((error: unknown) => {
    throw markSafeError(error)
  })

