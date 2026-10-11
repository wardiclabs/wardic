// The Effect-first rules (#63, ADR-0025, docs/agents/effect-first.md), held on @wardic/core's
// source. dom, solid and test follow the rules for new code; their conversion (#69) extends
// `files` here. Lint can't judge whether a Predicate is *named*, or whether Match or Scope
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

/** Rule 5: code in the repo imports core's subpaths. */
const SUBPATHS = [
  restrictShape(
    "ImportDeclaration[source.value='@wardic/core']",
    'Import the module\'s subpath: import * as X from "@wardic/core/X"; the root\'s namespaces are for users',
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

export default defineConfig([
  { ignores: ["**/dist/**"] },
  {
    files: ["packages/core/src/**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "no-ternary": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "no-restricted-syntax": ["error", ...BRANCHES, ...CHECKS, ...LOOPS, ...ALIASES],
    },
  },
  {
    files: PER_FRAME_LOOPS,
    rules: {
      "no-restricted-syntax": ["error", ...BRANCHES, ...CHECKS, ...ALIASES],
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
      "no-restricted-syntax": ["error", ...BRANCHES, ...CHECKS, ...LOOPS, ...ALIASES, ...ROOT],
    },
  },
  {
    // Only this rule here: the Effect-first rules reach dom, solid and test with #69.
    files: ["packages/{dom,solid,test}/{src,test}/**/*.{ts,tsx}", "packages/core/bench/**/*.ts"],
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
    files: ["packages/{dom,solid}/src/**/*.{ts,tsx}"],
    ignores: ["packages/dom/src/clock.ts"],
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
