<script setup lang="ts">
import { FlaskConical, Play, RotateCcw, Sparkles, Split } from '@lucide/vue'
import type { SimulationRun } from '@/shared/document'
import type { ScenarioKey } from '@/features/simulation'

defineProps<{ run: SimulationRun | null; stale: boolean; busy: boolean; issue: string }>()
const emit = defineEmits<{ run: []; reset: []; scenario: [ScenarioKey] }>()
</script>

<template>
  <section class="simulation-bar">
    <div class="simulation-status">
      <span class="status-orb" :class="run?.status ?? 'idle'"></span>
      <div><strong>{{ stale ? '场景已更改' : run?.status === 'complete' ? '链路完成' : run?.status === 'interrupted' ? '链路中断' : '待运行' }}</strong>
        <small>{{ stale ? '当前回放属于上一个布局版本' : run ? `${run.contacts.length} 次接触 · ${run.undeterminedPairs.length} 个未定分岔` : '运行一次，观察倒下旋转与接触区间' }}</small></div>
    </div>
    <p v-if="issue" class="simulation-error" role="alert">{{ issue }}</p>
    <div class="simulation-actions">
      <div class="scenario-group" role="group" aria-label="载入验证场景">
        <button class="scenario-button" @click="emit('scenario', 'rebound')"><FlaskConical :size="13" /> 验证 A 回弹</button>
        <button class="scenario-button" @click="emit('scenario', 'bifurcation')"><Split :size="13" /> 验证 B 分岔</button>
      </div>
      <button v-if="run" class="secondary-button" @click="emit('reset')"><RotateCcw :size="15" /> 清除</button>
      <button class="run-button" :disabled="busy" @click="emit('run')"><Play v-if="!busy" :size="16" fill="currentColor" /><span v-else class="button-spinner"></span>{{ busy ? '计算中…' : stale ? '重新模拟' : '运行模拟' }}<kbd>Space</kbd></button>
    </div>
    <span class="simulation-decoration"><Sparkles :size="15" /> 刚体旋转 · 区间夹逼</span>
  </section>
</template>
