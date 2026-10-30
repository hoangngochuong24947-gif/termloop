/**
 * 调度器：ts-fsrs 的薄封装。
 *
 * 之前这里是手写的一条经验曲线——接口长得像 FSRS，参数却不是。
 * 现在真接 FSRS-6，只做三件事：状态映射、参数固定、错误兜底。
 *
 * 参数选择：
 * - `enable_short_term: false` —— 一天的节奏。开着的话答对一张新卡会 10 分钟后再来，
 *   用户在这个 App 里刚清完 40 张，转头又要复习同一张，很挫败。
 * - `enable_fuzz: true` —— 给间隔加抖动，避免 261 张卡同一天集体到期。
 * - `request_retention: 0.9` —— 专业术语可以调高，见 PRD §5.2。
 */

import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type State } from 'ts-fsrs'

export type RatingName = 'again' | 'hard' | 'good' | 'easy'

export interface SchedState {
  stability: number
  difficulty: number
  due: string
  reps: number
  lapses: number
  last_review: string | null
  scheduled_days: number
  learning_steps: number
  /** FSRS State：0=New 1=Learning 2=Review 3=Relearning */
  state: number
}

export const RETENTION = Number(process.env.TERMLOOP_RETENTION ?? 0.9)

const scheduler = fsrs(
  generatorParameters({
    request_retention: RETENTION,
    enable_short_term: false,
    enable_fuzz: true,
  }),
)

/** repeat() 只接受 1–4（0 是 Manual，不用于正常复习） */
type ReviewGrade = 1 | 2 | 3 | 4

const RATING: Record<RatingName, ReviewGrade> = {
  again: Rating.Again as ReviewGrade,
  hard: Rating.Hard as ReviewGrade,
  good: Rating.Good as ReviewGrade,
  easy: Rating.Easy as ReviewGrade,
}

const DAY = 86_400_000

export function initialSched(now: Date = new Date()): SchedState {
  const card = createEmptyCard(now)
  return {
    stability: card.stability,
    difficulty: card.difficulty,
    due: card.due.toISOString(),
    reps: card.reps,
    lapses: card.lapses,
    last_review: null,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    state: card.state,
  }
}

function toFsrsCard(s: SchedState): Card {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    scheduled_days: s.scheduled_days,
    reps: s.reps,
    lapses: s.lapses,
    learning_steps: s.learning_steps,
    state: s.state as State,
    ...(s.last_review ? { last_review: new Date(s.last_review) } : {}),
  }
}

/**
 * 计算下一次调度。
 *
 * 新卡（reps === 0）必须从 FSRS 的「空卡」出发，不能沿用数据库里
 * 占位用的 stability=1 / difficulty=5，否则首张卡的间隔会偏。
 */
export function schedule(state: SchedState, rating: RatingName, now: Date = new Date()): SchedState {
  const base = state.reps === 0 ? initialSched(now) : state
  const card = toFsrsCard(base)

  let next: Card
  try {
    next = scheduler.repeat(card, now)[RATING[rating]].card
  } catch {
    // FSRS 偶发会因噪声参数抛错；退化到一天后再来，绝不阻塞复习
    const fallback = new Date(now.getTime() + DAY)
    return { ...base, due: fallback.toISOString(), reps: base.reps + 1, last_review: now.toISOString() }
  }

  return {
    stability: Number(next.stability.toFixed(4)),
    difficulty: Number(next.difficulty.toFixed(4)),
    due: next.due.toISOString(),
    reps: next.reps,
    lapses: next.lapses,
    last_review: next.last_review ? next.last_review.toISOString() : now.toISOString(),
    scheduled_days: next.scheduled_days,
    learning_steps: next.learning_steps,
    state: next.state,
  }
}

/** verdict → 建议 rating。只是建议，最终由人决定（见 PRD 附录 C.6）。 */
export function suggestRating(verdict: 'correct' | 'partial' | 'wrong'): RatingName {
  if (verdict === 'correct') return 'good'
  if (verdict === 'partial') return 'hard'
  return 'again'
}
