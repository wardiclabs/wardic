// A variant resolver that throws (#979, group F; ADR-0074): core calls every resolver in one place, and
// its throw comes back as the target's failure, not out of the resolution.
//
// - VT1: a resolver that throws resolves to nothing, its failure on the target with its name; a list's
//   other names still resolve; a clean one carries none.
// - VT2: `variantFailuresOf` keeps the last good resolution while a resolver throws, reports once, and
//   again after a resolution comes back clean.
// - VT3: an exit, a list's with one name that throws among them, and the starting values at setup,
//   carry the failure and leave its values out: a list leaves without the whole exit.
// - VT4: orchestration's own transition is none when the resolver throws, and it's told what it resolved.
// - VT5: a start's failure and the first resolution's same throw are reported once.
// - VT6: orchestration's failures go through the element's once by name: one orchestration alone sees
//   is reported once until it resolves; one setup or the element's resolutions saw isn't reported
//   again; another name's still is.
import type * as Config from "@wardic/core/unstable/Config"
import * as Spine from "@wardic/core/unstable/Spine"
import * as VariantTarget from "@wardic/core/unstable/VariantTarget"
import { describe, expect, it } from "@effect/vitest"
import * as Option from "effect/Option"

const broke = new Error("its variant broke")
const NONE: Spine.Active = { inView: false, focused: false, hovered: false, pressed: false, dragged: false, dragging: false }
const NO_STATE = VariantTarget.NO_VARIANT_STATE

