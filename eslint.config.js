// The Effect-first rules (#63, ADR-0025, docs/agents/effect-first.md), held on @wardic/core's
// source, and on @wardic/dom's as #69 converts it (ADR-0025, *Amendment (#69)*): its PR 2 takes
// dom's source but `internal/projection.ts`, which its PR 3 converts. solid and test follow the
// rules for new code until their own PRs. Lint can't judge whether a Predicate is *named*, or whether Match or Scope
// "fits": those stay with review.
//
// And the pipeable API's shape (#95, ADR-0028 decision 10, docs/agents/pipeable.md): the root
// re-exports namespaces only, and code in the repo imports core's subpaths.
//
// And the Refresh frames (#52, ADR-0031 decision 6): dom and the bindings request frames from the
// Environment's `RefreshFrameSource`, never from the browser's own functions.
import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"

const PAGE = "docs/agents/effect-first.md"

/**
 * The browser's frame functions, which only `ClockDomLive` reads: it provides them as the
 * Environment's `RefreshFrameSource`, the one the Clock ticks on and the flush gate requests its
 * flushes from (ADR-0031).
 */
const FRAME_FUNCTIONS = ["requestAnimationFrame", "cancelAnimationFrame"]
const FRAME_MESSAGE = "Request Refresh frames from the Environment's RefreshFrameSource, not the browser (ADR-0031)."

/** A `no-restricted-syntax` entry whose message points at the rules page. */
const restrict = (selector, message) => ({ selector, message: `${message} (${PAGE}).` })

/** The same, pointing at the pipeable API's rules. */
const restrictShape = (selector, message) => ({ selector, message: `${message} (docs/agents/pipeable.md).` })

/** Rule 1: the root, `src/index.ts`, re-exports each module as a namespace, and nothing else. */
const ROOT = [
  restrictShape(
    "ExportAllDeclaration[exported=null]",
    'The root re-exports each module as a namespace: export * as X from "./X.ts", not export *',
  ),
  restrictShape("ExportNamedDeclaration", "The root re-exports namespaces only: an export lives in its module"),
]

/**
 * Rule 5: code in the repo imports core's subpaths, and dom's (#132, ADR-0041): dom's root keeps
 * `DomLive` and `VERSION` for an app, and its namespaces are for users.
 */
const SUBPATHS = [
  restrictShape(
    "ImportDeclaration[source.value='@wardic/core']",
    'Import the module\'s subpath: import * as X from "@wardic/core/X"; the root\'s namespaces are for users',
  ),
  restrictShape(
    "ImportDeclaration[source.value='@wardic/dom'] > ImportSpecifier[imported.name!=/^(DomLive|VERSION)$/]",
    'Import dom\'s module by its subpath: import * as X from "@wardic/dom/X"; its root keeps DomLive and VERSION (ADR-0041)',
  ),
  restrictShape(
    "ImportDeclaration[source.value='@wardic/dom'] > ImportNamespaceSpecifier",
    'Import dom\'s module by its subpath: import * as X from "@wardic/dom/X" (ADR-0041)',
  ),
  restrictShape(
    "ImportDeclaration[source.value=/^@wardic\\/dom\\/internal\\//]",
    "dom's internal/ is its own: import a public module (ADR-0041)",
  ),
]

/** Rule 2 and the `if` / `switch` split (ADR-0025, decisions 1 and 2). */
const BRANCHES = [
  restrict("SwitchStatement", "Use Match, not switch"),
  restrict(
    "IfStatement[alternate]",
    "A branch that picks a value is a match (Bool.match, Option.match, Match); an if with no else stays only as a guard or a per-frame early return",
  ),
]

/** A `no-restricted-syntax` entry whose message points at the span rule's record. */
const restrictSpan = (selector, message) => ({ selector, message: `${message} (ADR-0040, decision 2).` })

/**
 * No Wardic span captures a call-site stack (#87, ADR-0040, decision 2). Every `withSpan` passes
 * `captureStackTrace: false` where Effect reads it: data-first in its options,
 * `Effect.withSpan(effect, name, { captureStackTrace: false })`; pipeable as its third argument,
 * `Effect.withSpan(name, options, { captureStackTrace: false })`; `Stream.withSpan(name, { … })` in
 * its options. TypeScript rejects it anywhere else. `Effect.fn` always captures one, at its
 * definition and at every call, with no option to stop it.
 */
