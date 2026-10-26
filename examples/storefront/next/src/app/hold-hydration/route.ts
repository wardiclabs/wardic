/**
 * What holds a page's hydration back when its `?hydrate=` asks (#388, #366): an empty script, sent
 * that many milliseconds late (`?ms=2000`), or never (`?ms=off`). The root layout loads it as a
 * `beforeInteractive` script, and Next.js hydrates once those have loaded. As the Solid apps'
 * client entries wait on `hydrateWhenAsked`, so the before-hydration example can show what plays
 * without the JavaScript.
 */
const SCRIPT = { headers: { "content-type": "text/javascript", "cache-control": "no-store" } }

export async function GET(request: Request) {
  const ms = Number.parseInt(new URL(request.url).searchParams.get("ms") ?? "", 10)
  // Never: held until the visitor leaves the page.
  if (!(ms > 0)) await new Promise((resolve) => request.signal.addEventListener("abort", resolve))
  else await new Promise((resolve) => setTimeout(resolve, ms))
  return new Response("", SCRIPT)
}
