/**
 * 存量迁移规则（PRD 附录 A）。
 *
 * 输入是「英文<TAB>中文」的裸两列文本，输出是符合领域模型的 Term。
 * 全部是启发式：命中率高但不是 100%，凡是拿不准的都压低 confidence，
 * 让 upper layer 把低分条目推给人审，而不是硬猜。
 */

import type {
  Annotation,
  AnnotationType,
  Evidence,
  Kind,
  Surface,
  ZhSide,
} from './types.ts'

export interface LegacyParse {
  kind: Kind
  surfaces: Surface[]
  zh: ZhSide
  annotations: Annotation[]
  confidence: number
  notes: string[]
}

/** 提取一对或多对括号，支持全角（）与半角()，返回去掉括号后的剩余文本。 */
export function extractParens(s: string): { rest: string; parts: string[] } {
  const parts: string[] = []
  let out = ''
  let depth = 0
  let buf = ''

  for (const ch of s) {
    if (ch === '（' || ch === '(') {
      if (depth === 0) buf = ''
      else buf += ch
      depth++
    } else if (ch === '）' || ch === ')') {
      if (depth > 0) {
        depth--
        if (depth === 0) parts.push(buf.trim())
        else buf += ch
      } else {
        out += ch
      }
    } else if (depth > 0) {
      buf += ch
    } else {
      out += ch
    }
  }
  if (depth > 0) out += `（${buf}` // 括号不闭合，原样保留
  return { rest: out, parts }
}

const ANNOTATION_RULES: Array<[AnnotationType, RegExp]> = [
  ['alias', /称|又名|亦称|又称/],
  ['catchword', /自创|本项目|团队自/],
  ['provenance', /§|^\d+(\.\d+)*$|\.(cpp|h|hpp|py|md|txt|dat|sus2)$|论文|学位论文|文档/],
  ['dimension', /[≈=≃~]|\d+\s*[a-zA-ZµμÅκλ]/],
  ['usage', /误差|吞吐|筛选|筛帧|用途|场景/],
]

export function classifyAnnotation(text: string): AnnotationType | null {
  for (const [type, re] of ANNOTATION_RULES) {
    if (re.test(text)) return type
  }
  return null
}

const UNIT_TOKEN =
  /^(meV|eV|keV|meV\/atom|eV\/Å|GPa|MPa|kPa|THz|GHz|fs|ps|ns|µs|us|ms|s|A|Å|nm|µm|um|K|%|κ|λ)$/

function looksLikeUnit(en: string): boolean {
  if (/\s/.test(en)) return false
  if (UNIT_TOKEN.test(en)) return true
  if (/[/·]/.test(en)) return true
  return false
}

const PROCEDURAL_LEXICON = new Set(
  [
    'pair_style',
    'pair_coeff',
    'run a job',
    'submit a job',
    'queue',
    'hang',
    'crash',
    'segfault',
    'out of memory',
    'blow up',
    'nan',
    'table lookup',
    'build',
    'link',
    'shared library',
    'header file',
    'compiler flags',
    'environment variable',
    'module load',
    'node',
    'core',
    'mpi rank',
    'thread',
    'vram',
    'input script',
    'potential file',
    'log file',
    'wall time',
    'throughput',
    'post-processing',
    'batch',
    'checkpoint',
    'resume',
    'warm start',
    'ghost atom',
    'halo',
    'run a job',
  ].map((s) => s.toLowerCase()),
)

const METRIC_ZH = /误差|系数|决定|相关|准确率|召回/

function looksLikeMetric(surfaces: Surface[], zhName: string | null): boolean {
  // R² 这类「缩写其实是符号」的情况也要算进指标，否则 abbr2full 卡不会生成
  const hasAbbrOrSymbol = surfaces.some((s) => s.type === 'abbr' || s.type === 'symbol')
  if (!hasAbbrOrSymbol) return false
  return zhName !== null && METRIC_ZH.test(zhName)
}

const CONVERSION = /^[\d.]+\s*[^\s]+\s*[≈=≃]\s*[\d.]+\s*[^\s]+$/

/**
 * 解析一行存量数据。
 *
 * 规则顺序有讲究：
 * 1. 先拆英文括号（缩写/符号焊在英文列里）
 * 2. 再拆中文括号（别名/量纲/用途混在一起）
 * 3. 中文分号切 name / explain
 * 4. unit 的「用途」识别要在 name 认定之前，否则「热导率单位」会被当成译名
 */
