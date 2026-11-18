// Appear animations read back from server markup, for both bindings' server tests (#48, #794): Solid-free.
import { vi } from "vitest"

/** The text of the first `<style>` in `html` carrying `attribute` (a prefix matches: `data-wardic-appear` finds the head's and a chunk's alike), or "". */
export const styleCss = (html: string, attribute: string): string => new RegExp(`<style ${attribute}[^>]*>([\\s\\S]*?)</style>`).exec(html)?.[1] ?? ""

/** The head's Appear style, or "". */
export const headCss = (html: string): string => styleCss(html, "data-wardic-appear")

/** The custom property an element's inline `animation` names (`var(--wardic-aN)`, or a path under `--wardic-a`), or "". */
export const propertyOf = (animation: string | undefined): string => /var\((--wardic-a[\w-]*)\)/.exec(animation ?? "")?.[1] ?? ""

/** The `:root` value of `property` in `css`, outside the media block, and inside it. */
export const timing = (css: string, property: string): { readonly normal: string; readonly reduced: string } => {
  if (property === "") return { normal: "", reduced: "" }
  const [plain, media = ""] = css.split("@media (prefers-reduced-motion: reduce)")
  const value = (text: string | undefined) => new RegExp(`${property}:([^;}]*)`).exec(text ?? "")?.[1] ?? ""
  return { normal: value(plain), reduced: value(media) }
}

/** The delay, in seconds, of an `animation` value: `name 1s linear 0.25s 1 both`. */
export const delayOf = (animation: string): number => Number(/s linear (-?[\d.]+)s/.exec(animation)?.[1] ?? Number.NaN)

/**
 * The provider's explanations logged while `render` runs (#585): each `wardic.appear:` line, from its
 * start. A render that returns a promise is awaited, so a word logged by a microtask after its build
 * counts (Foldkit's, #794).
 */
export const said = async (render: () => unknown): Promise<ReadonlyArray<string>> => {
  const lines: Array<string> = []
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: Array<unknown>) => {
      lines.push(args.map(String).join(" "))
    }),
  )
  try {
    await render()
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
  return lines.flatMap((line) => {
    const at = line.indexOf("wardic.appear:")
    if (at === -1) return []
    return [line.slice(at).trim()]
  })
}
