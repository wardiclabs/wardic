// Variable values in the DOM (#55, ADR-0035 *Amendment (#55)*): `resolveVariable` reads a `var()`
// against an element's computed style, following fallbacks up to 4 deep (Motion's
// `getVariableValue`), and `variableValues(element)` is the Key rule a binding binds to the element.
import * as Interpolator from "@wardic/core/Interpolator"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import { InterpolatorRegistryDomLive, isVariableValue, resolveVariable, variableValues } from "@wardic/dom"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { afterEach, describe, expect, it } from "vitest"

const mounted: Array<Element> = []
afterEach(() => {
  for (const el of mounted.splice(0)) el.remove()
})

/** A child of a parent that defines `vars`, both in the document. */
const childOf = (vars: Record<string, string>): HTMLElement => {
  const parent = document.createElement("div")
  for (const [name, value] of Object.entries(vars)) parent.style.setProperty(name, value)
  const child = document.createElement("div")
  parent.append(child)
  document.body.append(parent)
  mounted.push(parent)
  return child
}

/** The blend `variableValues(el)` gives a pair through the DOM's registry, at 0, 0.5 and on the last frame; `None` when it declines. */
const ruleBlend = (el: Element, key: string, from: number | string, to: number | string) =>
  Effect.runSync(
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      const rule = registry.keyBlendOf(key, from, to)
      if (Option.isNone(rule)) return Option.none<readonly [unknown, unknown, unknown]>()
      const blend = yield* rule.value
      return Option.some([blend(0, false), blend(0.5, false), blend(0.5, true)] as const)
    }).pipe(InterpolatorRegistry.withKeyRules([variableValues(el)]), Effect.provide(InterpolatorRegistryDomLive)),
  )

describe("Variable values (#55)", () => {
  it("RV1: a Variable value is wholly a var(), with or without a fallback; a var() inside a larger value isn't one", () => {
    expect(isVariableValue("var(--brand)")).toBe(true)
    expect(isVariableValue(" var(--brand, #000) ")).toBe(true)
    expect(isVariableValue("var(--a, var(--b))")).toBe(true)
    expect(isVariableValue("0px 0px 4px var(--c)")).toBe(false)
    expect(isVariableValue("calc(var(--x) * 2)")).toBe(false)
    expect(isVariableValue("var(--a, 1px) var(--b)"), "two values side by side").toBe(false)
    expect(isVariableValue("var(--a, var(--b, var(--c, var(--d, var(--e)))))"), "nested at any depth").toBe(true)
    expect(isVariableValue(4)).toBe(false)
  })

  it("RV2: resolves the custom property on the element, inherited from its parent", () => {
    const el = childOf({ "--brand": "#0000ff" })
    expect(resolveVariable(el, "var(--brand)")).toEqual(Option.some("#0000ff"))
  })

  it("RV3: follows the fallback, and a fallback that is itself a var(), up to 4 deep", () => {
    const el = childOf({ "--brand": "#0000ff" })
    expect(resolveVariable(el, "var(--missing, #00ff00)")).toEqual(Option.some("#00ff00"))
    expect(resolveVariable(el, "var(--missing, var(--brand))")).toEqual(Option.some("#0000ff"))
    expect(resolveVariable(el, "var(--a, var(--b, var(--c, var(--brand))))")).toEqual(Option.some("#0000ff"))
    expect(resolveVariable(el, "var(--a, var(--b, var(--c, var(--d, var(--brand)))))"), "past 4 deep").toEqual(Option.none())
  })

  it("RV4: a numeric value is a number; one that doesn't resolve is None", () => {
    const el = childOf({ "--o": "0.4" })
    expect(resolveVariable(el, "var(--o)")).toEqual(Option.some(0.4))
    expect(resolveVariable(el, "var(--missing)")).toEqual(Option.none())
  })

  it("RV5: the rule blends what both ends resolve to, and lands on the target as written", () => {
    const el = childOf({ "--brand": "#0000ff", "--a": "#ff0000", "--b": "#00ff00" })
    expect(ruleBlend(el, "background-color", "#ff0000", "var(--brand)")).toEqual(
      Option.some(["rgb(255, 0, 0)", "rgb(128, 0, 128)", "var(--brand)"]),
    )
    expect(ruleBlend(el, "background-color", "var(--a)", "var(--b)")).toEqual(Option.some(["rgb(255, 0, 0)", "rgb(128, 128, 0)", "var(--b)"]))
  })

  it("RV6: the resolved pair goes on to the DOM's other rules: a shadow from none grows from its zero", () => {
    const el = childOf({ "--shadow": "0px 0px 10px rgb(255, 0, 0)" })
    expect(ruleBlend(el, "box-shadow", "none", "var(--shadow)")).toEqual(
      Option.some(["0px 0px 0px rgba(255, 0, 0, 0)", "0px 0px 5px rgba(255, 0, 0, 0.5)", "var(--shadow)"]),
    )
  })

  it("RV7: it declines a pair with no Variable value, and one that doesn't resolve", () => {
    const el = childOf({})
    expect(ruleBlend(el, "background-color", "#ff0000", "#0000ff")).toEqual(Option.none())
    expect(ruleBlend(el, "background-color", "#ff0000", "var(--missing)")).toEqual(Option.none())
    // A var() inside a larger value isn't one (#158 keeps it as text).
    expect(ruleBlend(el, "box-shadow", "0px 0px 4px var(--c)", "0px 0px 8px var(--c)")).toEqual(Option.none())
    expect(Interpolator.defaults.length).toBeGreaterThan(0)
  })
})
