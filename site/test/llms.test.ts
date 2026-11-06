// The docs as Markdown, for llms.txt (scripts/llms.ts): a page's MDX without its front matter, its
// site components written out as Markdown, its links to the site absolute, and its code left as it is.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, it } from "vitest"
import { markdownOf } from "../scripts/llms.ts"

const SAMPLES = join(import.meta.dirname, "..", "samples")
const ORIGIN = "https://wardic.dev"

/** `body`'s Markdown, as a page at `/guides/animate` with front matter. */
const markdown = (body: string): string =>
  markdownOf(`---\ntitle: Animate\ndescription: How.\n---\n${body}`, SAMPLES, ORIGIN, `${ORIGIN}/guides/animate`)

it("leaves out the front matter", () => {
  expect(markdown("# Animate\n")).toBe("# Animate\n")
})

it("writes a CodeTabs as its sample's code, a block per binding, Solid 2's first", () => {
  const out = markdown('<CodeTabs sample="enter" />\n')
  const solid2 = readFileSync(join(SAMPLES, "enter", "solid2.tsx"), "utf8").trimEnd()
  const solid1 = readFileSync(join(SAMPLES, "enter", "solid1.tsx"), "utf8").trimEnd()
  expect(out).toContain(`Solid 2:\n\n\`\`\`tsx\n${solid2}\n\`\`\``)
  expect(out).toContain(`Solid 1:\n\n\`\`\`tsx\n${solid1}\n\`\`\``)
  expect(out.indexOf("Solid 2:")).toBeLessThan(out.indexOf("Solid 1:"))
})

it("writes an InstallTabs as its npm line, and a Demo as a pointer to the page", () => {
  expect(markdown('<InstallTabs packages="@wardic/solid effect" />\n')).toBe("```sh\nnpm install @wardic/solid effect\n```\n")
  expect(markdown('<Demo sample="enter" />\n')).toBe(`(A live demo runs here on the page: ${ORIGIN}/guides/animate)\n`)
})

it("makes a link to the site absolute, and leaves code as it is", () => {
  expect(markdown("See [Why](/why).\n")).toBe(`See [Why](${ORIGIN}/why).\n`)
  const code = '```tsx\n<CodeTabs sample="enter" />\n[a](/b)\n```\n'
  expect(markdown(code)).toBe(code)
})
