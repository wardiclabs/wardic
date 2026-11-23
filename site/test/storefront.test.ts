/**
 * The storefront's links to the docs (#908): each example names a docs page, as `DOCS_PAGES` titles it,
 * and each of those is a page of the site, under that title, which lists its examples
 * (`<Storefront guide>`). So a renamed or moved guide fails here, not as a dead link on the storefront.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { DOCS_PAGES, EXAMPLES } from "@wardic/example-storefront-shared/examples"
import { describe, expect, it } from "vitest"

const CONTENT = join(import.meta.dirname, "..", "src", "content")

/** A docs page's MDX, by its path: `/guides/layout` is `guides/layout.mdx`. */
const sourceOf = (path: string): string => readFileSync(join(CONTENT, `${path.slice(1)}.mdx`), "utf8")

describe("the storefront's links to the docs (#908)", () => {
  it("SF1: every docs page an example names is a page of the site, under the title it's linked with", () => {
    for (const [path, title] of Object.entries(DOCS_PAGES)) expect(sourceOf(path), path).toMatch(new RegExp(`^title: ${title}$`, "m"))
  })

  it("SF2: every docs page an example names lists its examples, and the Examples page lists every one", () => {
    for (const path of new Set(EXAMPLES.map((example) => example.docs))) expect(sourceOf(path), path).toContain(`<Storefront guide="${path}" />`)
    expect(sourceOf("/examples")).toContain("<Storefront />")
  })
})
