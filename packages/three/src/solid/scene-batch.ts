/**
 * A scene's Batch (#885's PR 5; ADR-0073 decision 16, ADR-0070 decisions 11–13, *Amendment (#885)* Q9):
 * what `createBatch` makes under a three.js Stage when its config has `object` or `instances`. Its members
 * move as one run on core's Batch, a change of all of them costing about what one object's does.
 *
 * - **`object`:** each member a three.js object, made as it enters (`object(item, i)`, or `object(i)` by
 *   count), which joins `parent`, else its own, else the Stage's scene. A keyed member that leaves plays
 *   `exit`, then leaves its parent; `dispose: true` disposes its geometries and materials.
 * - **`instances`:** an `InstancedMesh`, each member an instance. One enters at the next free index; one
 *   that leaves plays `exit`, then the last instance moves into its index, its values and velocity with
 *   it, and `count` drops by one. More members than the mesh holds is an error naming its capacity.
 * - **Its members' hovers and presses,** through the scene's raycast: each member's Override stack,
 *   `animate` < `whileHover` < `whileTap`, and its events with `{ i, item, element }`.
 *
 * @module
 */
// #885's PR 5. The page's keyed Batch (`@wardic/dom`'s `BatchMembers`) is the DOM's; this is the scene's,
// over core's Batch, as `@wardic/object`'s `ObjectBatch` is, with its keyed membership and its exits.
import * as Batch from "@wardic/core/Batch"
import * as InputSource from "@wardic/core/InputSource"
import * as Playback from "@wardic/core/Playback"
import * as Recognizer from "@wardic/core/Recognizer"
import * as BatchCalls from "@wardic/core/unstable/BatchCalls"
import type * as Config from "@wardic/core/unstable/Config"
import * as Report from "@wardic/core/unstable/Report"
import * as Spine from "@wardic/core/unstable/Spine"
import type { StageBatchBinding, StageBatchHooks, StageBatchMemberInfo, StageBatchValues, StageCountBatchConfig, StageKeyedBatchConfig, StageWardEnvironment } from "@wardic/solid"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import type { Object3D } from "three"
import { leaveScene } from "../internal/leave-scene.ts"
import * as ThreeColours from "../ThreeColours.ts"
import * as ThreeInstances from "../ThreeInstances.ts"
import * as ThreeRenderer from "../ThreeRenderer.ts"
import * as ThreeValues from "../ThreeValues.ts"

/** What a scene's Batches run on: the Stage's ward environment, and its scene. */
export interface SceneBatchContext {
  readonly environment: StageWardEnvironment
  readonly scene: Object3D | undefined
}

/** A member: its key and item (keyed), its index now, its object or instance, its slot, and its gestures. */
interface Member {
  readonly key: unknown
  item: unknown
  i: number
  subject: object
  /** An instance's index in its mesh. */
  index: number
  slot: number
  leaving: boolean
  hovered: boolean
  pressed: boolean
  /** Each gesture's values, read as it started (ADR-0070 Q58): none while it's off, or when they couldn't be read. */
  readonly held: { hovered: Readonly<Record<string, number>> | undefined; pressed: Readonly<Record<string, number>> | undefined }
  /** Where it started on each key: its `initial`, else its own values. What a key `animate` doesn't set returns to. */
  rest: Readonly<Record<string, number>>
  /** Its targets with no gesture on: `animate`'s values for it now, over its starts. */
  base: Readonly<Record<string, number>>
}

/** The targets a change reads: the list now (keyed) and each item's `animate` values, as given. */
interface Targets {
  readonly items: ReadonlyArray<unknown>
  readonly values: ReadonlyArray<StageBatchValues>
}

/** An error of the Batch's: it throws, naming what it got. */
const fail = (message: string): never => {
  throw new Error(`createBatch: ${message}`)
}

/** `target` without its `transition`: its values, and the transition it runs on. */
const valuesAndTransition = (target: StageBatchValues): readonly [StageBatchValues, Config.WardicTransition | undefined] => {
  if (Bool.not(Predicate.hasProperty(target, "transition"))) return [target, undefined]
  const { transition, ...values } = target as StageBatchValues & { readonly transition?: Config.WardicTransition }
  return [values, transition]
}

