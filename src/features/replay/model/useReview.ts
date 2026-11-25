import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { ContactEvent, SimulationRun } from '@/shared/document'
import { poseMap, visibleContacts } from '../lib/playback'

const SPEEDS = [0.25, 0.5, 1, 2] as const
export type PlaybackSpeed = typeof SPEEDS[number]

export function useReview(run: Ref<SimulationRun | null>) {
  const time = ref(0)
  const playing = ref(false)
  const speedIndex = ref(1)
  let timer = 0
  const events = computed(() => run.value?.events ?? [])
  const contacts = computed(() => run.value?.contacts ?? [])
  const trajectories = computed(() => run.value?.trajectories ?? [])
  const speed = computed<PlaybackSpeed>(() => SPEEDS[speedIndex.value])
  const poses = computed(() => poseMap(run.value, time.value))
  const shownContacts = computed(() => visibleContacts(run.value, time.value))

  // 当前接触：时刻落在夹逼区间内；若无则取最近一个已闭合的接触
  const currentContact = computed<ContactEvent | null>(() => {
    const list = contacts.value
    if (!list.length) return null
    const inside = list.filter(c => time.value >= c.interval.tLower && time.value <= c.interval.tUpper)
    if (inside.length) return inside.sort((a, b) => a.tEstimate - b.tEstimate)[0]
    const closed = list.filter(c => c.interval.tUpper <= time.value)
    return closed.at(-1) ?? null
  })
  const currentEvent = computed(() => {
    const list = events.value
    return list.filter(event => event.time <= time.value).at(-1) ?? null
  })
  const focusPieceId = computed(() => currentContact.value?.pieceId ?? currentEvent.value?.pieceId ?? null)

  function stop() {
    playing.value = false
    if (timer) window.clearInterval(timer)
    timer = 0
  }
  function pause() { stop() }
  function seek(value: number) {
    stop()
    time.value = Math.max(0, Math.min(run.value?.duration ?? 0, value))
  }
  function play() {
    if (!run.value || run.value.duration <= 0 || playing.value) return
    if (time.value >= run.value.duration) time.value = 0
    playing.value = true
    timer = window.setInterval(() => {
      const duration = run.value?.duration ?? 0
      time.value = Math.min(duration, time.value + 0.02 * speed.value)
      if (time.value >= duration) stop()
    }, 40)
  }
  function toggle() { if (playing.value) pause(); else play() }
  function restart() { seek(0) }
  function cycleSpeed() { speedIndex.value = (speedIndex.value + 1) % SPEEDS.length }
  function focusEvent(eventId: string) {
    const contact = contacts.value.find(item => item.id === eventId)
    if (contact) seek(contact.tEstimate)
    else {
      const event = events.value.find(item => item.id === eventId)
      if (event) seek(event.time)
    }
  }
  watch(run, () => { time.value = 0; stop(); speedIndex.value = 1 })
  onBeforeUnmount(stop)
  return {
    time, playing, speed, speeds: SPEEDS, events, contacts, trajectories, poses, shownContacts,
    currentEvent, currentContact, focusPieceId, seek, play, pause, toggle, restart, cycleSpeed, focusEvent,
  }
}
