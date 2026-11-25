import type { DominoDocument, SimulationRun } from '@/shared/document'
import { runEngine } from './engine'

/**
 * 兼容层：旧调用方只需要事件、中断点与状态。
 * 新的旋转轨迹、接触区间与未定分岔全部由 runEngine 在同一次模拟中产出。
 */
export function propagate(document: DominoDocument): SimulationRun {
  return runEngine(document)
}
