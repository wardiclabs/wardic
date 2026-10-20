/**
 * An element's place in variant orchestration on Solid 2 (ADR-0007, #50, #209): the variant context
 * a ward's `.Provider` and every `wardic.*` element provide, and the registry, stagger and `when` an
 * element with variants of its own runs for its Variant children. The rules are the Solid 1
 * binding's, Solid-free in `variant-tree.ts`; what Solid 2 changes is when a write is seen.
 *
 * A Solid 2 signal's read lags its write until the flush, and an effect's apply runs in an order
 * the binding doesn't choose. So nothing a child reads at its Retarget is written by an effect at
 * the trigger:
 *
 * - **Stagger slots** are plain fields, snapshotted as the handed-down name changes, in the memo
 *   that computes it. Every Variant child reads that memo for its target, so the snapshot is taken
 *   before any child's Retarget in that flush, and read there through its `extraDelay`.
 * - **`beforeChildren`** compares two values its children read in the same flush: the name handed
 *   down now, and the one the element last settled at (written by its spine's frames, outside any
 *   flush). A new name holds them until the element settles at it.
 *
 * @module
 */
import * as Stagger from "@wardic/core/Stagger"
import * as Bool from "effect/Boolean"
import { constTrue, constUndefined, constVoid } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { type Accessor, createContext, createMemo, createSignal, onCleanup, untrack, useContext } from "solid-js"
import type { WardicTransition } from "../../config.ts"
import {
  handedDown,
  hasOwnVariants,
  inheritedContext,
  initialNameOf,
  nameOf,
  ownOrInherited,
  passedThrough,
  staggerOf,
  type VariantConfig,
  type WardicChildRegistration,
  type WardicStaggerConfig,
  type WardicVariantContextValue,
} from "../../variant-tree.ts"
import { CLIENT_ONLY } from "./solid-reactivity.ts"

/**
 * The variant context: the nearest element's names, transition and orchestration, `null` outside
 * one. Solid 2 takes an `undefined` default for none and then throws in `useContext`.
 */
export const WardicVariantContext = createContext<WardicVariantContextValue | null>(null)

/** The nearest variant context, `undefined` outside one. */
export const useVariantContext = (): WardicVariantContextValue | undefined =>
  Option.getOrUndefined(Option.fromNullishOr(useContext(WardicVariantContext)))

/** An element's place in variant orchestration, on the client. */
export interface VariantNode {
  /** What its children read: its own context, its parent's passed through, or none. */
  readonly provided: WardicVariantContextValue | undefined
  /** The context its spine inherits names and its default transition from: its parent's, for a Variant child. */
  readonly inherited: WardicVariantContextValue | undefined
  /** Its stagger delay in seconds, as a Variant child; `undefined` for any other element. */
  readonly extraDelay: (() => number) | undefined
  /** Whether its spine may start a Retarget: its ancestor's `beforeChildren` and its own `afterChildren` allow it. */
  readonly canStart: () => boolean
  /** Its spine's settle report on each frame: to its ancestor's registry, and to its own `beforeChildren`. */
  readonly onFrame: (done: boolean) => void
}

/** The orchestration an element with variants of its own runs for its Variant children. */
interface OwnOrchestration {
  readonly context: WardicVariantContextValue
  readonly canStart: () => boolean
  readonly settled: (done: boolean) => void
}

/** A registered Variant child's stagger slot, as its ancestor's registry holds it: set at each trigger. */
interface ChildRecord {
  index: number
  total: number
}

/** What an element has settled at while it moves: no name. */
const MOVING: unique symbol = Symbol("wardic.moving")

/**
 * The registry, stagger and `when` an element with variants of its own runs for its Variant
 * children (ADR-0007), and the names it hands them. Call within a Solid owner.
 */
