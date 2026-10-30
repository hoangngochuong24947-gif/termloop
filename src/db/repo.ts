/**
 * 数据访问层。
 *
 * 唯一的写入者。任何客户端（网页、CLI、MCP、外部 Agent）都只能通过它，
 * 不能直接打开 SQLite 文件——见 docs/adr/0001-single-writer-local-service.md。
 */

import Database from 'better-sqlite3'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { migrate } from './migrate.ts'
import { planCards } from '../core/cardgen.ts'
import { canon } from '../core/grade.ts'
import { buildQuestion, judge, type Question } from '../core/review.ts'
import { schedule, suggestRating, type Rating, type SchedState } from '../core/sched.ts'
import {
  DraftInputSchema,
  TermInputSchema,
  type Annotation,
  type CardDirection,
  type DraftInput,
  type Evidence,
  type Kind,
  type Level,
  type Surface,
  type Term,
  type TermInput,
  type TermState,
  type ZhSide,
} from '../core/types.ts'

// ── id ────────────────────────────────────────────────────────────────────────

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** ULID：时间有序 + 随机，适合做主键与分页游标。 */
export function ulid(now: number = Date.now()): string {
  let t = ''
  let ts = now
  for (let i = 0; i < 10; i++) {
    t = B32[ts % 32]! + t
    ts = Math.floor(ts / 32)
  }
  let r = ''
  for (const b of randomBytes(16)) r += B32[b % 32]
  return t + r
}

export function slugify(s: string): string {
  const base = s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return base || 'term'
}

// ── 类型 ──────────────────────────────────────────────────────────────────────

export interface Actor {
  type: 'human' | 'agent' | 'system'
  name?: string | null
}

export interface TermFilter {
  q?: string
  kind?: Kind
  tag?: string
  state?: TermState
  evidence?: Evidence
  has_name?: boolean
  limit?: number
  cursor?: string
}

export interface Draft {
  id: string
  created_at: string
  source: string | null
  actor_type: string
  actor_name: string | null
  payload: DraftInput
  status: 'pending' | 'accepted' | 'rejected' | 'merged'
  ai_confidence: number | null
  decided_at: string | null
  decided_by: string | null
  term_id: string | null
}

export interface EventRecord {
  id: string
  ts: string
  actor_type: string
  actor_name: string | null
  action: string
  target_type: string
  target_id: string
  diff: unknown
  revertable: boolean
}

export interface QueueItem extends Question {
  due: string
  reps: number
  lapses: number
  stability: number
  difficulty: number
  term_kind: Kind
}

export interface AnswerResult {
  review_id: string
  verdict: 'correct' | 'partial' | 'wrong' | null
  decided_by: 'rule' | 'human'
  matched: string[]
  suggested_rating: Rating
  rating: Rating
  sched: SchedState
  answer: { name: string | null; explain: string; accepted: string[] }
}

// ── 行 → 领域对象 ─────────────────────────────────────────────────────────────

interface TermRow {
  id: string
  slug: string
  kind: Kind
  level: Level
  importance: number
  state: TermState
  domain: string | null
  created_at: string
  updated_at: string
}

interface SurfaceRow {
  id: string
  type: Surface['type']
  text: string
  status: Surface['status']
  evidence: Evidence
  locator: string | null
}

interface ZhRow {
  name: string | null
  name_evidence: Evidence
  explain: string
}

interface CardRow {
  id: string
  term_id: string
  direction: CardDirection
  enabled: number
  due: string
  reps: number
  lapses: number
  stability: number
  difficulty: number
  last_review: string | null
}

function pathDirname(p: string): string {
  return path.dirname(path.resolve(p))
}

// ── Repo ─────────────────────────────────────────────────────────────────────

export class Repo {
  readonly db: Database.Database

  constructor(path: string) {
    if (path !== ':memory:') {
      fs.mkdirSync(pathDirname(path), { recursive: true })
    }
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    migrate(this.db)
  }

  close(): void {
    this.db.close()
  }

  // ── 内部工具 ──────────────────────────────────────────────────────────────

  private now(): string {
    return new Date().toISOString()
  }

