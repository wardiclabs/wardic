/**
 * A storefront page's head tags (#908): its title and description, its canonical URL, Open Graph's and
 * Twitter's, its image a piece's photo, and its breadcrumbs, from `seo.ts`'s description of the page.
 * A page not found asks not to be indexed instead.
 */
import { photoOf } from "./images.ts"
import { type Crumb, escaped, type PageHead, SHOP, urlOf } from "./seo.ts"

/** A tag of a page's head, as `@solidjs/web`'s `useHead` takes one: its props, `children` its text. */
export interface HeadTag {
  readonly tag: "title" | "meta" | "link" | "script"
  readonly props: Readonly<Record<string, string>>
  readonly key: string
}

/** The breadcrumbs as schema.org's `BreadcrumbList`. */
const breadcrumbsOf = (origin: string, crumbs: ReadonlyArray<Crumb>): string =>
  JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({ "@type": "ListItem", position: index + 1, name: crumb.name, item: urlOf(origin, crumb.path) })),
  })

/**
 * The tags of `head`'s page, served from `origin`: its title and description, its canonical URL, Open
 * Graph's and Twitter's, its breadcrumbs; a page not found asks not to be indexed instead.
 */
export const headTagsOf = (head: PageHead, origin: string): ReadonlyArray<HeadTag> => {
  const title: HeadTag = { tag: "title", props: { children: head.title }, key: "title" }
  const description: HeadTag = { tag: "meta", props: { name: "description", content: head.description }, key: "description" }
  if (!head.found) return [title, description, { tag: "meta", props: { name: "robots", content: "noindex" }, key: "robots" }]
  const url = urlOf(origin, head.path)
  const photo = photoOf(head.piece)
  const image = urlOf(origin, photo.large)
  return [
    title,
    description,
    { tag: "link", props: { rel: "canonical", href: url }, key: "canonical" },
    { tag: "meta", props: { property: "og:site_name", content: SHOP }, key: "og:site_name" },
    { tag: "meta", props: { property: "og:type", content: "website" }, key: "og:type" },
    { tag: "meta", props: { property: "og:title", content: head.title }, key: "og:title" },
    { tag: "meta", props: { property: "og:description", content: head.description }, key: "og:description" },
    { tag: "meta", props: { property: "og:url", content: url }, key: "og:url" },
    { tag: "meta", props: { property: "og:image", content: image }, key: "og:image" },
    { tag: "meta", props: { property: "og:image:width", content: String(photo.width) }, key: "og:image:width" },
    { tag: "meta", props: { property: "og:image:height", content: String(photo.height) }, key: "og:image:height" },
    { tag: "meta", props: { name: "twitter:card", content: "summary_large_image" }, key: "twitter:card" },
    { tag: "script", props: { type: "application/ld+json", children: breadcrumbsOf(origin, head.crumbs) }, key: "breadcrumbs" },
  ]
}

/** `tags` as HTML, for a renderer that takes its head as text (Foldkit's), less any tag `skip` names. */
export const headHtmlOf = (tags: ReadonlyArray<HeadTag>, skip: ReadonlySet<string> = new Set()): string =>
  tags
    .filter((one) => !skip.has(one.key))
    .map((one) => {
      const attributes = Object.entries(one.props)
        .filter(([name]) => name !== "children")
        .map(([name, value]) => ` ${name}="${escaped(value)}"`)
        .join("")
      const children = one.props["children"]
      if (one.tag === "meta" || one.tag === "link") return `<${one.tag}${attributes}>`
      // A script's JSON can't hold `</script>`: its `<` is written as JSON's own escape.
      const text = one.tag === "script" ? (children ?? "").replaceAll("<", "\\u003c") : escaped(children ?? "")
      return `<${one.tag}${attributes}>${text}</${one.tag}>`
    })
    .join("")

