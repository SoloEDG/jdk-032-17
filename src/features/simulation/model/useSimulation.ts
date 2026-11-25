import { computed, ref, shallowRef, type Ref } from 'vue'
import type { DominoDocument, SimulationRun } from '@/shared/document'
import { runEngine } from '../lib/engine'

export function useSimulation(document: Ref<DominoDocument>) {
  const run = shallowRef<SimulationRun | null>(null)
  const busy = ref(false)
  const issue = ref('')
  const current = computed(() => run.value)
  const stale = computed(() => Boolean(run.value && run.value.revision !== document.value.revision))

  async function simulate() {
    busy.value = true
    issue.value = ''
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    try {
      const snapshot = structuredClone(document.value)
      // 慢放姿态、事件表与中断点全部来自这一次 runEngine 调用
      run.value = runEngine(snapshot)
      if (run.value.status === 'empty') issue.value = '场景里没有可运行的触发点。'
    } catch {
      issue.value = '场景计算未能完成，请检查元件连接。'
    } finally {
      busy.value = false
    }
  }

  function clear() { run.value = null; issue.value = '' }
  return { run, current, stale, busy, issue, simulate, clear }
}
