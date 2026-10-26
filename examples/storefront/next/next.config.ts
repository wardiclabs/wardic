/**
 * The Next.js config (#366). The shared package is TypeScript source, so Next compiles it with the
 * app; its server modules (the Effect store) run on the server only.
 */
import type { NextConfig } from "next"

const config: NextConfig = {
  transpilePackages: ["@wardic/example-storefront-shared"],
  // The repo's root holds the lockfile: trace the server's files from there.
  outputFileTracingRoot: new URL("../../..", import.meta.url).pathname,
  turbopack: { root: new URL("../../..", import.meta.url).pathname },
}

export default config
