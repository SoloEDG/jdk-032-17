import type { Piece, Vec2 } from '@/shared/document'
import { facingVector, tipProjection } from './physics'

/** 间隙函数只关心姿态几何，不依赖角速度 */
export interface LeanPose { facing: number; lean: number; x: number; y: number }

/**
 * 间隙函数族：gap > 0 表示尚未接触，gap ≤ 0 表示已接触。
 * 引擎在固定帧上观察符号变化，由此夹出接触时间范围 [tLower, tUpper]。
 */

function pointDistance(a: Vec2, b: Vec2) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export interface RampLip { center: Vec2; normal: Vec2; lateral: Vec2 }

/** 坡道沿朝向的两条边（近唇边 / 远唇边） */
export function rampLips(ramp: Piece): { near: RampLip; far: RampLip } {
  const normal = facingVector(ramp.angle)
  const lateral = { x: -normal.y, y: normal.x }
  const half = Math.max(ramp.width * 0.5, 0.2)
  const near = {
    center: { x: ramp.x - normal.x * half, y: ramp.y - normal.y * half },
    normal, lateral,
  }
  const far = {
    center: { x: ramp.x + normal.x * half, y: ramp.y + normal.y * half },
    normal, lateral,
  }
  return { near, far }
}

/** 取骨牌倒向（来源位置 → 顶端方向）首先越过的坡道唇边 */
export function nearestLip(ramp: Piece, sourcePoint: Vec2): RampLip {
  const { near, far } = rampLips(ramp)
  const from = { x: sourcePoint.x - ramp.x, y: sourcePoint.y - ramp.y }
  const dot = from.x * near.normal.x + from.y * near.normal.y
  // dot ≤ 0：骨牌位于 near 一侧，顶端先越过 near 唇边；反之先越过 far 唇边
  return dot <= 0 ? near : far
}

/** 骨牌顶端（落点端）与目标元件在桌面上的水平间距，已考虑双方厚度余量 */
export function pieceGap(source: Piece, state: LeanPose, target: Piece): number {
  const tip = tipProjection(state, source.height)
  const margin = (source.width + target.width) / 2
  return pointDistance(tip, { x: target.x, y: target.y }) - margin
}

/**
 * 骨牌与坡道唇边的间隙（水平面内的线段可达性）。
 * 唇边 normal 指向来向：沿 normal 的 along < 0 表示顶端还在唇边来向一侧（未到达），
 * along ≥ 0 表示已越过唇边线；横向偏出唇边范围同样视为未接触。
 */
export function rampGap(source: Piece, state: LeanPose, ramp: Piece): number {
  const tip = tipProjection(state, source.height)
  const { near, far } = rampLips(ramp)
  // 只考虑顶端仍在来向一侧（along ≥ 0）的唇边：已越过的唇边不能再产生接触。
  // 斜置坡道上骨牌可能先越过其中任一条，取可达唇边中的最小间隙。
  const gaps = [near, far]
    .map(lip => gapToLip(source, ramp, tip, lip))
    .filter(item => item.along >= 0)
  if (!gaps.length) return Number.POSITIVE_INFINITY
  return Math.min(...gaps.map(item => Math.max(item.reachGap, item.lateralGap)))
}

function gapToLip(source: Piece, ramp: Piece, tip: Vec2, lip: RampLip) {
  // 点到唇边直线的有向距离：>0 表示顶端还在唇边来向一侧（未到达）
  const along = (lip.center.x - tip.x) * lip.normal.x + (lip.center.y - tip.y) * lip.normal.y
  // 横向偏移相对坡道中心线测量
  const fromCenter = { x: tip.x - ramp.x, y: tip.y - ramp.y }
  const lateral = Math.abs(fromCenter.x * lip.lateral.x + fromCenter.y * lip.lateral.y)
  const reachGap = along - source.width * 0.25
  const lateralGap = lateral - (ramp.width * 0.5 + source.width / 2)
  return { along, reachGap, lateralGap }
}

/** 顶端与触发器感应圈的间隙 */
export function triggerGap(source: Piece, state: LeanPose, trigger: Piece): number {
  const tip = tipProjection(state, source.height)
  const radius = Math.max(trigger.width / 2, 0.3)
  return pointDistance(tip, { x: trigger.x, y: trigger.y }) - radius
}

/** 接触点的桌面位置估计，用于画布标注与事件表 */
export function contactPoint(kind: 'piece' | 'ramp-edge' | 'trigger' | 'ground', source: Piece,
  state: LeanPose, target: Piece | null): Vec2 {
  if (kind === 'ground' || !target) return tipProjection(state, source.height)
  if (kind === 'ramp-edge') return nearestLip(target, { x: state.x, y: state.y }).center
  return { x: target.x, y: target.y }
}
