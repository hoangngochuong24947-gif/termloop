import { z } from 'zod'

/** Term 的结构分类，决定必填字段与自动生成的卡片。见 PRD §2.2 */
export const KIND_LIST = ['term', 'phrase', 'procedural', 'metric', 'unit', 'symbol'] as const
export const KindSchema = z.enum(KIND_LIST)
export type Kind = z.infer<typeof KindSchema>

/** 供 OpenAPI 文档与校验复用 */
export const kindList: string[] = [...KIND_LIST]

export const SurfaceTypeSchema = z.enum(['en', 'zh', 'abbr', 'symbol', 'formula'])
export type SurfaceType = z.infer<typeof SurfaceTypeSchema>

export const SurfaceStatusSchema = z.enum(['preferred', 'accepted', 'rejected'])
export type SurfaceStatus = z.infer<typeof SurfaceStatusSchema>

/**
 * 证据四级。`unverified` 是「不知道」，`C` 是「查过了，不行」——
 * 只有 C 会剥夺 name 资格。见 ADR-0002。
 */
export const EvidenceSchema = z.enum(['unverified', 'A', 'B', 'C'])
export type Evidence = z.infer<typeof EvidenceSchema>

export const AnnotationTypeSchema = z.enum([
  'alias',
  'catchword',
  'dimension',
  'usage',
  'provenance',
])
export type AnnotationType = z.infer<typeof AnnotationTypeSchema>

export const TermStateSchema = z.enum(['draft', 'accepted', 'active', 'archived'])
export type TermState = z.infer<typeof TermStateSchema>

export const LevelSchema = z.enum(['general', 'academic', 'domain'])
export type Level = z.infer<typeof LevelSchema>

export const CardDirectionSchema = z.enum([
  'en2zh',
  'zh2en',
  'en2explain',
  'abbr2full',
  'symbol2name',
  'en2usage',
  'scene2en',
  'cloze',
])
export type CardDirection = z.infer<typeof CardDirectionSchema>

export const SurfaceSchema = z.object({
  type: SurfaceTypeSchema,
  text: z.string().min(1).max(300),
  status: SurfaceStatusSchema.default('preferred'),
  evidence: EvidenceSchema.default('unverified'),
  locator: z.string().max(300).nullish(),
})
export type Surface = z.infer<typeof SurfaceSchema>

/**
 * 中文侧。`name` 可以为 null（找不到公认译法时就该空着），
 * 但 name 与 explain 至少要有一个非空——由数据库 CHECK 兜底。
 */
export const ZhSideSchema = z
  .object({
    name: z.string().min(1).max(200).nullable(),
    name_evidence: EvidenceSchema.default('unverified'),
    explain: z.string().max(2000).default(''),
  })
  .refine((z) => z.name !== null || z.explain.length > 0, {
    message: 'name 与 explain 至少要有一个非空',
  })
export type ZhSide = z.infer<typeof ZhSideSchema>

export const AnnotationSchema = z.object({
  type: AnnotationTypeSchema,
  text: z.string().min(1).max(500),
})
export type Annotation = z.infer<typeof AnnotationSchema>

export const EvidenceRefSchema = z.object({
  grade: EvidenceSchema.default('unverified'),
  type: z.enum(['paper', 'code', 'standard', 'dict', 'community', 'none']).default('none'),
  citation: z.string().max(1000).nullish(),
  locator: z.string().max(300).nullish(),
})
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>

export const TermInputSchema = z.object({
  kind: KindSchema,
  surfaces: z.array(SurfaceSchema).min(1),
  zh: ZhSideSchema,
  annotations: z.array(AnnotationSchema).default([]),
  tags: z.array(z.string().min(1).max(40)).default([]),
  level: LevelSchema.default('domain'),
  importance: z.number().int().min(1).max(5).default(3),
  domain: z.string().max(40).nullish(),
  state: TermStateSchema.default('draft'),
})
export type TermInput = z.infer<typeof TermInputSchema>

export interface CardView {
  id: string
  term_id: string
  direction: CardDirection
  enabled: boolean
}

export interface Term {
  id: string
  slug: string
  kind: Kind
  level: Level
  importance: number
  state: TermState
  domain: string | null
  surfaces: Surface[]
  zh: ZhSide
  annotations: Annotation[]
  tags: string[]
  cards: CardView[]
  created_at: string
  updated_at: string
}

export const DraftInputSchema = z.object({
  kind: KindSchema,
  surfaces: z.array(SurfaceSchema).min(1),
  zh: ZhSideSchema,
  annotations: z.array(AnnotationSchema).default([]),
  tags: z.array(z.string().min(1).max(40)).default([]),
  level: LevelSchema.default('domain'),
  importance: z.number().int().min(1).max(5).default(3),
  domain: z.string().max(40).nullish(),
  evidence: z.array(EvidenceRefSchema).default([]),
  rationale: z.string().max(1000).default(''),
})
export type DraftInput = z.infer<typeof DraftInputSchema>
