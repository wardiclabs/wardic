/**
 * The core and dom references (#558): each module of `@wardic/core` and `@wardic/dom`, from its source's
 * JSDoc as it is, by TypeDoc and typedoc-plugin-markdown, as MDX pages the site renders as any other,
 * under `src/content/reference/{core,dom}/`. Made before every build and dev run, and left out of git,
 * so they can't drift from the code. It runs on Node (24 runs TypeScript as it is), as prerender.ts.
 *
 * - A module is a page: `@wardic/core/DragActivity` is `/reference/core/drag-activity`. The types its
 *   exports name but its module doesn't export (typedoc-plugin-missing-exports) go on a page beside it,
 *   `/reference/core/drag-activity/internal`. Each package's index lists its modules.
 * - Each page takes front matter, its title the module's name and its description its doc's first
 *   sentence, and TypeDoc's links between its files become the site's paths.
 * - A module is published once its JSDoc is the reader's (what it's for, how it's used, an example; the
 *   maintainer's issues and ADRs in `//` comments): `READY` lists them, and each area's rewrite adds its
 *   own. A link to a module that isn't yet is its text alone, and a package with none has no pages.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, normalize, relative } from "node:path"
import { Application, type Context, Converter, ReferenceType, ReflectionKind, ReflectionType } from "typedoc"

const SITE = join(import.meta.dirname, "..")
const REPO = join(SITE, "..")
const CONTENT = join(SITE, "src", "content", "reference")

/** Each package referenced: its name in the site's paths, and what its index says it is. */
const PACKAGES = [
  { dir: "core", name: "@wardic/core", about: "Wardic's engine: animations, gestures, layout projection and the services an Environment provides, free of any framework or platform." },
  { dir: "dom", name: "@wardic/dom", about: "The browser's Environment for Wardic: its renderer, input, probe, projection system and the services a binding builds on." },
] as const

/** A module's name as a path segment: `DragActivity` is `drag-activity`, `Svg` is `svg`. */
const slugOf = (name: string): string =>
  name
    .replace(/([a-z\d])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()

/**
 * The modules whose JSDoc is the reader's, by package: only these are published. Each area's rewrite
 * adds its modules (#558).
 */
const READY: Readonly<Record<(typeof PACKAGES)[number]["dir"], ReadonlyArray<string>>> = {
  core: [
    // Animation.
    "Arc", "Easing", "Inertia", "Machine", "Playback", "Scalar", "Sequence", "Spring", "Stagger", "Velocity", "Wave",
    // Values.
    "BaseValue", "DefaultTransition", "Interpolator", "InterpolatorRegistry", "LiveValue", "Override", "ReducedMotion", "Supersede", "Values",
    // Input and gestures.
    "AutoScroll", "Drag", "DragActivity", "DragRecognizer", "InputFeed", "InputSource", "PressClaims", "Recognizer", "Reorder",
  ],
  dom: [],
}

/** Every file under `dir`, recursively. */
const filesUnder = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return filesUnder(path)
    return [path]
  })

/**
 * A module's overview: its source file's opening doc comment, as Markdown, `{@link X}` as `X`'s code
 * span, and prose that MDX would read as JSX escaped. Its files carry no `@module` tag, so TypeDoc
 * doesn't take it as the module's comment.
 */
const overviewOf = (file: string): string | undefined => {
  const match = /^\s*\/\*\*([\s\S]*?)\*\//.exec(readFileSync(file, "utf8"))
  if (match === null) return undefined
  const text = match[1]!
    .split("\n")
    .map((line) => line.replace(/^\s*\* ?/, ""))
    .join("\n")
    .trim()
    .replace(/\{@link\s+([^}\s|]+)[^}]*\}/g, "`$1`")
  // Its `@example`, to the comment's end, as a TypeScript block; the prose before it, escaped.
  const [prose, example] = text.split(/^@example[ \t]*\n/m)
  const escaped = prose!
    .trim()
    .split(/(`+[^`]*`+)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/[<{}]/g, (c) => `\\${c}`)))
    .join("")
  if (example === undefined) return escaped
  return `${escaped}\n\n\`\`\`ts\n${example.trim()}\n\`\`\``
}

/**
 * A page's description: its overview's first sentence, plain. An opening "The `Spring` module:" is
 * left out, and so is a bracket that holds an issue or an ADR.
 */
