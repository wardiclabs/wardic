/**
 * What a search engine and a link's preview read of the storefront (#908): each page's title,
 * description, canonical URL, social tags and breadcrumbs, and the site's `robots.txt` and sitemap.
 * All of it comes from the examples' registry, for the Solid 2 and Foldkit apps alike.
 *
 * - **Titles name the binding** ("A cart drawer that keeps up · Wardic on Solid 2"), so each app's pages
 *   read as their own implementation of the same examples, each its own canonical.
 * - **A page's image** is a piece's photo, a different piece for each example, in turn.
 * - **Breadcrumbs** are the only structured data: the pieces and prices are made up, so nothing says
 *   they're for sale.
 * - **A path that names nothing** is a page not found, which the apps answer with a 404 and `noindex`.
 *
 * It reads no photo, so plain Node runs it: the Foldkit host writes `robots.txt` and the sitemap with it at
 * its start. A page's tags, its photo among them, are `head.ts`'s.
 */
import { APPS, type AppId } from "./apps.ts"
import { PRODUCTS } from "./catalog.ts"
import { AREAS, type Example, EXAMPLES, exampleById, hasExample, routeOf } from "./examples.ts"

/** A crumb of a page's breadcrumbs: its name and its path. */
export interface Crumb {
  readonly name: string
  readonly path: string
}

/** A page of the storefront, as its head describes it. */
export interface PageHead {
  /** Whether the path names a page: a path that doesn't is answered with a 404. */
  readonly found: boolean
  readonly title: string
  readonly description: string
  /** Its canonical path. */
  readonly path: string
  /** The piece whose photo is its image. */
  readonly piece: string
  readonly crumbs: ReadonlyArray<Crumb>
}

/** The shop's name. */
export const SHOP = "Wardic Northlight"

/** What a page's title ends with: the binding it's written on. */
const suffixOf = (app: AppId): string => `Wardic on ${APPS[app].label}`

/** The gallery's description, on `app`. */
const homeDescriptionOf = (app: AppId): string =>
  `${SHOP} is a made-up ceramics shop whose every feature is a Wardic animation example on ${APPS[app].label}, with its code: entrances, layout, gestures, exits, page transitions, live values, server rendering and shipping less.`

/** An example's title and summary on `app`: Foldkit's own where it has them. */
const wordsOf = (example: Example, app: AppId): { readonly title: string; readonly summary: string } => {
  if (app !== "foldkit" || example.foldkit === undefined) return { title: example.title, summary: example.summary }
  return { title: example.foldkit.title ?? example.title, summary: example.foldkit.summary ?? example.summary }
}

/** The piece an example's image shows: a different one for each, in the registry's order. */
const pieceOf = (example: Example): string => PRODUCTS[EXAMPLES.indexOf(example) % PRODUCTS.length]!.id

/** The examples with pages of their own under them, a piece each: `/<area>/<example>/<piece>`. */
const WITH_PIECES: ReadonlySet<string> = new Set(["catalogue", "waiting"])

/** The page not found's head, on `app`. */
export const notFoundOf = (app: AppId, path: string): PageHead => ({
  found: false,
  title: `Nothing on this shelf · ${suffixOf(app)}`,
  description: homeDescriptionOf(app),
  path,
  piece: PRODUCTS[0]!.id,
  crumbs: [],
})

/** The page at `path` on `app`: the gallery, an example, a piece under an example, or a page not found. */
export const pageHeadOf = (app: AppId, path: string): PageHead => {
  const segments = path.split("/").filter((segment) => segment !== "")
  if (segments.length === 0) {
    return { found: true, title: `${SHOP} · ${suffixOf(app)}`, description: homeDescriptionOf(app), path: "/", piece: PRODUCTS[0]!.id, crumbs: [{ name: "Examples", path: "/" }] }
  }
  const [areaId, id, pieceId, ...rest] = segments
  const example = exampleById(id ?? "")
  if (example === undefined || example.area !== areaId || !hasExample(app, example) || rest.length > 0) return notFoundOf(app, path)
  const area = AREAS.find((one) => one.id === example.area)!
  const words = wordsOf(example, app)
  const crumbs: Array<Crumb> = [
    { name: "Examples", path: "/" },
    { name: area.title, path: `/#area-${area.id}` },
    { name: words.title, path: routeOf(example) },
  ]
  if (pieceId === undefined) return { found: true, title: `${words.title} · ${suffixOf(app)}`, description: words.summary, path: routeOf(example), piece: pieceOf(example), crumbs }
  const piece = PRODUCTS.find((one) => one.id === pieceId)
  if (piece === undefined || !WITH_PIECES.has(example.id)) return notFoundOf(app, path)
  const own = `${routeOf(example)}/${piece.id}`
  return {
    found: true,
    title: `${piece.name} · ${words.title} · ${suffixOf(app)}`,
    description: `${piece.tagline} ${words.summary}`,
    path: own,
    piece: piece.id,
    crumbs: [...crumbs, { name: piece.name, path: own }],
  }
}

/** `path` served from `origin`, with no trailing slash on the origin. */
export const urlOf = (origin: string, path: string): string => `${origin.replace(/\/$/, "")}${path}`

/** An attribute's value, escaped for HTML and XML. */
export const escaped = (text: string): string => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

/** The paths `robots.txt` keeps crawlers out of on `app`: its server functions' or its rpc's. */
const PRIVATE: Readonly<Record<AppId, ReadonlyArray<string>>> = {
  solid1: ["/_server/"],
  solid2: ["/_server/"],
  foldkit: ["/api/"],
}

/** `robots.txt` for `app`, served from `origin`: everything but its server's own paths, and where its sitemap is. */
export const robotsTxtOf = (app: AppId, origin: string): string =>
  ["User-agent: *", "Allow: /", ...PRIVATE[app].map((path) => `Disallow: ${path}`), `Sitemap: ${urlOf(origin, "/sitemap.xml")}`, ""].join("\n")

/** Every page `app` has: the gallery, each of its examples, and the pieces under the examples that have them. */
export const pathsOf = (app: AppId): ReadonlyArray<string> => [
  "/",
  ...EXAMPLES.filter((example) => hasExample(app, example)).flatMap((example) => [
    routeOf(example),
    ...(WITH_PIECES.has(example.id) ? PRODUCTS.map((piece) => `${routeOf(example)}/${piece.id}`) : []),
  ]),
]

/** The sitemap of `app`, served from `origin`. */
export const sitemapOf = (app: AppId, origin: string): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...pathsOf(app).map((path) => `  <url><loc>${escaped(urlOf(origin, path))}</loc></url>`),
    "</urlset>",
    "",
  ].join("\n")

/**
 * The origin a request reached, as the visitor sees it: the proxy's scheme and host where one fronts
 * the app (`X-Forwarded-Proto`, `X-Forwarded-Host`), else the request's own.
 */
export const originOf = (request: Request): string => {
  const url = new URL(request.url)
  const scheme = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(/:$/, "")
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || url.host
  return `${scheme}://${host}`
}
