// Every drag element gets Motion's defaults (#36, ADR-0019 *Amendment (Reorder)*):
// `touch-action` (none, or pan-y / pan-x for an x / y drag), `user-select: none`, the
// WebKit prefixes and `draggable="false"`, as Motion's draggables do
// (render/html/use-props.ts:57-73 at 16c61222c4166bbef5ff6ab0051192faa79fa8c8). The user's
// style can override them. Before: a touch drag was cancelled after its first moves
// (`touch-action: auto`), and in Chromium a second drag starting on text the first drag
// selected became a native `dragstart` that cancelled the pointer.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { useWardic, ward, wardic, WardicProvider } from "@wardic/solid"
import { createSignal } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { commands, server } from "vitest/browser"
import "./browser-commands.ts"
import { afterPaint, raf, until } from "./browser-helpers.ts"

// `use:ward` needs the import to stay (the directive compiles to a bare `ward(...)`).
void ward

interface Pt {
  readonly x: number
  readonly y: number
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await raf()
  await afterPaint()
}
let mouseDown = false
const mouse = {
  move: (p: Pt): Promise<void> => commands.realMouse("move", p.x, p.y),
  down: async (p: Pt): Promise<void> => {
    await commands.realMouse("down", p.x, p.y)
    mouseDown = true
  },
  up: async (p: Pt): Promise<void> => {
    await commands.realMouse("up", p.x, p.y)
    mouseDown = false
  },
}
const glide = async (from: Pt, to: Pt, steps: number, ms = 20): Promise<void> => {
  for (let k = 1; k <= steps; k++) {
    await mouse.move({ x: from.x + ((to.x - from.x) * k) / steps, y: from.y + ((to.y - from.y) * k) / steps })
    await wait(ms)
  }
}

afterEach(async () => {
  if (mouseDown) await mouse.up({ x: 5, y: 5 })
  await mouse.move({ x: 5, y: 5 })
  window.getSelection()?.removeAllRanges()
  cleanup()
})

const cdpTouch = server.browser === "chromium"

/** Render `el` inside a provider at (40, 40) and return the element once painted. */
const mountOne = async (make: (ref: (el: HTMLElement) => void) => unknown): Promise<HTMLElement> => {
  const [el, setEl] = createSignal<HTMLElement>()
  render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "absolute", top: "40px", left: "40px" }}>{make((n) => setEl(n)) as never}</div>
    </WardicProvider>
  ))
  await settle()
  return el()!
}

const BOX = { position: "relative", width: "120px", height: "80px", background: "#f88" } as const

describe("drag elements get Motion's defaults (#36)", () => {
  it("E1: a free drag element gets touch-action none, no text selection and draggable=false", async () => {
    const el = await mountOne((ref) => <wardic.div ref={ref} drag style={BOX} />)
    expect(el.style.getPropertyValue("touch-action")).toBe("none")
    expect(el.style.getPropertyValue("user-select")).toBe("none")
    // The WebKit prefixes are written too, but a browser drops a property it doesn't
    // know from the inline style: Chromium and Firefox keep -webkit-user-select and drop
    // -webkit-touch-callout (Safari's), so each is asserted only where it's supported.
    for (const prefixed of ["-webkit-user-select", "-webkit-touch-callout"]) {
      if (CSS.supports(prefixed, "none")) expect(el.style.getPropertyValue(prefixed), prefixed).toBe("none")
    }
    expect(el.getAttribute("draggable")).toBe("false")
  })

  it("E2: an x drag keeps vertical panning (pan-y), a y drag horizontal panning (pan-x)", async () => {
    const x = await mountOne((ref) => <wardic.div ref={ref} drag="x" style={BOX} />)
    expect(x.style.getPropertyValue("touch-action")).toBe("pan-y")
    cleanup()
    const y = await mountOne((ref) => <wardic.div ref={ref} drag="y" style={BOX} />)
    expect(y.style.getPropertyValue("touch-action")).toBe("pan-x")
  })

  it("E3: the user's style overrides a default", async () => {
    const el = await mountOne((ref) => <wardic.div ref={ref} drag style={{ ...BOX, "user-select": "text" }} />)
    expect(el.style.getPropertyValue("user-select")).toBe("text")
    expect(el.style.getPropertyValue("touch-action")).toBe("none")
  })

  it("E4: an element without drag gets none of them", async () => {
    const el = await mountOne((ref) => <wardic.div ref={ref} animate={{ opacity: 1 }} style={BOX} />)
    expect(el.style.getPropertyValue("touch-action")).toBe("")
    expect(el.style.getPropertyValue("user-select")).toBe("")
    expect(el.hasAttribute("draggable")).toBe(false)
  })

  it("E5: useWardic's spread carries them", async () => {
    function Spread(props: { readonly ref: (el: HTMLElement) => void }) {
      const w = useWardic({ drag: true })
      return <div {...w({ ref: props.ref, style: BOX })} />
    }
    const el = await mountOne((ref) => <Spread ref={ref} />)
    expect(el.style.getPropertyValue("touch-action")).toBe("none")
    expect(el.getAttribute("draggable")).toBe("false")
  })

  it("E6: use:ward sets them at mount", async () => {
    const el = await mountOne((ref) => <div ref={ref} use:ward={{ drag: true }} style={BOX} />)
    await settle()
    expect(el.style.getPropertyValue("touch-action")).toBe("none")
    expect(el.style.getPropertyValue("user-select")).toBe("none")
    expect(el.getAttribute("draggable")).toBe("false")
  })

  it("E9 (guard): an animated key still wins over the user's style", async () => {
    const el = await mountOne((ref) => <wardic.div ref={ref} drag animate={{ opacity: 1 }} style={{ ...BOX, opacity: 0.2 }} />)
    await until(() => Number(getComputedStyle(el).opacity) > 0.999)
    expect(Number(getComputedStyle(el).opacity)).toBeCloseTo(1, 2)
  })
})