const SPANS = [
  restrictSpan(
    "CallExpression[callee.object.name='Effect'][callee.property.name='fn']",
    "Effect.fn captures a call-site stack at its definition and at every call: use Effect.gen with Effect.withSpan",
  ),
  restrictSpan(
    "CallExpression[callee.object.name=/^(Effect|Stream)$/][callee.property.name='withSpan']:not(:has(Property[key.name='captureStackTrace']))",
    "A Wardic span captures no call-site stack: pass captureStackTrace: false (pipeable Effect.withSpan: its third argument)",
  ),
]

/**
 * Core names no Environment's event fields (#189, ADR-0036 *Amendment (#189)*): an Environment maps
 * its platform's events onto core's own words, a pointer's `kind`, `pressed`, `button` and
 * `primary`, a key's `handled` and `handle()`. The DOM's names for them, as an identifier or a
 * string, don't belong in core's source.
 */
const DOM_EVENT_NAMES = "pointerType|buttons|isPrimary|deltaX|deltaY|deltaZ|deltaMode|preventDefault|defaultPrevented"
const EVENT_NAMES = [`Identifier[name=/^(${DOM_EVENT_NAMES})$/]`, `Literal[value=/^(${DOM_EVENT_NAMES})$/]`].map((selector) => ({
  selector,
  message:
    "Core names no Environment's event fields: use core's own (a pointer's kind, pressed, button and primary; a key's handled and handle()) (ADR-0036, Amendment (#189)).",
}))

/** Rule 1: missing values and boolean checks. */
const CHECKS = [
  restrict("LogicalExpression[operator='??']", "A missing value is an Option, not ??"),
  restrict("AssignmentExpression[operator='??=']", "A missing value is an Option, not ??="),
  restrict("ChainExpression", "A missing value is an Option, not ?."),
  restrict(
    "BinaryExpression[operator=/^[!=]==?$/] > Identifier[name='undefined']",
    "A missing value is an Option; check with Option or Predicate.isUndefined, not === undefined",
  ),
  restrict("BinaryExpression > UnaryExpression[operator='typeof']", "Check with a named Predicate (Predicate.isString, …), not typeof"),
]

/** Rule 1: loops. */
const LOOPS = ["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"].map((loop) =>
  restrict(loop, "Loop with Arr / Rec / Iter or Effect.forEach / Effect.all; only the per-frame files in eslint.config.js keep a for"),
)

/** The modules that hide a global take a fixed alias (ADR-0025, decision 5). */
const ALIASES = [
  restrict(
    "ImportNamespaceSpecifier[local.name=/^(Array|Record|Number|String|Boolean|Iterable)$/]",
    "This import hides a global: alias effect/Array, Record, Number, String, Boolean and Iterable as Arr, Rec, Num, Str, Bool and Iter",
  ),
  restrict("ImportNamespaceSpecifier[local.name='Function']", "This import hides a global: import effect/Function's members by name"),
]

/**
 * The per-frame files whose per-frame code keeps a counted loop or a loop over a stream's keys
 * (ADR-0025, decision 3): `Spring.step`'s substeps, `Machine`'s `blendAt` and `springValues`'
 * step, `Interpolator`'s `complex` blend (number by number), `Scalar.snapTo`,
 * `Projection.applyTreeDeltas`, and the Frame loop's tick (ADR-0027).
 */
const PER_FRAME_LOOPS = [
  "packages/core/src/Spring.ts",
  "packages/core/src/internal/frameLoop.ts",
  "packages/core/src/Machine.ts",
  "packages/core/src/Interpolator.ts",
  "packages/core/src/Scalar.ts",
  "packages/core/src/Projection.ts",
]

/**
 * The per-frame files whose reads by index are plain, `xs[i]`, never `Arr.getUnsafe`: a `dual`
 * call with a bounds check, which V8 doesn't reduce to an index (ADR-0030, decision 10). The
 * loop files, and `Easing.ts`' sampled spring. Input-event code (`Reorder.ts`,
 * `Velocity.trailing`) keeps `getUnsafe`.
 */
const PER_FRAME_READS = [...PER_FRAME_LOOPS, "packages/core/src/Easing.ts"]

