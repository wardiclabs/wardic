/**
 * The docs for language models, after the prerender: each page as Markdown at `<route>.md` (`/` as
 * `/index.md`), `llms.txt` listing them in the sidebar's sections with each page's description
 * (llmstxt.org), and `llms-full.txt`, every page in that order in one file.
 *
 * A page's Markdown is its MDX without the front matter: a `<CodeTabs>` becomes its sample's code,
 * one block per binding; a `<Demo>`, a pointer to the live page; an `<InstallTabs>`, its npm line; and
 * a link to a page of the site, absolute. The sections are `src/nav.ts`'s, imported with its titles
 * module answered from the front matter, as the build's plugin answers it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { dirname, join, relative } from "node:path"
import { AREAS, type Example, EXAMPLES, hasExample, routeOf } from "@wardic/example-storefront-shared/examples"
import { fieldOfPages, pagesUnder } from "../plugins/page-front-matter.ts"

/** The bindings a sample can be written for, in `CodeTabs`' order, with their labels and their fences' languages. */
const BINDINGS = [
  { file: "solid2.tsx", label: "Solid 2", lang: "tsx" },
  { file: "solid1.tsx", label: "Solid 1 (v1)", lang: "tsx" },
  // Foldkit's form is a `.ts` file: a view takes Foldkit's builder, not JSX (#795).
  { file: "foldkit.ts", label: "Foldkit", lang: "ts" },
  { file: "motion.tsx", label: "Motion", lang: "tsx" },
] as const

/** A self-closing component of the site's on a line of its own, `<CodeTabs sample="enter" />`. */
const COMPONENT = /^\s*<(CodeTabs|Demo|InstallTabs|Storefront)\s+([^>]*?)\/>\s*$/

/** Where each storefront is served, as `src/components/Storefront.tsx` links them. */
const STOREFRONTS = { solid2: "https://solid2.wardic.dev", foldkit: "https://foldkit.wardic.dev" } as const

/** An example's line, as `<Storefront>` renders it: its title linked, its summary, and its Foldkit page. */
const entryOf = (example: Example): string => {
  const first = hasExample("solid2", example) ? STOREFRONTS.solid2 : STOREFRONTS.foldkit
  const foldkit = hasExample("solid2", example) && hasExample("foldkit", example) ? ` ([on Foldkit](${STOREFRONTS.foldkit}${routeOf(example)}))` : ""
  return `- [${example.title}](${first}${routeOf(example)}): ${example.summary}${foldkit}`
}

/** A `<Storefront>` as Markdown (#908): a guide's examples, or every one under its area's heading. */
const storefrontOf = (guide: string | undefined): string => {
  if (guide !== undefined) return EXAMPLES.filter((example) => example.docs === guide).map(entryOf).join("\n")
  return AREAS.filter((area) => EXAMPLES.some((example) => example.area === area.id))
    .map((area) => [`## ${area.title}`, "", area.blurb, "", ...EXAMPLES.filter((example) => example.area === area.id).map(entryOf)].join("\n"))
    .join("\n\n")
}

/** A component's attributes, by name. */
const attributesOf = (source: string): Readonly<Record<string, string>> =>
  Object.fromEntries([...source.matchAll(/(\w+)="([^"]*)"/g)].map(([, name, value]) => [name!, value!]))

/** A sample's code, one fenced block per binding it's written for. */
const codeOf = (samples: string, sample: string): string =>
  BINDINGS.flatMap((binding) => {
    const file = join(samples, sample, binding.file)
    if (!existsSync(file)) return []
    return [`${binding.label}:\n\n\`\`\`${binding.lang}\n${readFileSync(file, "utf8").trimEnd()}\n\`\`\``]
  }).join("\n\n")

/** A page's Markdown, from its MDX: `url` is the page's own, for its live demos. */
export const markdownOf = (source: string, samples: string, origin: string, url: string): string => {
  const body = source.replace(/^---\n[\s\S]*?\n---\n/, "")
  let fenced = false
  const lines = body.split("\n").flatMap((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      return [line]
    }
    if (fenced) return [line]
    const component = COMPONENT.exec(line)
    if (component === null) return [line.replaceAll("](/", `](${origin}/`)]
    const attributes = attributesOf(component[2]!)
    if (component[1] === "CodeTabs") return [codeOf(samples, attributes["sample"] ?? "")]
    if (component[1] === "InstallTabs") return [`\`\`\`sh\nnpm install ${attributes["packages"] ?? ""}\n\`\`\``]
    if (component[1] === "Storefront") return [storefrontOf(attributes["guide"])]
    return [`(A live demo runs here on the page: ${url})`]
  })
  return `${lines.join("\n").trim()}\n`
}

