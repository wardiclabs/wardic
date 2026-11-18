/**
 * The server entry (#795, Q22): one `Request` in, one result out, for the Vite dev server and the Node
 * host alike. `/api/rpc` is the store's wire; any other request renders the route with the data its
 * page shows at first paint, as the program's Flags, for the visitor the cookie names (given on a
 * first request).
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Record from "effect/Record"
import { Cookies } from "effect/http"
import { Server } from "foldkit/experimental"
import * as Url from "foldkit/url"
import type * as Store from "@wardic/example-storefront-shared/server"
import { init, routing, view } from "~/app.ts"
import { Flags, type Prefs } from "~/model.ts"
import { pageOf } from "~/pages.ts"
import { rpc, VISITOR_COOKIE, visitorOf } from "~/rpc/server.ts"
import { urlToRoute } from "~/routes.ts"
import { Shop } from "~/shop.ts"
import { shopFor } from "~/shop/live.ts"

export const renderDocument: Server.DocumentRenderer = (application, assets) => Server.renderDocument(application, assets, { lang: "en", head: '<link rel="icon" href="data:," />' })

/** The visitor's switches from their cookies (Q26): the system's theme and motion unless they chose. */
const prefsOf = (cookies: Record<string, string>): Prefs => ({
  theme: Option.getOrElse(Option.filter(Record.get(cookies, "storefront-theme"), (theme): theme is Prefs["theme"] => theme === "light" || theme === "dark" || theme === "system"), () => "system" as const),
  reduceMotion: Option.getOrElse(Option.map(Record.get(cookies, "storefront-reduce-motion"), (on) => on === "true"), () => false),
})

/** The Flags for `url`: the header's, and the route's page's data and code, each `null` where the store didn't answer, for the client to load again. */
const flagsFor = (url: Url.Url, visitor: Store.VisitorInfo, prefs: Prefs, host: string | undefined): Effect.Effect<Flags> =>
  Effect.gen(function* () {
    const shop = yield* Shop
    const settings = yield* Effect.orElseSucceed(shop.getSettings, () => ({ delay: 300, failNext: false }))
    const cart = yield* Effect.orElseSucceed(shop.getCart, () => ({ lines: [] }))
    const route = urlToRoute(url)
    const forExample = route._tag === "Example" ? Option.map(pageOf(route.id), (page) => ({ id: route.id, page })) : Option.none()
    const page = yield* Option.match(forExample, {
      onNone: () => Effect.succeed(null),
      onSome: ({ id, page }) => Effect.orElseSucceed(Effect.map(page.load, (data: unknown) => ({ id, data })), () => null),
    })
    const code = yield* Option.match(forExample, {
      onNone: () => Effect.succeed(null),
      onSome: ({ id }) => Effect.orElseSucceed(shop.highlighted(id), () => null),
    })
    return { prefs, visitorName: visitor.name, settings, cart, page, code }
  }).pipe(Effect.provide(shopFor(visitor, host)))

const HEADERS = { "cache-control": "private, no-store", vary: "cookie" } as const

/** The rpc's path, as the client sends it: Effect's client joins its base URL and an empty path with a slash. */
const isRpc = (pathname: string): boolean => pathname === "/api/rpc" || pathname === "/api/rpc/"

export const renderPage = async (request: Request): Promise<Server.EntryResult> => {
  const url = new URL(request.url)
  if (isRpc(url.pathname)) return Server.Responded(await rpc.handler(request, Context.empty() as Context.Context<unknown>))
  if (request.method === "OPTIONS") return Server.Responded(new Response(null, { status: 204, headers: { allow: Server.HOST_METHOD_ANSWERS.allow } }))
  const cookieHeader = request.headers.get("cookie") ?? undefined
  const cookies = Cookies.parseHeader(cookieHeader ?? "")
  const visitor = visitorOf(cookieHeader)
  const host = request.headers.get("host") ?? undefined
  const parsed = Option.getOrThrowWith(Url.fromString(request.url), () => new Error(`Not a URL: ${request.url}`))
  const flags = await Effect.runPromise(flagsFor(parsed, visitor, prefsOf(cookies), host))
  const rendered = await Effect.runPromise(Server.renderToString({ Flags, routing, init, view }, { url: request.url, flags }))
  const headers: Record<string, string> = { ...HEADERS }
  // A first request: the visitor's cookie, so their cart lasts between requests.
  if (!(VISITOR_COOKIE in cookies)) headers["set-cookie"] = `${VISITOR_COOKIE}=${visitor.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
  return Server.Rendered(rendered, { headers })
}
