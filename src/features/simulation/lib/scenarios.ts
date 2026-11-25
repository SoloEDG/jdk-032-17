import type { DominoDocument, Piece, PieceKind } from '@/shared/document'

const baseDomino = (id: string, x: number, y: number, angle: number, label: string): Piece => ({
  id, kind: 'domino', x, y, angle, facing: 'east', label,
  height: 1.6, width: 0.42, fallThreshold: 0.8, friction: 0.55,
})

const rampPiece = (id: string, x: number, y: number, angle: number, label: string, width = 1.0): Piece => ({
  id, kind: 'ramp', x, y, angle, facing: 'east', label,
  height: 0.45, width, fallThreshold: 0.8, friction: 0.55,
})

const triggerPiece = (id: string, x: number, y: number, label: string): Piece => ({
  id, kind: 'trigger', x, y, angle: 0, facing: 'east', label,
  height: 0.8, width: 0.7, fallThreshold: 0.8, friction: 0.55,
})

const emptyScene = (width: number, height: number): DominoDocument['scene'] => ({
  gravity: 9.8, friction: 0.62, width, height, showGrid: true,
})

function documentOf(id: string, title: string, pieces: Piece[], startPieceId: string): DominoDocument {
  return {
    id, title, revision: 1, updatedAt: Date.now(),
    pieces, connections: [], scene: emptyScene(12, 8), startPieceId,
  }
}

/**
 * 场景 A：侧倒碰到坡道前沿边，按恢复系数侧向回弹，再击中近邻 d2，
 * 近邻继续倒下触达终点触发器。验证回弹仍能驱动下游链路。
 */
export function reboundScenario(): DominoDocument {
  const pieces: Piece[] = [
    baseDomino('d1', 1.0, 4.0, 0, '侧倒起点'),
    // 浅角斜置坡道：倾倒中段（约 42°）碰到唇边，朝向折向下侧近邻
    rampPiece('r1', 1.7, 4.0, -20, '坡道边', 1.1),
    baseDomino('d2', 2.05, 2.9, 0, '回弹近邻'),
    triggerPiece('t1', 3.1, 2.9, '终点'),
  ]
  return documentOf('verify-rebound', '验证 A · 坡道回弹', pieces, 'd1')
}

/**
 * 场景 B：d0 同时朝向两个等距候选 dL / dR，几何上两个首次接触
 * 落在同一积分帧内，接触时间范围互相重叠，先后顺序标记为未定（分岔）。
 */
export function bifurcationScenario(): DominoDocument {
  const pieces: Piece[] = [
    baseDomino('d0', 1.0, 4.0, 0, '分岔起点'),
    baseDomino('dL', 2.55, 4.0, 0, '左侧候选'),
    baseDomino('dR', 2.558, 4.0, 0, '右侧候选'),
  ]
  return documentOf('verify-bifurcation', '验证 B · 区间重叠分岔', pieces, 'd0')
}

export type ScenarioKey = 'rebound' | 'bifurcation'

export function buildScenario(key: ScenarioKey): DominoDocument {
  return key === 'rebound' ? reboundScenario() : bifurcationScenario()
}

export const scenarioMeta: Record<ScenarioKey, { title: string; blurb: string }> = {
  rebound: { title: '验证 A · 坡道回弹', blurb: '侧倒碰坡道边 → 侧向回弹 → 击中近邻 → 触发终点' },
  bifurcation: { title: '验证 B · 区间重叠分岔', blurb: '两个首次接触区间重叠，顺序标记为未定' },
}

export const scenarioKinds: PieceKind[] = ['domino', 'ramp', 'splitter', 'trigger']
