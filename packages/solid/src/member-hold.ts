/**
 * A Batch member's element's hold on the groups a Wardic element on it takes from its Batch (#665's
 * PR 4, ADR-0069 decision 17, Q52–Q54): the latest driver. Its spine makes one as it first finds its
 * element a member's, through what `createBatch` provides here: an app with no Batch ships none of it.
 *
 * @module
 */
// ADR-0070, *Amendment (#665)*: only members pay. A spine reads one module slot a Retarget while no
// Batch has been made, and a WeakMap after; this module's code is reached through `provideBatchHolds`,
// which only `createBatch` calls.
import * as BaseValue from "@wardic/core/BaseValue"
import * as Arr from "effect/Array"
import { constFalse } from "effect/Function"
import * as Iter from "effect/Iterable"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import { type BatchGroup, batchGroupOf, type BatchHandover, type BatchHolder, type BatchMemberEntry, isMemberElement, memberEntryOf } from "./batch.ts"
import { type HoldHost, type MemberHold, type MemberHolds, provideMemberHolds, velocityAt } from "./spine.ts"

// What a hold works its spine with (#746): here, not in the spine, so an app with no Batch ships none
// of it (ADR-0070's *Note (#746)*). Functions over the host, not closures: a hold makes none of its own.

/** Whether a leg still runs on a key `which` picks. */
// Per held group at a leg's end or a Batch change (#665): statements.
const anyRunning = (host: HoldHost, which: (key: string) => boolean): boolean => {
  let runs = false
  Iter.forEach(host.owners, ([key, running]) => {
    if (Predicate.isUndefined(running)) return
    if (running.done) return
    if (which(key)) runs = true
  })
  return runs
}

/** The keys `which` picks given up by the legs drawing them, each leg drawing the rest from then on. */
// Setting a visited key is safe in a Map's iteration.
const giveUpKeys = (host: HoldHost, which: (key: string) => boolean): void => {
  Iter.forEach(host.owners, ([key, running]) => {
    if (Predicate.isUndefined(running)) return
    if (which(key)) host.giveUp(key, running)
  })
  host.keepTheRest()
}

/** `key`'s speed at `now`, per second. */
const velocityOf = (host: HoldHost, key: string, now: number): number => velocityAt(host.snapshot, host.owners.get(key), key, now)

/** `key` the spine's no more: out of the keys it drove and those it returns. */
const forgetKey = (host: HoldHost, key: string): void => {
  host.driven.delete(key)
  host.returning().delete(key)
}

/** Holds made from now on (`createBatch`, as it's called): a Batch's members can be Wardic elements. */
// #672 (Q14): the slot is the spine's; this fills it with the Batch's holds.
export const provideBatchHolds = (): void => provideMemberHolds(BATCH_HOLDS)

