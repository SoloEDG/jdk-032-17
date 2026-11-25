import type {
  ContactEvent, ContactKind, DominoDocument, FallTrajectory, Piece, PoseSample,
  SimulationEvent, SimulationRun,
} from '@/shared/document'
import {
  cloneState, groundGap, groundLean, initialLean, motionParams, rk4Step,
  type MotionParams, type RigidState,
} from './physics'
import { contactPoint, pieceGap, rampGap, triggerGap } from './contacts'
import { resolveContactOrder } from './ordering'

export interface EngineOptions {
  frameStep: number
  maxDepth: number
  maxFrames: number
}

const DEFAULT_OPTIONS: EngineOptions = { frameStep: 0.02, maxDepth: 14, maxFrames: 24000 }

type BodyPhase = 'idle' | 'falling' | 'rest'

interface SimBody {
  piece: Piece
  state: RigidState
  phase: BodyPhase
  params: MotionParams
  restLean: number
  trajectory: FallTrajectory
  consumed: Set<string>
  reboundCount: number
}

interface ScheduledKick {
  time: number
  pieceId: string
  causeId: string | null
  detail: string
  omega0: number
}

interface ScheduledMechanism {
  time: number
  pieceId: string
  causeId: string | null
  detail: string
}

interface Candidate {
  key: string
  kind: ContactKind
  target: Piece | null
  gap: (s: RigidState) => number
}

let eventSerial = 0
const nextId = (prefix: string) => `${prefix}-${(eventSerial += 1)}`

function restitutionOf(piece: Piece) {
  // 摩擦越小回弹越强；侧向回弹能量有上限，避免永动
  return Math.min(0.62, 0.24 + (1 - piece.friction) * 0.5)
}

function candidateScan(document: DominoDocument, body: SimBody): Candidate[] {
  const result: Candidate[] = []
  for (const other of document.pieces) {
    if (other.id === body.piece.id) continue
    const centerDistance = Math.hypot(other.x - body.state.x, other.y - body.state.y)
    if (centerDistance > body.piece.height + Math.max(other.width, 1.2)) continue
    if (other.kind === 'ramp') {
      result.push({
        key: `ramp-edge:${other.id}`, kind: 'ramp-edge', target: other,
        gap: s => rampGap(body.piece, s, other),
      })
    } else if (other.kind === 'trigger') {
      result.push({
        key: `trigger:${other.id}`, kind: 'trigger', target: other,
        gap: s => triggerGap(body.piece, s, other),
      })
    } else if (other.kind === 'splitter' || other.kind === 'domino') {
      result.push({
        key: `piece:${other.id}`, kind: other.kind === 'splitter' ? 'piece' : 'piece', target: other,
        gap: s => pieceGap(body.piece, s, other),
      })
    }
  }
  return result
}

