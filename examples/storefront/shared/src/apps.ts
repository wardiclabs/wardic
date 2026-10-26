/**
 * The storefront's three apps (#366): Solid 1, Solid 2, and Motion on Next.js. An example's page
 * links to the same example in the others. Each serves on its own port; a page links to the others
 * on the host its visitor used, so the links work wherever the three run together, unless an
 * environment variable names an app's base URL (`STOREFRONT_SOLID1_URL`, `STOREFRONT_SOLID2_URL`,
 * `STOREFRONT_NEXT_URL`).
 */

export type AppId = "solid1" | "solid2" | "next"

export interface App {
  readonly id: AppId
  /** What a link to it says. */
  readonly label: string
  /** Where its preview and the smoke serve it. */
  readonly port: number
  /** The environment variable that can name its base URL. */
  readonly env: string
}

export const APPS: Readonly<Record<AppId, App>> = {
  solid1: { id: "solid1", label: "Solid 1", port: 4101, env: "STOREFRONT_SOLID1_URL" },
  solid2: { id: "solid2", label: "Solid 2", port: 4102, env: "STOREFRONT_SOLID2_URL" },
  next: { id: "next", label: "Motion · Next.js", port: 4103, env: "STOREFRONT_NEXT_URL" },
}

/**
 * `route` in `app`: under its base URL from the environment, or on `host` (a request's `Host`
 * header, its port dropped) at the app's port.
 */
export const appUrl = (app: App, route: string, host: string | null | undefined, env: Readonly<Record<string, string | undefined>>): string => {
  const base = env[app.env]
  if (base !== undefined && base !== "") return base.replace(/\/$/, "") + route
  const hostname = (host ?? "localhost").replace(/:\d+$/, "")
  return `http://${hostname}:${app.port}${route}`
}
