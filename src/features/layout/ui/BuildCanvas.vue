<script setup lang="ts">
import { computed, ref } from 'vue'
import { Crosshair, MousePointer2 } from '@lucide/vue'
import type {
  ContactEvent, DominoDocument, Piece, PieceKind, SimulationRun,
} from '@/shared/document'
import type { PlaybackPose } from '@/features/replay'
import { leanDegrees } from '@/features/replay'

const props = defineProps<{
  document: DominoDocument; activeTool: PieceKind | null; selectedId: string | null
  run: SimulationRun | null; focusPieceId: string | null
  poses: Map<string, PlaybackPose>; contacts: ContactEvent[]; reviewTime: number
}>()
const emit = defineEmits<{
  place: [PieceKind, number, number]; select: [string | null]; move: [string, number, number]
}>()
const svg = ref<SVGSVGElement | null>(null)
const view = { width: 1040, height: 510, margin: 35 }
const fallen = computed(() => new Set(
  props.run?.trajectories.filter(t => t.tGround !== null).map(t => t.pieceId) ?? []))
const failed = computed(() => props.run?.interruptedPieceId ?? null)
let dragging: string | null = null

function worldPoint(event: PointerEvent) {
  if (!svg.value) return { x: 0, y: 0 }
  const bounds = svg.value.getBoundingClientRect()
  const svgX = (event.clientX - bounds.left) / bounds.width * view.width
  const svgY = (event.clientY - bounds.top) / bounds.height * view.height
  return {
    x: Math.max(0, Math.min(props.document.scene.width,
      (svgX - view.margin) / (view.width - view.margin * 2) * props.document.scene.width)),
    y: Math.max(0, Math.min(props.document.scene.height,
      (svgY - view.margin) / (view.height - view.margin * 2) * props.document.scene.height)),
  }
}

function down(event: PointerEvent, piece: Piece) {
  event.stopPropagation()
  dragging = piece.id
  emit('select', piece.id)
  ;(event.currentTarget as SVGGElement).setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (!dragging) return
  const point = worldPoint(event)
  emit('move', dragging, point.x, point.y)
}
function up() { dragging = null }
function boardClick(event: PointerEvent) {
  if (dragging) return
  const point = worldPoint(event)
  if (props.activeTool) emit('place', props.activeTool, point.x, point.y)
  else emit('select', null)
}
function pxX(x: number) { return view.margin + x / props.document.scene.width * (view.width - view.margin * 2) }
function pxY(y: number) { return view.margin + y / props.document.scene.height * (view.height - view.margin * 2) }

/** 回放姿态：骨牌绕底边在倾倒平面内旋转，底边随回弹滑移 */
function poseTransform(piece: Piece) {
  const pose = props.poses.get(piece.id)
  if (!pose) return `translate(${pxX(piece.x)} ${pxY(piece.y)}) rotate(${piece.angle})`
  const baseX = pxX(pose.x)
  const baseY = pxY(pose.y)
  const lean = leanDegrees(pose)
  // 骨牌矩形底边在本地坐标 y=19，旋转中心放到该底边，倾倒方向取 facing + lean
  return `translate(${baseX} ${baseY}) rotate(${pose.facing + lean} 0 19)`
}

function isFalling(piece: Piece) {
  const pose = props.poses.get(piece.id)
  return Boolean(pose && pose.phase !== 'rest')
}

function pieceColor(piece: Piece) {
  if (piece.id === failed.value) return '#e88b69'
  const pose = props.poses.get(piece.id)
  if (pose?.phase === 'rest' || fallen.value.has(piece.id)) return '#89c5a5'
  if (pose) return '#e6bd68'
  if (piece.kind === 'ramp') return '#8ca6a0'
  if (piece.kind === 'splitter') return '#e6bd68'
  if (piece.kind === 'trigger') return '#df8d70'
  return '#ead8b5'
}
function pieceOpacity(piece: Piece) {
  const pose = props.poses.get(piece.id)
  if (pose?.phase === 'rest') return 0.7
  if (pose) return 1
  return fallen.value.has(piece.id) ? 0.68 : 1
}
function eventTime(pieceId: string) {
  const contact = props.run?.contacts.find(item => item.pieceId === pieceId && item.kind !== 'ground')
  return contact ? contact.tEstimate.toFixed(2) : ''
}
function bracketActive(contact: ContactEvent) {
  return props.reviewTime >= contact.interval.tLower && props.reviewTime <= contact.interval.tUpper
}
function bracketClosed(contact: ContactEvent) {
  return props.reviewTime > contact.interval.tUpper
}
</script>

