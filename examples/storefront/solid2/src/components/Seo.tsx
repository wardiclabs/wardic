/**
 * Each page's head (#908): its title, description, canonical URL, social tags and breadcrumbs, from
 * its path, through the shared registry (`@wardic/example-storefront-shared/seo`). A path that names no
 * page is answered with a 404, its page asking not to be indexed.
 */
import { useLocation } from "@solidjs/router"
import type { StartRequestEvent } from "@solidjs/vite-plugin"
import { getRequestEvent, isServer, useHead } from "@solidjs/web"
import { headTagsOf } from "@wardic/example-storefront-shared/head"
import { originOf, pageHeadOf } from "@wardic/example-storefront-shared/seo"
import { createMemo, untrack } from "solid-js"

/** The origin the page is served from, as its visitor sees it: the request's on the server, the page's in the browser. */
const originHere = (): string => {
  if (!isServer) return location.origin
  const event = getRequestEvent()
  if (event === undefined) return ""
  return originOf(event.request)
}

export function Seo() {
  const path = useLocation()
  const head = createMemo(() => pageHeadOf("solid2", path.pathname))
  const origin = originHere()
  // Before the response's head is sent: the shell renders this before it flushes.
  if (isServer && !untrack(head).found) {
    const response = (getRequestEvent() as StartRequestEvent | undefined)?.response
    if (response !== undefined && response.committed !== true) response.status = 404
  }
  useHead(() => [...headTagsOf(head(), origin)])
  return null
}
