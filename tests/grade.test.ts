import { describe, expect, it } from 'vitest'

import { canon, deplural, expandAccepted, gradeEn, gradeZh, levenshtein, normalizeEn } from '../src/core/grade.ts'

describe('normalizeEn', () => {
  it('统一大小写、连字符与空白', () => {
    expect(normalizeEn('Machine-Learning  Interatomic Potentials')).toBe(
      'machine learning interatomic potentials',
    )
  })

  it('保留希腊字母与带重音字符（v1.0 会吃掉它们）', () => {
    expect(normalizeEn('thermal conductivity κ')).toBe('thermal conductivity κ')
    expect(normalizeEn('phonon BTE')).toBe('phonon bte')
  })

  it('只丢冠词，不丢介词', () => {
    expect(normalizeEn('the equation of state')).toBe('equation of state')
    expect(canon('Equation of State')).toBe('equation of state')
  })

  it('下划线与斜杠视作分词', () => {
    expect(normalizeEn('pair_style')).toBe('pair style')
  })
})

describe('deplural', () => {
  it('不把一个正常单词砍坏', () => {
    expect(deplural('studies')).toBe('study')
    expect(deplural('process')).toBe('process')
    expect(deplural('analysis')).toBe('analysis')
    expect(deplural('surface')).toBe('surface')
    expect(deplural('surfaces')).toBe('surface')
  })
})

describe('levenshtein', () => {
  it('基本正确', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshtein('surface', 'surface')).toBe(0)
  })
})

describe('expandAccepted', () => {
  it('把「全称 (缩写)」拆成三个候选', () => {
    const out = expandAccepted(['moment tensor potential (MTP)'])
    expect(out).toContain('moment tensor potential (MTP)')
    expect(out).toContain('moment tensor potential')
    expect(out).toContain('MTP')
  })
})

describe('gradeEn', () => {
  it('单复数归一后视为同一术语（v1.0 判成 partial，是错的）', () => {
    expect(gradeEn('potential energy surfaces', ['potential energy surface'])).toBe('correct')
  })

  it('漏写缩写也算对', () => {
    expect(
      gradeEn('machine learning interatomic potential', [
        'machine-learning interatomic potential (MLIP)',
      ]),
    ).toBe('correct')
  })

  it('单词序不同算对', () => {
    expect(gradeEn('energy potential surface', ['potential energy surface'])).toBe('correct')
  })

  it('容忍一次手滑', () => {
    expect(gradeEn('potetial energy surface', ['potential energy surface'])).toBe('correct')
  })

  it('覆盖不足不判对', () => {
    expect(gradeEn('potential energy', ['potential energy surface'])).toBe('wrong')
    expect(gradeEn('kinetic energy', ['potential energy surface'])).toBe('wrong')
  })

  it('空答案就是错', () => {
    expect(gradeEn('   ', ['potential energy surface'])).toBe('wrong')
  })
})

describe('gradeZh', () => {
  it('必含词全中即对', () => {
    expect(gradeZh('势能面', ['势能面'], [])).toBe('correct')
  })

  it('答非所问判错', () => {
    expect(gradeZh('力是它的梯度', ['势能面'], ['能量'])).toBe('wrong')
  })

  it('中文不要求语序', () => {
    expect(gradeZh('势能面，梯度给出力', ['势能面'], ['梯度'])).toBe('correct')
  })

  it('否定句不能判对', () => {
    expect(gradeZh('这不是势能面', ['势能面'], [])).toBe('wrong')
  })
})
