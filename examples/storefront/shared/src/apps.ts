/**
 * The storefront's three apps (#366, #795, #826): Solid 1, Solid 2 and Foldkit, each on its own port
 * (its preview, its smoke, and the deploy's subdomain behind Caddy).
 */

export type AppId = "solid1" | "solid2" | "foldkit"

export interface App {
  readonly id: AppId
  /** What a link to it says. */
  readonly label: string
  /** Where its preview and the smoke serve it. */
  readonly port: number
}

export const APPS: Readonly<Record<AppId, App>> = {
  solid1: { id: "solid1", label: "Solid 1", port: 4101 },
  solid2: { id: "solid2", label: "Solid 2", port: 4102 },
  foldkit: { id: "foldkit", label: "Foldkit", port: 4104 },
}
