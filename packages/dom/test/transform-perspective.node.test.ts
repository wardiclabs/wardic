/// <reference types="node" />
// The DOM's `transformPerspective` (#887; ADR-0073, *Amendment (#887)*): Motion's key, a `perspective()` at
// the head of the element's own `transform`, in px (motion-dom 14.10.1's `transformPropOrder`, its
// `translateAlias` and `buildProjectionTransform`). A key of the DOM's own table, not core's: no scene draws it.
//
// Expected strings are literal: the point is the markup `project` writes.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import * as Projection from "@wardic/core/Projection"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import { describe, expect, it } from "vitest"

const AXIS = { translate: 0, scale: 1, origin: 0.5, originPoint: 0 }
/** A projection moving the element `tx` across, with no tree scale. */
const projected = (tx: number) => ({ [Projection.KEY]: { delta: { x: { ...AXIS, translate: tx }, y: AXIS }, treeScale: { x: 1, y: 1 } } })

describe("transformPerspective: what project draws (#887)", () => {
  it("TP1: perspective() in px, at the head of the transform, before the translate group", () => {
    expect(DomRenderer.project({ rotateY: 30, x: 10, transformPerspective: 800 })).toEqual({ transform: "perspective(800px) translateX(10px) rotateY(30deg)" })
    expect(DomRenderer.project({ transformPerspective: "40rem" }), "a string as it is").toEqual({ transform: "perspective(40rem)" })
  })

  it("TP2: left out at 0, no perspective, and below it: CSS refuses a negative depth, which drops the whole transform", () => {
    expect(DomRenderer.project({ transformPerspective: 0 })).toEqual({ transform: "none" })
    expect(DomRenderer.project({ transformPerspective: -12, rotateY: 30 }), "a spring's overshoot past 0").toEqual({ transform: "rotateY(30deg)" })
    expect(DomRenderer.project({ transformPerspective: "-0.5px", rotateY: 30 })).toEqual({ transform: "rotateY(30deg)" })
    expect(DomRenderer.project({ transformPerspective: 0.5 }), "just above 0").toEqual({ transform: "perspective(0.5px)" })
    expect(DomRenderer.project({ transformPerspective: "var(--depth)" }), "a string parseFloat can't read").toEqual({ transform: "perspective(var(--depth))" })
  })

  it("TP3: on a projected element, at the head of the projection's transform, as Motion's buildProjectionTransform puts it", () => {
    expect(DomRenderer.project({ ...projected(20), transformPerspective: 600, rotateY: 15 })).toEqual({ transform: "perspective(600px) translate3d(20px, 0px, 0px) rotateY(15deg)" })
    expect(DomRenderer.project({ ...projected(0), x: "-100%", transformPerspective: 600 }), "before a translate in another unit").toEqual({ transform: "perspective(600px) translate(-100%, 0px)" })
    expect(DomRenderer.project({ ...projected(20), transformPerspective: -4, rotateY: 15 }), "left out below 0").toEqual({ transform: "translate3d(20px, 0px, 0px) rotateY(15deg)" })
    expect(DomRenderer.project({ ...projected(0), transformPerspective: 0 }), "and at 0").toEqual({ transform: "none" })
  })
})

const SRC = join(import.meta.dirname, "../src")

/** Every `.ts` file under `dir`. */
const filesIn = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return filesIn(path)
    if (name.endsWith(".ts")) return [path]
    return []
  })

/** What reads core's transform table, through its module's namespace or a named import, and the one module of dom's each may appear in. */
const CORE_READERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/BaseValue\.(TRANSFORM_IDENTITY|transformIdentity)\b/, "internal/transform-keys.ts"],
  [/import\s*(type\s*)?\{[^}]*\b(TRANSFORM_IDENTITY|transformIdentity)\b[^}]*\}\s*from\s*"@wardic\/core\/BaseValue"/, "internal/transform-keys.ts"],
  [/ReducedMotion\.(isTransform|transformsOnly)\b/, "internal/transform-keys.ts"],
  [/import\s*\{[^}]*\b(isTransform|transformsOnly)\b[^}]*\}\s*from\s*"@wardic\/core\/ReducedMotion"/, "internal/transform-keys.ts"],
  [/DefaultTransition\.(byKey|layerByKey)\b/, "internal/default-transition.ts"],
  [/import\s*\{[^}]*\b(byKey|layerByKey)\b[^}]*\}\s*from\s*"@wardic\/core\/DefaultTransition"/, "internal/default-transition.ts"],
]

describe("the DOM's transform keys: one table (#887)", () => {
  it("TK1: no dom source reads core's transform table but the DOM's own, which adds its keys to core's", () => {
    const strays = filesIn(SRC).flatMap((path) => {
      const file = relative(SRC, path)
      const text = readFileSync(path, "utf8")
      return CORE_READERS.flatMap(([reader, home]) => {
        if (file === home || !reader.test(text)) return []
        return [`${file}: ${reader.source}`]
      })
    })
    expect(strays).toEqual([])
  })
})
