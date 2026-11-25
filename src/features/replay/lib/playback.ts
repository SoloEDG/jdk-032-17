import type { ContactEvent, FallTrajectory, Piece, PoseSample } from '@/shared/document'

export interface PlaybackPose {
  pieceId: string
  t: number
  lean: number
  omega: number
  x: number
  y: number
  facing: number
  phase: PoseSample['phase']
  /** 0 = 完全直立，1 = 完全着地，用于画布透明度/着色 */
  progress: number
}

const ZERO_EPS = 1e-9

/** 在一条轨迹的姿态采样之间按时间线性插值，供慢放渲染连续旋转 */
export function samplePose(trajectory: FallTrajectory | undefined, time: number): PlaybackPose | null {
  if (!trajectory || trajectory.samples.length === 0) return null
  const samples = trajectory.samples
  if (time <= samples[0].t) return toPose(trajectory.pieceId, samples[0], trajectory)
  const last = samples[samples.length - 1]
  if (time >= last.t) return toPose(trajectory.pieceId, last, trajectory)
  for (let i = 0; i < samples.length - 1; i += 1) {
    const a = samples[i]
    const b = samples[i + 1]
    if (time >= a.t && time <= b.t) {
      const span = b.t - a.t
      const u = span <= ZERO_EPS ? 0 : (time - a.t) / span
      const interpolated: PoseSample = {
        t: time,
        lean: a.lean + (b.lean - a.lean) * u,
        omega: a.omega + (b.omega - a.omega) * u,
        x: a.x + (b.x - a.x) * u,
        y: a.y + (b.y - a.y) * u,
        facing: a.facing + (b.facing - a.facing) * u,
        phase: u < 1 ? a.phase : b.phase,
      }
      return toPose(trajectory.pieceId, interpolated, trajectory)
    }
  }
  return toPose(trajectory.pieceId, last, trajectory)
}

function toPose(pieceId: string, sample: PoseSample, trajectory: FallTrajectory): PlaybackPose {
  const span = (trajectory.leanGround ?? sample.lean) - trajectory.leanStart
  const progress = span <= ZERO_EPS ? 0 : Math.max(0, Math.min(1, (sample.lean - trajectory.leanStart) / span))
  return { pieceId, ...sample, progress }
}

export function poseMap(run: { trajectories: FallTrajectory[] } | null, time: number) {
  const map = new Map<string, PlaybackPose>()
  if (!run) return map
  for (const trajectory of run.trajectories) {
    const pose = samplePose(trajectory, time)
    if (pose) map.set(trajectory.pieceId, pose)
  }
  return map
}

/** 给定时刻已经闭合（tUpper ≤ time）的接触，用于画布上的区间标注显隐 */
export function visibleContacts(run: { contacts: ContactEvent[] } | null, time: number) {
  if (!run) return []
  return run.contacts.filter(contact => contact.interval.tLower <= time)
}

/** 该骨牌在给定时刻是否处于活动（已启动且未完全着地） */
export function isPieceActive(pose: PlaybackPose | undefined) {
  return Boolean(pose && pose.phase !== 'rest' && pose.lean > 0 && (pose.omega !== 0 || pose.progress < 1))
}

export function leanDegrees(pose: PlaybackPose | undefined) {
  return pose ? pose.lean * 180 / Math.PI : 0
}

export function contactLabel(contact: ContactEvent, pieces: Piece[]) {
  const target = pieces.find(piece => piece.id === contact.targetId)
  switch (contact.kind) {
    case 'ground': return '姿态着地'
    case 'rebound': return `坡道边回弹 → ${target?.label ?? contact.targetId}`
    case 'ramp-edge': return `坡道边触碰 → ${target?.label ?? contact.targetId}`
    case 'trigger': return `触发器 → ${target?.label ?? contact.targetId}`
    case 'piece': return `相邻接触 → ${target?.label ?? contact.targetId}`
    default: return contact.detail
  }
}
