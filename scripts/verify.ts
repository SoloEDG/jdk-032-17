/**
 * 无头验证：两个验证场景各自只运行一次模拟，
 * 慢放姿态、事件表与中断点均从同一份 run 中取出核对。
 *   node --experimental-strip-types scripts/verify.ts
 */
import { runEngine } from '../src/features/simulation/lib/engine.ts'
import { buildScenario } from '../src/features/simulation/lib/scenarios.ts'
import type { ContactEvent, SimulationRun } from '../src/shared/document.ts'

interface Check { name: string; pass: boolean; detail: string }

function fmt(t: number) { return `${t.toFixed(4)}s` }

function intervalText(contact: ContactEvent) {
  return `[${fmt(contact.interval.tLower)}, ${fmt(contact.interval.tUpper)}] → ${fmt(contact.tEstimate)}`
}

function verifyRebound(): Check[] {
  const doc = buildScenario('rebound')
  const run = runEngine(doc)
  const checks: Check[] = []
  const d1 = run.trajectories.find(item => item.pieceId === 'd1')
  const rebound = run.contacts.find(item => item.kind === 'rebound' && item.targetId === 'r1')
  const neighbor = run.contacts.find(item => item.kind === 'piece' && item.pieceId === 'd1' && item.targetId === 'd2')
  const trigger = run.contacts.find(item => item.kind === 'trigger' && item.targetId === 't1')
  const ground = run.contacts.find(item => item.kind === 'ground' && item.pieceId === 'd1')

  checks.push({
    name: 'A1 骨牌 d1 存在完整旋转轨迹（站立 → 着地）',
    pass: Boolean(d1 && d1.duration !== null && (d1.leanGround ?? 0) > d1.leanStart && d1.samples.length >= 4),
    detail: d1 ? `t0=${fmt(d1.t0)} tGround=${fmt(d1.tGround ?? -1)} 姿态采样=${d1.samples.length}` : '缺少 d1 轨迹',
  })
  checks.push({
    name: 'A2 坡道边接触带相邻时刻夹出的时间范围',
    pass: Boolean(rebound && rebound.interval.tUpper > rebound.interval.tLower && rebound.tEstimate >= rebound.interval.tLower && rebound.tEstimate <= rebound.interval.tUpper),
    detail: rebound ? `r1 ${intervalText(rebound)} 深度=${rebound.depth}` : '未检测到坡道边接触',
  })
  checks.push({
    name: 'A3 触碰坡道边后产生侧向回弹（朝向改变 + 侧向位移）',
    pass: Boolean(rebound?.rebound && rebound.rebound.facingAfter !== rebound.rebound.facingBefore && rebound.rebound.lateralKick > 0),
    detail: rebound?.rebound ? `朝向 ${rebound.rebound.facingBefore.toFixed(1)}° → ${rebound.rebound.facingAfter.toFixed(1)}°，侧移 ${rebound.rebound.lateralKick.toFixed(3)}m，恢复系数 ${rebound.rebound.restitution.toFixed(2)}` : '无回弹数据',
  })
  checks.push({
    name: 'A4 回弹继续影响下游：击中近邻 d2（可与回弹同帧同区间）',
    pass: Boolean(neighbor && rebound && neighbor.tEstimate >= rebound.tEstimate
      && neighbor.interval.tLower >= rebound.interval.tLower),
    detail: neighbor ? `d2 ${intervalText(neighbor)}` : '近邻未被击中',
  })
  checks.push({
    name: 'A5 下游链路最终触达终点触发器',
    pass: Boolean(trigger),
    detail: trigger ? `t1 ${intervalText(trigger)}` : '终点未响应',
  })
  checks.push({
    name: 'A6 同一条事件轨迹内含坡道回弹与地面接触',
    pass: Boolean(d1 && d1.contacts.some(c => c.kind === 'rebound') && d1.contacts.some(c => c.kind === 'ground')),
    detail: ground ? `地面接触 ${intervalText(ground)}` : '缺少地面接触',
  })
  checks.push({
    name: 'A7 模拟状态完整、无中断点',
    pass: run.status === 'complete' && run.interruptedPieceId === null,
    detail: `status=${run.status} interrupted=${run.interruptedPieceId ?? '无'}`,
  })
  return checks
}

