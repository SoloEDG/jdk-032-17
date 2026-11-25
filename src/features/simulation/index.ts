export { useSimulation } from './model/useSimulation'
export { default as SimulationBar } from './ui/SimulationBar.vue'
export { propagate } from './lib/propagate'
export { runEngine, type EngineOptions } from './lib/engine'
export { buildScenario, scenarioMeta, type ScenarioKey } from './lib/scenarios'
export {
  compareContacts, intervalsOverlap, resolveContactOrder, orderLabel, sortByInterval,
} from './lib/ordering'