/**
 * dom's per-frame files (ADR-0025, *Amendment (#69)*, decision 2), by core's file-level rule: the
 * projection pass and the Measure pass's reads per node, the gate's `write` and flush, the
 * Renderer's `project`, the SVG split in a flush, the scale correctors and the Key rules'
 * `KeyBlend`s. Their cold code follows the full rules by review, as `Machine.ts`'s does.
 */
const DOM_PER_FRAME = [
  "packages/dom/src/internal/projection.ts",
  "packages/dom/src/internal/gate.ts",
  "packages/dom/src/internal/renderer.ts",
  "packages/dom/src/internal/svg.ts",
  "packages/dom/src/internal/scale-correction.ts",
  "packages/dom/src/internal/key-rules.ts",
  "packages/dom/src/internal/measure.ts",
]

export default defineConfig([
  { ignores: ["**/dist/**"] },
  {
    files: ["packages/core/src/**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "no-ternary": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "no-restricted-syntax": ["error", ...BRANCHES, ...CHECKS, ...LOOPS, ...ALIASES, ...SPANS, ...EVENT_NAMES],
    },
  },
  {
    files: PER_FRAME_LOOPS,
    rules: {
      "no-restricted-syntax": ["error", ...BRANCHES, ...CHECKS, ...ALIASES, ...SPANS, ...EVENT_NAMES],
    },
  },
  {
    files: PER_FRAME_READS,
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Arr",
          property: "getUnsafe",
          message: `An index in range on the per-frame path is a plain read, xs[i], not Arr.getUnsafe (${PAGE}).`,
        },
      ],
    },
  },
  {
    files: ["packages/core/src/index.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...BRANCHES, ...CHECKS, ...LOOPS, ...ALIASES, ...ROOT, ...SPANS, ...EVENT_NAMES],
    },
  },
  {
    // Only this rule here: the Effect-first rules reach dom, solid and test with #69.
    files: ["packages/{dom,solid,test}/{src,test}/**/*.{ts,tsx}", "packages/{core,solid}/bench/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    // solid's code carries eslint-plugin-solid's `solid/reactivity` directives, for an editor
    // that runs the plugin; this lint doesn't, so the rule is named here, doing nothing, and its
    // directives aren't reported as unused.
    plugins: { solid: { rules: { reactivity: { create: () => ({}) } } } },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      "no-restricted-syntax": ["error", ...SUBPATHS],
    },
  },
  {
    // dom's and solid's source take the span rule too (ADR-0040, decision 2), over the block above.
    files: ["packages/{dom,solid}/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...SUBPATHS, ...SPANS],
    },
  },
  {
    // dom's source takes the Effect-first rules (#69's PR 2); `projection.ts` with PR 3.
    files: ["packages/dom/src/**/*.ts"],
    ignores: ["packages/dom/src/internal/projection.ts"],
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "no-ternary": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "no-restricted-syntax": ["error", ...SUBPATHS, ...SPANS, ...BRANCHES, ...CHECKS, ...LOOPS, ...ALIASES],
    },
  },
  {
    // Its per-frame files keep a `for` and plain index reads (ADR-0025, *Amendment (#69)*, decision 2).
    files: DOM_PER_FRAME,
    ignores: ["packages/dom/src/internal/projection.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...SUBPATHS, ...SPANS, ...BRANCHES, ...CHECKS, ...ALIASES],
      "no-restricted-properties": [
        "error",
        {
          object: "Arr",
          property: "getUnsafe",
          message: `An index in range on the per-frame path is a plain read, xs[i], not Arr.getUnsafe (${PAGE}).`,
        },
      ],
    },
  },
  {
    files: ["packages/{dom,solid}/src/**/*.{ts,tsx}"],
    ignores: ["packages/dom/src/internal/clock.ts"],
    rules: {
      "no-restricted-globals": ["error", ...FRAME_FUNCTIONS.map((name) => ({ name, message: FRAME_MESSAGE }))],
      "no-restricted-properties": [
        "error",
        ...["window", "globalThis", "self"].flatMap((object) =>
          FRAME_FUNCTIONS.map((property) => ({ object, property, message: FRAME_MESSAGE }))
        ),
      ],
    },
  },
])