/** A Batch member's element's {@link MemberHold}. */
const makeMemberHold = (host: HoldHost): MemberHold => {
  const { element, gate, id, snapshot } = host
  // The groups it holds now, each with the Batch's keys in it; the member it took them from; and whether
  // a drag holds `x`/`y`, from its first read or write to its hand-back.
  const held = new Map<BatchGroup, ReadonlyArray<string>>()
  let takenFrom: BatchMemberEntry | undefined
  let dragging = false

  /** A transform key the Batch doesn't draw (`rotate` on an `{ x, y }` Batch): its `transform` would drop it. */
  const undrawnBy = (batchKeys: ReadonlyArray<string>) => (key: string): boolean => {
    if (batchGroupOf(key) !== "transform") return false
    return !Arr.contains(batchKeys, key)
  }

  /** Whether a transform key the Batch doesn't draw has a leg running, or is off its identity. */
  // Per held transform at a leg's end or a Batch change (#665): statements.
  const holdsUndrawn = (batchKeys: ReadonlyArray<string>): boolean => {
    const undrawn = undrawnBy(batchKeys)
    if (anyRunning(host, undrawn)) return true
    return Arr.some(Rec.keys(snapshot.values), (key) => {
      if (!undrawn(key)) return false
      return snapshot.values[key] !== BaseValue.TRANSFORM_IDENTITY[key]
    })
  }

  /** Whether it keeps the transform: a drag holds it, or a transform key the Batch doesn't draw. */
  const keepsTransform = (batchKeys: ReadonlyArray<string>): boolean => {
    if (dragging) return true
    return holdsUndrawn(batchKeys)
  }

  /** `group` given back: its legs give its keys up, the gate draws it no more (what's drawn kept), and its Batch keys' values and speeds. */
  const surrender = (group: BatchGroup): BatchHandover | undefined => {
    const batchKeys = held.get(group)
    if (Predicate.isUndefined(batchKeys)) return undefined
    held.delete(group)
    const now = snapshot.now()
    const values: Record<string, number> = {}
    const velocities: Record<string, number> = {}
    Arr.forEach(batchKeys, (key) => {
      values[key] = snapshot.values[key] as number
      velocities[key] = velocityOf(host, key, now)
    })
    const inGroup = (key: string): boolean => batchGroupOf(key) === group
    giveUpKeys(host, inGroup)
    const keys = Arr.filter(Rec.keys(snapshot.values), inGroup)
    // Left as drawn as it drops out: the Batch's writer draws it from its next step. A group's name is its property's.
    gate.release(id, keys, undefined, [group])
    Arr.forEach(keys, (key) => {
      delete snapshot.values[key]
      forgetKey(host, key)
    })
    return { values, velocities }
  }

  const holder: BatchHolder = {
    surrender,
    keepsThrough: (group) => {
      if (group !== "transform") return false
      const batchKeys = held.get(group)
      if (Predicate.isUndefined(batchKeys)) return false
      return keepsTransform(batchKeys)
    },
  }

  /** `group` taken from the Batch of `entry`, its element's member (Q53): seeded at the member's values and speeds, drawn by the gate from now on. */
  const claim = (entry: BatchMemberEntry, group: BatchGroup): void => {
    if (held.has(group)) return
    const given = entry.binding.yieldGroup(entry.member, group, holder)
    if (Predicate.isUndefined(given)) return
    held.set(group, given.keys)
    snapshot.values = { ...snapshot.values, ...given.values }
    snapshot.velocities = { ...snapshot.velocities, ...given.velocities }
    const now = snapshot.now()
    Arr.forEach(given.keys, (seeded) => {
      snapshot.drawnAt[seeded] = now
    })
    gate.write(id, given.values)
  }

  /**
   * Its element's member now, what it holds kept only if it's the one it took them from: an element
   * another member's, or its Batch's no more, holds nothing of its old one.
   */
  const memberNow = (): BatchMemberEntry | undefined => {
    const entry = memberEntryOf(element)
    if (entry === takenFrom) return entry
    held.clear()
    takenFrom = entry
    return entry
  }

  /** Each group it holds and `keeps` doesn't, back to the member's Batch, from where it is. Deleting the visited entry is safe in a Map's iteration. */
  const giveBack = (keeps: (group: BatchGroup, batchKeys: ReadonlyArray<string>) => boolean): void => {
    if (held.size === 0) return
    const entry = memberNow()
    if (Predicate.isUndefined(entry)) return
    Iter.forEach(held, ([group, batchKeys]) => {
      if (keeps(group, batchKeys)) return
      const back = surrender(group)
      if (Predicate.isNotUndefined(back)) entry.binding.reclaim(entry.member, group, back)
    })
  }

  /** Whether `group` stays its own at a leg's end: a leg runs on it, or it's the transform it keeps (Q54). */
  const stays = (group: BatchGroup, batchKeys: ReadonlyArray<string>): boolean => {
    if (anyRunning(host, (key) => batchGroupOf(key) === group)) return true
    if (group !== "transform") return false
    return keepsTransform(batchKeys)
  }

  return {
    retarget: (t, dragged) => {
      const entry = memberNow()
      if (Predicate.isUndefined(entry)) return
      if (dragged) claim(entry, "transform")
      // Per key of a member's Retarget: statements.
      Arr.forEach(Rec.keys(t), (key) => {
        const group = batchGroupOf(key)
        if (Predicate.isUndefined(group)) return
        if (held.has(group)) return
        const drawn = entry.binding.drawnValueOf(entry.member, key)
        if (Predicate.isUndefined(drawn)) return
        if (t[key] === drawn) {
          delete t[key]
          return
        }
        claim(entry, group)
      })
    },
    settle: () => giveBack(stays),
    drag: (on) => {
      if (on) {
        dragging = true
        if (held.has("transform")) return
        const entry = memberNow()
        if (Predicate.isNotUndefined(entry)) claim(entry, "transform")
        return
      }
      if (!dragging) return
      dragging = false
      giveBack(stays)
    },
    dispose: () => giveBack(constFalse),
  }
}

/** The Batch's holds, which `provideBatchHolds` gives the spine's slot: one record, made once. */
const BATCH_HOLDS: MemberHolds = { isMember: isMemberElement, make: makeMemberHold }
