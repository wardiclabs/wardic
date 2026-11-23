// The HTML document around the app: start mode's generated entries render it on the server and
// hydrate it in the browser, injecting the client entry into the head.
import { HydrationScript } from "@solidjs/web"
import type { ParentProps } from "solid-js"

export default function Document(props: ParentProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Its title and the rest of its head are each page's own (`components/Seo.tsx`, #908). Wardic's mark, the docs' icons. */}
        <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <HydrationScript />
      </head>
      <body>{props.children}</body>
    </html>
  )
}
