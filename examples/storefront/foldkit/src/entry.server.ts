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
import * as Schema from "effect/Schema"
import { headHtmlOf, headTagsOf } from "@wardic/example-storefront-shared/head"
import { notFoundOf, originOf, pageHeadOf } from "@wardic/example-storefront-shared/seo"
import { DEFAULT_SETTINGS, type VisitorInfo } from "@wardic/example-storefront-shared/server"
import { init, routing, view } from "~/app.ts"
import { Flags, type Prefs, REDUCE_MOTION_COOKIE, Theme, THEME_COOKIE } from "~/model.ts"
import { pageOf } from "~/pages.ts"
import { rpc, VISITOR_COOKIE, visitorOf } from "~/rpc/server.ts"
import { exampleOf, urlToRoute } from "~/routes.ts"
import { Shop } from "~/shop.ts"
import { shopFor } from "~/shop/live.ts"

/** The theme the visitor chose, as the root element renders it: copied onto `<html>`, where the stylesheet reads it, so a dark page is dark from its first paint. */
const themeOf = (html: string): string | undefined => /^<div[^>]*\sdata-theme="(light|dark)"/.exec(html)?.[1]

/** Wardic's mark, the docs' icons (#908), served from the shared `public/`. */
const ICONS = '<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png">'

/** What Foldkit writes of the head itself, from the view's Document: its title, canonical URL and `og:url`. */
const FOLDKIT_WRITES: ReadonlySet<string> = new Set(["title", "canonical", "og:url"])

/**
 * The page's head beyond what Foldkit writes (#908): its description and social tags, by the canonical
 * URL the view gave; a page not found, which has none, asks not to be indexed.
 */
const headOf = (application: Server.RenderedApplication): string => {
  if (application.canonical === undefined) return headHtmlOf(headTagsOf(notFoundOf("foldkit", "/"), ""), FOLDKIT_WRITES)
  const url = new URL(application.canonical)
  return headHtmlOf(headTagsOf(pageHeadOf("foldkit", url.pathname), url.origin), FOLDKIT_WRITES)
}

export const renderDocument: Server.DocumentRenderer = (application, assets) => {
  const document = Server.renderDocument(application, assets, { lang: "en", head: ICONS + headOf(application) })
  const theme = themeOf(application.html)
  if (theme === undefined) return document
  return document.replace("<html", `<html data-theme="${theme}"`)
}

// Q26: the cookies the switches keep, read here into the Flags.
/** The visitor's switches from their cookies: the system's theme and motion unless they chose. */
const prefsOf = (cookies: Readonly<Record<string, string>>): Prefs => ({
  theme: Option.getOrElse(Option.filter(Record.get(cookies, THEME_COOKIE), Schema.is(Theme)), () => "system" as const),
  reduceMotion: Option.getOrElse(Option.map(Record.get(cookies, REDUCE_MOTION_COOKIE), (on) => on === "true"), () => false),
})

/** The Flags for `url`: the header's, and the route's page's data and code, each `null` where the store didn't answer, for the client to load again. */
const flagsFor = (url: Url.Url, visitor: VisitorInfo, prefs: Prefs, origin: string): Effect.Effect<Flags> =>
  Effect.gen(function* () {
    const shop = yield* Shop
    const settings = yield* Effect.orElseSucceed(shop.getSettings, () => DEFAULT_SETTINGS)
    const cart = yield* Effect.orElseSucceed(shop.getCart, () => ({ lines: [] }))
    const route = urlToRoute(url)
    // The example under the route, a piece's included: every route is server-rendered with its page's data.
    const forExample = Option.flatMap(exampleOf(route), ({ id }) => Option.map(pageOf(id), (page) => ({ id, page })))
    const page = yield* Option.match(forExample, {
      onNone: () => Effect.succeed(null),
      onSome: ({ id, page }) => Effect.orElseSucceed(Effect.map(page.load, (data: unknown) => ({ id, data })), () => null),
    })
    const code = yield* Option.match(forExample, {
      onNone: () => Effect.succeed(null),
      onSome: ({ id }) => Effect.orElseSucceed(shop.highlighted(id), () => null),
    })
    return { origin, prefs, visitorName: visitor.name, settings, cart, page, code }
  }).pipe(Effect.provide(shopFor(visitor)))

const HEADERS = { "cache-control": "private, no-store", vary: "cookie" } as const

/** The rpc's path, as the client sends it: Effect's client joins its base URL and an empty path with a slash. */
const isRpc = (pathname: string): boolean => pathname === "/api/rpc" || pathname === "/api/rpc/"

export const renderPage = async (request: Request): Promise<Server.EntryResult> => {
  const url = new URL(request.url)
  if (isRpc(url.pathname)) return Server.Responded(await rpc.handler(request, Context.empty() as Context.Context<unknown>))
  if (request.method === "OPTIONS") return Server.Responded(new Response(null, { status: 204, headers: { allow: Server.HOST_METHOD_ANSWERS.allow } }))
  // Each page's canonical URL is a path at the origin its visitor sees (#908). `robots.txt` and the
  // sitemap are files the host writes at its start (`server.ts`): it serves a path with an extension
  // only from its files.
  const origin = originOf(request)
  const cookies = Cookies.parseHeader(request.headers.get("cookie") ?? "")
  const visitor = visitorOf(cookies)
  const parsed = Option.getOrThrowWith(Url.fromString(request.url), () => new Error(`Not a URL: ${request.url}`))
  const flags = await Effect.runPromise(flagsFor(parsed, visitor, prefsOf(cookies), origin))
  const rendered = await Effect.runPromise(Server.renderToString({ Flags, routing, init, view }, { url: request.url, flags }))
  const headers: Record<string, string> = { ...HEADERS }
  // A first request: the visitor's cookie, so their cart lasts between requests.
  if (!(VISITOR_COOKIE in cookies)) headers["set-cookie"] = `${VISITOR_COOKIE}=${visitor.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
  // A path that names no page is answered with a 404 (#908), its page asking not to be indexed.
  return Server.Rendered(rendered, { headers, status: pageHeadOf("foldkit", url.pathname).found ? 200 : 404 })
}
