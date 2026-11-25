export type PieceKind = 'domino' | 'ramp' | 'splitter' | 'trigger'
export type Axis = 'north' | 'east' | 'south' | 'west'

export interface Vec2 { x: number; y: number }

export interface Piece {
  id: string
  kind: PieceKind
  x: number
  y: number
  angle: number
  facing: Axis
  label: string
  height: number
  width: number
  fallThreshold: number
  friction: number
}

export interface MechanismConnection {
  id: string
  from: string
  to: string
  delay: number
  enabled: boolean
}

export interface SceneSettings {
  gravity: number
  friction: number
  width: number
  height: number
  showGrid: boolean
}

export interface DominoDocument {
  id: string
  title: string
  revision: number
  updatedAt: number
  pieces: Piece[]
  connections: MechanismConnection[]
  scene: SceneSettings
  startPieceId: string
}

/** 接触类型：地面、坡道边、相邻元件、触发器、回弹、机关 */
export type ContactKind = 'ground' | 'ramp-edge' | 'piece' | 'trigger' | 'rebound' | 'mechanism'

/**
 * 接触时间范围（夹逼区间）。
 * tLower：相邻的“尚未接触”采样时刻；tUpper：检测到“首次接触”的时刻。
 * 真实接触时刻只保证落在 [tLower, tUpper] 内。
 */
export interface ContactInterval {
  tLower: number
  tUpper: number
}

export interface ContactPoint { x: number; y: number }

/** 回弹参数：记录坡道边碰撞后朝向偏转与侧向滑移 */
export interface ReboundInfo {
  restitution: number
  facingBefore: number
  facingAfter: number
  lateralKick: number
}

export interface ContactEvent {
  id: string
  pieceId: string
  kind: ContactKind
  targetId: string | null
  /** 由相邻未接触时刻与首次接触时刻夹出的时间范围 */
  interval: ContactInterval
  /** 局部二分细化后的接触时刻估计 */
  tEstimate: number
  /** 接触瞬间的倾倒角（弧度） */
  leanAtContact: number
  /** 接触点（桌面坐标，供画布标注） */
  point: ContactPoint
  /** 是否经过局部缩步细化 */
  refined: boolean
  /** 细化层级（二分次数） */
  depth: number
  /** 全局帧步长（秒） */
  frameStep: number
  rebound?: ReboundInfo
  detail: string
  /** 区间比较结果：区间不重叠才能确定先后 */
  earlierThan: string[]
  laterThan: string[]
  undeterminedWith: string[]
}

/** 慢放姿态采样 */
export interface PoseSample {
  t: number
  lean: number
  omega: number
  x: number
  y: number
  facing: number
  phase: 'falling' | 'rebound' | 'rest'
}

/** 单条事件轨迹：从站立、旋转、接触、回弹到着地的完整过程 */
export interface FallTrajectory {
  pieceId: string
  t0: number
  tGround: number | null
  leanStart: number
  leanGround: number | null
  duration: number | null
  reboundCount: number
  samples: PoseSample[]
  contacts: ContactEvent[]
}

export interface UndeterminedPair { a: string; b: string }

export interface SimulationEvent {
  id: string
  pieceId: string
  time: number
  causeId: string | null
  kind: 'trigger' | 'fall' | 'mechanism' | 'interrupted'
  detail: string
}

export interface SimulationRun {
  id: string
  documentId: string
  revision: number
  startedAt: number
  startPieceId: string
  status: 'complete' | 'interrupted' | 'empty'
  /** 兼容旧面板的事件列表（由轨迹与接触派生，与新数据来自同一次模拟） */
  events: SimulationEvent[]
  interruptedPieceId: string | null
  interruptionReason: string | null
  duration: number
  /** 每条骨牌的完整倒下轨迹（含姿态采样与接触区间） */
  trajectories: FallTrajectory[]
  /** 扁平化的全部接触事件，便于事件表直接渲染 */
  contacts: ContactEvent[]
  frameStep: number
  refinements: number
  undeterminedPairs: UndeterminedPair[]
}
