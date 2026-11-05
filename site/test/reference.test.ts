// The Solid reference's coverage (#558): every name either binding exports has a page, and every page
// names only what a binding exports. A page lists the exports it documents in its front matter's
// `api: [a, b]`; the names whose pages are still to come are in `PENDING`, which only shrinks.
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const REPO = join(import.meta.dirname, "../..")
const SOLID = join(REPO, "packages/solid/src")
const REFERENCE = join(REPO, "site/src/content/reference/solid")

/** The names whose pages come in a later PR of #558's reference, by family. Each PR empties its own. */
const PENDING: ReadonlyArray<string> = [
  // live-values
  ...["createSpring", "createFollowValue", "createTransform", "createScroll", "createVelocity", "createTime", "createAnimationFrame", "createWillChange", "SpringAccessor"],
  ...["FollowAccessor", "FollowValueOptions", "Live", "LiveSource", "ElementSource", "ScrollOptions", "ScrollValues", "WillChange"],
  // animation
  ...["createAnimate", "WardicAnimate", "WardicAnimateOptions", "WardicAnimationScope", "WardicAnimationScopeV2", "WardicScopeLanding", "WardicAnimationSequence"],
  ...["WardicAnimationSubject", "WardicElementSegment", "WardicFunctionSegment", "WardicPlayState", "WardicPlaybackControls", "WardicSegment", "WardicSegmentOptions"],
  ...["WardicSegmentTarget", "WardicSequenceLabel", "WardicSequenceOptions", "WardicSequenceTime", "createAnimationControls", "WardicAnimationControls", "WardicControlsDefinition"],
  // transitions
  ...["WardicTransition", "WardicTransitionEntries", "WardicValueTransition", "WardicVariantTransition", "WardicOrchestration", "WardicInertia", "WardicPath", "WardicArcOptions"],
  ...["arc", "stagger", "WardicStagger", "WardicStaggerOptions", "anticipate", "backIn", "backInOut", "backOut", "circIn", "circInOut", "circOut", "cubicBezier"],
  ...["easeIn", "easeInOut", "easeOut", "steps"],
  // utilities
  ...["VERSION", "createCycle", "Cycle", "createReducedMotion", "createReducedMotionConfig", "isValidWardicProp", "isWardicComponent", "unwrapWardicComponent"],
  ...["transformViewBoxPoint", "correctParentTransform"],
  // advanced
  ...["useWardicRuntime", "WardicRuntime", "WardicServices", "useWardicFiber", "runScoped", "useWardicGate", "FlushGate", "FlushSink", "fromAtom", "streamToSignal"],
  ...["useVariantContext", "WardicVariantContext", "WardicVariantContextValue", "runDragTrack", "RunDragTrackOptions", "DragSnapshot", "DragTrackConfig"],
]

/** Every name `entry` exports, values and types alike, as the TypeScript compiler sees them. */
const exportsOf = (program: ts.Program, entry: string): ReadonlyArray<string> => {
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(entry)
  if (source === undefined) throw new Error(`no source for ${entry}`)
  const module = checker.getSymbolAtLocation(source)
  if (module === undefined) throw new Error(`no module for ${entry}`)
  return checker.getExportsOfModule(module).map((symbol) => symbol.name)
}

/** The MDX files under `dir`, at any depth. */
const pagesUnder = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return pagesUnder(path)
    if (entry.name.endsWith(".mdx")) return [path]
    return []
  })

/** A page's `api` list, from its front matter: `api: [createSpring, SpringAccessor]`. */
const apiOf = (file: string): ReadonlyArray<string> => {
  const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(file, "utf8"))?.[1] ?? ""
  const list = /^api:\s*\[([^\]]*)\]\s*$/m.exec(front)?.[1]
  if (list === undefined) return []
  return list
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "")
}

const program = ts.createProgram([join(SOLID, "index.ts"), join(SOLID, "unstable/v2/index.ts")], {
  allowImportingTsExtensions: true,
  noEmit: true,
  jsx: ts.JsxEmit.Preserve,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ESNext,
  customConditions: ["@wardic/source"],
  skipLibCheck: true,
})
const exported = new Set([...exportsOf(program, join(SOLID, "index.ts")), ...exportsOf(program, join(SOLID, "unstable/v2/index.ts"))])
const pages = pagesUnder(REFERENCE)
const documented = new Map(pages.flatMap((page) => apiOf(page).map((name) => [name, relative(REFERENCE, page)] as const)))

describe("the Solid reference's coverage (#558)", () => {
  it("RC1: every name either binding exports has a page, or is still to come", () => {
    const missing = [...exported].filter((name) => !documented.has(name) && !PENDING.includes(name)).sort()
    expect(missing, "exported, with no page and not pending").toEqual([])
  })

  it("RC2: every name a page documents is exported by a binding", () => {
    const stale = [...documented.keys()].filter((name) => !exported.has(name)).sort()
    expect(stale, "documented, but no binding exports it").toEqual([])
  })

  it("RC3: a pending name is exported, and has no page yet", () => {
    expect(PENDING.filter((name) => !exported.has(name)), "pending, but no binding exports it").toEqual([])
    expect(PENDING.filter((name) => documented.has(name)), "pending, but already documented: take it off").toEqual([])
  })
})
