<script setup lang="ts">
import { AlertTriangle, CheckCircle2, CircleStop, FastForward, Pause, Play, RotateCcw, SkipBack, Timer } from '@lucide/vue'
import type { ContactEvent, DominoDocument, SimulationEvent, SimulationRun } from '@/shared/document'
import { formatSeconds } from '@/shared/time'
import { contactLabel } from '@/features/replay'
import { orderLabel } from '@/features/simulation'

const props = defineProps<{
  run: SimulationRun | null; events: SimulationEvent[]; contacts: ContactEvent[]; time: number
  playing: boolean; speed: number; currentEvent: SimulationEvent | null
  currentContact: ContactEvent | null; stale: boolean; document: DominoDocument
}>()
const emit = defineEmits<{ toggle: []; seek: [number]; restart: []; event: [string]; speed: [] }>()
const iconFor = (kind: SimulationEvent['kind']) => kind === 'interrupted' ? AlertTriangle
  : kind === 'mechanism' ? FastForward : CheckCircle2
const contactIcon = (kind: ContactEvent['kind']) => kind === 'rebound' || kind === 'ramp-edge' ? FastForward : CheckCircle2

function rowClass(contact: ContactEvent) {
  return {
    current: props.currentContact?.id === contact.id,
    undecided: contact.undeterminedWith.length > 0,
    rebound: contact.kind === 'rebound',
    ground: contact.kind === 'ground',
  }
}
function verdictClass(contact: ContactEvent) {
  return contact.undeterminedWith.length ? 'verdict-undecided' : 'verdict-certain'
}
</script>

<template>
  <section class="replay-panel" aria-labelledby="replay-title">
    <div class="replay-heading">
      <div class="section-kicker"><span>05 / REVIEW</span><h2 id="replay-title">结果回看</h2></div>
      <span v-if="run" class="replay-revision" :class="{ stale }">{{ stale ? '旧版布局' : `R${run.revision}` }}</span>
    </div>
    <template v-if="run">
      <div class="replay-summary" :class="run.status">
        <div class="summary-symbol"><CircleStop v-if="run.status === 'interrupted'" :size="17" /><CheckCircle2 v-else :size="17" /></div>
        <div><strong>{{ run.status === 'interrupted' ? '找到中断点' : run.status === 'complete' ? '连锁已完成' : '场景暂无元件' }}</strong>
          <small>{{ run.interruptionReason ?? `姿态轨迹 ${run.trajectories.length} 条 · 接触 ${run.contacts.length} 次 · 局部细化 ${run.refinements} 次` }}</small></div>
      </div>
      <div class="replay-controls">
        <button class="replay-icon" aria-label="回到开头" @click="emit('restart')"><SkipBack :size="15" /></button>
        <button class="replay-play" :aria-label="playing ? '暂停回放' : '播放回放'" @click="emit('toggle')">
          <Pause v-if="playing" :size="16" fill="currentColor" /><Play v-else :size="16" fill="currentColor" />
        </button>
        <button class="replay-speed" :aria-label="`播放速度 ${speed}x`" @click="emit('speed')"><Timer :size="13" /><span class="mono">{{ speed }}x</span></button>
        <span class="replay-clock mono">{{ formatSeconds(time) }}</span>
        <input aria-label="回放进度" class="replay-range" type="range" min="0" :max="run.duration || 0.01" step="0.01" :value="time"
          @input="emit('seek', Number(($event.target as HTMLInputElement).value))" />
        <span class="replay-clock mono">{{ formatSeconds(run.duration) }}</span>
      </div>

      <div class="event-list-heading"><span>接触事件表（含夹逼时间范围）</span><span>{{ contacts.length }} CONTACTS</span></div>
      <ol class="event-list contact-table">
        <li v-for="contact in contacts" :key="contact.id">
          <button class="event-row" :class="rowClass(contact)"
            :aria-current="currentContact?.id === contact.id ? 'step' : undefined" @click="emit('event', contact.id)">
            <span class="contact-bracket-range mono">
              <span class="bracket-lo">{{ formatSeconds(contact.interval.tLower) }}</span>
              <span class="bracket-sep">⌐</span>
              <span class="bracket-hi">{{ formatSeconds(contact.interval.tUpper) }}</span>
            </span>
            <span class="event-icon"><component :is="contactIcon(contact.kind)" :size="14" /></span>
            <span class="event-copy">
              <strong>{{ contactLabel(contact, document.pieces) }}</strong>
              <small>{{ contact.pieceId }} · 估计 {{ formatSeconds(contact.tEstimate) }}s · 倾角 {{ (contact.leanAtContact * 180 / Math.PI).toFixed(0) }}°<template v-if="contact.refined"> · 二分×{{ contact.depth }}</template></small>
            </span>
            <span class="order-verdict mono" :class="verdictClass(contact)">{{ orderLabel(contact) }}</span>
          </button>
        </li>
      </ol>

      <div v-if="run.undeterminedPairs.length" class="undecided-card">
        <span class="interrupt-icon"><AlertTriangle :size="16" /></span>
        <div><strong>{{ run.undeterminedPairs.length }} 个分岔未定</strong>
          <p>这些接触的时间范围互相重叠，无法仅靠区间判定先后；缩小步长只细化对应区间，不会移动已确认的接触时刻。</p></div>
      </div>

      <div class="event-list-heading legacy"><span>兼容事件轨迹</span><span>{{ events.length }} EVENTS</span></div>
      <ol class="event-list legacy-list">
        <li v-for="event in events" :key="event.id">
          <button class="event-row legacy-row" :class="{ current: currentEvent?.id === event.id, interrupted: event.kind === 'interrupted' }"
            :aria-current="currentEvent?.id === event.id ? 'step' : undefined" @click="emit('event', event.id)">
            <span class="event-time mono">{{ formatSeconds(event.time) }}</span>
            <span class="event-icon"><component :is="iconFor(event.kind)" :size="14" /></span>
            <span class="event-copy"><strong>{{ event.detail.split(' · ')[0] }}</strong><small>{{ event.detail.split(' · ')[1] ?? event.pieceId }}</small></span>
            <span v-if="event.kind === 'interrupted'" class="event-flag">中断</span>
          </button>
        </li>
      </ol>

      <div v-if="run.interruptedPieceId" class="interruption-card">
        <span class="interrupt-icon"><AlertTriangle :size="16" /></span>
        <div><strong>中断位置</strong><p>{{ run.interruptedPieceId }} 未触及下一件元件。返回场景调整间距或方向，再次模拟。</p></div>
      </div>
      <div v-if="stale" class="stale-note"><RotateCcw :size="13" /> 当前布局已改变，这份结果仍对应运行时保存的场景。</div>
    </template>
    <div v-else class="replay-empty">
      <div class="empty-orbit"><i></i><i></i><i></i><span></span></div>
      <strong>等待第一次模拟</strong><p>运行模拟后，旋转姿态、接触区间与未定分岔会显示在这里。</p>
    </div>
  </section>
</template>