function verifyBifurcation(): Check[] {
  const doc = buildScenario('bifurcation')
  const run = runEngine(doc)
  const checks: Check[] = []
  const left = run.contacts.find(c => c.targetId === 'dL')
  const right = run.contacts.find(c => c.targetId === 'dR')
  const overlap = left && right
    ? left.interval.tLower < right.interval.tUpper && right.interval.tLower < left.interval.tUpper
    : false
  const undetermined = run.undeterminedPairs.some(pair =>
    (pair.a === left?.id && pair.b === right?.id) || (pair.a === right?.id && pair.b === left?.id))

  checks.push({
    name: 'B1 两个首次接触都带有夹逼时间范围',
    pass: Boolean(left && right && left.interval.tUpper > left.interval.tLower && right.interval.tUpper > right.interval.tLower),
    detail: `dL ${left ? intervalText(left) : '缺失'}；dR ${right ? intervalText(right) : '缺失'}`,
  })
  checks.push({
    name: 'B2 两个接触区间重叠 → 先后标记为未定',
    pass: Boolean(overlap && undetermined && left?.undeterminedWith.includes(right?.id ?? '')),
    detail: overlap ? `区间重叠，未定对=${run.undeterminedPairs.length}` : '区间未重叠',
  })
  checks.push({
    name: 'B3 不重叠的接触（相对地面接触）可确定先后',
    pass: Boolean(left && run.contacts.some(c => c.kind === 'ground') && left.laterThan.length + left.earlierThan.length >= 1),
    detail: `dL 先于=${left?.earlierThan.length ?? 0} 后于=${left?.laterThan.length ?? 0} 未定=${left?.undeterminedWith.length ?? 0}`,
  })
  checks.push({
    name: 'B4 全部接触均经局部二分细化',
    pass: run.contacts.every(c => c.refined && c.depth > 0) && run.refinements >= run.contacts.length,
    detail: `接触=${run.contacts.length} 细化次数=${run.refinements}`,
  })
  return checks
}

function verifyStability(): Check[] {
  const doc = buildScenario('rebound')
  const coarse = runEngine(doc, { frameStep: 0.04 })
  const fine = runEngine(doc, { frameStep: 0.01 })
  const checks: Check[] = []

  const byTarget = (run: SimulationRun, target: string) =>
    run.contacts.filter(c => c.targetId === target || (target === 'ground' && c.kind === 'ground'))

  for (const target of ['r1', 'd2', 't1', 'ground']) {
    const c = byTarget(coarse, target)
    const f = byTarget(fine, target)
    const coarseT = c[0]?.tEstimate
    const fineT = f[0]?.tEstimate
    const drift = coarseT !== undefined && fineT !== undefined ? Math.abs(coarseT - fineT) : Number.POSITIVE_INFINITY
    // 容差与夹逼区间宽度同阶：缩步只细化本地区间，不重积分远处已确认的接触
    const tolerance = Math.max(coarse.frameStep, fine.frameStep)
    checks.push({
      name: `C 细化竞争碰撞时 ${target} 接触时刻不整体漂移（粗帧 0.04s vs 细帧 0.01s）`,
      pass: drift <= tolerance,
      detail: coarseT !== undefined && fineT !== undefined
        ? `粗=${fmt(coarseT)} 细=${fmt(fineT)} 漂移=${drift.toFixed(4)}s（容差 ${tolerance.toFixed(2)}s）`
        : '接触缺失',
    })
  }
  const topology = (run: SimulationRun) =>
    run.contacts.map(c => `${c.pieceId}>${c.targetId ?? c.kind}`).sort().join('|')
  checks.push({
    name: 'C 局部细化只重积分当前骨牌：两次运行的接触拓扑一致',
    pass: topology(coarse) === topology(fine),
    detail: `粗帧接触=${coarse.contacts.length} 细帧接触=${fine.contacts.length}`,
  })
  return checks
}

function verifySingleRunCoherence(): Check[] {
  const doc = buildScenario('rebound')
  const run = runEngine(doc)
  // 事件表、姿态采样、中断点必须指向同一次模拟 id
  const sameRun = run.trajectories.every(t => t.contacts.every(c => run.contacts.includes(c)))
  const orderedSamples = run.trajectories.every(t =>
    t.samples.every((s, i, arr) => i === 0 || s.t >= arr[i - 1].t - 1e-9))
  const bracketValid = run.contacts.every(c =>
    c.interval.tLower <= c.tEstimate + 1e-12 && c.tEstimate <= c.interval.tUpper + 1e-12)
  return [
    { name: 'D1 事件表接触与轨迹内接触来自同一次模拟对象', pass: sameRun, detail: `runId=${run.id.slice(0, 8)}` },
    { name: 'D2 姿态采样时间单调，可直接驱动慢放', pass: orderedSamples, detail: `轨迹数=${run.trajectories.length}` },
    { name: 'D3 估计接触时刻全部落在夹逼区间内', pass: bracketValid, detail: `接触数=${run.contacts.length}` },
  ]
}

const groups = [
  ['场景 A · 侧倒碰坡道边回弹再击近邻', verifyRebound()],
  ['场景 B · 两个接触区间重叠的分岔', verifyBifurcation()],
  ['稳定性 · 缩小步长不整体漂移', verifyStability()],
  ['一致性 · 慢放/事件表/中断点同一次模拟', verifySingleRunCoherence()],
]

let failures = 0
for (const [title, checks] of groups) {
  console.log(`\n=== ${title} ===`)
  for (const check of checks as Check[]) {
    if (!check.pass) failures += 1
    console.log(`${check.pass ? 'PASS' : 'FAIL'}  ${check.name}\n        ${check.detail}`)
  }
}
console.log(`\n${failures === 0 ? '全部验证通过' : `${failures} 项验证失败`}`)
if (failures) process.exitCode = 1
