/**
 * 判分。见 PRD 附录 C。
 *
 * 这一层是纯函数：不碰数据库、不碰网络、不碰 React。
 * 任何改动都必须先让 tests/grade.test.ts 变绿。
 */

export type Verdict = 'correct' | 'partial' | 'wrong'

const HYPHENS = /[\u2010\u2011\u2012\u2013\u2014\u2015-]/g
const ARTICLES = /\b(a|an|the)\b/g

/**
 * 英文归一化。
 *
 * 三个刻意的选择：
 * - 只丢冠词，不丢介词（`equation of state` 丢了 of 会撞上 `equation state`）
 * - 保留 `\p{L}`（希腊字母 κ、物理符号）——v1.0 的 `\w` 会把它们直接吃掉
 * - 连字符/下划线统一成空格，视作分词：`machine-learning` ≡ `machine learning`
 */
export function normalizeEn(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(HYPHENS, '-')
    .replace(/[-_/]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(ARTICLES, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 极简单复数还原。v1.0 的 `\b(\w+)(s|es|ies)\b` 会把 studies 变成 stud。 */
export function deplural(w: string): string {
  if (w.length <= 3) return w
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`
  if (/(ses|xes|zes|ches|shes)$/.test(w)) return w.slice(0, -2)
  if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1)
  return w
}

export function canon(s: string): string {
  return normalizeEn(s).split(' ').filter(Boolean).map(deplural).join(' ')
}

/** Levenshtein 距离，带一层剪枝。 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  if (Math.abs(a.length - b.length) > 2) return 3

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost)
    }
    prev = cur
  }
  return prev[b.length]!
}

function sortedTokens(s: string): string {
  return [...new Set(s.split(' ').filter(Boolean))].sort().join(' ')
}

/**
 * 英文判分。
 *
 * 顺序很重要：先完全一致，再词序无关，再手滑容错，最后才是覆盖度。
 * 单复数归一后相等 → correct（v1.0 把这种情况判成 partial，是错的）。
 */
/**
 * 把 `moment tensor potential (MTP)` 这种「全称 (缩写)」拆成三个候选项。
 * 否则答案里少写一个缩写就会被判成 partial。
 */
export function expandAccepted(list: string[]): string[] {
  const out = new Set<string>()
  for (const raw of list) {
    if (!raw) continue
    out.add(raw)
    const m = /^(.*?)\s*[（(]([^)）]+)[)）]\s*$/.exec(raw)
    if (m) {
      out.add(m[1]!.trim())
      out.add(m[2]!.trim())
    }
  }
  return [...out]
}

export function gradeEn(input: string, accepted: string[]): Verdict {
  const a = canon(input)
  if (!a) return 'wrong'

  const pool = expandAccepted(accepted).map(canon).filter(Boolean)
  if (pool.length === 0) return 'wrong'

  if (pool.includes(a)) return 'correct'
  if (pool.some((x) => sortedTokens(x) === sortedTokens(a))) return 'correct'
  if (a.length >= 8 && pool.some((x) => levenshtein(x, a) <= 1)) return 'correct'

  const at = new Set(a.split(' ').filter(Boolean))
  const covered = pool.some((x) => {
    const xt = x.split(' ').filter(Boolean)
    if (!xt.length) return false
    return xt.filter((t) => at.has(t)).length / xt.length >= 0.8
  })
  return covered ? 'partial' : 'wrong'
}

const NEGATION = /[不非无未没]/

/**
 * 中文判分。
 *
 * 中文不做语序与字数要求，只要求必含词命中；但「不是势能面」不能算对，
 * 所以关键词前面紧邻否定词时视为未命中。
 */
export function gradeZh(input: string, must: string[], optional: string[] = []): Verdict {
  const s = input.replace(/\s+/g, '')
  if (!s) return 'wrong'

  const hit = (kw: string): boolean => {
    if (!kw) return false
    let from = 0
    for (;;) {
      const i = s.indexOf(kw, from)
      if (i < 0) return false
      const before = s.slice(Math.max(0, i - 3), i)
      if (!NEGATION.test(before)) return true
      from = i + 1
    }
  }

  const mustList = must.filter(Boolean)
  const optList = optional.filter(Boolean)
  const hitMust = mustList.filter(hit).length
  const hitOpt = optList.filter(hit).length

  if (mustList.length > 0 && hitMust === mustList.length) return 'correct'

  const total = mustList.length + 0.5 * optList.length
  if (total === 0) return 'wrong'
  return (hitMust + 0.5 * hitOpt) / total >= 0.5 ? 'partial' : 'wrong'
}
