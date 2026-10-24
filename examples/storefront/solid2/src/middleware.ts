/**
 * The server's middleware (`start.middleware`): every request gets a visitor (#296). Their id comes
 * from their cookie, or a new one is made and the response sets it; the store's server functions
 * read it from `event.locals`.
 */
import type { StartMiddleware } from "@solidjs/vite-plugin"
import { parseCookieHeader, serializeCookie } from "@solidjs/web"
import { visitorFromId } from "@wardic/example-storefront-shared/server"

const COOKIE = "storefront-visitor"

const visitor: StartMiddleware = async (event, next) => {
  const known = parseCookieHeader(event.request.headers.get("cookie"))[COOKIE]
  const id = known || crypto.randomUUID()
  event.locals.visitor = visitorFromId(id)
  const response = await next()
  if (!known) response.headers.append("Set-Cookie", serializeCookie(COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 }))
  return response
}

export default [visitor]
