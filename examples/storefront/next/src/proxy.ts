/**
 * Next.js's proxy (what was its middleware), in front of every request:
 * - Every request gets a visitor (#296). Their id comes from their cookie, or a new one is made and
 *   the response sets it, which Next.js also hands to this request's `cookies()`.
 * - A page's `?hydrate=` (#388) goes to the root layout, which can't read the URL, as a header.
 */
import { type NextRequest, NextResponse } from "next/server"
import { HYDRATE_HEADER } from "~/lib/hydration.ts"
import { VISITOR_COOKIE } from "~/lib/visitor.ts"

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers)
  headers.set(HYDRATE_HEADER, request.nextUrl.searchParams.get("hydrate") ?? "")
  const response = NextResponse.next({ request: { headers } })
  if (!request.cookies.has(VISITOR_COOKIE)) response.cookies.set(VISITOR_COOKIE, crypto.randomUUID(), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 })
  return response
}

export const config = {
  // Every page and server action, not Next's own files.
  matcher: ["/((?!_next/static|_next/image).*)"],
}
