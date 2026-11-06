/**
 * The HTML document around the app (#558): the start mode's generated entries render it on the server
 * and hydrate it in the browser. A small script sets the chosen theme before the page paints, so a dark
 * page never flashes light.
 */
import { HydrationScript } from "@solidjs/web"
import type { ParentProps } from "solid-js"
import { THEME_SCRIPT } from "~/components/ThemeToggle.tsx"

export default function Document(props: ParentProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* What every page's link preview shares: its own title, description and URL are the route's. */}
        <meta property="og:site_name" content="Wardic" />
        <meta property="og:image" content="https://wardic.dev/og.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="Wardic: Cassiopeia's W in a ward ring, beside the wordmark." />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#eceff4" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#2e3440" />
        {/* Wardic's mark (brand/): the small cut as SVG, a PNG for browsers without SVG icons, and a touch icon. */}
        <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        {/* The headings' face (site.css), fetched with the page so they don't swap in late. */}
        <link rel="preload" href="/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
        <script innerHTML={THEME_SCRIPT} />
        <HydrationScript />
      </head>
      <body>{props.children}</body>
    </html>
  )
}
