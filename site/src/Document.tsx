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
        <meta name="description" content="Animation for Solid, with the API of Motion for React." />
        <link rel="icon" href="data:," />
        <script innerHTML={THEME_SCRIPT} />
        <HydrationScript />
      </head>
      <body>{props.children}</body>
    </html>
  )
}
