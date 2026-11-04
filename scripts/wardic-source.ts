/**
 * The repo resolves `@wardic/*` to its source (#554): every package's `exports` entry starts with
 * the `@wardic/source` condition, pointing at `src/`, before the published targets in `dist/`. An
 * app outside the repo doesn't know the condition, and gets `dist/`.
 *
 * This Vite plugin turns the condition on in every environment a config makes (the client, the
 * server, a framework's own), beside the conditions the environment already has: a test config's
 * own, vite-plugin-solid's `solid`, or Vite's defaults where nothing set any. Vite 6 and Vite 8
 * alike. TypeScript turns it on through `customConditions`.
 */

/** The condition the packages' `exports` give their source under. */
export const SOURCE_CONDITION = "@wardic/source"

/** Vite's own defaults (`defaultClientConditions`, `defaultServerConditions`), the same on 6 and 8. */
const CLIENT = ["module", "browser", "development|production"]
const SERVER = ["module", "node", "development|production"]

/** An environment's config, as far as the plugin reads it. */
interface EnvironmentConfig {
  readonly consumer?: "client" | "server" | undefined
  readonly resolve?: { readonly conditions?: ReadonlyArray<string> | undefined } | undefined
}

/**
 * The plugin. Typed by its shape rather than by `vite`'s `Plugin`, so a config on another Vite
 * version (the storefronts are on Vite 8, the repo on Vite 6) takes it as its own. Vite's merge
 * appends what it returns: the condition alone where the environment has conditions, and the
 * defaults with it where it has none, which a returned list would otherwise replace.
 */
export const wardicSource = () => ({
  name: "wardic:source",
  enforce: "post" as const,
  configEnvironment: (name: string, config: EnvironmentConfig) => {
    let conditions = [SOURCE_CONDITION]
    if (config.resolve?.conditions === undefined) {
      const server = config.consumer === "server" || (config.consumer === undefined && name !== "client")
      conditions = [...CLIENT, SOURCE_CONDITION]
      if (server) conditions = [...SERVER, SOURCE_CONDITION]
    }
    return { resolve: { conditions, externalConditions: [SOURCE_CONDITION] } }
  },
})
