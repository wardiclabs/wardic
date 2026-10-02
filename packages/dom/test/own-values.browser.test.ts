// An element's Own value (#47, ADR-0022): what it holds for a key before Wardic writes it,
// read by the DOM Environment once per key, at first need. A transform key takes core's
// identity and is never read (Motion's projected branch, HTMLVisualElement.ts:51 at
// 16c61222c4166bbef5ff6ab0051192faa79fa8c8, which every motion element takes: its
// `isProjecting` check is never called); an svg-inner attribute key reads its attribute;
// anything else the computed style. Real Chromium (and Firefox through the local config).
import { ownValues } from "@wardic/dom"
import { afterEach, describe, expect, it } from "vitest"

const SVGNS = "http://www.w3.org/2000/svg"
const sheet = document.createElement("style")
sheet.textContent = `
  .half { opacity: 0.5; }
  .third { opacity: 0.3; }
  .shrunk { transform: scale(0.5); }
  .blue { fill: rgb(0, 0, 255); }
`
document.head.append(sheet)

const mounted: Array<Element> = []
const mount = <E extends Element>(el: E): E => {
  document.body.append(el)
  mounted.push(el)
  return el
}
const div = (cls = "", style = ""): HTMLDivElement => {
  const el = document.createElement("div")
  if (cls !== "") el.className = cls
  if (style !== "") el.setAttribute("style", style)
  return mount(el)
}
const svgInner = (tag: string, attrs: Record<string, string> = {}): SVGElement => {
  const root = mount(document.createElementNS(SVGNS, "svg"))
  const el = document.createElementNS(SVGNS, tag) as SVGElement
  for (const name in attrs) el.setAttribute(name, attrs[name]!)
  root.append(el)
  return el
}

/** Count `getComputedStyle` calls while `fn` runs. */
const countReads = <A>(fn: () => A): { result: A; reads: number } => {
  const original = window.getComputedStyle
  let reads = 0
  window.getComputedStyle = ((...args: Parameters<typeof getComputedStyle>) => {
    reads++
    return original.apply(window, args)
  }) as typeof getComputedStyle
  try {
    return { result: fn(), reads }
  } finally {
    window.getComputedStyle = original
  }
}

afterEach(() => {
  for (const el of mounted.splice(0)) el.remove()
})

describe("ownValues: an element's own value for a key (ADR-0022)", () => {
  it("OV1: an inline style value", () => {
    expect(ownValues(div("", "opacity: 0.5"))("opacity")).toBe("0.5")
  })

  it("OV2: a value from a stylesheet (the computed style)", () => {
    expect(ownValues(div("half"))("opacity")).toBe("0.5")
  })

  it("OV3: a key nothing sets reads its computed default", () => {
    expect(ownValues(div())("opacity")).toBe("1")
  })

  it("OV4: a transform key takes its identity, whatever the element's CSS transform (Motion's C5)", () => {
    const own = ownValues(div("shrunk"))
    expect(own("scale")).toBe(1)
    expect(own("scaleX")).toBe(1)
    expect(own("x")).toBe(0)
    expect(own("rotate")).toBe(0)
  })

  it("OV5: a transform key never reads the element", () => {
    const own = ownValues(div("shrunk"))
    const { reads } = countReads(() => [own("scale"), own("y"), own("skewX")])
    expect(reads).toBe(0)
  })

  it("OV6: a key is read once per reader; a new reader reads again", () => {
    const el = div("half")
    const own = ownValues(el)
    expect(own("opacity")).toBe("0.5")
    el.className = "third"
    const { result, reads } = countReads(() => own("opacity"))
    expect(result).toBe("0.5")
    expect(reads).toBe(0)
    expect(ownValues(el)("opacity")).toBe("0.3")
  })

  it("OV7: creating a reader reads nothing", () => {
    const el = div("half")
    const { reads } = countReads(() => ownValues(el))
    expect(reads).toBe(0)
  })

  it("OV8: an svg-inner element's attribute key reads its attribute", () => {
    const circle = svgInner("circle", { cx: "50", r: "30" })
    const own = ownValues(circle)
    expect(own("cx")).toBe("50")
    expect(own("r")).toBe("30")
  })

  it("OV9: an svg-inner attribute alias reads the attribute it writes (attrX → x)", () => {
    const rect = svgInner("rect", { x: "12", width: "10", height: "10" })
    expect(ownValues(rect)("attrX")).toBe("12")
  })

  it("OV10: an svg-inner key with no attribute falls back to the computed style (a class's fill)", () => {
    const circle = svgInner("circle", { class: "blue", r: "10" })
    expect(ownValues(circle)("fill")).toBe("rgb(0, 0, 255)")
  })

  it("OV11: a custom property keeps its name (no dash-casing)", () => {
    const el = div("", "--brandColor: 3")
    expect(ownValues(el)("--brandColor")).toBe("3")
  })

  it("OV12: a miss is remembered as a miss", () => {
    const el = div()
    const own = ownValues(el)
    expect(own("--unset")).toBeUndefined()
    const { result, reads } = countReads(() => own("--unset"))
    expect(result).toBeUndefined()
    expect(reads).toBe(0)
  })
})
