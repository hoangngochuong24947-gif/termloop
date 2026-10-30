import { describe, expect, it } from 'vitest'

import { initialSched, schedule, suggestRating, type SchedState } from '../src/core/sched.ts'

const T0 = new Date('2026-10-30T08:00:00Z')

function review(s: SchedState, rating: 'again' | 'hard' | 'good' | 'easy', at: Date) {
  return schedule(s, rating, at)
}

describe('FSRS 调度', () => {
  it('新卡是 New 状态（state=0），不会冒充 Review', () => {
    const s = initialSched(T0)
    expect(s.state).toBe(0)
    expect(s.reps).toBe(0)
    expect(s.stability).toBe(0)
  })

  it('第一次答对就毕业到 Review，间隔至少一天', () => {
    const s = review(initialSched(T0), 'good', T0)
    expect(s.state).toBe(2)
    expect(s.reps).toBe(1)
    expect(s.scheduled_days).toBeGreaterThanOrEqual(1)
    expect(new Date(s.due).getTime()).toBeGreaterThan(T0.getTime())
  })

  it('连续答对，稳定性单调增长', () => {
    let s = review(initialSched(T0), 'good', T0)
    const s1 = s.stability
    let at = new Date(s.due)
    s = review(s, 'good', at)
    const s2 = s.stability
    at = new Date(s.due)
    s = review(s, 'good', at)
    const s3 = s.stability
    expect(s2).toBeGreaterThan(s1)
    expect(s3).toBeGreaterThan(s2)
  })

  it('答错会掉稳定性并记一次 lapse', () => {
    let s = review(initialSched(T0), 'good', T0)
    s = review(s, 'good', new Date(s.due))
    const before = s.stability
    s = review(s, 'again', new Date(s.due))
    expect(s.stability).toBeLessThan(before)
    expect(s.lapses).toBeGreaterThanOrEqual(1)
  })

  it('新卡必须从空卡出发，不能被数据库里的占位值带偏', () => {
    const polluted: SchedState = { ...initialSched(T0), stability: 1, difficulty: 5, reps: 0 }
    const clean = initialSched(T0)
    const a = review(polluted, 'good', T0)
    const b = review(clean, 'good', T0)
    expect(a.stability).toBe(b.stability)
    expect(a.scheduled_days).toBe(b.scheduled_days)
  })

  it('easy 比 good 给的间隔更长', () => {
    const g = review(initialSched(T0), 'good', T0)
    const e = review(initialSched(T0), 'easy', T0)
    expect(new Date(e.due).getTime()).toBeGreaterThanOrEqual(new Date(g.due).getTime())
  })

  it('日期永远是合法 ISO', () => {
    const s = review(initialSched(T0), 'good', T0)
    expect(Number.isNaN(new Date(s.due).getTime())).toBe(false)
    expect(s.last_review).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('suggestRating', () => {
  it('三档映射', () => {
    expect(suggestRating('correct')).toBe('good')
    expect(suggestRating('partial')).toBe('hard')
    expect(suggestRating('wrong')).toBe('again')
  })
})
