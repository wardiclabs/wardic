/**
 * A rehype step after Shiki (#558): each highlighted block becomes one `<div class="code-block">`
 * holding its HTML as a string (`innerHTML`). MDX would otherwise compile every token's `<span>` to a
 * component call, a page's worth of JavaScript to draw what's already HTML.
 */
import type { Element, Root } from "hast"
import { toHtml } from "hast-util-to-html"

/** Whether `node` is a block Shiki highlighted: Shiki's hast names its class `class`, not `className`. */
const isShiki = (node: Element): boolean => node.tagName === "pre" && String(node.properties.class ?? node.properties.className ?? "").includes("shiki")

/**
 * Replaces each of `parent`'s Shiki blocks, at any depth: inside elements, and inside the `root` that
 * Shiki's rehype plugin puts in each block's place.
 */
const replaceIn = (parent: Root | Element): void => {
  parent.children = parent.children.map((child) => {
    const node = child as Root["children"][number] | Root
    if (node.type === "root") {
      replaceIn(node)
      return child
    }
    if (node.type !== "element") return child
    if (isShiki(node)) return { type: "element", tagName: "div", properties: { className: ["code-block"], innerHTML: toHtml(node) }, children: [] }
    replaceIn(node)
    return child
  }) as typeof parent.children
}

export const rehypeCodeHtml = () => (tree: Root) => {
  replaceIn(tree)
}
