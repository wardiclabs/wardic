// Per-value transitions' types (#301, Motion's `TransitionWithValueOverrides`), checked by the type
// checker (`typecheck:tests`): a transition takes an entry under any value's name, `default` and
// `layout`, each a spring or a tween; no value's name is one of a transition's own fields.
//
// - VK1: no value's name is a transition's own field, so an entry is never read as one.
// - VK2: an entry is a spring or a tween, `inherit` too; not the orchestration, which is the whole
//   transition's.
// - VK3: every value's name takes an entry: a style, a transform shorthand, an SVG attribute, a CSS
//   variable; and `default` and `layout`. A name that's no value is rejected.
// - VK4: a variant's own transition and a gesture target's take entries too.
import type * as Machine from "@wardic/core/Machine"
import type { WardicReducedMotion, WardicTransition, WardicValueKey, WardicValueTransition, WardicVariant } from "@wardic/solid"
import { describe, expectTypeOf, it } from "vitest"
import type { WardicOrchestration } from "../src/config.ts"

/** A transition's own fields, on either arm, and the names an entry is read under besides a value's. */
type OwnField =
  | keyof ({ readonly type?: "spring" } & Omit<Machine.SpringOptions, "from">)
  | keyof ({ readonly type: "tween" } & Machine.AnimateOptions)
  | keyof WardicOrchestration
  | keyof WardicReducedMotion
  | "inherit"
  | "default"
  | "layout"

describe("per-value transitions' types (#301)", () => {
  it("VK1: no value's name is a transition's own field", () => {
    expectTypeOf<Extract<WardicValueKey, OwnField>>().toBeNever()
    expectTypeOf<"opacity">().toExtend<WardicValueKey>()
    expectTypeOf<"--accent">().toExtend<WardicValueKey>()
  })

  it("VK2: an entry is a spring or a tween, inherit too; not the orchestration", () => {
    expectTypeOf<{ readonly stiffness: 300 }>().toExtend<WardicValueTransition>()
    expectTypeOf<{ readonly type: "tween"; readonly duration: 0.2 }>().toExtend<WardicValueTransition>()
    expectTypeOf<{ readonly inherit: true; readonly delay: 0.1 }>().toExtend<WardicValueTransition>()
    const spring: WardicTransition = { opacity: { stiffness: 300, damping: 20 } }
    const tween: WardicTransition = { opacity: { type: "tween", duration: 0.2 } }
    // @ts-expect-error a duration is a tween's, as on a whole transition
    const untyped: WardicTransition = { opacity: { duration: 0.2 } }
    // @ts-expect-error the orchestration is the whole transition's
    const staggered: WardicTransition = { opacity: { staggerChildren: 0.1 } }
    void [spring, tween, untyped, staggered]
  })

  it("VK3: every value's name takes an entry, and default and layout; a name that's no value is rejected", () => {
    const fast = { type: "tween", duration: 0.2 } as const
    const every: WardicTransition = { opacity: fast, "background-color": fast, x: fast, scale: fast, pathLength: fast, "--accent": fast, default: fast, layout: fast }
    // @ts-expect-error no value has this name
    const unknown: WardicTransition = { opacityy: fast }
    void [every, unknown]
  })

  it("VK4: a variant's own transition and a gesture target's take entries too", () => {
    const variant: WardicVariant = { opacity: 1, x: 10, transition: { type: "tween", duration: 1, opacity: { type: "tween", duration: 0.2, inherit: true } } }
    void variant
  })
})
