/**
 * What the storefront tells a search engine (#908), from the registry: each page's head, by its path
 * and its app, a page not found, `robots.txt` and the sitemap.
 */
import { describe, expect, it } from "vitest"
import { EXAMPLES, hasExample, routeOf } from "../src/examples.ts"
import { originOf, pageHeadOf, pathsOf, robotsTxtOf, sitemapOf } from "../src/seo.ts"

describe("the storefront's SEO (#908)", () => {
  it("SE1: an example's page is titled for its binding, described by its summary, its canonical its own path", () => {
    const solid2 = pageHeadOf("solid2", "/layout/cart-drawer")
    const foldkit = pageHeadOf("foldkit", "/layout/cart-drawer")
    expect(solid2).toMatchObject({ found: true, title: "A cart drawer that keeps up · Wardic on Solid 2", path: "/layout/cart-drawer" })
    expect(foldkit.title).toBe("A cart drawer that keeps up · Wardic on Foldkit")
    expect(solid2.description).toBe(EXAMPLES.find((example) => example.id === "cart-drawer")!.summary)
    expect(solid2.crumbs.map((crumb) => crumb.name)).toEqual(["Examples", "Layout", "A cart drawer that keeps up"])
  })

  it("SE2: Foldkit's own words where it has them; a piece's page under the catalogue", () => {
    const sizeGuide = EXAMPLES.find((example) => example.id === "size-guide")!
    expect(pageHeadOf("foldkit", routeOf(sizeGuide)).title).toBe(`${sizeGuide.foldkit!.title} · Wardic on Foldkit`)
    expect(pageHeadOf("solid2", "/transitions/catalogue/moon-vase")).toMatchObject({ found: true, title: "Moon Vase · From the catalogue to a piece's own page · Wardic on Solid 2", piece: "moon-vase" })
  })

  it("SE3: a path that names nothing is a page not found: an unknown route, example, area, piece, or an app's missing example", () => {
    const waiting = EXAMPLES.find((example) => example.id === "waiting")!
    expect(hasExample("foldkit", waiting)).toBe(false)
    for (const [app, path] of [
      ["solid2", "/no-such-page"],
      ["solid2", "/layout/no-such-example"],
      ["solid2", "/gestures/cart-drawer"],
      ["solid2", "/transitions/catalogue/no-such-piece"],
      ["solid2", "/layout/cart-drawer/moon-vase"],
      ["foldkit", routeOf(waiting)],
    ] as const) {
      expect(pageHeadOf(app, path).found, `${app} ${path}`).toBe(false)
    }
  })

  it("SE4: robots.txt names the sitemap and keeps the server's paths out; the sitemap lists every page once", () => {
    expect(robotsTxtOf("solid2", "https://solid2.wardic.dev")).toBe("User-agent: *\nAllow: /\nDisallow: /_server/\nSitemap: https://solid2.wardic.dev/sitemap.xml\n")
    const sitemap = sitemapOf("foldkit", "https://foldkit.wardic.dev")
    const paths = pathsOf("foldkit")
    expect(new Set(paths).size).toBe(paths.length)
    expect(sitemap.match(/<loc>/g)).toHaveLength(paths.length)
    expect(paths.every((path) => pageHeadOf("foldkit", path).found)).toBe(true)
  })

  it("SE5: the origin a visitor sees: the proxy's scheme and host, else the request's", () => {
    expect(originOf(new Request("http://127.0.0.1:4102/x", { headers: { "x-forwarded-proto": "https", "x-forwarded-host": "solid2.wardic.dev" } }))).toBe("https://solid2.wardic.dev")
    expect(originOf(new Request("http://127.0.0.1:4102/x"))).toBe("http://127.0.0.1:4102")
  })
})