  private logEvent(
    actor: Actor,
    action: string,
    target_type: string,
    target_id: string,
    diff: unknown,
  ): void {
    this.db
      .prepare(
        `INSERT INTO events (id, ts, actor_type, actor_name, action, target_type, target_id, diff_json, revertable)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ulid(),
        this.now(),
        actor.type,
        actor.name ?? null,
        action,
        target_type,
        target_id,
        JSON.stringify(diff ?? null),
        1,
      )
  }

  private uniqueSlug(base: string): string {
    const root = slugify(base)
    let candidate = root
    let n = 2
    const stmt = this.db.prepare('SELECT 1 FROM terms WHERE slug = ?')
    while (stmt.get(candidate)) {
      candidate = `${root}-${n++}`
    }
    return candidate
  }

  private assemble(row: TermRow): Term {
    const surfaces = this.db
      .prepare('SELECT * FROM surfaces WHERE term_id = ? ORDER BY ord, rowid')
      .all(row.id) as SurfaceRow[]
    const zh = this.db.prepare('SELECT * FROM zh_sides WHERE term_id = ?').get(row.id) as ZhRow
    const annotations = this.db
      .prepare('SELECT type, text FROM annotations WHERE term_id = ? ORDER BY ord, rowid')
      .all(row.id) as Annotation[]
    const tags = (
      this.db.prepare('SELECT tag FROM tags WHERE term_id = ? ORDER BY tag').all(row.id) as Array<{
        tag: string
      }>
    ).map((r) => r.tag)
    const cards = this.db
      .prepare('SELECT id, term_id, direction, enabled FROM cards WHERE term_id = ? ORDER BY rowid')
      .all(row.id) as Array<{ id: string; term_id: string; direction: CardDirection; enabled: number }>

    return {
      id: row.id,
      slug: row.slug,
      kind: row.kind,
      level: row.level,
      importance: row.importance,
      state: row.state,
      domain: row.domain,
      surfaces: surfaces.map((s) => ({
        type: s.type,
        text: s.text,
        status: s.status,
        evidence: s.evidence,
        locator: s.locator,
      })),
      zh: { name: zh?.name ?? null, name_evidence: zh?.name_evidence ?? 'unverified', explain: zh?.explain ?? '' },
      annotations,
      tags,
      cards: cards.map((c) => ({ ...c, enabled: Boolean(c.enabled) })),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }

  // ── 查询 ──────────────────────────────────────────────────────────────────

  getTerm(idOrSlug: string): Term | null {
    const row = this.db
      .prepare('SELECT * FROM terms WHERE id = ? OR slug = ?')
      .get(idOrSlug, idOrSlug) as TermRow | undefined
    return row ? this.assemble(row) : null
  }

  findByEnSurface(text: string): Term | null {
    const row = this.db
      .prepare(`SELECT DISTINCT term_id FROM surfaces WHERE type = 'en' AND norm = ? LIMIT 1`)
      .get(canon(text)) as { term_id: string } | undefined
    return row ? this.getTerm(row.term_id) : null
  }

  listTerms(f: TermFilter = {}): { items: Term[]; next: string | null; total: number } {
    const where: string[] = []
    const params: unknown[] = []

    if (f.kind) {
      where.push('kind = ?')
      params.push(f.kind)
    }
    if (f.state) {
      where.push('state = ?')
      params.push(f.state)
    }
    if (f.evidence) {
      where.push('id IN (SELECT term_id FROM surfaces WHERE evidence = ?)')
      params.push(f.evidence)
    }
    if (f.tag) {
      where.push('id IN (SELECT term_id FROM tags WHERE tag = ?)')
      params.push(f.tag)
    }
    if (f.has_name === true) where.push('id IN (SELECT term_id FROM zh_sides WHERE name IS NOT NULL)')
    if (f.has_name === false) where.push('id IN (SELECT term_id FROM zh_sides WHERE name IS NULL)')
    if (f.q && f.q.trim()) {
      const like = `%${f.q.trim()}%`
      where.push(
        `(id IN (SELECT term_id FROM surfaces WHERE text LIKE ? OR norm LIKE ?)
          OR id IN (SELECT term_id FROM zh_sides WHERE name LIKE ? OR explain LIKE ?))`,
      )
      params.push(like, `%${canon(f.q)}%`, like, like)
    }
    if (f.cursor) {
      where.push('id > ?')
      params.push(f.cursor)
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const limit = Math.min(Math.max(f.limit ?? 50, 1), 200)

    const rows = this.db
      .prepare(
        `SELECT * FROM terms ${clause} ORDER BY id ASC LIMIT ?`,
      )
      .all(...params, limit + 1) as TermRow[]

    const total = (
      this.db.prepare(`SELECT COUNT(*) AS c FROM terms ${clause}`).get(...params) as { c: number }
    ).c

    const items = rows.slice(0, limit).map((r) => this.assemble(r))
    const next = rows.length > limit ? (items[items.length - 1]?.id ?? null) : null
    return { items, next, total }
  }

  // ── 写：Term ──────────────────────────────────────────────────────────────

  private insertTermBody(id: string, slug: string, input: TermInput, now: string): void {
    this.db
      .prepare(
        `INSERT INTO terms (id, slug, kind, level, importance, state, domain, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, slug, input.kind, input.level, input.importance, input.state, input.domain ?? null, now, now)

    const insSurface = this.db.prepare(
      `INSERT INTO surfaces (id, term_id, type, text, norm, status, evidence, locator, ord)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    input.surfaces.forEach((s, i) => {
      insSurface.run(ulid(), id, s.type, s.text, canon(s.text), s.status, s.evidence, s.locator ?? null, i)
    })

    this.db
      .prepare('INSERT INTO zh_sides (term_id, name, name_evidence, explain) VALUES (?, ?, ?, ?)')
      .run(id, input.zh.name, input.zh.name_evidence, input.zh.explain)

    const insAnn = this.db.prepare(
      'INSERT INTO annotations (id, term_id, type, text, ord) VALUES (?, ?, ?, ?, ?)',
    )
    input.annotations.forEach((a, i) => insAnn.run(ulid(), id, a.type, a.text, i))

    const insTag = this.db.prepare('INSERT OR IGNORE INTO tags (term_id, tag) VALUES (?, ?)')
    for (const t of input.tags) insTag.run(id, t)
  }

  createTerm(
    input: TermInput,
    actor: Actor,
    opts: { onDuplicate?: 'skip' | 'error' } = {},
  ): { term: Term; created: boolean } {
    const parsed = TermInputSchema.parse(input)
    const primaryEn =
      parsed.surfaces.find((s) => s.type === 'en' && s.status === 'preferred')?.text ??
      parsed.surfaces.find((s) => s.type === 'en')?.text ??
      parsed.surfaces.find((s) => s.type === 'abbr')?.text

    if (!primaryEn) throw new Error('至少需要一个 en 或 abbr 类型的 Surface')

    const existing = this.findByEnSurface(primaryEn)
    if (existing) {
      if ((opts.onDuplicate ?? 'skip') === 'error') {
        throw new DuplicateTermError(existing.id)
      }
      return { term: existing, created: false }
    }

    const id = ulid()
    const slug = this.uniqueSlug(primaryEn)
    const now = this.now()

    const tx = this.db.transaction(() => {
      this.insertTermBody(id, slug, parsed, now)
      this.syncCards(id, parsed)
      this.logEvent(actor, 'term.create', 'term', id, { slug, kind: parsed.kind })
    })
    tx()

    return { term: this.getTerm(id)!, created: true }
  }

  updateTerm(
    id: string,
    patch: Partial<TermInput>,
    actor: Actor,
  ): Term {
    const current = this.getTerm(id)
    if (!current) throw new NotFoundError('term', id)

    const now = this.now()
    const tx = this.db.transaction(() => {
      const next: TermInput = {
        kind: patch.kind ?? current.kind,
        surfaces: patch.surfaces ?? current.surfaces,
        zh: patch.zh ?? current.zh,
        annotations: patch.annotations ?? current.annotations,
        tags: patch.tags ?? current.tags,
        level: patch.level ?? current.level,
        importance: patch.importance ?? current.importance,
        domain: patch.domain !== undefined ? (patch.domain ?? null) : current.domain,
        state: patch.state ?? current.state,
      }
      const parsed = TermInputSchema.parse(next)

      this.db
        .prepare(
          `UPDATE terms SET kind=?, level=?, importance=?, state=?, domain=?, updated_at=? WHERE id=?`,
        )
        .run(parsed.kind, parsed.level, parsed.importance, parsed.state, parsed.domain ?? null, now, id)

      if (patch.surfaces) {
        this.db.prepare('DELETE FROM surfaces WHERE term_id = ?').run(id)
        const ins = this.db.prepare(
          `INSERT INTO surfaces (id, term_id, type, text, norm, status, evidence, locator, ord)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        parsed.surfaces.forEach((s, i) =>
          ins.run(ulid(), id, s.type, s.text, canon(s.text), s.status, s.evidence, s.locator ?? null, i),
        )
      }

      if (patch.zh) {
        this.db
          .prepare('UPDATE zh_sides SET name=?, name_evidence=?, explain=? WHERE term_id=?')
          .run(parsed.zh.name, parsed.zh.name_evidence, parsed.zh.explain, id)
      }

      if (patch.annotations) {
        this.db.prepare('DELETE FROM annotations WHERE term_id = ?').run(id)
        const ins = this.db.prepare(
          'INSERT INTO annotations (id, term_id, type, text, ord) VALUES (?, ?, ?, ?, ?)',
        )
        parsed.annotations.forEach((a, i) => ins.run(ulid(), id, a.type, a.text, i))
      }

      if (patch.tags) {
        this.db.prepare('DELETE FROM tags WHERE term_id = ?').run(id)
        const ins = this.db.prepare('INSERT OR IGNORE INTO tags (term_id, tag) VALUES (?, ?)')
        for (const t of parsed.tags) ins.run(id, t)
      }

      if (patch.surfaces || patch.zh || patch.kind) {
        this.syncCards(id, parsed)
      }

      this.logEvent(actor, 'term.update', 'term', id, patch)
    })
    tx()

