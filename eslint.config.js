// The Effect-first rules (#63, ADR-0025, docs/agents/effect-first.md), held on @wardic/core's
// source. dom, solid and test follow the rules for new code; their conversion (#69) extends
// `files` here. Lint can't judge whether a Predicate is *named*, or whether Match or Scope
// "fits": those stay with review.
import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"

const PAGE = "docs/agents/effect-first.md"

/** A `no-restricted-syntax` entry whose message points at the rules page. */
const restrict = (selector, message) => ({ selector, message: `${message} (${PAGE}).` })

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

export default defineConfig([
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
])
