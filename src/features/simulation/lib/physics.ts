import type { Piece, Vec2 } from '@/shared/document'

/**
 * 把骨牌视为绕底边铰接的匀质细杆：
 *   I·θ¨ = m·g·(L/2)·sinθ − c·θ˙，I = m·L²/3
 * 即 θ¨ = (3g/2L)·sinθ − d·θ˙
 * lean 为骨牌相对竖直方向的倾倒角（弧度），facing 决定倾倒所在的竖直平面方向。
 */

export interface MotionParams {
  gravity: number
  /** 阻尼系数（由摩擦映射），单位 1/s */
  damping: number
}

export interface RigidState {
  /** 倾倒角，0 = 直立，正方向沿 facing 倾倒 */
  lean: number
  /** 倾倒角速度 */
  omega: number
  /** 倾倒平面朝向（桌面坐标系角度，度） */
  facing: number
  /** 铰接底边位置（回弹后可发生侧向滑移） */
  x: number
  y: number
}

export function motionParams(piece: Piece, sceneGravity: number, sceneFriction: number): MotionParams {
  return {
    gravity: sceneGravity,
    // 摩擦越大、倾倒门槛越高，转动阻尼越强
    damping: 0.18 + sceneFriction * 0.22 + piece.friction * 0.18 + piece.fallThreshold * 0.1,
  }
}

export function angularAcceleration(lean: number, omega: number, height: number, params: MotionParams) {
  return (3 * params.gravity / (2 * height)) * Math.sin(lean) - params.damping * omega
}

/** 单步 RK4 积分 lean / omega；位置与朝向在回弹事件中另行修改 */
export function rk4Step(state: RigidState, height: number, dt: number, params: MotionParams): RigidState {
  const f = (lean: number, omega: number) => ({ dLean: omega, dOmega: angularAcceleration(lean, omega, height, params) })

  const k1 = f(state.lean, state.omega)
  const k2 = f(state.lean + k1.dLean * dt / 2, state.omega + k1.dOmega * dt / 2)
  const k3 = f(state.lean + k2.dLean * dt / 2, state.omega + k2.dOmega * dt / 2)
  const k4 = f(state.lean + k3.dLean * dt, state.omega + k3.dOmega * dt)

  return {
    ...state,
    lean: state.lean + (k1.dLean + 2 * k2.dLean + 2 * k3.dLean + k4.dLean) * dt / 6,
    omega: state.omega + (k1.dOmega + 2 * k2.dOmega + 2 * k3.dOmega + k4.dOmega) * dt / 6,
  }
}

/** 骨牌顶端触地时的倾倒角：L·cosθ = 厚度/2 */
export function groundLean(height: number, width: number) {
  return Math.acos(Math.min(1, width / (2 * height)))
}

export function toRadians(degrees: number) {
  return degrees * Math.PI / 180
}

export function facingVector(facingDegrees: number): Vec2 {
  const radians = toRadians(facingDegrees)
  return { x: Math.cos(radians), y: Math.sin(radians) }
}

/** 骨牌顶端在桌面上的水平投影位置（水平伸出量 = L·sinθ） */
export function tipProjection(state: { facing: number; lean: number; x: number; y: number }, height: number): Vec2 {
  const reach = height * Math.sin(state.lean)
  const dir = facingVector(state.facing)
  return { x: state.x + dir.x * reach, y: state.y + dir.y * reach }
}

/** 顶端离地高度（L·cosθ） */
export function tipHeight(state: { facing: number; lean: number; x: number; y: number }, height: number) {
  return height * Math.cos(state.lean)
}

/** 顶端与地面（按骨牌厚度留余量）之间的间隙，≤0 即触地 */
export function groundGap(state: RigidState, piece: Piece) {
  return tipHeight(state, piece.height) - piece.width / 2
}

/** 从静止直立被推动后的初始倾倒角：越过倾倒门槛才会真正倒下 */
export function initialLean(piece: Piece) {
  // 门槛 0.8 对应约 9° 起步倾角，范围随参数缩放
  return Math.max(0.05, piece.fallThreshold * 0.19)
}

export function cloneState(state: RigidState): RigidState {
  return { ...state }
}

export function angleLerp(a: number, b: number, u: number) {
  return a + (b - a) * u
}

/** 在两个姿态采样之间做线性姿态插值（回放慢放使用） */
export function interpolateState(a: RigidState, b: RigidState, u: number): RigidState {
  return {
    lean: angleLerp(a.lean, b.lean, u),
    omega: angleLerp(a.omega, b.omega, u),
    facing: angleLerp(a.facing, b.facing, u),
    x: angleLerp(a.x, b.x, u),
    y: angleLerp(a.y, b.y, u),
  }
}