export function parseLegacyRow(enRaw: string, zhRaw: string): LegacyParse {
  const notes: string[] = []
  let confidence = 0.95

  const en = enRaw.trim()
  const zh = zhRaw.trim()
  if (!en || !zh) {
    throw new Error('空的英文列或中文列')
  }

  // ── ① 英文侧括号 ──────────────────────────────
  // 单位符号自己就带括号（W/(m·K)）。先判定是不是单位，是的话绝不能剥括号——
  // 否则 "W/(m·K)" 会被拆成 "W/"，两个不同的单位撞成同一条。
  const isUnit = looksLikeUnit(en)
  const enParen = isUnit ? { rest: en, parts: [] as string[] } : extractParens(en)
  const enMain = enParen.rest.replace(/\s+/g, ' ').trim() || en

  const surfaces: Surface[] = [
    {
      type: 'en',
      text: enMain,
      status: 'preferred',
      evidence: 'unverified',
      locator: null,
    },
  ]

  for (const part of enParen.parts) {
    if (!part) continue
    if (/[²³⁻¹µÅκ]/.test(part) || /^[A-Z][\d²³]?$/.test(part)) {
      surfaces.push({ type: 'symbol', text: part, status: 'accepted', evidence: 'unverified', locator: null })
    } else if (/^[A-Z0-9]{2,8}$/.test(part)) {
      surfaces.push({ type: 'abbr', text: part, status: 'preferred', evidence: 'unverified', locator: null })
    } else {
      // 括号里既不是缩写也不是符号：无法判定，交给人
      surfaces.push({ type: 'abbr', text: part, status: 'accepted', evidence: 'unverified', locator: null })
      notes.push(`英文括号内容无法自动判定类型：「${part}」`)
      confidence -= 0.1
    }
  }

  // 单独的缩写 Term（如 BFGS），英文本身就是缩写
  if (!/\s/.test(enMain) && /^[A-Z0-9]{2,8}$/.test(enMain)) {
    surfaces.push({ type: 'abbr', text: enMain, status: 'preferred', evidence: 'unverified', locator: null })
  }

  // ── ② 中文侧括号 ──────────────────────────────
  const zhParen = extractParens(zh)
  const annotations: Annotation[] = []
  const looseParts: string[] = []

  for (const part of zhParen.parts) {
    if (!part) continue
    const type = classifyAnnotation(part)
    if (type) annotations.push({ type, text: part })
    else looseParts.push(part)
  }

  // ── ③ 中文分号 ────────────────────────────────
  const segments = zhParen.rest
    .split('；')
    .map((s) => s.trim())
    .filter(Boolean)

  let name: string | null = segments[0] ?? null
  const explainParts: string[] = []

  for (const seg of segments.slice(1)) {
    if (CONVERSION.test(seg) || /[≈=≃]/.test(seg)) {
      annotations.push({ type: 'dimension', text: seg })
    } else {
      explainParts.push(seg)
    }
  }
  explainParts.push(...looseParts)

  // ── ④ kind 判定 ───────────────────────────────
  let kind: Kind
  if (isUnit) {
    kind = 'unit'
    confidence = 0.95
  } else if (PROCEDURAL_LEXICON.has(enMain.toLowerCase())) {
    kind = 'procedural'
    confidence = 0.98
  } else if (looksLikeMetric(surfaces, name)) {
    kind = 'metric'
    confidence = 0.9
  } else if (surfaces.some((s) => s.type === 'symbol') && !/\s/.test(enMain)) {
    kind = 'symbol'
    confidence = 0.85
  } else if (/\s/.test(enMain)) {
    kind = 'term'
    confidence = Math.min(confidence, 0.9)
  } else {
    kind = 'term'
    confidence = Math.min(confidence, 0.8)
  }

  // ── ⑤ unit 的「用途」不能当译名 ────────────────
  // W/(m·K) → 「热导率单位」不是读法，是用途。这是 261 条里的真实毛病。
  if (kind === 'unit' && name && /单位$/.test(name)) {
    annotations.push({ type: 'usage', text: name })
    notes.push(`单位的中文侧是用途描述而非读法：「${name}」`)
    name = null
    confidence -= 0.15
  }

  let explain = explainParts.join('；').trim()

  // 不变量：中文侧永不真正空置。name 被清空（如单位只写了用途）时，
  // 原始文本必须落进 explain，否则这条数据就既没有译名也没有解释。
  if (name === null && explain === '') {
    explain = zhParen.rest.trim() || zh
  }

  return {
    kind,
    surfaces,
    zh: {
      name,
      name_evidence: 'unverified' as Evidence,
      explain,
    },
    annotations,
    confidence: Math.max(0.3, Number(confidence.toFixed(2))),
    notes,
  }
}

/** 解析一个 TSV 文件的内容。返回成功条目与失败行号。 */
export function parseLegacyTsv(
  text: string,
): { rows: Array<{ line: number; en: string; zh: string; parsed?: LegacyParse; error?: string }> } {
  const rows: Array<{ line: number; en: string; zh: string; parsed?: LegacyParse; error?: string }> = []
  const lines = text.split(/\r?\n/)
  lines.forEach((line, i) => {
    if (!line.trim()) return
    const cols = line.split('\t')
    if (cols.length < 2) {
      rows.push({ line: i + 1, en: line, zh: '', error: '列数不足 2' })
      return
    }
    const en = cols[0]!.trim()
    const zh = cols.slice(1).join('\t').trim()
    try {
      rows.push({ line: i + 1, en, zh, parsed: parseLegacyRow(en, zh) })
    } catch (err) {
      rows.push({ line: i + 1, en, zh, error: (err as Error).message })
    }
  })
  return { rows }
}
