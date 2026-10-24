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
        <title>Kiln & Co. · Wardic on Solid 2</title>
        <link rel="icon" href="data:," />
        <HydrationScript />
      </head>
      <body>{props.children}</body>
    </html>
  )
}