describe.skipIf(!cdpTouch)("a touch drag isn't taken for a scroll (#36, Chromium DevTools touch)", () => {
  it("E7: a touch drag of 12 moves on a drag element with no app touch-action ends at its last offset", async () => {
    const el = await mountOne((ref) => <wardic.div ref={ref} drag dragMomentum={false} style={BOX} />)
    const slot = el.getBoundingClientRect()
    // Chromium swallows the first touch after an earlier touch gesture: tap off the element first.
    await commands.realTouch("touchStart", [{ x: 300, y: 600, id: 1 }])
    await commands.realTouch("touchEnd", [])
    await wait(50)
    const g = { x: slot.left + 20, y: slot.top + 40 }
    await commands.realTouch("touchStart", [{ ...g, id: 1 }])
    for (let k = 1; k <= 12; k++) {
      await commands.realTouch("touchMove", [{ x: g.x + 5 * k, y: g.y, id: 1 }])
      await wait(20)
    }
    await commands.realTouch("touchEnd", [])
    await settle()
    // Before: Chromium took the touch for a pan after 8 moves and sent a pointercancel,
    // which ended the drag at the cancel's own point, (0, 0): the element at -60,-80.
    expect(el.getBoundingClientRect().left - slot.left).toBeCloseTo(60, 0)
  })
})

describe.skipIf(server.browser !== "chromium")("a second drag starting on text isn't a native drag (#36, Chromium)", () => {
  it("E8: after a y drag that swept across the element's text, a second drag starting on that text moves it", async () => {
    const el = await mountOne((ref) => (
      <wardic.div ref={ref} drag="y" dragMomentum={false} style={{ ...BOX, width: "300px", "font-size": "20px", "white-space": "nowrap" }}>
        some text to select here
      </wardic.div>
    ))
    const slot = el.getBoundingClientRect()
    // The first drag starts on the text and sweeps right across it while the element
    // follows only on y, so the pointer moves over the text: it selects it.
    const g = { x: slot.left + 10, y: slot.top + 15 }
    const end = { x: g.x + 120, y: g.y + 30 }
    await mouse.down(g)
    await glide(g, end, 12)
    await mouse.up(end)
    await settle()
    const after = el.getBoundingClientRect()
    // The second drag starts inside what the first one swept over.
    const g2 = { x: g.x + 60, y: after.top + 15 }
    await mouse.down(g2)
    await glide(g2, { x: g2.x, y: g2.y + 40 }, 10)
    await mouse.up({ x: g2.x, y: g2.y + 40 })
    await settle()
    expect(el.getBoundingClientRect().top - after.top).toBeCloseTo(40, 0)
  })
})
