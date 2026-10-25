// Counting the listeners added to and removed from each target, for the watch-cleanup tests (#318, #379).

/** Listeners added and removed per target while counting, and how to stop counting. */
export interface ListenerCounts {
  readonly added: (target: EventTarget) => number
  readonly removed: (target: EventTarget) => number
  readonly stop: () => void
}

type Listen = EventTarget["addEventListener"]

/**
 * Count every `addEventListener` and `removeEventListener` call, per target, until `stop`. The test
 * page's window has its own pair (the browser runner wraps them), so they're wrapped too, and its
 * calls counted there once.
 */
export const countListeners = (): ListenerCounts => {
  const added = new Map<EventTarget, number>()
  const removed = new Map<EventTarget, number>()
  const bump = (counts: Map<EventTarget, number>, target: EventTarget): void => {
    counts.set(target, (counts.get(target) ?? 0) + 1)
  }
  const add = EventTarget.prototype.addEventListener
  const remove = EventTarget.prototype.removeEventListener
  const windowAdd = window.addEventListener
  const windowRemove = window.removeEventListener
  const ownOnWindow = windowAdd !== add
  /** `listen` counted into `counts` for its target: once, the window's own pair counting the window's. */
  const counted = (listen: Listen, counts: Map<EventTarget, number>, skipWindow: boolean): Listen =>
    function (this: EventTarget, ...args: Parameters<Listen>) {
      if (!(skipWindow && this === window)) bump(counts, this)
      return listen.apply(this, args)
    }
  EventTarget.prototype.addEventListener = counted(add, added, ownOnWindow)
  EventTarget.prototype.removeEventListener = counted(remove, removed, ownOnWindow)
  if (ownOnWindow) {
    window.addEventListener = counted(windowAdd, added, false)
    window.removeEventListener = counted(windowRemove, removed, false)
  }
  return {
    added: (target) => added.get(target) ?? 0,
    removed: (target) => removed.get(target) ?? 0,
    stop: () => {
      EventTarget.prototype.addEventListener = add
      EventTarget.prototype.removeEventListener = remove
      if (ownOnWindow) {
        window.addEventListener = windowAdd
        window.removeEventListener = windowRemove
      }
    },
  }
}
