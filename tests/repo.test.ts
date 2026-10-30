import { beforeEach, describe, expect, it } from 'vitest'

import { Repo } from '../src/db/repo.ts'
import type { DraftInput, TermInput } from '../src/core/types.ts'

const ACTOR = { type: 'human' as const, name: 'test' }

function term(overrides: Partial<TermInput> = {}): TermInput {
  return {
    kind: 'term',
    surfaces: [
      { type: 'en', text: 'potential energy surface', status: 'preferred', evidence: 'A', locator: null },
      { type: 'abbr', text: 'PES', status: 'preferred', evidence: 'A', locator: null },
    ],
    zh: { name: '势能面', name_evidence: 'B', explain: '给定原子位置，体系能量是多少' },
    annotations: [{ type: 'provenance', text: '胡晏箫学位论文 §1.1' }],
    tags: ['core'],
    level: 'domain',
    importance: 5,
    domain: 'mlip',
    state: 'active',
    ...overrides,
  }
}

let repo: Repo

beforeEach(() => {
  repo = new Repo(':memory:')
})

describe('createTerm', () => {
  it('落库并自动生成卡片', () => {
    const { term: t, created } = repo.createTerm(term(), ACTOR)
    expect(created).toBe(true)
    expect(t.slug).toBe('potential-energy-surface')
    expect(t.cards.map((c) => c.direction).sort()).toEqual(['en2explain', 'en2zh', 'zh2en'])
  })

  it('同一个英文不产生重复', () => {
    repo.createTerm(term(), ACTOR)
    const second = repo.createTerm(term(), ACTOR)
    expect(second.created).toBe(false)
    expect(second.term.slug).toBe('potential-energy-surface')
  })

  it('连字符与空格视作同一条', () => {
    repo.createTerm(term(), ACTOR)
    const dup = repo.createTerm(
      term({
        surfaces: [
          { type: 'en', text: 'potential-energy surface', status: 'preferred', evidence: 'A', locator: null },
        ],
      }),
      ACTOR,
    )
    expect(dup.created).toBe(false)
  })

  it('没有译名也能入库，但不出 zh2en 卡', () => {
    const { term: t } = repo.createTerm(
      term({
        zh: { name: null, name_evidence: 'C', explain: '把任意材料物性表示为一个可求导的场函数' },
      }),
      ACTOR,
    )
    const zh2en = t.cards.find((c) => c.direction === 'zh2en')
    expect(zh2en).toBeDefined()
    expect(zh2en!.enabled).toBe(false) // 卡片存在但停用：证据升级后可一键复活
    expect(t.cards.find((c) => c.direction === 'en2explain')!.enabled).toBe(true)
    expect(t.cards.find((c) => c.direction === 'en2zh')!.enabled).toBe(false)
  })

  it('中文侧两边都空会被 zod 挡下', () => {
    expect(() =>
      repo.createTerm(
        term({ zh: { name: null, name_evidence: 'unverified', explain: '' } }),
        ACTOR,
      ),
    ).toThrow()
  })

  it('每一笔写入都留下可回滚的事件', () => {
    const { term: t } = repo.createTerm(term(), ACTOR)
    const events = repo.listEvents(10, t.id)
    expect(events.length).toBeGreaterThan(0)
    expect(events[0]!.action).toBe('term.create')
    expect(events[0]!.revertable).toBe(true)
  })
})

describe('复习闭环', () => {
  it('答对 → correct → good，延迟按天增长', () => {
    const { term: t } = repo.createTerm(term(), ACTOR)
    const [card] = repo.nextCards(1)
    expect(card).toBeDefined()
    expect(card!.prompt).toBe('potential energy surface')

    const res = repo.answerCard(card!.card_id, { answer_raw: '势能面' }, ACTOR)
    expect(res.verdict).toBe('correct')
    expect(res.rating).toBe('good')
    expect(res.sched.reps).toBe(1)
    expect(res.sched.stability).toBeGreaterThan(1)

    // 卡片各自独立调度：答完 en2zh，zh2en 仍然到期
    const remaining = repo.nextCards(10).map((c) => c.direction)
    expect(remaining).not.toContain('en2zh')
    expect(remaining).toContain('zh2en')
    void t
  })

  it('答错 → wrong → again', () => {
    repo.createTerm(term(), ACTOR)
    const [card] = repo.nextCards(1)
    const res = repo.answerCard(card!.card_id, { answer_raw: '完全无关' }, ACTOR)
    expect(res.verdict).toBe('wrong')
    expect(res.rating).toBe('again')
  })

  it('自评题型不给 rating 会被拒绝', () => {
    const { term: t } = repo.createTerm(term(), ACTOR)
    const explainCard = t.cards.find((c) => c.direction === 'en2explain')!
    expect(() => repo.answerCard(explainCard.id, { answer_raw: '随便写点' }, ACTOR)).toThrow()
    const ok = repo.answerCard(explainCard.id, { answer_raw: '随便写点', rating: 'good' }, ACTOR)
    expect(ok.decided_by).toBe('human')
    expect(ok.verdict).toBeNull()
  })

  it('预览不落库', () => {
    repo.createTerm(term(), ACTOR)
    const [card] = repo.nextCards(1)
    const p = repo.previewAnswer(card!.card_id, '势能面')
    expect(p.verdict).toBe('correct')
    expect(repo.nextCards(1).length).toBe(1) // 仍然待复习
  })
})

describe('Draft 流程', () => {
  const draft = (over: Partial<DraftInput> = {}): DraftInput => ({
    kind: 'term',
    surfaces: [{ type: 'en', text: 'body order', status: 'preferred', evidence: 'unverified', locator: null }],
    zh: { name: '体阶', name_evidence: 'unverified', explain: '展开式中最高阶的相互作用层数' },
    annotations: [],
    tags: ['math'],
    level: 'domain',
    importance: 3,
    domain: null,
    evidence: [{ grade: 'A', type: 'paper', citation: 'x', locator: '§2' }],
    rationale: '源码文档叫体序，论文叫体阶',
    ...over,
  })

  it('提交后进入 Inbox，接受后才变成 Term', () => {
    const d = repo.createDraft(draft(), { type: 'agent', name: 'test-agent' })
    expect(repo.listDrafts().items).toHaveLength(1)
    expect(repo.listTerms().total).toBe(0)

    const t = repo.acceptDraft(d.id, ACTOR)
    expect(t.state).toBe('active')
    expect(repo.listTerms().total).toBe(1)
    expect(repo.listDrafts().items).toHaveLength(0)
  })

  it('拒绝不会产生 Term', () => {
    const d = repo.createDraft(draft(), ACTOR)
    repo.rejectDraft(d.id, ACTOR, '译名有争议')
    expect(repo.listTerms().total).toBe(0)
  })

  it('接受后被改动的候选不能重复接受', () => {
    const d = repo.createDraft(draft(), ACTOR)
    repo.acceptDraft(d.id, ACTOR)
    expect(() => repo.acceptDraft(d.id, ACTOR)).toThrow()
  })
})

describe('导出', () => {
  it('JSONL 一行一个 Term', () => {
    repo.createTerm(term(), ACTOR)
    repo.createTerm(
      term({
        surfaces: [{ type: 'en', text: 'phonon', status: 'preferred', evidence: 'A', locator: null }],
        zh: { name: '声子', name_evidence: 'B', explain: '晶格振动的量子化元激发' },
      }),
      ACTOR,
    )
    const lines = repo.exportJsonl().trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!).surfaces.length).toBeGreaterThan(0)
  })
})
