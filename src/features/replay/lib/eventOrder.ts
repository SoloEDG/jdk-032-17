import type { ContactEvent, SimulationEvent } from '@/shared/document'

export function sortedEvents(events: readonly SimulationEvent[]) {
  return [...events].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
}

export function previousEvent(events: readonly SimulationEvent[], time: number) {
  return sortedEvents(events).filter(event => event.time <= time).at(-1) ?? null
}

/** 接触按夹逼区间下界排序，区间相同则按估计时刻 */
export function sortedContacts(contacts: readonly ContactEvent[]) {
  return [...contacts].sort((a, b) =>
    a.interval.tLower - b.interval.tLower
    || a.interval.tUpper - b.interval.tUpper
    || a.tEstimate - b.tEstimate
    || a.id.localeCompare(b.id))
}
