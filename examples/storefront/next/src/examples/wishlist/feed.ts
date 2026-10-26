// The shared wishlist, live: Next.js has no live server function, so the list's changes come over
// server-sent events, from a route handler (`app/api/wishlist/route.ts` serves this `GET`). The
// store's feed sends its order now, then each change as anyone makes it; it ends when the reader
// leaves.
import * as Store from "@wardic/example-storefront-shared/server"
import { visitor } from "~/lib/visitor.ts"

export async function GET() {
  const changes = (await Store.streamFor(await visitor(), Store.wishlistChanges("shared")))[Symbol.asyncIterator]()
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await changes.next()
      if (next.done) controller.close()
      else controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`))
    },
    async cancel() {
      await changes.return?.()
    },
  })
  // `no-transform`: a compressing server would hold the events back.
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" } })
}