    return this.getTerm(id)!
  }

  archiveTerm(id: string, actor: Actor): Term {
    return this.updateTerm(id, { state: 'archived' }, actor)
  }

  activateTerm(id: string, actor: Actor): Term {
    return this.updateTerm(id, { state: 'active' }, actor)
  }

  /** 按卡片生成矩阵同步卡片；已有作答历史的卡片只停用不删除。 */
  private syncCards(termId: string, input: TermInput): void {
    const plan = planCards({
      kind: input.kind,
      surfaces: input.surfaces as Surface[],
      zh: input.zh as ZhSide,
    })
    const wanted = new Map(plan.map((p) => [p.direction, p]))
    const existing = this.db
      .prepare('SELECT id, direction FROM cards WHERE term_id = ?')
      .all(termId) as Array<{ id: string; direction: CardDirection }>
    const have = new Set(existing.map((c) => c.direction))

    const ins = this.db.prepare(
      `INSERT INTO cards (id, term_id, direction, enabled, due) VALUES (?, ?, ?, ?, ?)`,
    )
    for (const [direction, p] of wanted) {
      if (!have.has(direction)) ins.run(ulid(), termId, direction, p.enabled ? 1 : 0, this.now())
      else this.db.prepare('UPDATE cards SET enabled = ? WHERE term_id = ? AND direction = ?').run(p.enabled ? 1 : 0, termId, direction)
    }

    for (const c of existing) {
      if (wanted.has(c.direction)) continue
      const reviewed = this.db.prepare('SELECT 1 FROM reviews WHERE card_id = ? LIMIT 1').get(c.id)
      if (reviewed) this.db.prepare('UPDATE cards SET enabled = 0 WHERE id = ?').run(c.id)
      else this.db.prepare('DELETE FROM cards WHERE id = ?').run(c.id)
    }
  }

  // ── 写：Draft ─────────────────────────────────────────────────────────────

  createDraft(input: DraftInput, actor: Actor, source?: string | null): Draft {
    const parsed = DraftInputSchema.parse(input)
    const id = ulid()
    this.db
      .prepare(
        `INSERT INTO drafts (id, created_at, source, actor_type, actor_name, payload_json, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      )
      .run(id, this.now(), source ?? null, actor.type, actor.name ?? null, JSON.stringify(parsed))
    this.logEvent(actor, 'draft.create', 'draft', id, { rationale: parsed.rationale })
    return this.getDraft(id)!
  }

  getDraft(id: string): Draft | null {
    const row = this.db.prepare('SELECT * FROM drafts WHERE id = ?').get(id) as
      | {
          id: string
          created_at: string
          source: string | null
          actor_type: string
          actor_name: string | null
          payload_json: string
          status: Draft['status']
          ai_confidence: number | null
          decided_at: string | null
          decided_by: string | null
          term_id: string | null
        }
      | undefined
    if (!row) return null
    return {
      ...row,
      payload: JSON.parse(row.payload_json) as DraftInput,
    }
  }

  listDrafts(
    status: string = 'pending',
    opts: { limit?: number; cursor?: string } = {},
  ): { items: Draft[]; total: number; next: string | null } {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500)
    const where = opts.cursor ? 'status = ? AND id < ?' : 'status = ?'
    const params = opts.cursor ? [status, opts.cursor, limit + 1] : [status, limit + 1]

    const rows = this.db
      .prepare(`SELECT id FROM drafts WHERE ${where} ORDER BY id DESC LIMIT ?`)
      .all(...(params as never[])) as Array<{ id: string }>

    const total = (
      this.db.prepare('SELECT COUNT(*) AS c FROM drafts WHERE status = ?').get(status) as { c: number }
    ).c

    const items = rows.slice(0, limit).map((r) => this.getDraft(r.id)!).filter(Boolean)
    const next = rows.length > limit ? (items[items.length - 1]?.id ?? null) : null
    return { items, total, next }
  }

  acceptDraft(id: string, actor: Actor, override?: Partial<DraftInput>): Term {
    const draft = this.getDraft(id)
    if (!draft) throw new NotFoundError('draft', id)
    if (draft.status !== 'pending') throw new ConflictError(`draft ${id} is already ${draft.status}`)

    const payload = { ...draft.payload, ...(override ?? {}) }
    const input: TermInput = TermInputSchema.parse({
      kind: payload.kind,
      surfaces: payload.surfaces,
      zh: payload.zh,
      annotations: payload.annotations,
      tags: payload.tags,
      level: payload.level,
      importance: payload.importance,
      domain: payload.domain,
      state: 'active',
    })

    const tx = this.db.transaction(() => {
      const { term } = this.createTerm(input, actor)
      this.db
        .prepare(
          `UPDATE drafts SET status='accepted', decided_at=?, decided_by=?, term_id=? WHERE id=?`,
        )
        .run(this.now(), actor.name ?? actor.type, term.id, id)
      this.logEvent(actor, 'draft.accept', 'draft', id, { term_id: term.id })
      return term
    })
    return tx()
  }

  rejectDraft(id: string, actor: Actor, reason: string): void {
    const draft = this.getDraft(id)
    if (!draft) throw new NotFoundError('draft', id)
    if (draft.status !== 'pending') throw new ConflictError(`draft ${id} is already ${draft.status}`)
    this.db
      .prepare(`UPDATE drafts SET status='rejected', decided_at=?, decided_by=?, result_json=? WHERE id=?`)
      .run(this.now(), actor.name ?? actor.type, JSON.stringify({ reason }), id)
    this.logEvent(actor, 'draft.reject', 'draft', id, { reason })
  }

  // ── 复习 ──────────────────────────────────────────────────────────────────

  nextCards(limit = 1, now: Date = new Date()): QueueItem[] {
    const rows = this.db
      .prepare(
        `SELECT c.* FROM cards c
         JOIN terms t ON t.id = c.term_id
         WHERE c.enabled = 1 AND t.state = 'active' AND c.due <= ?
         ORDER BY c.due ASC, t.importance DESC
         LIMIT ?`,
      )
      .all(now.toISOString(), limit) as CardRow[]

    const out: QueueItem[] = []
    for (const c of rows) {
      const term = this.getTerm(c.term_id)
      if (!term) continue
      const q = buildQuestion(term, c.id, c.direction)
      out.push({
        ...q,
        due: c.due,
        reps: c.reps,
        lapses: c.lapses,
        stability: c.stability,
        difficulty: c.difficulty,
        term_kind: term.kind,
      })
    }
    return out
  }

  /**
   * 只判分、不落库。网页的两段式交互要用它：
   * 先提交答案看判定，再按 1–4 评分才真正写入。
   */
  previewAnswer(cardId: string, answerRaw: string) {
    const card = this.db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId) as CardRow | undefined
    if (!card) throw new NotFoundError('card', cardId)
    const term = this.getTerm(card.term_id)
    if (!term) throw new NotFoundError('term', card.term_id)

    const j = judge(term, card.direction, answerRaw)
    return {
      verdict: j.verdict,
      self_graded: j.self_graded,
      matched: j.matched,
      suggested_rating: j.self_graded ? null : suggestRating(j.verdict ?? 'partial'),
    }
  }

  answerCard(
    cardId: string,
    body: { answer_raw?: string; rating?: Rating; elapsed_ms?: number },
    actor: Actor,
  ): AnswerResult {
    const card = this.db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId) as CardRow | undefined
    if (!card) throw new NotFoundError('card', cardId)
    const term = this.getTerm(card.term_id)
    if (!term) throw new NotFoundError('term', card.term_id)

    const answerRaw = body.answer_raw ?? ''
    const j = judge(term, card.direction, answerRaw)

    if (j.self_graded && !body.rating) {
      throw new BadRequestError('self_graded_card_requires_rating')
    }

    const rating: Rating = body.rating ?? suggestRating(j.verdict ?? 'partial')
    const now = new Date()
    const prev: SchedState = {
      stability: card.stability,
      difficulty: card.difficulty,
      due: card.due,
      reps: card.reps,
      lapses: card.lapses,
      last_review: card.last_review,
    }
    const next = schedule(prev, rating, now)

    const question = buildQuestion(term, cardId, card.direction)

    const reviewId = ulid()
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO reviews (id, card_id, ts, prompt, answer_raw, verdict, decided_by, rating, elapsed_ms, sched_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          reviewId,
          cardId,
          now.toISOString(),
          question.prompt,
          answerRaw,
          j.verdict,
          j.self_graded ? 'human' : 'rule',
          rating,
          body.elapsed_ms ?? null,
          JSON.stringify(next),
        )
      this.db
        .prepare(
          `UPDATE cards SET stability=?, difficulty=?, reps=?, lapses=?, due=?, last_review=? WHERE id=?`,
        )
        .run(next.stability, next.difficulty, next.reps, next.lapses, next.due, next.last_review, cardId)
      this.logEvent(actor, 'review.answer', 'card', cardId, { verdict: j.verdict, rating })
    })
    tx()

    const keyRow = this.db
      .prepare('SELECT name, explain FROM zh_sides WHERE term_id = ?')
      .get(term.id) as { name: string | null; explain: string } | undefined

    const accepted = term.surfaces
      .filter((s) => s.type === 'en' || s.type === 'abbr')
      .map((s) => s.text)

    return {
      review_id: reviewId,
      verdict: j.verdict,
      decided_by: j.self_graded ? 'human' : 'rule',
      matched: j.matched,
      suggested_rating: suggestRating(j.verdict ?? 'partial'),
      rating,
      sched: next,
      answer: {
        name: keyRow?.name ?? null,
        explain: keyRow?.explain ?? '',
        accepted,
      },
    }
  }

  // ── 事件 / 导出 / 统计 ─────────────────────────────────────────────────────

  listEvents(limit = 100, targetId?: string): EventRecord[] {
    const rows = (
      targetId
        ? this.db
            .prepare('SELECT * FROM events WHERE target_id = ? ORDER BY ts DESC LIMIT ?')
            .all(targetId, limit)
        : this.db.prepare('SELECT * FROM events ORDER BY ts DESC LIMIT ?').all(limit)
    ) as Array<{
      id: string
      ts: string
      actor_type: string
      actor_name: string | null
      action: string
      target_type: string
      target_id: string
      diff_json: string | null
      revertable: number
    }>

    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      actor_type: r.actor_type,
      actor_name: r.actor_name,
      action: r.action,
      target_type: r.target_type,
      target_id: r.target_id,
      diff: r.diff_json ? JSON.parse(r.diff_json) : null,
      revertable: Boolean(r.revertable),
    }))
  }

  exportJsonl(): string {
    const rows = this.db.prepare('SELECT * FROM terms ORDER BY id ASC').all() as TermRow[]
    return rows.map((r) => JSON.stringify(this.assemble(r))).join('\n') + (rows.length ? '\n' : '')
  }

  snapshot(dir: string): { path: string; count: number } {
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'terms.jsonl')
    const content = this.exportJsonl()
    fs.writeFileSync(file, content, 'utf8')
    const { c } = this.db.prepare('SELECT COUNT(*) AS c FROM terms').get() as { c: number }
    return { path: file, count: c }
  }

  diagnostics(): Record<string, unknown> {
    const total = (this.db.prepare('SELECT COUNT(*) c FROM terms').get() as { c: number }).c
    const active = (
      this.db.prepare(`SELECT COUNT(*) c FROM terms WHERE state='active'`).get() as { c: number }
    ).c
    const unverified = (
      this.db.prepare(`SELECT COUNT(DISTINCT term_id) c FROM surfaces WHERE evidence='unverified'`).get() as {
        c: number
      }
    ).c
    const noName = (
      this.db.prepare('SELECT COUNT(*) c FROM zh_sides WHERE name IS NULL').get() as { c: number }
    ).c
    const reviews = (this.db.prepare('SELECT COUNT(*) c FROM reviews').get() as { c: number }).c
    const again = (
      this.db.prepare(`SELECT COUNT(*) c FROM reviews WHERE rating='again'`).get() as { c: number }
    ).c

    const byKind = this.db
      .prepare('SELECT kind, COUNT(*) c FROM terms GROUP BY kind ORDER BY c DESC')
      .all() as Array<{ kind: string; c: number }>

    const dimensionLapse = this.db
      .prepare(
        `SELECT tg.tag, COUNT(r.id) total,
                SUM(CASE WHEN r.rating='again' THEN 1 ELSE 0 END) again
         FROM tags tg
         JOIN cards c ON c.term_id = tg.term_id
         JOIN reviews r ON r.card_id = c.id
         GROUP BY tg.tag
         HAVING total >= 3
         ORDER BY CAST(again AS REAL)/total DESC
         LIMIT 10`,
      )
      .all() as Array<{ tag: string; total: number; again: number }>

    return {
      totals: { terms: total, active, reviews, due_today: this.nextCards(100).length },
      evidence_gap: { unverified_terms: unverified, no_name_terms: noName, ratio: total ? unverified / total : 0 },
      recall: { again_rate: reviews ? again / reviews : 0 },
      by_kind: byKind,
      dimension_lapse: dimensionLapse.map((d) => ({ ...d, again_rate: d.total ? d.again / d.total : 0 })),
    }
  }

  // ── 幂等 ──────────────────────────────────────────────────────────────────

  getIdempotent(key: string): string | null {
    const row = this.db
      .prepare('SELECT response_json FROM idempotency WHERE key = ?')
      .get(key) as { response_json: string } | undefined
    return row ? row.response_json : null
  }

  saveIdempotent(key: string, responseJson: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO idempotency (key, created_at, response_json) VALUES (?, ?, ?)')
      .run(key, this.now(), responseJson)
  }
}

// ── 错误 ─────────────────────────────────────────────────────────────────────

export class NotFoundError extends Error {
  constructor(
    public readonly kind: string,
    public readonly id: string,
  ) {
    super(`${kind} not found: ${id}`)
  }
}

export class ConflictError extends Error {}
export class BadRequestError extends Error {}
export class DuplicateTermError extends Error {
  constructor(public readonly termId: string) {
    super(`duplicate term: ${termId}`)
  }
}

