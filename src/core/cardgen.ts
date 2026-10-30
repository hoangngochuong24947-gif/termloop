/**
 * 由 Term 派生卡片（PRD §2.2 的矩阵）。
 *
 * 这张表是整个系统里最容易出错的地方：它决定了「一条术语会产生几道题」，
 * 判错会导致复习量翻倍或题型缺失。所有规则集中在这里，便于测试与审阅。
 */

import type { CardDirection, Kind, Surface, ZhSide } from './types.ts'

export interface CardPlan {
  direction: CardDirection
  enabled: boolean
  reason: string
}

export interface CardSource {
  kind: Kind
  surfaces: Surface[]
  zh: ZhSide
}

export function planCards(src: CardSource): CardPlan[] {
  const out: CardPlan[] = []
  const add = (direction: CardDirection, enabled: boolean, reason: string) => {
    if (out.some((c) => c.direction === direction)) return
    out.push({ direction, enabled, reason })
  }

  const live = src.surfaces.filter((s) => s.status !== 'rejected')
  const hasAbbr = live.some((s) => s.type === 'abbr')
  const hasSymbol = live.some((s) => s.type === 'symbol' || s.type === 'formula')

  // 只有 name 存在、且不是 C 级证据，才允许出「中↔英」互译题。
  // 这条规则是 ADR-0002 在卡片层面的落地。
  const nameUsable = src.zh.name !== null && src.zh.name !== '' && src.zh.name_evidence !== 'C'
  const hasExplain = src.zh.explain.trim().length > 0

  switch (src.kind) {
    case 'term':
      add('en2zh', nameUsable, nameUsable ? '有可用译名' : '无译名或无权威来源')
      add('zh2en', nameUsable, nameUsable ? '有可用译名' : '无译名或无权威来源')
      add('en2explain', hasExplain, hasExplain ? '有解释' : '无解释')
      break

    case 'phrase':
      add('en2zh', nameUsable, nameUsable ? '有可用译名' : '无译名')
      add('zh2en', nameUsable, nameUsable ? '有可用译名' : '无译名')
      add('en2explain', hasExplain, '表述类需要能说出用法')
      break

    case 'procedural':
      // 程序性词语没有官方译名，只能考「给场景说命令」。
      add('en2usage', true, '程序性词语的核心是知道它干什么')
      add('en2explain', hasExplain, '需要能用大白话解释')
      break

    case 'metric':
      add('abbr2full', hasAbbr, hasAbbr ? '有缩写' : '无缩写')
      add('en2zh', nameUsable, nameUsable ? '有可用译名' : '无译名')
      add('en2explain', hasExplain, '需要知道它衡量什么')
      break

    case 'unit':
      add('symbol2name', true, '单位必须能读出量纲')
      add('en2zh', nameUsable, nameUsable ? '有读法' : '无读法')
      break

    case 'symbol':
      add('symbol2name', hasSymbol || true, '符号必须能说出含义')
      add('en2zh', nameUsable, nameUsable ? '有译名' : '无译名')
      break
  }

  return out
}

/** 无法自动判分的题型：交给自评。 */
export function isSelfGraded(direction: CardDirection): boolean {
  return direction === 'en2explain' || direction === 'en2usage' || direction === 'scene2en'
}
