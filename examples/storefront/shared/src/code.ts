/**
 * The code panels (#296 Q3, #366): how all three apps highlight an example's files, and in what
 * order they show them. Shiki writes both themes as CSS variables, and the stylesheet picks one.
 */

/** A file's language, by its extension. */
const langOf = (path: string): "tsx" | "ts" => {
  if (path.endsWith(".tsx")) return "tsx"
  return "ts"
}

/** Shiki's options for the file at `path`. */
export const highlightOptions = (path: string) => ({ lang: langOf(path), themes: { light: "catppuccin-latte", dark: "nord" }, defaultColor: false }) as const

/** Whether `path` is an example's demo: what its folder starts with. */
const rankOf = (path: string): number => Number(!path.endsWith("/Demo.tsx"))

/** An example's files in the order a panel shows them: its `Demo.tsx` first, then the rest by name. */
export const inShowingOrder = (paths: ReadonlyArray<string>): ReadonlyArray<string> => [...paths].sort((a, b) => rankOf(a) - rankOf(b) || a.localeCompare(b))