export function runEngine(document: DominoDocument, options: Partial<EngineOptions> = {}) {
  eventSerial = 0
  const opts: EngineOptions = { ...DEFAULT_OPTIONS, ...options }
  const { frameStep } = opts

  const bodies = new Map<string, SimBody>()
  for (const piece of document.pieces) {
    if (piece.kind !== 'domino') continue
    const state: RigidState = { lean: 0, omega: 0, facing: piece.angle, x: piece.x, y: piece.y }
    bodies.set(piece.id, {
      piece, state, phase: 'idle', params: motionParams(piece, document.scene.gravity, document.scene.friction),
      restLean: groundLean(piece.height, piece.width),
      trajectory: {
        pieceId: piece.id, t0: 0, tGround: null, leanStart: 0, leanGround: null,
        duration: null, reboundCount: 0, samples: [], contacts: [],
      },
      consumed: new Set(), reboundCount: 0,
    })
  }

  const kicks: ScheduledKick[] = []
  const mechanisms: ScheduledMechanism[] = []
  const contacts: ContactEvent[] = []
  const legacy: SimulationEvent[] = []
  let reachedTrigger = false
  let interruptedPieceId: string | null = null
  let interruptionReason: string | null = null
  let refinements = 0
  let frame = 0

  function pushLegacy(pieceId: string, time: number, causeId: string | null,
    kind: SimulationEvent['kind'], detail: string) {
    legacy.push({ id: `event-${legacy.length + 1}`, pieceId, time, causeId, kind, detail })
  }

  function scheduleKick(pieceId: string, time: number, causeId: string | null, detail: string, omega0: number) {
    kicks.push({ time, pieceId, causeId, detail, omega0 })
  }

  function fireMechanisms(fromId: string, time: number, causeId: string | null) {
    for (const link of document.connections.filter(item => item.from === fromId && item.enabled)) {
      mechanisms.push({ time: time + link.delay, pieceId: link.to, causeId, detail: '机关连线' })
    }
  }

  function startFalling(body: SimBody, time: number, causeId: string | null, detail: string, omega0: number) {
    if (body.phase !== 'idle') return
    body.phase = 'falling'
    body.state.lean = initialLean(body.piece)
    body.state.omega = Math.max(omega0, 0.55)
    body.trajectory.t0 = time
    body.trajectory.leanStart = body.state.lean
    body.trajectory.samples.push({
      t: time, lean: body.state.lean, omega: body.state.omega,
      x: body.state.x, y: body.state.y, facing: body.state.facing, phase: 'falling',
    })
    pushLegacy(body.piece.id, time, causeId, 'fall', `受力倒下 · ${detail}`)
  }

  /** 坡道边碰撞：冲量沿唇边切向偏转，形成侧向回弹；骨牌在偏转后的平面内继续向前旋转 */
  function applyRebound(body: SimBody, ramp: Piece, contact: ContactEvent) {
    const before = body.state.facing
    const rad = before * Math.PI / 180
    const incoming = { x: Math.cos(rad), y: Math.sin(rad) }
    const normal = { x: Math.cos(ramp.angle * Math.PI / 180), y: Math.sin(ramp.angle * Math.PI / 180) }
    const tangent = { x: -normal.y, y: normal.x }
    const restitution = restitutionOf(body.piece)
    const dot = incoming.x * normal.x + incoming.y * normal.y
    // 擦碰唇边后朝向被折向唇边切向一侧，偏转量受恢复系数调制并限制在前向半平面
    const side = -Math.sign(incoming.x * tangent.x + incoming.y * tangent.y || 1)
    const bendMagnitude = Math.min(58, (28 + 34 * restitution) * (0.5 + 0.6 * Math.abs(dot)))
    const facingAfter = before + side * bendMagnitude
    const dir = { x: Math.cos(facingAfter * Math.PI / 180), y: Math.sin(facingAfter * Math.PI / 180) }
    // 铰接底边沿回弹方向轻微滑移，侧向冲量有界
    const lateral = body.piece.height * 0.08 * (0.4 + Math.abs(dot))
    body.state.facing = facingAfter
    body.state.x += dir.x * lateral
    body.state.y += dir.y * lateral
    // 保持向前旋转（omega 仍为正），仅按恢复系数损失能量
    body.state.omega = Math.abs(body.state.omega) * (0.55 + 0.45 * restitution)
    body.reboundCount += 1
    body.trajectory.reboundCount = body.reboundCount
    contact.rebound = {
      restitution, facingBefore: before, facingAfter, lateralKick: lateral,
    }
  }

  /** 从帧起点缓存状态出发做局部二分，只重积分当前骨牌，远处已确认的接触不受影响 */
  function bisectContact(body: SimBody, state0: RigidState, t0: number, dt: number, gap: (s: RigidState) => number) {
    let lo = 0
    let hi = dt
    let stateLo = cloneState(state0)
    for (let depth = 0; depth < opts.maxDepth; depth += 1) {
      const mid = (lo + hi) / 2
      const stateMid = rk4Step(state0, body.piece.height, mid, body.params)
      if (gap(stateMid) <= 0) hi = mid
      else { lo = mid; stateLo = stateMid }
    }
    refinements += 1
    return { tau: (lo + hi) / 2, stateAt: rk4Step(state0, body.piece.height, (lo + hi) / 2, body.params), depth: opts.maxDepth }
  }

  function registerContact(body: SimBody, candidate: Candidate, time: number, frameStart: number,
    stateAt: RigidState, depth: number, detail: string): ContactEvent {
    const point = contactPoint(candidate.kind === 'ramp-edge' ? 'ramp-edge' : candidate.kind === 'trigger' ? 'trigger' : 'piece',
      body.piece, stateAt, candidate.target)
    const contact: ContactEvent = {
      id: nextId('contact'),
      pieceId: body.piece.id,
      kind: candidate.kind,
      targetId: candidate.target?.id ?? null,
      // 相邻未接触时刻（帧起点）与首次接触时刻（帧终点）夹出的时间范围
      interval: { tLower: frameStart, tUpper: frameStart + frameStep },
      tEstimate: time,
      leanAtContact: stateAt.lean,
      point,
      refined: true,
      depth,
      frameStep,
      earlierThan: [], laterThan: [], undeterminedWith: [],
      detail,
    }
    contacts.push(contact)
    body.trajectory.contacts.push(contact)
    body.consumed.add(candidate.key)
    return contact
  }

  function handleContact(body: SimBody, candidate: Candidate, contact: ContactEvent, time: number) {
    const target = candidate.target
    if (candidate.kind === 'ramp-edge' && target) {
      contact.detail = `坡道边触碰 · 回弹系数 ${(contact.rebound?.restitution ?? 0).toFixed(2)}`
      applyRebound(body, target, contact)
      contact.kind = 'rebound'
      body.trajectory.samples.push({
        t: time, lean: body.state.lean, omega: body.state.omega,
        x: body.state.x, y: body.state.y, facing: body.state.facing, phase: 'rebound',
      })
      return
    }
    if (candidate.kind === 'trigger' && target) {
      reachedTrigger = true
      contact.detail = `触发器响应 · ${target.label}`
      pushLegacy(target.id, time, contact.id, 'mechanism', `触发器响应 · 来自 ${body.piece.id}`)
      fireMechanisms(target.id, time, contact.id)
      return
    }
    if (!target) return
    if (target.kind === 'splitter') {
      contact.detail = `分岔展开 · 来自 ${body.piece.id}`
      pushLegacy(target.id, time, contact.id, 'mechanism', `分岔展开 · 来自 ${body.piece.id}`)
      fireMechanisms(target.id, time, contact.id)
      return
    }
    // 普通相邻骨牌：把冲量传给下游，源骨牌继续自己的旋转轨迹
    contact.detail = `相邻接触 · 推动 ${target.id}`
    const targetBody = bodies.get(target.id)
    if (targetBody) {
      scheduleKick(target.id, time, contact.id, `来自 ${body.piece.id} 的接触`,
        Math.abs(body.state.omega) * 0.62)
    }
    fireMechanisms(target.id, time, contact.id)
  }

  function settleGround(body: SimBody, time: number, frameStart: number, stateAt: RigidState, depth: number) {
    const contact: ContactEvent = {
      id: nextId('contact'),
      pieceId: body.piece.id,
      kind: 'ground',
      targetId: null,
      interval: { tLower: frameStart, tUpper: frameStart + frameStep },
      tEstimate: time,
      leanAtContact: stateAt.lean,
      point: contactPoint('ground', body.piece, stateAt, null),
      refined: true, depth, frameStep,
      earlierThan: [], laterThan: [], undeterminedWith: [],
      detail: '姿态着地 · 旋转轨迹结束',
    }
    contacts.push(contact)
    body.trajectory.contacts.push(contact)
    body.trajectory.tGround = time
    body.trajectory.leanGround = body.restLean
    body.trajectory.duration = time - body.trajectory.t0
    body.state = { ...stateAt, lean: body.restLean, omega: 0 }
    body.phase = 'rest'
    body.trajectory.samples.push({
      t: time, lean: body.restLean, omega: 0,
      x: body.state.x, y: body.state.y, facing: body.state.facing, phase: 'rest',
    })
    const hasConnection = document.connections.some(link => link.from === body.piece.id && link.enabled)
    // 已触达触发器即视为链路完成，末端骨牌自然着地不再算作中断
    if (!hasConnection && interruptedPieceId === null && !reachedTrigger) {
      const touchedNeighbor = body.trajectory.contacts.some(item => item.kind === 'piece' || item.kind === 'trigger')
      if (!touchedNeighbor) {
        interruptedPieceId = body.piece.id
        interruptionReason = '倒下方向内没有可触达的元件，链路在此停止。'
        pushLegacy(body.piece.id, time + 0.05, contact.id, 'interrupted', interruptionReason)
      }
    }
  }

  /** 推进单个骨牌一个帧步，期间可发生多次接触与回弹，全部局部求解 */
  function advanceBody(body: SimBody, frameStart: number) {
    let cursor = frameStart
    let state0 = cloneState(body.state)
    const deadline = frameStart + frameStep
    let guard = 0
    while (cursor < deadline - 1e-12 && guard < 64) {
      guard += 1
      const dt = Math.min(frameStep, deadline - cursor)
      const candidates = candidateScan(document, body).filter(item => !body.consumed.has(item.key))
      const stateEnd = rk4Step(state0, body.piece.height, dt, body.params)

      interface Flip { candidate: Candidate; tau: number; stateAt: RigidState; depth: number; gap0: number }
      const flips: Flip[] = []
      if (groundGap(state0, body.piece) > 0 && groundGap(stateEnd, body.piece) <= 0) {
        const bis = bisectContact(body, state0, cursor, dt, s => groundGap(s, body.piece))
        flips.push({
          candidate: { key: 'ground', kind: 'ground', target: null, gap: s => groundGap(s, body.piece) },
          tau: bis.tau, stateAt: bis.stateAt, depth: bis.depth,
          gap0: groundGap(state0, body.piece),
        })
      }
      for (const candidate of candidates) {
        const g0 = candidate.gap(state0)
        const g1 = candidate.gap(stateEnd)
        if (g0 > 0 && g1 <= 0) {
          const bis = bisectContact(body, state0, cursor, dt, candidate.gap)
          flips.push({ candidate, tau: bis.tau, stateAt: bis.stateAt, depth: bis.depth, gap0: g0 })
        }
      }

      if (!flips.length) {
        body.state = stateEnd
        cursor = deadline
        break
      }
      flips.sort((a, b) => a.tau - b.tau || a.candidate.key.localeCompare(b.candidate.key))
      const first = flips[0]
      const time = cursor + first.tau
      body.state = first.stateAt
      if (first.candidate.kind === 'ground') {
        settleGround(body, time, cursor, first.stateAt, first.depth)
        return
      }
      // 同一帧内其它间隙在首次接触姿态下也已闭合 → 竞争接触，共享同一夹逼区间
      const simultaneous = flips.slice(1).filter(flip => flip.candidate.gap(first.stateAt) <= 0)
      const firstContact = registerContact(body, first.candidate, time, cursor, first.stateAt, first.depth, '')
      handleContact(body, first.candidate, firstContact, time)
      for (const extra of simultaneous) {
        const extraContact = registerContact(body, extra.candidate, time, cursor, first.stateAt, extra.depth, '')
        handleContact(body, extra.candidate, extraContact, time)
      }
      // 回弹这类离散状态变化可能让某个间隙在瞬间闭合（无连续符号翻转），
      // 在接触后姿态下立即补检，新区间与本次接触共用同一个帧夹逼范围
      if (first.candidate.kind === 'ramp-edge' || first.candidate.kind === 'rebound') {
        for (const candidate of candidateScan(document, body).filter(item => !body.consumed.has(item.key))) {
          if (candidate.gap(body.state) <= 0) {
            const born = registerContact(body, candidate, time, cursor, body.state, first.depth, '')
            handleContact(body, candidate, born, time)
          }
        }
      }
      // 以接触后状态作为新的帧内起点，继续推进剩余时间；其它骨牌与帧时钟完全不动
      cursor = time
      state0 = cloneState(body.state)
    }
    if (body.phase === 'falling') {
      body.trajectory.samples.push({
        t: deadline, lean: body.state.lean, omega: body.state.omega,
        x: body.state.x, y: body.state.y, facing: body.state.facing,
        phase: body.reboundCount ? 'rebound' : 'falling',
      })
    }
  }

  // 启动：手动触发起点
  const startPiece = document.pieces.find(item => item.id === document.startPieceId)
  if (startPiece) {
    if (startPiece.kind === 'trigger') {
      pushLegacy(startPiece.id, 0, null, 'mechanism', '触发器响应 · 手动触发')
      reachedTrigger = true
      fireMechanisms(startPiece.id, 0, null)
    } else {
      const startBody = bodies.get(startPiece.id)
      if (startBody) scheduleKick(startPiece.id, 0, null, '手动触发', 0.9)
    }
  }

  while (frame < opts.maxFrames) {
    const now = frame * frameStep
    const next = (frame + 1) * frameStep

    // 1) 处理到时的机关消息
    for (const item of mechanisms.filter(entry => entry.time <= next)) {
      const target = document.pieces.find(piece => piece.id === item.pieceId)
      if (!target) continue
      if (target.kind === 'trigger') {
        reachedTrigger = true
        pushLegacy(target.id, item.time, item.causeId, 'mechanism', `触发器响应 · ${item.detail}`)
        fireMechanisms(target.id, item.time, item.causeId)
      } else {
        const body = bodies.get(target.id)
        if (body) scheduleKick(target.id, item.time, item.causeId, item.detail, 0.8)
      }
    }
    for (let i = mechanisms.length - 1; i >= 0; i -= 1) if (mechanisms[i].time <= next) mechanisms.splice(i, 1)

    // 2) 处理到时的倒下冲量
    for (const item of kicks.filter(entry => entry.time <= next)) {
      const body = bodies.get(item.pieceId)
      if (body) startFalling(body, Math.max(item.time, now), item.causeId, item.detail, item.omega0)
    }
    for (let i = kicks.length - 1; i >= 0; i -= 1) if (kicks[i].time <= next) kicks.splice(i, 1)

    // 3) 固定帧推进所有活动骨牌（接触在帧内局部求解，不改动全局时钟）
    let active = false
    for (const body of bodies.values()) {
      if (body.phase === 'falling') {
        active = true
        advanceBody(body, now)
      }
    }

    frame += 1
    const stillQueued = kicks.length > 0 || mechanisms.length > 0
    const stillFalling = [...bodies.values()].some(body => body.phase === 'falling')
    if (!active && !stillQueued && !stillFalling) break
  }

  const trajectories = [...bodies.values()].map(body => body.trajectory)
  contacts.sort((a, b) => a.tEstimate - b.tEstimate || a.id.localeCompare(b.id))
  const undeterminedPairs = resolveContactOrder(contacts)

  const duration = Math.max(
    ...trajectories.map(item => item.tGround ?? item.samples.at(-1)?.t ?? 0),
    ...legacy.map(item => item.time), 0)

  const status: SimulationRun['status'] = legacy.length === 0 && contacts.length === 0 ? 'empty'
    : interruptedPieceId || !reachedTrigger ? 'interrupted'
    : 'complete'

  const run: SimulationRun = {
    id: crypto.randomUUID(),
    documentId: document.id,
    revision: document.revision,
    startedAt: Date.now(),
    startPieceId: document.startPieceId,
    status,
    events: legacy,
    interruptedPieceId,
    interruptionReason,
    duration,
    trajectories,
    contacts,
    frameStep,
    refinements,
    undeterminedPairs,
  }
  return run
}