/** A scene's Batch on `context`, as `createBatch` drives it. */
export const bindSceneBatch = (context: SceneBatchContext, config: StageKeyedBatchConfig<unknown> | StageCountBatchConfig, hooks: StageBatchHooks): StageBatchBinding => {
  const { environment } = context
  const runtime = environment.runtime
  const keyed = Predicate.hasProperty(config, "each")
  // A `stagger()` in its `delay`, which core's Batch calls read as one: a transition otherwise as an element's.
  const configTransition = config.transition as Config.WardicTransition | undefined
  const byKey = config as StageKeyedBatchConfig<unknown>
  const byCount = config as StageCountBatchConfig
  const keyOf = (item: unknown): unknown =>
    Bool.match(Predicate.isFunction(byKey.key), {
      onTrue: () => (byKey.key as (item: unknown) => unknown)(item),
      onFalse: () => (item as Readonly<Record<PropertyKey, unknown>>)[byKey.key as unknown as PropertyKey],
    })
  /** Its call of a member's function: `(item, i)` keyed, `(i)` by count. */
  const callFor = <A>(fn: (...args: ReadonlyArray<never>) => A, item: unknown, i: number): A =>
    Bool.match(keyed, { onTrue: () => (fn as (item: unknown, i: number) => A)(item, i), onFalse: () => (fn as (i: number) => A)(i) })

  // --- Its members' subjects: objects made per member, or an InstancedMesh's instances ---------------------
  const instanced = Predicate.isNotUndefined(config.instances)
  const source = UndefinedOr.map(config.instances, (mesh) => UndefinedOr.getOrThrowWith(ThreeInstances.batchSource()(mesh), () => new Error("createBatch: `instances` is an InstancedMesh, or a three object with `isInstancedMesh`.")))
  const mesh = config.instances as (Object3D & { count: number }) | undefined
  const capacity = UndefinedOr.match(source, { onUndefined: () => Number.POSITIVE_INFINITY, onDefined: (given) => given.members.length })
  const writer = UndefinedOr.match(source, { onUndefined: () => ThreeRenderer.writer, onDefined: (given) => given.writer })
  const read = UndefinedOr.match(source, { onUndefined: () => ThreeValues.read, onDefined: (given) => given.read })
  // Its members by key (keyed) or index, by slot, by object, and by instance index.
  const members = new Map<unknown, Member>()
  const bySlot: Array<Member | undefined> = []
  const byObject = new WeakMap<object, Member>()
  const byIndex: Array<Member | undefined> = []
  let instances = 0
  UndefinedOr.map(mesh, (given) => {
    given.count = 0
  })

  /** The parent a member's object joins: the one given, else its own, else the Stage's scene. */
  const parentFor = (object: Object3D): Object3D => {
    if (Predicate.isNotUndefined(config.parent)) return config.parent as Object3D
    if (Predicate.isNotNull(object.parent)) return object.parent
    return UndefinedOr.match(context.scene, {
      onUndefined: () => fail("its objects have no parent, and the Stage adopts a runtime with no scene of its own: give it `parent`."),
      onDefined: (scene) => scene,
    })
  }

  /** A new member's subject: its object, joined to its parent, or the next free instance. */
  const subjectFor = (item: unknown, i: number): readonly [object, number] => {
    if (instanced) {
      if (instances >= capacity) fail(`its InstancedMesh holds ${capacity} instances, and a member more is entering: make the mesh with room for as many as the list can hold.`)
      const index = instances
      instances++
      ;(mesh as { count: number }).count = instances
      return [(source as NonNullable<typeof source>).members[index] as object, index]
    }
    const object = callFor(config.object as (...args: ReadonlyArray<never>) => Object3D, item, i)
    const parent = parentFor(object)
    if (object.parent !== parent) parent.add(object)
    return [object, -1]
  }

  // --- The Batch: made on its keys at its first member ---------------------------------------------------
  let batch: Batch.Batch<object> | undefined
  let keys: ReadonlyArray<string> = []
  let keyIndex: ReadonlyMap<string, number> = new Map()

  /** `values` on `subject`, its colours split into their channels: numbers by key. */
  const splitOn = (subject: object, values: StageBatchValues): Readonly<Record<string, unknown>> =>
    ThreeColours.splitCall(subject, values, undefined)[0] as Readonly<Record<string, unknown>>

  /** `values` as numbers, each key one of the Batch's: an error naming one that isn't, or isn't a number. */
  const numbersOf = (values: Readonly<Record<string, unknown>>): Readonly<Record<string, number>> =>
    Rec.map(values, (value, key) => {
      if (Bool.not(keyIndex.has(key))) fail(`"${key}" isn't one of its keys (${keys.join(", ")}): its keys are its first targets', or \`keys\` when it's made.`)
      if (Bool.not(Predicate.isNumber(value))) fail(`"${key}" is ${JSON.stringify(value)}: a Batch's keys are numbers, or a colour key's colour.`)
      return value as number
    })

  /** A gesture's or an exit's values for a member, as given: an object's, or a function's. */
  const overlayOf = (given: unknown, member: Member): StageBatchValues | undefined => {
    if (Predicate.isUndefined(given)) return undefined
    if (Predicate.isFunction(given)) return callFor(given as (...args: ReadonlyArray<never>) => StageBatchValues, member.item, member.i)
    return given as StageBatchValues
  }

  /** The Batch, made on the keys of its first members' targets (or `keys`), its gestures' and its exit's. */
  const made = (first: ReadonlyArray<readonly [object, StageBatchValues]>): Batch.Batch<object> => {
    if (Predicate.isNotUndefined(batch)) return batch
    const named = new Set<string>()
    const add = (subject: object, values: StageBatchValues | undefined): void =>
      UndefinedOr.map(values, (given) => Arr.forEach(Rec.keys(splitOn(subject, valuesAndTransition(given)[0])), (key) => void named.add(key)))
    UndefinedOr.match(config.keys, {
      onDefined: (given) => Arr.forEach(ThreeColours.splitBatchKeys(UndefinedOr.map(Arr.head(first).pipe(Option.getOrUndefined), ([subject]) => subject), given), (key) => void named.add(key)),
      onUndefined: () =>
        Arr.forEach(first, ([subject, values]) => {
          add(subject, values)
          Arr.forEach([config.initial, byKey.exit, config.whileHover, config.whileTap], (given) => {
            if (Bool.or(Predicate.isUndefined(given), given === false)) return
            if (Bool.not(Predicate.isFunction(given))) add(subject, given as StageBatchValues)
          })
        }),
    })
    keys = Arr.fromIterable(named)
    keyIndex = new Map(Arr.map(keys, (key, k) => [key, k] as const))
    const transition = Rec.fromEntries(Arr.map(keys, (key) => [key, environment.defaultTransition.transitionFor(key, 1) as Batch.Transition] as const))
    batch = Batch.make({ keys, writer, transition, unitScale: Spine.unitScaleOf(runtime) })
    return batch
  }

  /** A member's start on the Batch's keys: its `initial`'s, else its own values; with `initial: false`, its targets. */
  const startOf = (member: Member): Readonly<Record<string, number>> => {
    const own = Rec.fromEntries(
      Arr.map(keys, (key) => {
        const value = read(member.subject, key)
        return [key, Bool.match(Predicate.isNumber(value), { onTrue: () => value as number, onFalse: () => 0 })] as const
      }),
    )
    if (config.initial === false) return { ...own, ...member.base }
    return UndefinedOr.match(overlayOf(config.initial, member), {
      onUndefined: () => own,
      onDefined: (initial) => ({ ...own, ...numbersOf(splitOn(member.subject, initial)) }),
    })
  }

  /** A gesture's values for a member as it starts: its object's, or its function's, called now. */
  const gestureValuesOf = (given: unknown, member: Member): Readonly<Record<string, number>> | undefined =>
    UndefinedOr.map(overlayOf(given, member), (overlay) => numbersOf(splitOn(member.subject, valuesAndTransition(overlay)[0])))

  /**
   * A member's target now: its press's over its hover's over `animate`'s, each gesture's as it read at its
   * start, so a change never calls a gesture's function (ADR-0070 Q58, Q59).
   */
  const targetFor = (member: Member): Readonly<Record<string, number>> => {
    // A gesture's values are held only while it's on (`gestured`, `leave`): per member per change, statements.
    let target = member.base
    const hover = member.held.hovered
    if (Predicate.isNotUndefined(hover)) target = { ...target, ...hover }
    const tap = member.held.pressed
    if (Predicate.isNotUndefined(tap)) target = { ...target, ...tap }
    return target
  }

  // --- Its runs and flights, as the page's Batch's ------------------------------------------------------
  const fibers = new Set<Fiber.Fiber<void>>()
  let flying = false
  let moved = 0
  let disposed = false
  /** A flight lands once a run ends with nothing moving. */
  const ended = (): void => {
    if (Bool.or(disposed, Bool.not(flying))) return
    if (Batch.isMoving(batch as Batch.Batch<object>)) return
    flying = false
    hooks.landed({ moved })
  }
  /** After a change: a flight's start, if it set one off, and a run, which does nothing while one runs. */
  const wake = (setOff: number): void => {
    const running = batch as Batch.Batch<object>
    if (Bool.not(Batch.isMoving(running))) return
    if (Bool.not(flying)) {
      flying = true
      moved = 0
      hooks.started()
    }
    moved += setOff
    const fiber = runtime.runFork(Batch.run(running))
    fibers.add(fiber)
    fiber.addObserver(() => {
      fibers.delete(fiber)
      ended()
    })
  }

  /** The planning of a change on its keys. */
  const planning = (): BatchCalls.Planning => ({
    keys,
    positionalKeys: environment.positionalKeys,
    defaultFor: (k, target) => environment.defaultTransition.transitionFor(keys[k] as string, target) as Batch.Transition,
    fail,
  })

  /** A change of `moving` toward `targetOf`, on `given` (the config's transition, else a gesture's or an exit's). */
  const turn = (moving: ReadonlyArray<Member>, targetOf: (member: Member) => Readonly<Record<string, number>>, given: Config.WardicTransition | undefined): void => {
    if (Bool.or(moving.length === 0, Predicate.isUndefined(batch))) return
    const running = batch as Batch.Batch<object>
    const targets = new Map<number, Readonly<Record<string, number>>>()
    Arr.forEach(moving, (member) => void targets.set(member.slot, targetOf(member)))
    const targetAt = (slot: number, k: number): number => UndefinedOr.match((targets.get(slot) as Readonly<Record<string, number>>)[keys[k] as string], { onUndefined: () => Number.NaN, onDefined: (value) => value })
    const skipped = Bool.or(environment.skipAnimations(), UndefinedOr.map(given, (transition) => transition.skipAnimations) === true)
    const planned = BatchCalls.plannedOf(environment.positionalKeys, keys, UndefinedOr.map(given, BatchCalls.unstaggered), environment.reducedMotion(), fail)
    const delay = BatchCalls.staggerOf(given)
    const options: Batch.RetargetOptions = Bool.match(skipped, {
      onTrue: (): Batch.RetargetOptions => ({ transition: BatchCalls.INSTANT }),
      onFalse: (): Batch.RetargetOptions => ({
        transition: (slot, k) => BatchCalls.memberTransitionsOf(keys, planned, (key, target) => environment.defaultTransition.transitionFor(key, target) as Batch.Transition, (kk) => targetAt(slot, kk), false)[k] as Batch.Transition,
        ...UndefinedOr.match(delay, { onUndefined: () => ({}), onDefined: (given) => ({ delay: given }) }),
      }),
    })
    wake(Batch.retarget(running, Arr.map(moving, (member) => member.slot), targetAt, options))
  }

  /** A member gone from the Batch: its object out of its parent, or its instance's index given to the last. */
  const remove = (member: Member): void => {
    members.delete(member.key)
    bySlot[member.slot] = undefined
    UndefinedOr.map(batch, (running) => Batch.leave(running, member.slot))
    if (instanced) {
      const last = byIndex[instances - 1] as Member
      if (last !== member) {
        const freed = member.index
        last.index = freed
        last.subject = (source as NonNullable<typeof source>).members[freed] as object
        byIndex[freed] = last
        UndefinedOr.map(batch, (running) => Batch.replace(running, last.slot, last.subject))
      }
      byIndex[instances - 1] = undefined
      instances--
      ;(mesh as { count: number }).count = instances
      UndefinedOr.map(batch, (running) => Batch.draw(running))
      return
    }
    // An app's listener that throws as it leaves: reported, and it has left all the same (#981).
    try {
      leaveScene(member.subject as Object3D, byKey.dispose === true)
    } catch (defect) {
      runtime.runFork(Report.failure("wardic.stage: a Subject's leave failed", Cause.die(defect)))
    }
  }

  /** Keyed members leaving: each plays its exit, one driven change of them all, and goes as its own lands. */
  const leave = (going: ReadonlyArray<Member>): void => {
    Arr.forEach(going, (member) => {
      member.leaving = true
      member.hovered = false
      member.pressed = false
      member.held.hovered = undefined
      member.held.pressed = undefined
    })
    const exiting = Arr.filter(going, (member) => Predicate.isNotUndefined(overlayOf(byKey.exit, member)))
    Arr.forEach(
      Arr.filter(going, (member) => Bool.not(exiting.includes(member))),
      remove,
    )
    if (Bool.or(exiting.length === 0, Predicate.isUndefined(batch))) return
    const running = batch as Batch.Batch<object>
    const exits = new Map<number, Readonly<Record<string, number>>>()
    let transition: Config.WardicTransition | undefined
    Arr.forEach(exiting, (member) => {
      const [values, own] = valuesAndTransition(overlayOf(byKey.exit, member) as StageBatchValues)
      transition = UndefinedOr.match(own, { onUndefined: () => transition, onDefined: (given) => given })
      exits.set(member.slot, numbersOf(splitOn(member.subject, values)))
    })
    const exitAt = (slot: number, k: number): number => UndefinedOr.match((exits.get(slot) as Readonly<Record<string, number>>)[keys[k] as string], { onUndefined: () => Number.NaN, onDefined: (value) => value })
    const given = UndefinedOr.match(transition, { onUndefined: () => configTransition, onDefined: (own) => own })
    const animation = Batch.animate(
      running,
      Arr.map(exiting, (member) => member.slot),
      exitAt,
      BatchCalls.animateOptions(
        planning(),
        {
          transition: given,
          reducedMotion: environment.reducedMotion(),
          skipAnimations: environment.skipAnimations(),
          head: Playback.make(),
          settled: () => undefined,
          onMemberLanded: (slot) => UndefinedOr.map(bySlot[slot], (member) => Bool.match(member.leaving, { onTrue: () => remove(member), onFalse: () => undefined })),
        },
        exitAt,
        undefined,
      ),
    )
    wake(Batch.play(animation))
  }

  /** A member entering: its subject made, its start at its `initial`, joined to the Batch. */
  const enter = (key: unknown, item: unknown, i: number, values: StageBatchValues): Member => {
    const [subject, index] = subjectFor(item, i)
    const member: Member = { key, item, i, subject, index, slot: -1, leaving: false, hovered: false, pressed: false, held: { hovered: undefined, pressed: undefined }, rest: {}, base: {} }
    const running = made([[subject, values]])
    const animated = numbersOf(splitOn(subject, values))
    member.base = animated
    const start = startOf(member)
    member.rest = start
    member.base = { ...start, ...animated }
    member.slot = Batch.enter(running, subject, start)
    bySlot[member.slot] = member
    Bool.match(instanced, {
      onTrue: () => {
        byIndex[index] = member
      },
      onFalse: () => void byObject.set(subject, member),
    })
    members.set(key, member)
    return member
  }

  // --- Its members' gestures, watched once asked for -------------------------------------------------------
  let gestureScope: Scope.Closeable | undefined
  const listening = new Set<"hover" | "press">()
  /** A path node's member: an object's, or an instance's of its mesh. */
  const memberOfNode = (node: unknown): Option.Option<unknown> => {
    const given = node as { readonly object: object; readonly instanceId: number | undefined }
    if (instanced) {
      if (Bool.or(given.object !== mesh, Bool.not(Predicate.isNumber(given.instanceId)))) return Option.none()
      return Option.fromUndefinedOr(byIndex[given.instanceId as number])
    }
    return Option.fromUndefinedOr(byObject.get(given.object))
  }
  /** A member's gesture info. */
  const infoOf = (member: Member): StageBatchMemberInfo =>
    Bool.match(keyed, { onTrue: () => ({ i: member.i, item: member.item, element: member.subject }), onFalse: () => ({ i: member.i, element: member.subject }) })
  /**
   * A member's gesture changed: its values read as it starts, then it turns toward its stack's target, on the
   * gesture's transition. A gesture whose values throw is the watch's report, and its member stays on it
   * with nothing to turn to.
   */
  // #979, row 34 (ADR-0074, its group A amendment: Wardic's own first): the flag is set before the app's
  // function is called, and the event told before both, so a hover's start and end stay paired. Before, a
  // change of `animate` called a hovered member's function again, inside the Batch's Solid effect, and its
  // throw halted Solid.
  const gestured = (member: Member, layer: "hovered" | "pressed", on: boolean, given: unknown): void => {
    if (Bool.or(member.leaving, member[layer] === on)) return
    member[layer] = on
    member.held[layer] = undefined
    if (on) member.held[layer] = gestureValuesOf(given, member)
    const transition = Bool.match(Bool.and(on, Bool.and(Predicate.isNotUndefined(given), Bool.not(Predicate.isFunction(given)))), {
      onTrue: () => UndefinedOr.match(valuesAndTransition(given as StageBatchValues)[1], { onUndefined: () => configTransition, onDefined: (own) => own }),
      onFalse: () => configTransition,
    })
    turn([member], targetFor, BatchCalls.unstaggered(UndefinedOr.match(transition, { onUndefined: () => ({}), onDefined: (t) => t })))
  }
  const listen = (gesture: "hover" | "press"): void => {
    if (Bool.or(disposed, listening.has(gesture))) return
    listening.add(gesture)
    if (Predicate.isUndefined(gestureScope)) gestureScope = Scope.makeUnsafe()
    // A gesture's function that throws, or values that aren't the Batch's, reported as the DOM's Batch's are
    // (#979, row 34): before, they were dropped here, unlogged.
    const onDefect = (cause: Cause.Cause<never>): void => {
      runtime.runFork(Report.failure("createBatch: a gesture failed", cause))
    }
    const watch = Bool.match(gesture === "hover", {
      onTrue: () =>
        Recognizer.watchHoverAmong(memberOfNode, {
          on: (target, edge) => {
            const member = target as Member
            hooks.gesture(Bool.match(edge.active, { onTrue: () => "hoverStart" as const, onFalse: () => "hoverEnd" as const }), infoOf(member))
            gestured(member, "hovered", edge.active, config.whileHover)
          },
          onDefect,
        }),
      onFalse: () =>
        Recognizer.watchPressAmong(memberOfNode, {
          on: (target, press) => {
            const member = target as Member
            if (press.phase === "start") hooks.gesture("pressStart", infoOf(member))
            if (press.phase === "tap") hooks.gesture("tap", infoOf(member))
            if (press.phase === "cancel") hooks.gesture("tapCancel", infoOf(member))
            gestured(member, "pressed", press.phase === "start", config.whileTap)
          },
          onDefect,
        }, { keys: false }),
    })
    runtime.runSync(watch.pipe(Effect.provideService(InputSource.InputSource, environment.input), Scope.provide(gestureScope as Scope.Closeable)))
  }

  // --- Its targets, read in a compute, and applied ---------------------------------------------------------
  const targetsOf = (): Targets => {
    if (keyed) {
      const items = byKey.each()
      return { items, values: Arr.map(items, (item, i) => byKey.animate(item, i)) }
    }
    return { items: [], values: Arr.makeBy(byCount.count, (i) => byCount.animate(i)) }
  }

  const apply = (given: unknown): void => {
    if (disposed) return
    const { items, values } = given as Targets
    const moving: Array<Member> = []
    /** Keyed: each item's member, entering or turned again; the rest leave. */
    const keyedChange = (): void => {
      const present = new Set<unknown>()
      Arr.forEach(items, (item, i) => {
        const key = keyOf(item)
        present.add(key)
        const value = values[i] as StageBatchValues
        UndefinedOr.match(members.get(key), {
          onUndefined: () => void moving.push(enter(key, item, i, value)),
          onDefined: (member) => {
            member.item = item
            member.i = i
            // One leaving, back in the list: taken back, from where its exit has it.
            member.leaving = false
            member.base = { ...member.rest, ...numbersOf(splitOn(member.subject, value)) }
            moving.push(member)
          },
        })
      })
      leave(Arr.filter(Arr.fromIterable(members.values()), (member) => Bool.and(Bool.not(present.has(member.key)), Bool.not(member.leaving))))
    }
    /** By count: each index's member, entering at the first change. */
    const countChange = (): void =>
      Arr.forEach(values, (value, i) =>
        UndefinedOr.match(members.get(i), {
          onUndefined: () => void moving.push(enter(i, undefined, i, value)),
          onDefined: (member) => {
            member.base = { ...member.rest, ...numbersOf(splitOn(member.subject, value)) }
            moving.push(member)
          },
        }),
      )
    const before = members.size
    Bool.match(keyed, { onTrue: keyedChange, onFalse: countChange })
    // Members that entered drawn at their starts now, so the first frame drawn shows their `initial`.
    if (Bool.and(members.size > before, Predicate.isNotUndefined(batch))) Batch.draw(batch as Batch.Batch<object>)
    turn(moving, targetFor, configTransition)
  }

  const dispose = (): void => {
    disposed = true
    UndefinedOr.map(gestureScope, (scope) => runtime.runSync(Scope.close(scope, Exit.void)))
    Arr.forEach(Arr.fromIterable(fibers), (fiber) => void runtime.runFork(Fiber.interrupt(fiber)))
    Arr.forEach(Arr.fromIterable(members.values()), remove)
  }

  return { targetsOf, apply, listen, dispose }
}
