// A Batch's Appear animation fixtures (#706): rendered on the server in Node by the hydrate project's
// `serverRenderPage` command, and hydrated in Chromium by batch-appear.hydrate.browser.test.tsx. Each
// element to watch carries `data-k`.
import { DomLive } from "@wardic/dom"
import { createBatch, Reorder, stagger, wardic, WardicProvider } from "@wardic/solid"
import { For, type JSX } from "solid-js"

const page = (children: () => JSX.Element): JSX.Element => <WardicProvider env={DomLive}>{children()}</WardicProvider>

const BOX: JSX.CSSProperties = { position: "absolute", left: "0", top: "0", width: "20px", height: "20px", background: "teal" }

/** The spring both of B1's sides run. */
export const B1_SPRING = { type: "spring", stiffness: 300, damping: 25 } as const

/** A member and a Wardic element on one spec, side by side: they rise in alike. */
export const B1 = (): JSX.Element =>
  page(() => {
    const rise = createBatch({ appear: true, count: 1, initial: { opacity: 0, y: 40 }, animate: () => ({ opacity: 1, y: 0 }), transition: B1_SPRING })
    return (
      <>
        <div data-k="member" {...rise.at(0, { style: BOX })} />
        <wardic.div data-k="element" style={{ ...BOX, left: "40px" }} initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={B1_SPRING} />
      </>
    )
  })

/** B2's tween and its members' targets. */
export const B2_TWEEN = { type: "tween", duration: 0.6, ease: "easeOut" } as const
export const B2_TARGETS: ReadonlyArray<number> = [0, 100, 200]
export const B2_STAGGER = 0.1

/** A grid of three, each to its own `x`, fading in, 0.1 s apart. */
export const B2 = (): JSX.Element =>
  page(() => {
    const tiles = createBatch({
      appear: true,
      count: 3,
      initial: { x: 0, opacity: 0 },
      animate: (i) => ({ x: B2_TARGETS[i] as number, opacity: 1 }),
      transition: { ...B2_TWEEN, delay: stagger(B2_STAGGER) },
    })
    return (
      <For each={[0, 1, 2]}>{(i) => <div data-k={`t${i}`} {...tiles.at(i, { style: { ...BOX, top: `${i * 30}px` } })} />}</For>
    )
  })

/** B3's tween: its ease named, so the test's own Batch runs it as the binding does. */
export const B3_TWEEN = { type: "tween", duration: 0.8, ease: "easeOut" } as const

/** A Batch Reorder group's column fading in (Q16, Q20). */
export const B3 = (): JSX.Element =>
  page(() => (
    <Reorder.BatchGroup appear values={["a", "b", "c"]} onReorder={() => {}} axis="y" itemSize={{ width: 80, height: 20 }} gap={10} initial={{ opacity: 0 }} transition={B3_TWEEN}>
      <For each={["a", "b", "c"]}>{(v) => <Reorder.BatchItem value={v} data-k={`g${v}`} style={{ background: "teal" }}>{v}</Reorder.BatchItem>}</For>
    </Reorder.BatchGroup>
  ))

/** B4's and B5's tween: each Batch's, and the Wardic element's own mount animation on its member's element. */
export const B4_TWEEN = { type: "tween", duration: 0.8, ease: "easeOut" } as const

/**
 * A Batch fading in two members (#706): a Wardic element on the first, with a mount animation of its own,
 * which its Batch's Appear animation vetoes; the second's own style sets an animation, which vetoes its
 * Appear animation (Q4).
 */
export const B4 = (): JSX.Element =>
  page(() => {
    const fade = createBatch({ appear: true, count: 2, initial: { opacity: 0 }, animate: () => ({ opacity: 1 }), transition: B4_TWEEN })
    return (
      <>
        <wardic.div data-k="w" {...fade.at(0, { style: BOX })} initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={B4_TWEEN} />
        <div data-k="v" {...fade.at(1, { style: { ...BOX, left: "40px", animation: "none" } })} />
      </>
    )
  })

/** A Batch without `appear` (Q21), its member's element a Wardic element with an Appear animation of its own. */
export const B5 = (): JSX.Element =>
  page(() => {
    const fade = createBatch({ count: 1, initial: { opacity: 0 }, animate: () => ({ opacity: 1 }), transition: B4_TWEEN })
    return <wardic.div data-k="w" {...fade.at(0, { style: BOX })} initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={B4_TWEEN} />
  })
