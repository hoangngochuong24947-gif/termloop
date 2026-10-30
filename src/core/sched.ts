/**
 * 调度器（v0.1 简化实现）。
 *
 * 刻意不引入 ts-fsrs：首版要的是「接口稳定 + 行为可测」，而不是参数拟合精度。
 * 状态字段与 FSRS 对齐（stability / difficulty / due / reps / lapses），
 * 后续替换成真正的 FSRS 时，只需换掉 schedule() 的实现，数据无需迁移。
 *
 * 已知差距：没有 fuzz、没有可学习参数、不做 same-day review 的二次压缩。
 */

export type Rating = 'again' | 'hard' | 'good' | 'easy'

export interface SchedState {
  stability: number
  difficulty: number
  due: string
  reps: number
  lapses: number
  last_review: string | null
}

const DAY = 86_400_000

export function initialSched(now: Date = new Date()): SchedState {
  return {
    stability: 1,
    difficulty: 5,
    due: now.toISOString(),
    reps: 0,
    lapses: 0,
    last_review: null,
  }
}

const DIFFICULTY_DELTA: Record<Rating, number> = {
  again: 1.2,
  hard: 0.4,
  good: -0.2,
  easy: -0.5,
}

export function schedule(state: SchedState, rating: Rating, now: Date = new Date()): SchedState {
  const difficulty = Math.min(10, Math.max(1, state.difficulty + DIFFICULTY_DELTA[rating]))
  const ease = 10 - difficulty

  let stability: number
  switch (rating) {
    case 'again':
      stability = Math.max(0.5, state.stability * 0.35)
      break
    case 'hard':
      stability = Math.max(1, state.stability * (1.1 + 0.02 * ease))
      break
    case 'good':
      stability = Math.max(1, state.stability * (1.7 + 0.09 * ease))
      break
    case 'easy':
      stability = Math.max(1, state.stability * (2.4 + 0.14 * ease))
      break
  }

  const intervalDays = Math.max(1, Math.round(stability))
  const due = new Date(now.getTime() + intervalDays * DAY).toISOString()

  return {
    stability: Number(stability.toFixed(3)),
    difficulty: Number(difficulty.toFixed(3)),
    due,
    reps: state.reps + 1,
    lapses: state.lapses + (rating === 'again' ? 1 : 0),
    last_review: now.toISOString(),
  }
}

/** verdict → 建议 rating。只是建议，最终由人决定（见 PRD §5.3 / 附录 C.6）。 */
export function suggestRating(verdict: 'correct' | 'partial' | 'wrong'): Rating {
  if (verdict === 'correct') return 'good'
  if (verdict === 'partial') return 'hard'
  return 'again'
}
