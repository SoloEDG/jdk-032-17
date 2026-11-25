import type { ContactEvent, ContactInterval, UndeterminedPair } from '@/shared/document'

/** 两个接触时间范围是否重叠（端点相接视为可分辨，不算重叠） */
export function intervalsOverlap(a: ContactInterval, b: ContactInterval) {
  return a.tLower < b.tUpper && b.tLower < a.tUpper
}

export type OrderVerdict = 'earlier' | 'later' | 'undetermined'

/** 只有范围互不重叠才能确定先后；范围重叠则顺序未定 */
export function compareContacts(a: ContactInterval, b: ContactInterval): OrderVerdict {
  if (a.tUpper <= b.tLower) return 'earlier'
  if (b.tUpper <= a.tLower) return 'later'
  return 'undetermined'
}

/** 对全部接触事件做两两区间比较，回写排序关系并收集未定对 */
export function resolveContactOrder(contacts: ContactEvent[]) {
  const undeterminedPairs: UndeterminedPair[] = []
  for (const contact of contacts) {
    contact.earlierThan = []
    contact.laterThan = []
    contact.undeterminedWith = []
  }
  for (let i = 0; i < contacts.length; i += 1) {
    for (let j = i + 1; j < contacts.length; j += 1) {
      const a = contacts[i]
      const b = contacts[j]
      const verdict = compareContacts(a.interval, b.interval)
      if (verdict === 'earlier') {
        a.earlierThan.push(b.id)
        b.laterThan.push(a.id)
      } else if (verdict === 'later') {
        a.laterThan.push(b.id)
        b.earlierThan.push(a.id)
      } else {
        a.undeterminedWith.push(b.id)
        b.undeterminedWith.push(a.id)
        undeterminedPairs.push({ a: a.id, b: b.id })
      }
    }
  }
  return undeterminedPairs
}

export function orderLabel(contact: ContactEvent) {
  if (contact.undeterminedWith.length) return '未定'
  if (contact.earlierThan.length && !contact.laterThan.length) return '先'
  if (contact.laterThan.length && !contact.earlierThan.length) return '后'
  return contact.earlierThan.length ? '中' : '独立'
}

/** 按区间下界的稳定排序（仅用于展示，不改变未定判定） */
export function sortByInterval(contacts: ContactEvent[]) {
  return [...contacts].sort((a, b) =>
    a.interval.tLower - b.interval.tLower
    || a.interval.tUpper - b.interval.tUpper
    || a.pieceId.localeCompare(b.pieceId))
}
