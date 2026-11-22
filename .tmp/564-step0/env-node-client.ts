// #881, probe 3: Node with no DOM, but Vite's client pipeline: the JSX compiled for the DOM and
// \`solid-js\` resolved as a browser's, as a \`TestStage\` test in the node tier would want.
import type { Environment } from "vitest/environments"

export default {
  name: "node-client",
  viteEnvironment: "client",
  setup: () => ({ teardown: () => undefined }),
} satisfies Environment