<template>
  <section class="stage-panel" aria-label="骨牌构筑场景">
    <div class="stage-toolbar">
      <div class="stage-mode"><MousePointer2 :size="15" /><span>{{ activeTool ? '点击空位添加元件' : '编辑场景' }}</span></div>
      <div class="stage-readout">
        <span class="readout-dot"></span>{{ document.pieces.length }} 件元件 <span class="readout-sep">·</span>
        {{ run ? `接触 ${run.contacts.length} · 细化 ${run.refinements} · 未定 ${run.undeterminedPairs.length}` : `${document.scene.width} × ${document.scene.height} 桌面` }}
      </div>
    </div>
    <svg ref="svg" class="stage-svg" :viewBox="`0 0 ${view.width} ${view.height}`" role="img"
      aria-label="可编辑的多米诺场景。慢放时骨牌按真实倾倒角旋转，接触区间用括弧标注。" @pointerup="up" @pointercancel="up"
      @pointermove="move" @pointerdown="boardClick">
      <defs>
        <pattern id="draft-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#3c5048" stroke-width=".65" opacity=".6" />
          <circle cx="0" cy="0" r="1" fill="#b9c3a5" opacity=".3" />
        </pattern>
        <pattern id="draft-fine" width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".65" fill="#758376" opacity=".35" />
        </pattern>
        <filter id="piece-shadow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="1" dy="3" stdDeviation="2" flood-color="#101a17" flood-opacity=".38" />
        </filter>
      </defs>
      <rect x="0" y="0" :width="view.width" :height="view.height" rx="12" class="board-bg" />
      <rect :x="view.margin" :y="view.margin" :width="view.width-view.margin*2" :height="view.height-view.margin*2" rx="7" class="board-surface" />
      <rect :x="view.margin" :y="view.margin" :width="view.width-view.margin*2" :height="view.height-view.margin*2" rx="7" fill="url(#draft-fine)" pointer-events="none" />
      <path v-if="document.scene.showGrid" :d="`M ${view.margin} ${view.height/2} H ${view.width-view.margin} M ${view.width/2} ${view.margin} V ${view.height-view.margin}`" class="center-guide" pointer-events="none" />

      <g v-for="connection in document.connections.filter(link => link.enabled)" :key="connection.id" class="mechanism-link" pointer-events="none">
        <path :d="`M ${pxX(document.pieces.find(piece => piece.id === connection.from)?.x ?? 0)} ${pxY(document.pieces.find(piece => piece.id === connection.from)?.y ?? 0)} Q ${(pxX(document.pieces.find(piece => piece.id === connection.from)?.x ?? 0)+pxX(document.pieces.find(piece => piece.id === connection.to)?.x ?? 0))/2} ${(pxY(document.pieces.find(piece => piece.id === connection.from)?.y ?? 0)+pxY(document.pieces.find(piece => piece.id === connection.to)?.y ?? 0))/2-36} ${pxX(document.pieces.find(piece => piece.id === connection.to)?.x ?? 0)} ${pxY(document.pieces.find(piece => piece.id === connection.to)?.y ?? 0)}`" />
        <circle :cx="pxX(document.pieces.find(piece => piece.id === connection.from)?.x ?? 0)" :cy="pxY(document.pieces.find(piece => piece.id === connection.from)?.y ?? 0)" r="3" />
      </g>

      <g v-for="piece in document.pieces" :key="piece.id" class="scene-piece"
        :class="{ selected: selectedId === piece.id, focused: focusPieceId === piece.id, fallen: fallen.has(piece.id), moving: isFalling(piece) }"
        :transform="poseTransform(piece)" :opacity="pieceOpacity(piece)"
        :tabindex="0" role="button" :aria-label="`${piece.label}，${piece.x.toFixed(1)}，${piece.y.toFixed(1)}`" :aria-pressed="selectedId === piece.id"
        @pointerdown="down($event, piece)" @keydown.enter.stop="emit('select', piece.id)" @keydown.space.stop.prevent="emit('select', piece.id)">
        <ellipse v-if="piece.kind === 'domino'" cx="0" cy="19" rx="15" ry="7" class="piece-ground-shadow" />
        <rect v-if="piece.kind === 'domino'" x="-9" y="-20" width="18" height="39" rx="4" :fill="pieceColor(piece)" class="domino-body" filter="url(#piece-shadow)" />
        <path v-else-if="piece.kind === 'ramp'" d="M-24 10 L22 10 L22 -10 Z" :fill="pieceColor(piece)" class="ramp-body" filter="url(#piece-shadow)" />
        <path v-else-if="piece.kind === 'splitter'" d="M0-13 L13 0 L0 13 L-13 0 Z" :fill="pieceColor(piece)" class="splitter-body" filter="url(#piece-shadow)" />
        <circle v-else r="11" :fill="pieceColor(piece)" class="trigger-body" filter="url(#piece-shadow)" />
        <line v-if="piece.kind === 'domino'" x1="0" y1="-15" x2="0" y2="14" class="domino-mark" />
        <circle v-if="piece.id === document.startPieceId" cy="-28" r="4" class="start-marker" />
        <circle v-if="piece.id === failed" cy="-34" r="7" class="failure-marker" />
        <text y="32" text-anchor="middle" class="piece-label">{{ piece.label }}</text>
        <text v-if="eventTime(piece.id)" y="44" text-anchor="middle" class="piece-time">{{ eventTime(piece.id) }}s</text>
        <rect v-if="selectedId === piece.id || focusPieceId === piece.id" x="-18" y="-28" width="36" height="55" rx="8" class="selection-ring" />
      </g>

      <!-- 接触时间范围标注：括弧宽度对应 [tLower, tUpper] 在当前时刻的状态 -->
      <g v-for="contact in contacts" :key="contact.id" class="contact-bracket"
        :class="{ active: bracketActive(contact), closed: bracketClosed(contact), undecided: contact.undeterminedWith.length > 0 }"
        :transform="`translate(${pxX(contact.point.x)} ${pxY(contact.point.y)})`" pointer-events="none">
        <circle r="4" class="bracket-dot" />
        <g v-if="bracketActive(contact) || bracketClosed(contact)">
          <path class="bracket-arc" d="M -11 -9 A 14 14 0 0 1 11 -9" />
          <text y="-13" text-anchor="middle" class="bracket-text">
            {{ contact.interval.tLower.toFixed(2) }}–{{ contact.interval.tUpper.toFixed(2) }}
          </text>
          <text v-if="contact.undeterminedWith.length" y="20" text-anchor="middle" class="bracket-undecided">未定</text>
        </g>
      </g>

      <g v-if="focusPieceId" class="focus-reticle" pointer-events="none">
        <circle :cx="pxX(document.pieces.find(piece => piece.id === focusPieceId)?.x ?? 0)" :cy="pxY(document.pieces.find(piece => piece.id === focusPieceId)?.y ?? 0)" r="25" />
        <circle :cx="pxX(document.pieces.find(piece => piece.id === focusPieceId)?.x ?? 0)" :cy="pxY(document.pieces.find(piece => piece.id === focusPieceId)?.y ?? 0)" r="32" />
      </g>
      <g class="board-scale" pointer-events="none"><path d="M 0 0 H 80 M 0 0 V -5 M 80 0 V -5" /><text x="40" y="15" text-anchor="middle">2 M</text></g>
    </svg>
    <div class="stage-footer">
      <span><Crosshair :size="13" /> 桌面定位</span>
      <span>括弧 = 相邻未接触/首次接触夹出的时间范围 · 区间重叠标「未定」</span>
    </div>
  </section>
</template>
