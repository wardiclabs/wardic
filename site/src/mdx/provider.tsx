/**
 * MDX's components (#558), for its `providerImportSource`. MDX writes each element as
 * `<_components.h1>`, which Solid compiles as a component call, so each must be a component. MDX
 * spreads what this returns over its own defaults (the tags' names, as strings, which Solid can't
 * call), so it names every HTML element, each a plain element through `dynamic()` unless the site has
 * its own.
 */
import { dynamic } from "@solidjs/web"
import type { JSX } from "@solidjs/web"
import { CodeTabs } from "~/components/CodeTabs.tsx"
import { Demo } from "~/components/Demo.tsx"

type Component = (props: Record<string, unknown>) => JSX.Element

/**
 * Every HTML element: what Markdown makes, and what a rehype plugin adds (Shiki's `span`s, a heading's
 * anchor), each of which MDX maps through its components too.
 */
const TAGS = [
  "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "blockquote", "br", "button", "caption", "cite", "code", "col",
  "colgroup", "data", "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "footer", "h1", "h2", "h3",
  "h4", "h5", "h6", "header", "hr", "i", "img", "input", "ins", "kbd", "label", "li", "main", "mark", "nav", "ol", "p", "picture",
  "pre", "q", "s", "samp", "section", "small", "source", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td",
  "tfoot", "th", "thead", "time", "tr", "u", "ul", "var", "video", "wbr",
] as const

/**
 * A plain element named `tag`: a static `dynamic()`, which renders it with no computation per element
 * (the largest page has about 1,600). Made here, once, at the module's top, outside any owner: under a
 * render's, it would take a hydration id on one side only (as `@wardic/solid`'s tags, `formOf`).
 */
// #618 (S2): `<Dynamic>` is deprecated, and made a memo over its `component` for every element.
const elementOf = (tag: string): Component => dynamic(() => tag, { static: true }) as Component

/**
 * The site's own components, over the plain elements, and the ones a page uses by name: `<Demo>` and
 * `<CodeTabs>`. (A link is a plain `<a>`: the router opens a page of the site without a reload.)
 */
const OWN: Record<string, Component> = { CodeTabs: CodeTabs as Component, Demo: Demo as Component }

const ALL: Record<string, Component> = { ...Object.fromEntries(TAGS.map((tag) => [tag, elementOf(tag)])), ...OWN }

export const useMDXComponents = (): Record<string, Component> => ALL
