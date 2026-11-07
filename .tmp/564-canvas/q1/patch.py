#!/usr/bin/env python3
"""PROTOTYPE Q1: build q1/core-<name> from packages/core/src with the hacks named. usage: patch.py <name> [lazy] [direct]
lazy:   springValues' Frame is one class whose `value`/`velocity` records are filled when read (no keyed
        double stores per step), and which exposes `positions` for a positional writer.
direct: the Frame loop gains `runDirect(machine, sink, onEnd)`: a run with no fiber, Deferred or scope."""
import sys, shutil, os
name, flags = sys.argv[1], set(sys.argv[2:])
root = os.path.dirname(os.path.abspath(__file__))
dst = os.path.join(root, f"core-{name}")
shutil.rmtree(dst, ignore_errors=True)
shutil.copytree(os.path.join(root, "../../../packages/core/src"), os.path.join(dst, "src"))
os.symlink("../../../../packages/core/node_modules", os.path.join(dst, "node_modules"))
def edit(rel, old, new):
    p = os.path.join(dst, "src", rel); s = open(p).read()
    assert s.count(old) == 1, (rel, old[:60]); open(p, "w").write(s.replace(old, new))
if "lazy" in flags:
    edit("Machine.ts", '''      const frame = { value: recordOf(positions), velocity: recordOf(velocities), done: false }
      const frameValue = frame.value
      const frameVelocity = frame.velocity''', '''      // Q1 HACK lazy: records filled when read; one class, so every run's Frame shares a shape.
      const frameValue = recordOf(positions)
      const frameVelocity = recordOf(velocities)
      const frame = new ValuesFrame(keys, positions, velocities, frameValue, frameVelocity)''')
    edit("Machine.ts", '''          const key = keys[i]
          frameValue[key] = position
          frameVelocity[key] = speed
        }''', '''        }''')
    edit("Machine.ts", '''// --- The composites ----------------------------------------------------------''', '''/** Q1 HACK lazy: `springValues`' Frame. */
class ValuesFrame {
  done = false
  keys: ReadonlyArray<string>
  positions: Array<number>
  velocities: Array<number>
  valueRecord: Record<string, number>
  velocityRecord: Record<string, number>
  constructor(keys: ReadonlyArray<string>, positions: Array<number>, velocities: Array<number>, valueRecord: Record<string, number>, velocityRecord: Record<string, number>) {
    this.keys = keys
    this.positions = positions
    this.velocities = velocities
    this.valueRecord = valueRecord
    this.velocityRecord = velocityRecord
  }
  get value(): Record<string, number> {
    const keys = this.keys, xs = this.positions, rec = this.valueRecord
    for (let i = 0; i < keys.length; i++) rec[keys[i]] = xs[i]
    return rec
  }
  get velocity(): Record<string, number> {
    const keys = this.keys, xs = this.velocities, rec = this.velocityRecord
    for (let i = 0; i < keys.length; i++) rec[keys[i]] = xs[i]
    return rec
  }
}

// --- The composites ----------------------------------------------------------''')
if "direct" in flags:
    edit("internal/frameLoop.ts", '''  removed: boolean
}
''', '''  removed: boolean
  /** Q1 HACK direct: a direct run's end, a plain call in place of its Deferred. */
  onEnd?: (exit: Exit.Exit<Frame.Frame<unknown>>) => void
}
''')
    edit("internal/frameLoop.ts", '''      if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) failedCount++
      Deferred.doneUnsafe(entry.settled, exit)''', '''      if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) failedCount++
      if (entry.onEnd !== undefined) {
        entry.onEnd(exit)
        return
      }
      Deferred.doneUnsafe(entry.settled, exit)''')
    edit("internal/frameLoop.ts", '''    return { run: runIn(entries), runLast: runIn(lastEntries), afterTick } satisfies Shape''', '''    const NO_DEFERRED = Deferred.makeUnsafe<Frame.Frame<unknown> | Supersede.Superseded>()
    const runDirect = <F extends Frame.Frame<unknown>>(machine: Machine.Machine<F>, sink: FrameLoop.Sink<F>, onEnd: (exit: Exit.Exit<Frame.Frame<unknown>>) => void) => {
      const entry: Entry = {
        name: machine.span.name,
        step: machine.start(),
        sink: sink as FrameLoop.Sink<Frame.Frame<unknown>>,
        settles: machine.settles,
        settled: NO_DEFERRED,
        removed: false,
        onEnd,
      }
      entries.push(entry)
      if (!bursting) Effect.runFork(startBurst)
      return { stop: () => { entry.removed = true } }
    }
    return { run: runIn(entries), runLast: runIn(lastEntries), afterTick, runDirect } as unknown as Shape''')
print("built", dst, sorted(flags))