const ownOrchestration = (
  cfg: Accessor<VariantConfig>,
  parent: WardicVariantContextValue | undefined,
  inherited: WardicVariantContextValue | undefined,
): OwnOrchestration => {
  const config = untrack(cfg)
  // Children in mount order (a Set keeps insertion order), snapshotted at each trigger. Kept with a
  // count of the unsettled ones rather than a signal of the records, so a child's mount, unmount or
  // settle costs the same at 1,000 children as at 1. The count is plain, and the signal its copy:
  // two writes in one flush each see the other's.
  const records = new Set<ChildRecord>()
  let unsettledCount = 0
  const [unsettled, setUnsettled] = createSignal(0, { ownedWrite: true })
  const countUnsettled = (change: number): void => {
    unsettledCount += change
    setUnsettled(unsettledCount)
  }

  const register = (): WardicChildRegistration => {
    const record: ChildRecord = { index: 0, total: 1 }
    // A child starts unsettled; its spine reports each frame, so only a change counts.
    let settled = false
    records.add(record)
    countUnsettled(1)
    const setSettled = (done: boolean): void => {
      if (done === settled) return
      settled = done
      countUnsettled(Bool.match(done, { onTrue: () => -1, onFalse: () => 1 }))
    }
    const dispose = (): void => {
      if (!records.delete(record)) return
      if (!settled) countUnsettled(-1)
    }
    return {
      index: () => {
        fresh()
        return record.index
      },
      total: () => {
        fresh()
        return record.total
      },
      setSettled,
      dispose,
    }
  }

  const stagger: Accessor<WardicStaggerConfig> = createMemo(() => staggerOf(cfg().transition), CLIENT_ONLY)
  const when: Accessor<"beforeChildren" | "afterChildren" | undefined> = () => UndefinedOr.map(cfg().transition, (t) => t.when)

  // Snapshot-at-trigger (ADR-0007): each child's index and total are recomputed only when this
  // element's variant changes, so a mount, unmount or reorder mid-transition doesn't reshuffle
  // in-flight delays. `staggerDirection: -1` reverses the index. Taken at the first slot read after
  // the change (#209 PR 4a): at mount this element's name is first computed in its setup, before
  // its children register, and they read their slots at their first Retarget, once all have.
  let stale = true
  const fresh = (): void => {
    if (!stale) return
    stale = false
    snapshotSlots()
  }
  const snapshotSlots = (): void => {
    const n = records.size
    const direction = untrack(stagger).direction
    let i = 0
    records.forEach((record) => {
      record.total = n
      record.index = Bool.match(direction === -1, { onTrue: () => n - 1 - i, onFalse: () => i })
      i++
    })
  }

  // The names handed down. `animate`'s is reactive, its change the trigger; `initial`'s is read once.
  const variant: Accessor<string | undefined> = createMemo((previous: string | undefined) => {
    const c = cfg()
    const next = handedDown(c, () => nameOf(c.animate), () => UndefinedOr.map(parent, (p) => p.variant()))
    if (next !== previous) stale = true
    return next
  }, CLIENT_ONLY)
  const initial = handedDown<string | false>(config, () => initialNameOf(config.initial), () => UndefinedOr.map(parent, (p) => p.initial))

  // The name this element last settled at: `MOVING` while its own animation runs.
  const [settledAt, setSettledAt] = createSignal<string | undefined | typeof MOVING>(MOVING, { ownedWrite: true })

  const childrenMayStart: Accessor<boolean> = () => when() !== "beforeChildren" || settledAt() === variant()
  const allChildrenSettled: Accessor<boolean> = () => unsettled() === 0
  // The transition its children default to: its own, else the one it inherits.
  const transition: Accessor<WardicTransition | undefined> = createMemo(() => ownOrInherited(cfg().transition, inherited), CLIENT_ONLY)

  return {
    context: { variant, initial, transition, register, stagger, when, childrenMayStart, allChildrenSettled },
    // It holds its own start for `afterChildren` (it owns the registry, so it reads it directly).
    canStart: () => when() !== "afterChildren" || allChildrenSettled(),
    settled: (done) => {
      setSettledAt(Bool.match(done, { onTrue: () => untrack(variant), onFalse: (): typeof MOVING => MOVING }))
    },
  }
}

/**
 * An element's place in variant orchestration on the client, from its config and the nearest
 * context (`useVariantContext()`). Call within a Solid owner.
 */
export const createVariantNode = (cfg: Accessor<VariantConfig>, parent: WardicVariantContextValue | undefined): VariantNode => {
  const config = untrack(cfg)
  const inherited = inheritedContext(config, parent)
  // A Variant child registers with the ancestor it joins, for its stagger slot and its `when`.
  const joined = UndefinedOr.map(inherited, (context) => ({ context, registration: context.register() }))
  if (Predicate.isNotUndefined(joined)) onCleanup(joined.registration.dispose)
  const own = Bool.match(hasOwnVariants(config), {
    onFalse: constUndefined,
    onTrue: () => ownOrchestration(cfg, parent, inherited),
  })
  // The spine reports on every frame (the per-frame path, docs/agents/effect-first.md): both
  // reports are resolved here, once, so a frame makes two plain calls and allocates nothing.
  const reportJoined: (done: boolean) => void = UndefinedOr.match(joined, {
    onUndefined: () => constVoid,
    onDefined: ({ registration }) => registration.setSettled,
  })
  const reportOwn: (done: boolean) => void = UndefinedOr.match(own, { onUndefined: () => constVoid, onDefined: (o) => o.settled })
  return {
    provided: UndefinedOr.match(own, { onDefined: (o) => o.context, onUndefined: () => passedThrough(config, parent) }),
    inherited,
    extraDelay: UndefinedOr.map(joined, ({ context, registration }) => () => {
      const s = context.stagger()
      return s.delayChildren + Stagger.make(s.amount, { from: s.from })(registration.index(), registration.total())
    }),
    canStart: () =>
      UndefinedOr.match(inherited, { onUndefined: constTrue, onDefined: (context) => context.childrenMayStart() }) &&
      UndefinedOr.match(own, { onUndefined: constTrue, onDefined: (o) => o.canStart() }),
    onFrame: (done) => {
      reportJoined(done)
      reportOwn(done)
    },
  }
}
