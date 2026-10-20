// The Babel plugins vite.solid2.ts runs (#209), which ship no declarations of their own.
declare module "@babel/preset-typescript" {
  import type { PluginItem } from "@babel/core"
  const preset: PluginItem
  export default preset
}
declare module "@solidjs/babel-plugin" {
  import type { PluginItem } from "@babel/core"
  const plugin: PluginItem
  export default plugin
}
