// Counting the listeners added to and removed from each target, for the watch-cleanup tests (#318).

/** Listeners added and removed per target while counting, and how to stop counting. */
export interface ListenerCounts {
  readonly added: (target: EventTarget) => number
  readonly removed: (target: EventTarget) => number
  readonly stop: () => void
}

/** Count every `addEventListener` and `removeEventListener` call, per target, until `stop`. */
export const countListeners = (): ListenerCounts => {
  const added = new Map<EventTarget, number>()
  const removed = new Map<EventTarget, number>()
  const add = EventTarget.prototype.addEventListener
  const remove = EventTarget.prototype.removeEventListener
  EventTarget.prototype.addEventListener = function (this: EventTarget, ...args: Parameters<EventTarget["addEventListener"]>) {
    added.set(this, (added.get(this) ?? 0) + 1)
    return add.apply(this, args)
  }
  EventTarget.prototype.removeEventListener = function (this: EventTarget, ...args: Parameters<EventTarget["removeEventListener"]>) {
    removed.set(this, (removed.get(this) ?? 0) + 1)
    return remove.apply(this, args)
  }
  return {
    added: (target) => added.get(target) ?? 0,
    removed: (target) => removed.get(target) ?? 0,
    stop: () => {
      EventTarget.prototype.addEventListener = add
      EventTarget.prototype.removeEventListener = remove
    },
  }
}
