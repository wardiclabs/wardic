// The HTML document around the app, rendered by entry-server.tsx and hydrated by entry-client.tsx.
// With an authored entry pair the document references its client entry itself: the handler
// rewrites this `/src/entry-client.tsx` to the built file's URL.
import { HydrationScript } from "@solidjs/web"
import type { ParentProps } from "solid-js"

export default function Document(props: ParentProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Wardic: Solid 2 sandbox</title>
        <HydrationScript />
        <script type="module" src="/src/entry-client.tsx" async />
      </head>
      <body>{props.children}</body>
    </html>
  )
}
