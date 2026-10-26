/**
 * The visitor the proxy found or made for this request (#296): what every server action and server
 * component runs the store for.
 */
import { type VisitorInfo, visitorFromId } from "@wardic/example-storefront-shared/server"
import { cookies } from "next/headers"

export const VISITOR_COOKIE = "storefront-visitor"

export const visitor = async (): Promise<VisitorInfo> => {
  const id = (await cookies()).get(VISITOR_COOKIE)?.value
  if (id === undefined) throw new Error("No visitor on the request: is the proxy wired?")
  return visitorFromId(id)
}
