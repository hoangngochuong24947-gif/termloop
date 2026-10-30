/**
 * 出题与判分：把「一条 Term + 一个方向」变成一道可作答的题。
 *
 * 这里只做纯计算，不碰数据库——所以它可被测试覆盖，也可被 CLI 的 dry-run 复用。
 */

import { gradeEn, gradeZh, type Verdict } from './grade.ts'
import type { CardDirection, Term } from './types.ts'

export interface Question {
  card_id: string
  term_id: string
  direction: CardDirection
  prompt: string
  /** 题面下方的小字：出处、tag、自创名标记等 */
  context: string[]
  /** 是否由人自评（不做自动判分） */
  self_graded: boolean
}

export interface AnswerKey {
  name: string | null
  explain: string
  accepted: string[]
}

function surfaces(term: Term, type: 'en' | 'abbr' | 'symbol' | 'formula'): string[] {
  return term.surfaces
    .filter((s) => s.type === type && s.status !== 'rejected')
    .sort((a, b) => (a.status === 'preferred' ? -1 : b.status === 'preferred' ? 1 : 0))
    .map((s) => s.text)
}

function primaryEn(term: Term): string {
  return surfaces(term, 'en')[0] ?? surfaces(term, 'abbr')[0] ?? surfaces(term, 'symbol')[0] ?? term.slug
}

export function buildContext(term: Term): string[] {
  const ctx: string[] = []
  const prov = term.annotations.find((a) => a.type === 'provenance')
  if (prov) ctx.push(prov.text)
  if (term.annotations.some((a) => a.type === 'catchword')) ctx.push('⚑ 自创名')
  ctx.push(...term.tags.slice(0, 3))
  return ctx
}

export function buildQuestion(term: Term, cardId: string, direction: CardDirection): Question {
  const context = buildContext(term)
  const name = term.zh.name

  const base = { card_id: cardId, term_id: term.id, direction, context }

  switch (direction) {
    case 'en2zh':
      return { ...base, prompt: primaryEn(term), self_graded: false }
    case 'zh2en':
      return { ...base, prompt: name ?? term.zh.explain, self_graded: false }
    case 'en2explain':
      return { ...base, prompt: primaryEn(term), self_graded: true }
    case 'en2usage':
      return { ...base, prompt: primaryEn(term), self_graded: true }
    case 'abbr2full':
      return { ...base, prompt: surfaces(term, 'abbr')[0] ?? primaryEn(term), self_graded: false }
    case 'symbol2name':
      return {
        ...base,
        prompt: surfaces(term, 'symbol')[0] ?? surfaces(term, 'formula')[0] ?? primaryEn(term),
        self_graded: name === null || term.zh.name_evidence === 'C',
      }
    case 'scene2en':
      return { ...base, prompt: term.zh.explain || primaryEn(term), self_graded: true }
    case 'cloze':
      return { ...base, prompt: primaryEn(term), self_graded: true }
  }
}

export function answerKey(term: Term, direction: CardDirection): AnswerKey {
  const name = term.zh.name
  const aliases = term.annotations.filter((a) => a.type === 'alias').map((a) => a.text)

  switch (direction) {
    case 'en2zh':
      return {
        name,
        explain: term.zh.explain,
        accepted: [name, ...aliases].filter((x): x is string => Boolean(x)),
      }
    case 'zh2en':
      return {
        name,
        explain: term.zh.explain,
        accepted: [
          ...surfaces(term, 'en'),
          ...surfaces(term, 'abbr'),
        ],
      }
    case 'abbr2full':
      return { name, explain: term.zh.explain, accepted: surfaces(term, 'en') }
    case 'symbol2name':
      return {
        name,
        explain: term.zh.explain,
        accepted: [name ?? term.zh.explain].filter(Boolean),
      }
    default:
      return { name, explain: term.zh.explain, accepted: [] }
  }
}

export interface Judgement {
  verdict: Verdict | null
  matched: string[]
  self_graded: boolean
}

/**
 * 判分。自动可判的题型走规则；不可判的返回 verdict=null，由人直接给 rating。
 *
 * 宁可返回 null 也不猜——把「我不知道对不对」伪装成 correct/wrong，
 * 会直接污染调度数据。
 */
export function judge(
  term: Term,
  direction: CardDirection,
  answerRaw: string,
): Judgement {
  const key = answerKey(term, direction)
  const q = buildQuestion(term, '', direction)

  if (q.self_graded || key.accepted.length === 0) {
    return { verdict: null, matched: [], self_graded: true }
  }

  const answer = answerRaw.trim()
  if (!answer) return { verdict: 'wrong', matched: [], self_graded: false }

  if (direction === 'en2zh' || direction === 'symbol2name') {
    const verdict = gradeZh(answer, key.accepted, [])
    return {
      verdict,
      matched: verdict === 'wrong' ? [] : key.accepted.filter((a) => answer.includes(a)),
      self_graded: false,
    }
  }

  const verdict = gradeEn(answer, key.accepted)
  return {
    verdict,
    matched: verdict === 'wrong' ? [] : key.accepted,
    self_graded: false,
  }
}