describe("a variant resolver that throws (#979, group F)", () => {
  it("VT1: resolves to nothing, its failure on the target; a list's other names still resolve; a clean one carries none", () => {
    const variants = {
      shown: () => {
        throw broke
      },
      plain: { x: 1 },
    } as unknown as Config.WardicVariants
    // Before #979, the throw came out of the resolution.
    const target = VariantTarget.resolveTarget("shown", variants, undefined, NO_STATE)
    expect(target.values).toEqual({})
    expect(target.failure).toEqual(Option.some({ defect: broke, name: "shown" }))
    const merged = VariantTarget.mergedOf(VariantTarget.resolveTargets(["plain", "shown"], variants, undefined, NO_STATE))
    expect(merged.values).toEqual({ x: 1 })
    expect(merged.failure).toEqual(Option.some({ defect: broke, name: "shown" }))
    expect(VariantTarget.resolveTarget("plain", variants, undefined, NO_STATE).failure).toEqual(Option.none())
  })

  it("VT2: variantFailuresOf keeps the last good resolution while a resolver throws, reports once, and again after a clean one", () => {
    const reports: Array<VariantTarget.VariantFailure> = []
    const keep = Spine.variantFailuresOf((failure) => void reports.push(failure)).kept
    let broken = false
    const variants = {
      shown: () => {
        if (broken) throw broke
        return { x: 1 }
      },
    } as unknown as Config.WardicVariants
    const resolve = (): Spine.Resolution => Spine.resolutionOf({ animate: "shown", variants } as Config.SpineConfig, undefined, {}, NONE, Spine.emptySnapshotOf({}))
    const good = keep(resolve())
    expect(good.resolved).toEqual({ x: 1 })
    broken = true
    expect(keep(resolve()), "the last good one kept").toBe(good)
    expect(keep(resolve())).toBe(good)
    expect(reports).toEqual([{ defect: broke, name: "shown" }])
    broken = false
    const again = keep(resolve())
    expect(again).not.toBe(good)
    expect(again.resolved).toEqual({ x: 1 })
    broken = true
    expect(keep(resolve())).toBe(again)
    expect(reports, "reported again after a clean one").toHaveLength(2)
  })

  it("VT3: an exit, and the starting values at setup, carry the failure and leave its values out", () => {
    const variants = {
      hidden: { opacity: 0 },
      shown: { opacity: 1 },
      gone: () => {
        throw broke
      },
    } as unknown as Config.WardicVariants
    const exit = Spine.exitTargetOf({ exit: "gone", variants } as unknown as Spine.ExitConfig, undefined, NO_STATE, undefined)
    expect(exit.values).toEqual({})
    expect(exit.failure).toEqual(Option.some({ defect: broke, name: "gone" }))
    // A list with one name that throws leaves without the whole exit, its other names' values too (Q3).
    const list = Spine.exitTargetOf({ exit: ["shown", "gone"], variants } as unknown as Spine.ExitConfig, undefined, NO_STATE, undefined)
    expect(list.values).toEqual({})
    expect(list.groups).toBeUndefined()
    expect(list.failure).toEqual(Option.some({ defect: broke, name: "gone" }))
    // Setup resolves every variant for the Starting style: `gone`, an exit's, among them.
    const start = Spine.startOf({ initial: "hidden", animate: "shown", variants } as Config.SpineConfig, undefined, false, (f) => f())
    expect(start.initialValues).toEqual({ opacity: 0 })
    expect(start.failure).toEqual(Option.some({ defect: broke, name: "gone" }))
  })

  it("VT4: orchestration's own transition is none when the resolver throws, and it's told what it resolved", () => {
    const variants = {
      shown: () => {
        throw broke
      },
      plain: { x: 1, transition: { staggerChildren: 0.1 } },
    } as unknown as Config.WardicVariants
    const told: Array<readonly [unknown, Option.Option<VariantTarget.VariantFailure>]> = []
    const orchestrated: VariantTarget.Orchestrated = (entry, failure) => void told.push([entry, failure])
    expect(VariantTarget.ownTransitionOf(undefined, "shown", variants, undefined, orchestrated)).toBeUndefined()
    expect(VariantTarget.ownTransitionOf(undefined, "plain", variants, undefined, orchestrated)).toEqual({ staggerChildren: 0.1 })
    expect(told).toEqual([
      ["shown", Option.some({ defect: broke, name: "shown" })],
      ["plain", Option.none()],
    ])
  })

  it("VT5: a start's failure and the first resolution's same throw are reported once", () => {
    const reports: Array<VariantTarget.VariantFailure> = []
    const failures = Spine.variantFailuresOf((failure) => void reports.push(failure))
    const variants = {
      hidden: { x: 0 },
      shown: () => {
        throw broke
      },
    } as unknown as Config.WardicVariants
    const config = { initial: "hidden", animate: "shown", variants } as Config.SpineConfig
    const start = Spine.startOf(config, undefined, false, (f) => f())
    failures.started(start)
    failures.kept(Spine.resolutionOf(config, undefined, start.initialLink, NONE, Spine.snapshotOf(start)))
    expect(reports).toEqual([{ defect: broke, name: "shown" }])
  })

  it("VT6: orchestration's failures go through the element's once by name", () => {
    const reports: Array<string | undefined> = []
    const fresh = () => Spine.variantFailuresOf((failure) => void reports.push(failure.name))
    const open = (): Option.Option<VariantTarget.VariantFailure> => Option.some({ defect: broke, name: "open" })
    let broken = false
    const variants = {
      shown: () => {
        if (broken) throw broke
        return { x: 1 }
      },
    } as unknown as Config.WardicVariants
    const resolve = (): Spine.Resolution => Spine.resolutionOf({ animate: "shown", variants } as Config.SpineConfig, undefined, {}, NONE, Spine.emptySnapshotOf({}))
    // The element's own resolution of `open` comes back clean: it resolves with the element's values.
    const opened = (): Spine.Resolution =>
      Spine.resolutionOf({ animate: "open", variants: { open: () => ({ x: 1 }) } } as unknown as Config.SpineConfig, undefined, {}, NONE, Spine.emptySnapshotOf({}))
    // One only orchestration sees: reported once, until orchestration resolves it; the element's own
    // clean resolutions of it don't re-arm it.
    const alone = fresh()
    alone.orchestrated("open", open())
    alone.kept(opened())
    alone.orchestrated("open", open())
    expect(reports, "alone, once").toEqual(["open"])
    alone.orchestrated("open", Option.none())
    alone.orchestrated("open", open())
    expect(reports, "again once it resolved").toEqual(["open", "open"])
    // One setup saw (it resolves as orchestration does): not reported again by orchestration after the
    // element's first clean resolution.
    reports.length = 0
    const setup = fresh()
    setup.started({ failure: open() } as Spine.Start)
    setup.kept(opened())
    setup.orchestrated("open", open())
    expect(reports, "setup's, once").toEqual(["open"])
    // One the element's resolutions and orchestration both see: once. Another name's: reported too.
    reports.length = 0
    const both = fresh()
    broken = true
    both.kept(resolve())
    both.orchestrated("shown", Option.some({ defect: broke, name: "shown" }))
    both.orchestrated("open", open())
    expect(reports).toEqual(["shown", "open"])
  })
})
