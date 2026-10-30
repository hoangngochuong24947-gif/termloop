import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { classifyAnnotation, extractParens, parseLegacyRow, parseLegacyTsv } from '../src/core/legacy.ts'

const SEED = fileURLToPath(new URL('../data/seed/termlist-sus2-261.tsv', import.meta.url))

describe('extractParens', () => {
  it('支持全角与半角混用', () => {
    expect(extractParens('势能面（力是它的梯度）').parts).toEqual(['力是它的梯度'])
    expect(extractParens('potential energy surface (PES)').parts).toEqual(['PES'])
  })

  it('括号不闭合时原样保留，不丢数据', () => {
    expect(extractParens('撤销（未闭合').rest).toContain('未闭合')
  })
})

describe('classifyAnnotation', () => {
  it('五种类型各有明确信号', () => {
    expect(classifyAnnotation('源码文档称体序')).toBe('alias')
    expect(classifyAnnotation('论文自创名')).toBe('catchword')
    expect(classifyAnnotation('1 GPa=10 kbar')).toBe('dimension')
    expect(classifyAnnotation('能量误差')).toBe('usage')
    expect(classifyAnnotation('§4.2.1')).toBe('provenance')
  })

  it('认不出来的返回 null，交给 explain 兜底', () => {
    expect(classifyAnnotation('输入转输出跟着转')).toBeNull()
  })
})

describe('parseLegacyRow', () => {
  it('缩写焊在英文列里也要拆出来', () => {
    const r = parseLegacyRow('potential energy surface (PES)', '势能面；力是它的梯度')
    expect(r.kind).toBe('term')
    expect(r.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'en', text: 'potential energy surface' }),
        expect.objectContaining({ type: 'abbr', text: 'PES' }),
      ]),
    )
    expect(r.zh.name).toBe('势能面')
    expect(r.zh.explain).toBe('力是它的梯度')
  })

  it('单位符号里的括号不能被剥掉（否则 W/(m·K) 会撞成 W/）', () => {
    const r = parseLegacyRow('W/(m·K)', '热导率单位')
    expect(r.surfaces[0]!.text).toBe('W/(m·K)')
    expect(parseLegacyRow('W/(m²·K)', '界面热导单位').surfaces[0]!.text).toBe('W/(m²·K)')
  })

  it('单位的「用途」不能被当成译名', () => {
    const r = parseLegacyRow('W/(m·K)', '热导率单位')
    expect(r.kind).toBe('unit')
    expect(r.zh.name).toBeNull()
    expect(r.annotations).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'usage' })]))
  })

  it('单位的「读法」要保留', () => {
    const r = parseLegacyRow('GPa', '吉帕；1 GPa=10 kbar')
    expect(r.kind).toBe('unit')
    expect(r.zh.name).toBe('吉帕')
    expect(r.annotations).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'dimension' })]),
    )
  })

  it('括号里的别名要拆成 alias', () => {
    const r = parseLegacyRow('body order', '体阶（源码文档称体序）')
    expect(r.annotations).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'alias' })]))
  })

  it('程序性词语走 procedural 分支', () => {
    expect(parseLegacyRow('pair_style', '势函数声明命令').kind).toBe('procedural')
    expect(parseLegacyRow('out of memory (OOM)', '内存或显存爆掉').kind).toBe('procedural')
  })

  it('指标走 metric 分支', () => {
    expect(parseLegacyRow('mean absolute error (MAE)', '平均绝对误差').kind).toBe('metric')
  })
})

describe('261 条全量', () => {
  const text = fs.readFileSync(SEED, 'utf8')
  const { rows } = parseLegacyTsv(text)

  it('一行不少', () => {
    expect(rows.length).toBe(261)
  })

  it('零解析失败', () => {
    const failed = rows.filter((r) => r.error)
    expect(failed).toEqual([])
  })

  it('每条中文侧都不空（name 或 explain 至少一个）', () => {
    for (const r of rows) {
      expect(r.parsed).toBeDefined()
      const hasSomething = r.parsed!.zh.name !== null || r.parsed!.zh.explain.length > 0
      expect(hasSomething, `L${r.line}: ${r.en}`).toBe(true)
    }
  })

  it('低置信度条目不超过 40（否则说明规则太弱）', () => {
    const low = rows.filter((r) => (r.parsed?.confidence ?? 0) < 0.8)
    expect(low.length).toBeLessThanOrEqual(40)
  })
})
