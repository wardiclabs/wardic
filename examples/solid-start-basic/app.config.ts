import { defineConfig } from "@solidjs/start/config"

export default defineConfig({
  ssr: true,
  vite: {
    ssr: {
      // The @wardic/* workspace packages ship TypeScript source (their `exports`
      // point at ./src). Bundle them instead of externalizing so Vite transpiles
      // the source — and, once they contain Solid `.tsx`, runs the Solid transform.
      noExternal: ["@wardic/core", "@wardic/dom", "@wardic/solid"],
    },
  },
})