/** A page's path, from its name: `index` is `/`, `guides/index` is `/guides`. */
const pathOf = (name: string): string => `/${name.replace(/(^|\/)index$/, "")}`

/** Where a page's Markdown is served, from its path: `/` is `/index.md`. */
const markdownPathOf = (path: string): string => (path === "/" ? "/index.md" : `${path}.md`)

interface NavPage {
  readonly path: string
  readonly title: string
}

interface NavSection {
  readonly title: string
  readonly pages: ReadonlyArray<NavPage>
  readonly groups?: ReadonlyArray<{ readonly title: string; readonly pages: ReadonlyArray<NavPage> }>
}

/** The sidebar's sections, from `src/nav.ts`, its `virtual:page-titles` answered with `titles`. */
const navOf = async (site: string, titles: Readonly<Record<string, string>>): Promise<ReadonlyArray<NavSection>> => {
  const module = `data:text/javascript,export default ${encodeURIComponent(JSON.stringify(titles))}`
  registerHooks({
    resolve: (specifier, context, next) => {
      if (specifier === "virtual:page-titles") return { url: module, shortCircuit: true }
      return next(specifier, context)
    },
  })
  const { NAV } = (await import(join(site, "src", "nav.ts"))) as { readonly NAV: ReadonlyArray<NavSection> }
  return NAV
}

/** Write each page's Markdown, `llms.txt` and `llms-full.txt` into `client`. */
export const writeLlms = async (site: string, client: string, origin: string): Promise<void> => {
  const content = join(site, "src", "content")
  const samples = join(site, "samples")
  const titles = fieldOfPages(content, "title")
  const descriptions = fieldOfPages(content, "description")

  // Each page's name and Markdown, by its path.
  const pages = new Map<string, { readonly name: string; readonly markdown: string }>()
  for (const file of pagesUnder(content)) {
    const name = relative(content, file).replace(/\.mdx$/, "")
    const path = pathOf(name)
    const markdown = markdownOf(readFileSync(file, "utf8"), samples, origin, origin + path)
    pages.set(path, { name, markdown })
    const out = join(client, markdownPathOf(path).slice(1))
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, markdown)
  }

  // The sections, as the sidebar has them; the pages it leaves out, last, under "Optional".
  const descriptionOf = (path: string): string => descriptions[pages.get(path)?.name ?? ""] ?? ""
  const linkOf = (page: NavPage): string => `- [${page.title}](${origin}${markdownPathOf(page.path)}): ${descriptionOf(page.path)}`
  const sections: Array<{ readonly title: string; readonly pages: ReadonlyArray<NavPage> }> = []
  for (const section of await navOf(site, titles)) {
    sections.push({ title: section.title, pages: section.pages })
    for (const group of section.groups ?? []) sections.push({ title: `${section.title}: ${group.title}`, pages: group.pages })
  }
  const listed = new Set(sections.flatMap((section) => section.pages.map((page) => page.path)))
  const rest = [...pages]
    .filter(([path]) => !listed.has(path))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, page]) => ({ path, title: titles[page.name] ?? path }))
  if (rest.length > 0) sections.push({ title: "Optional", pages: rest })

  const intro = [
    "# Wardic",
    "",
    `> ${descriptions["index"]}`,
    "",
    "Install `@wardic/solid`, `@wardic/dom` and `effect`. On Solid 2, import from `@wardic/solid`; on Solid 1, from `@wardic/solid/v1`, deprecated. Each link below is the page as Markdown; " +
      `${origin}/llms-full.txt has every page in one file.`,
  ].join("\n")
  const list = sections.map((section) => `## ${section.title}\n\n${section.pages.map(linkOf).join("\n")}`).join("\n\n")
  writeFileSync(join(client, "llms.txt"), `${intro}\n\n${list}\n`)

  const order = new Set(sections.flatMap((section) => section.pages.map((page) => page.path)))
  const full = [...order].flatMap((path) => {
    const page = pages.get(path)
    if (page === undefined) return []
    return [`<!-- ${origin}${path} -->\n\n${page.markdown}`]
  })
  writeFileSync(join(client, "llms-full.txt"), `${intro}\n\n${full.join("\n---\n\n")}`)
  console.log(`llms: ${pages.size} pages as Markdown, llms.txt and llms-full.txt into dist/client`)
}
