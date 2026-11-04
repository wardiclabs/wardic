import mdx from "@mdx-js/rollup"
import rehypeShiki from "@shikijs/rehype"
import solid from "@solidjs/vite-plugin"
import { highlightOptions } from "@wardic/example-storefront-shared/code"
import { fileRoutes } from "filesystem-routing/vite"
import { fileURLToPath } from "node:url"
import rehypeAutolinkHeadings from "rehype-autolink-headings"
import rehypeSlug from "rehype-slug"
import remarkFrontmatter from "remark-frontmatter"
import remarkMdxFrontmatter from "remark-mdx-frontmatter"
import { defineConfig } from "vite"
import { wardicSource } from "../scripts/wardic-source.ts"

// The storefronts' Shiki themes, light and dark as CSS variables (#365).
const { themes, defaultColor } = highlightOptions("page.tsx")

// Wardic's docs site (#558): Solid 2 in @solidjs/vite-plugin's start mode, rendered on the server, then
// prerendered page by page, as the Solid 2 storefront is set up.
// - Pages are MDX (src/content), compiled to JSX that Solid's compiler then compiles, each element
//   through the provider's components (src/mdx/provider.tsx), with HTML's attribute names and CSS's
//   property names, as Solid takes them; headings get ids and anchors, and code fences Shiki.
// - `@wardic/*` from its source in the repo (#554).
export default defineConfig({
  plugins: [
    wardicSource(),
    {
      enforce: "pre",
      ...mdx({
        jsx: true,
        jsxImportSource: "@solidjs/web",
        providerImportSource: "~/mdx/provider.tsx",
        elementAttributeNameCase: "html",
        stylePropertyNameCase: "css",
        remarkPlugins: [remarkFrontmatter, remarkMdxFrontmatter],
        rehypePlugins: [rehypeSlug, [rehypeAutolinkHeadings, { behavior: "wrap" }], [rehypeShiki, { themes, defaultColor }]],
      }),
    },
    solid({ start: {}, ssr: true, extensions: [".jsx", ".tsx", ".mdx"] }),
    fileRoutes({ types: true }),
  ],
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
    // As the Solid 2 storefront: Solid from this app, for @wardic/solid's source among the importers.
    dedupe: ["solid-js", "@solidjs/web", "@solidjs/router", "effect"],
  },
  ssr: { noExternal: ["@wardic/core", "@wardic/dom", "@wardic/solid", "@wardic/example-storefront-shared", "@kobalte/core"] },
  server: { port: 3110 },
  preview: { port: 4110 },
  build: { target: "esnext" },
})