const descriptionOf = (overview: string): string => {
  let flat = overview.replace(/\s+/g, " ")
  // Innermost first: `(#548, ADR-0067 *Amendment (#548)*)` goes in two steps.
  for (let before = ""; before !== flat; ) {
    before = flat
    flat = flat.replace(/\s*\((?:[^()]|\([^()]*\))*?(?:#\d|ADR-\d)(?:[^()]|\([^()]*\))*\)/g, "")
  }
  flat = flat
    .replace(/^The `?\w+`? module[.:] /, "")
    .replace(/\*/g, "")
    .trim()
  const end = /\.(\s|$)/.exec(flat)
  const sentence = end === null ? flat : flat.slice(0, end.index + 1)
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

/** A heading's anchor, as rehype-slug (github-slugger) makes it from its text. */
const slugOfHeading = (text: string): string =>
  text
    .replace(/\\(.)/g, "$1")
    .replace(/`/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-")

/**
 * A page's same-page links fixed: TypeDoc's markdown plugin can number an anchor (`#groupoptions-1`)
 * the page has once, as `#groupoptions`; such a link goes to the one it has.
 */
const fixAnchors = (page: string): string => {
  const seen = new Map<string, number>()
  const anchors = new Set<string>()
  for (const [, text] of page.matchAll(/^#{1,6} (.+)$/gm)) {
    const base = slugOfHeading(text!)
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    anchors.add(n === 0 ? base : `${base}-${n}`)
  }
  return page.replace(/\]\(#([^)\s]+)\)/g, (whole, anchor: string) => {
    if (anchors.has(anchor)) return whole
    const base = anchor.replace(/-\d+$/, "")
    return anchors.has(base) ? `](#${base})` : whole
  })
}

/**
 * Where an output file goes, and its route: a module's `X.mdx` (or `X/README.mdx`, when it has
 * internal types) is `x`, its `X/-internal-.mdx` is `x/internal`, the package's `README.mdx` is its index.
 */
const placeOf = (file: string): string => {
  const parts = file.replace(/\.mdx$/, "").split("/")
  if (parts.length === 1 && parts[0] === "README") return "index"
  if (parts.length === 1) return slugOf(parts[0]!)
  if (parts[1] === "README") return slugOf(parts[0]!)
  if (parts[1] === "-internal-") return `${slugOf(parts[0]!)}/internal`
  throw new Error(`reference: no place for TypeDoc's ${file}`)
}

/** A link's target, from the file `from`, as the site's path: TypeDoc's `../Box.mdx#box` is `/reference/core/box#box`. */
const routeOf = (dir: string, from: string, target: string): string => {
  const [path, hash] = target.split("#")
  if (path === undefined || path === "") return target
  const place = placeOf(normalize(join(dirname(from), path)))
  const route = place === "index" ? `/reference/${dir}` : `/reference/${dir}/${place}`
  return hash === undefined ? route : `${route}#${hash}`
}

/** The module a TypeDoc output file is, or a link's target is in: `Box.mdx#box` and `Box/README.mdx` are `Box`. */
const moduleOfFile = (file: string): string => file.split("/")[0]!.replace(/\.mdx$/, "")

/**
 * Each Effect service's members as its class's own: a `Context.Service` class's instance is the service,
 * but TypeDoc shows the class it extends (Effect's `ServiceClass.Shape<…>`, the members in its type,
 * their docs left out) and a constructor no one calls. Its members are lifted onto it before TypeDoc
 * groups them, its constructor left out, and it extends `Context.Service`.
 */
const liftServices = (context: Context): void => {
  for (const service of context.project.getReflectionsByKind(ReflectionKind.Class)) {
    if (!service.isDeclaration()) continue
    const shape = service.extendedTypes?.find((type) => type instanceof ReferenceType && type.package === "effect" && type.qualifiedName === "ServiceClass.Shape")
    const members = shape instanceof ReferenceType ? shape.typeArguments?.[1] : undefined
    if (!(members instanceof ReflectionType)) continue
    for (const constructor of service.getChildrenByKind(ReflectionKind.Constructor)) context.project.removeReflection(constructor)
    for (const member of members.declaration.children ?? []) {
      member.parent = service
      service.addChild(member)
    }
    service.extendedTypes = [ReferenceType.createBrokenReference("Context.Service", context.project, "effect")]
  }
}

/** One package's ready modules as MDX pages in `CONTENT/<dir>`. */
const generate = async (pkg: (typeof PACKAGES)[number]): Promise<number> => {
  const source = join(REPO, "packages", pkg.dir)
  const ready = new Set(READY[pkg.dir])
  const target = join(CONTENT, pkg.dir)
  rmSync(target, { recursive: true, force: true })
  if (ready.size === 0) return 0
  const out = mkdtempSync(join(tmpdir(), `wardic-reference-${pkg.dir}-`))
  const app = await Application.bootstrapWithPlugins({
    entryPoints: [join(source, "src", "*.ts")],
    exclude: [join(source, "src", "index.ts")],
    tsconfig: join(source, "tsconfig.json"),
    plugin: ["typedoc-plugin-markdown", "typedoc-plugin-missing-exports"],
    out,
    readme: "none",
    excludePrivate: true,
    excludeInternal: true,
    excludeExternals: true,
    disableSources: true,
    skipErrorChecking: true,
    logLevel: "Error",
    // typedoc-plugin-markdown's: MDX, a page per module, no header or breadcrumbs (the site has its
    // own), escaped comments (a bare `<A>` in prose is JSX to MDX), and the index as a table.
    fileExtension: ".mdx",
    outputFileStrategy: "modules",
    hidePageHeader: true,
    hideBreadcrumbs: true,
    sanitizeComments: true,
    indexFormat: "table",
    useCodeBlocks: true,
  } as Parameters<typeof Application.bootstrapWithPlugins>[0])
  app.converter.on(Converter.EVENT_RESOLVE_BEGIN, liftServices)
  const project = await app.convert()
  if (project === undefined) throw new Error(`reference: TypeDoc couldn't convert ${pkg.name}`)
  await app.generateOutputs(project)

  /** A page's front matter. */
  const frontOf = (title: string, description: string): string => `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\n---\n\n`
  /** Writes a page at its place. */
  const write = (place: string, text: string): void => {
    const path = join(target, `${place}.mdx`)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }
  // Each module's page and its internal types' page, TypeDoc's, with the module's overview after its
  // heading. TypeDoc's own index is left out: the package's is written below.
  const modules: Array<{ readonly name: string; readonly place: string; readonly description: string }> = []
  const files = filesUnder(out).filter((file) => file.endsWith(".mdx") && relative(out, file) !== "README.mdx" && ready.has(moduleOfFile(relative(out, file))))
  for (const file of files) {
    const from = relative(out, file)
    const place = placeOf(from)
    const module = moduleOfFile(from)
    const internal = place.endsWith("/internal")
    const overview = internal ? undefined : overviewOf(join(source, "src", `${module}.ts`))
    const description = internal ? `The types ${pkg.name}/${module}'s exports name that it doesn't export.` : descriptionOf(overview ?? `${pkg.name}/${module}.`)
    if (!internal) modules.push({ name: module, place, description })
    // Its heading the page's title (TypeDoc's internal page is `# <internal>`), its overview after it.
    const title = internal ? `${module}: its internal types` : module
    const page = readFileSync(file, "utf8").replace(/^# .+\n/, () => (overview === undefined ? `# ${title}\n` : `# ${title}\n\n${overview}\n`))
    // TypeDoc's one-row table of the internal types' page, as a sentence.
    const linked = page.replace(
      /## Modules\n\n\| Module \| Description \|\n\| -+ \| -+ \|\n\| \[\\<internal\\>\]\(([^)]+)\) \| - \|\n/,
      (_whole, link: string) => `Its exports also name types the module doesn't export: [its internal types](${link}).\n`,
    )
    // TypeDoc's links between its files as the site's paths; one to a module not yet published, its text.
    const body = fixAnchors(linked).replace(/\[([^\]]*)\]\(([^)\s]+\.mdx(?:#[^)\s]*)?)\)/g, (_whole, text: string, link: string) => {
      const into = moduleOfFile(normalize(join(dirname(from), link.split("#")[0]!)))
      if (into !== "README" && !ready.has(into)) return text
      return `[${text}](${routeOf(pkg.dir, from, link)})`
    })
    write(place, frontOf(title, description) + body)
  }
  // The package's index: what it is, and each module with its description.
  const rows = modules
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((module) => `| [${module.name}](/reference/${pkg.dir}/${module.place}) | ${module.description.replace(/\|/g, "\\|")} |`)
  write(
    "index",
    frontOf(pkg.name, pkg.about) +
      `# ${pkg.name}\n\n${pkg.about} Each module is \`${pkg.name}/<Module>\`, and each page is generated from its source's doc comments.\n\n| Module | |\n| --- | --- |\n${rows.join("\n")}\n`,
  )
  rmSync(out, { recursive: true, force: true })
  return files.length + 1
}

// Each package in a process of its own: typedoc-plugin-missing-exports loads once per process.
const asked = PACKAGES.find((pkg) => pkg.dir === process.argv[2])
if (asked !== undefined) {
  const count = await generate(asked)
  console.log(`reference: ${count} pages of ${asked.name} into src/content/reference/${asked.dir}`)
} else {
  for (const pkg of PACKAGES) execFileSync(process.execPath, [import.meta.filename, pkg.dir], { stdio: "inherit" })
}
