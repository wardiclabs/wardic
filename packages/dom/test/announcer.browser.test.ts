// The DOM's Announcer (#43, ADR-0037): one visually hidden live region per document, assertive and
// atomic, added before the first announcement when asked; each announcement replaces the last, and a
// repeat of the last still changes the text, so a screen reader speaks it again. And the hidden
// instructions elements for `aria-describedby`, one per distinct text.
import * as Announcer from "@wardic/core/Announcer"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { ANNOUNCER_ATTRIBUTE, AnnouncerDomLive, announceIn, instructionsId, prepareAnnouncer } from "../src/internal/announcer.ts"

const regions = (): Array<Element> => Array.from(document.querySelectorAll(`[${ANNOUNCER_ATTRIBUTE}]`))

describe("the DOM's Announcer (#43)", () => {
  it("AN1: prepareAnnouncer adds one live region, assertive and atomic and visually hidden; announcing reuses it", () => {
    prepareAnnouncer(document)
    prepareAnnouncer(document)
    expect(regions()).toHaveLength(1)
    const region = regions()[0]!
    expect(region.getAttribute("aria-live")).toBe("assertive")
    expect(region.getAttribute("aria-atomic")).toBe("true")
    const box = region.getBoundingClientRect()
    expect(box.width * box.height, "a 1 px box, clipped").toBeLessThanOrEqual(1)
    announceIn(document, "Picked up Milk, position 2 of 6.")
    expect(regions()).toHaveLength(1)
    expect(region.textContent).toBe("Picked up Milk, position 2 of 6.")
  })

  it("AN2: each announcement replaces the last; a repeat of the last gets a trailing no-break space, so it changes", () => {
    announceIn(document, "Milk, position 3 of 6.")
    const region = regions()[0]!
    expect(region.textContent).toBe("Milk, position 3 of 6.")
    announceIn(document, "Milk, position 3 of 6.")
    expect(region.textContent).toBe("Milk, position 3 of 6. ")
    announceIn(document, "Dropped Milk at position 3 of 6.")
    expect(region.textContent).toBe("Dropped Milk at position 3 of 6.")
  })

  it.effect("AN3: AnnouncerDomLive is core's Announcer on the page's document", () =>
    Effect.gen(function* () {
      const announcer = yield* Announcer.Announcer
      announcer.announce("Moved Milk to position 1 of 6.")
      expect(regions()[0]!.textContent).toBe("Moved Milk to position 1 of 6.")
    }).pipe(Effect.provide(AnnouncerDomLive)))

  it("AN4: instructionsId gives one hidden element per distinct text, reused, and a new one if it was removed", () => {
    const a = instructionsId(document, "Press Space to pick up.")
    expect(instructionsId(document, "Press Space to pick up.")).toBe(a)
    const b = instructionsId(document, "Space to grab.")
    expect(b).not.toBe(a)
    const el = document.getElementById(a)!
    expect(el.hidden).toBe(true)
    expect(el.textContent).toBe("Press Space to pick up.")
    el.remove()
    const again = instructionsId(document, "Press Space to pick up.")
    expect(document.getElementById(again)?.textContent).toBe("Press Space to pick up.")
  })
})
