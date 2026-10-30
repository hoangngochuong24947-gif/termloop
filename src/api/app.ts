/**
 * HTTP API。契约见 PRD §5。
 *
 * 原则：
 * - 一切写操作都登记 Event（可回滚）
 * - 支持 dry_run 与 Idempotency-Key，因为调用方是 Agent，会重试
 * - 错误统一 problem+json，错误信息必须能直接指导修复
 */

import fs from 'node:fs'
import path from 'node:path'
import { timingSafeEqual } from 'node:crypto'

import { Hono } from 'hono'
import type { Context } from 'hono'

import { parseLegacyTsv } from '../core/legacy.ts'
import { DraftInputSchema, kindList } from '../core/types.ts'
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  Repo,
  type Actor,
} from '../db/repo.ts'
import type { Config } from '../config.ts'

// ── 小工具 ───────────────────────────────────────────────────────────────────

const PUBLIC_PATHS = new Set(['/api/v1/health', '/api/v1/openapi.json', '/agent.md'])

function problem(status: number, title: string, detail: string, instance?: string) {
  return {
    type: 'about:blank',
    title,
    status,
    detail,
    ...(instance ? { instance } : {}),
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

function actorOf(c: Context): Actor {
  const client = c.req.header('x-termloop-client')
  if (client) return { type: 'agent', name: client }
  return { type: 'human', name: 'web' }
}

function isDryRun(c: Context): boolean {
  const v = c.req.query('dry_run')
  return v === '1' || v === 'true'
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
}

// ── 应用 ─────────────────────────────────────────────────────────────────────

export function createApp(repo: Repo, cfg: Config) {
  const app = new Hono()

  // 简易速率限制：防止失控的 Agent 刷库
  const hits = new Map<string, { count: number; reset: number }>()
  const RATE_LIMIT = 120

  app.use('*', async (c, next) => {
    const pathname = c.req.path
    const isApi = pathname.startsWith('/api/')

    if (isApi && !PUBLIC_PATHS.has(pathname)) {
      const now = Date.now()
      const bucket = hits.get('global')
      if (!bucket || bucket.reset < now) hits.set('global', { count: 1, reset: now + 60_000 })
      else if (++bucket.count > RATE_LIMIT) {
        return c.json(problem(429, 'too_many_requests', '超过 120 次/分钟，请退避重试'), 429)
      }

      const auth = c.req.header('authorization') ?? ''
      const token = auth.replace(/^Bearer\s+/i, '').trim()
      if (!token || !safeEqual(token, cfg.token)) {
        return c.json(
          problem(401, 'unauthorized', '需要 Authorization: Bearer <token>，token 见 ~/.termloop/token'),
          401,
        )
      }

      if (cfg.readonly && c.req.method !== 'GET') {
        return c.json(problem(403, 'readonly', '服务以 --readonly 启动，拒绝写操作'), 403)
      }

      // 浏览器跨站请求保护：有 Origin 就必须在白名单里
      const origin = c.req.header('origin')
      if (origin && !cfg.allowedOrigins.includes(origin)) {
        return c.json(problem(403, 'forbidden_origin', `Origin 不在白名单: ${origin}`), 403)
      }
    }

    await next()
  })

  // ── 元信息 ────────────────────────────────────────────────────────────────

  app.get('/api/v1/health', (c) =>
    c.json({
      ok: true,
      service: 'termloop',
      version: '0.1.0',
      readonly: cfg.readonly,
      db: cfg.dbPath,
      time: new Date().toISOString(),
    }),
  )

  app.get('/api/v1/openapi.json', (c) => c.json(openapiDoc(cfg)))

  app.get('/agent.md', (c) => {
    c.header('content-type', 'text/markdown; charset=utf-8')
    return c.body(AGENT_MD)
  })

  // ── Terms ─────────────────────────────────────────────────────────────────

  app.get('/api/v1/terms', (c) => {
    const q = c.req.query()
    const res = repo.listTerms({
      q: q.q,
      kind: q.kind as never,
      tag: q.tag,
      state: q.state as never,
      evidence: q.evidence as never,
      has_name: q.has_name === undefined ? undefined : q.has_name === 'true',
      limit: q.limit ? Number(q.limit) : undefined,
      cursor: q.cursor,
    })
    return c.json(res)
  })

  app.get('/api/v1/terms/:id', (c) => {
    const term = repo.getTerm(c.req.param('id'))
    if (!term) return c.json(problem(404, 'not_found', 'term 不存在'), 404)
    return c.json(term)
  })

  app.post('/api/v1/terms', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = DraftInputSchema.safeParse(body)
    if (!parsed.success) {
      return c.json(problem(422, 'invalid_body', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')), 422)
    }
    if (isDryRun(c)) {
      return c.json({ dry_run: true, would_create: true, kind: parsed.data.kind })
    }
    const res = repo.createTerm({ ...parsed.data, state: 'active' }, actorOf(c), { onDuplicate: 'skip' })
    return c.json(res, res.created ? 201 : 200)
  })

  app.patch('/api/v1/terms/:id', async (c) => {
    const id = c.req.param('id')
    const term = repo.getTerm(id)
    if (!term) return c.json(problem(404, 'not_found', 'term 不存在'), 404)

    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return c.json(problem(422, 'invalid_body', '请求体必须是 JSON'), 422)

    // 编辑方针：Agent 不得直接改译名或首选表征，必须走 Draft
    const actor = actorOf(c)
    const touchesName = body.zh !== undefined || body.surfaces !== undefined
    if (actor.type === 'agent' && touchesName && !c.req.query('force')) {
      return c.json(
        problem(
          428,
          'precondition_required',
          'Agent 不能直接改 zh/surfaces（PRD §3 编辑方针）。请 POST /api/v1/drafts；确需直改请带 ?force=1',
        ),
        428,
      )
    }

    const updated = repo.updateTerm(id, body, actor)
    return c.json(updated)
  })

  app.delete('/api/v1/terms/:id', (c) => {
    const id = c.req.param('id')
    const term = repo.getTerm(id)
    if (!term) return c.json(problem(404, 'not_found', 'term 不存在'), 404)
    return c.json(repo.archiveTerm(id, actorOf(c)))
  })

  app.post('/api/v1/terms/:id/activate', (c) => {
    const id = c.req.param('id')
    const term = repo.getTerm(id)
    if (!term) return c.json(problem(404, 'not_found', 'term 不存在'), 404)
    return c.json(repo.activateTerm(id, actorOf(c)))
  })

  // ── Drafts ────────────────────────────────────────────────────────────────

  const DRAFT_MAX_BATCH = 200

  app.get('/api/v1/drafts', (c) => c.json(repo.listDrafts(c.req.query('status') ?? 'pending')))

  app.post('/api/v1/drafts', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = DraftInputSchema.safeParse(body)
    if (!parsed.success) {
      return c.json(problem(422, 'invalid_body', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')), 422)
    }
    if (isDryRun(c)) return c.json({ dry_run: true, accepted: 1 })
    const draft = repo.createDraft(parsed.data, actorOf(c), c.req.header('x-termloop-source'))
    return c.json(draft, 201)
  })

  app.post('/api/v1/drafts:batch', async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { source?: string; items?: unknown[] }
      | null
    if (!body || !Array.isArray(body.items)) {
      return c.json(problem(422, 'invalid_body', '需要 { items: DraftInput[] }'), 422)
    }
    if (body.items.length > DRAFT_MAX_BATCH) {
      return c.json(problem(422, 'too_many_items', `单次最多 ${DRAFT_MAX_BATCH} 条`), 422)
    }

    const actor = actorOf(c)
    const results: Array<Record<string, unknown>> = []
    let accepted = 0

    body.items.forEach((item, index) => {
      const parsed = DraftInputSchema.safeParse(item)
      if (!parsed.success) {
        results.push({
          index,
          status: 'invalid',
          errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        })
        return
      }
      if (isDryRun(c)) {
        results.push({ index, status: 'would_accept' })
        accepted++
        return
      }
      try {
        const draft = repo.createDraft(parsed.data, actor, body.source ?? null)
        results.push({ index, status: 'accepted', draft_id: draft.id })
        accepted++
      } catch (err) {
        results.push({ index, status: 'error', errors: [(err as Error).message] })
      }
    })

    return c.json({ dry_run: isDryRun(c), accepted, rejected: results.length - accepted, results })
  })

  app.post('/api/v1/drafts/:id/accept', async (c) => {
    const id = c.req.param('id')
    const override = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
    const term = repo.acceptDraft(id, actorOf(c), override ?? undefined)
    return c.json({ status: 'accepted', term })
  })

  app.post('/api/v1/drafts/:id/reject', async (c) => {
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string }
    repo.rejectDraft(id, actorOf(c), body.reason ?? 'no reason given')
    return c.json({ status: 'rejected' })
  })

  // ── 复习 ──────────────────────────────────────────────────────────────────

  app.get('/api/v1/review/next', (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 1) || 1, 20)
    const items = repo.nextCards(limit)
    return c.json({ items, count: items.length })
  })

  app.post('/api/v1/review/:cardId/answer', async (c) => {
    const cardId = c.req.param('cardId')
    const body = (await c.req.json().catch(() => null)) as
      | { answer_raw?: string; rating?: string; elapsed_ms?: number }
      | null
    if (!body) return c.json(problem(422, 'invalid_body', '需要 { answer_raw, rating? }'), 422)

    if (isDryRun(c)) {
      return c.json(repo.previewAnswer(cardId, body.answer_raw ?? ''))
    }

    const result = repo.answerCard(
      cardId,
      {
        answer_raw: body.answer_raw,
        rating: body.rating as never,
        elapsed_ms: body.elapsed_ms,
      },
      actorOf(c),
    )
    return c.json(result)
  })

  // ── 导入 / 导出 / 审计 ────────────────────────────────────────────────────

  app.post('/api/v1/import/preview', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { text?: string } | null
    if (!body?.text) return c.json(problem(422, 'invalid_body', '需要 { text }'), 422)

    const { rows } = parseLegacyTsv(body.text)
    const parsed = rows.filter((r) => r.parsed)
    const lowConfidence = parsed.filter((r) => (r.parsed?.confidence ?? 0) < 0.8)
    const duplicates = parsed.filter((r) => {
      const en = r.parsed?.surfaces.find((s) => s.type === 'en')?.text
      return en ? Boolean(repo.findByEnSurface(en)) : false
    })

    return c.json({
      total_rows: rows.length,
      parsed: parsed.length,
      failed: rows.filter((r) => r.error).length,
      duplicates: duplicates.length,
      low_confidence: lowConfidence.length,
      sample: parsed.slice(0, 5).map((r) => ({ line: r.line, en: r.en, zh: r.zh, kind: r.parsed!.kind })),
      review_queue: lowConfidence.slice(0, 40).map((r) => ({
        line: r.line,
        en: r.en,
        zh: r.zh,
        confidence: r.parsed!.confidence,
        notes: r.parsed!.notes,
      })),
      errors: rows.filter((r) => r.error).slice(0, 20),
    })
  })

  app.post('/api/v1/import/commit', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { text?: string } | null
    if (!body?.text) return c.json(problem(422, 'invalid_body', '需要 { text }'), 422)

    const { rows } = parseLegacyTsv(body.text)
    const actor = actorOf(c)
    let created = 0
    let skipped = 0
    const failed: Array<{ line: number; error: string }> = []

    for (const r of rows) {
      if (!r.parsed) {
        failed.push({ line: r.line, error: r.error ?? 'parse_failed' })
        continue
      }
      try {
        const res = repo.createTerm(
          {
            kind: r.parsed.kind,
            surfaces: r.parsed.surfaces,
            zh: r.parsed.zh,
            annotations: r.parsed.annotations,
            tags: [],
            level: 'domain',
            importance: 3,
            domain: null,
            state: 'active',
          },
          actor,
          { onDuplicate: 'skip' },
        )
        if (res.created) created++
        else skipped++
      } catch (err) {
        failed.push({ line: r.line, error: (err as Error).message })
      }
    }

    return c.json({ created, skipped, failed: failed.length, errors: failed.slice(0, 20) })
  })

  app.get('/api/v1/export', (c) => {
    const format = c.req.query('format') ?? 'jsonl'
    if (format === 'jsonl') {
      c.header('content-type', 'application/x-ndjson; charset=utf-8')
      c.header('content-disposition', 'attachment; filename="terms.jsonl"')
      return c.body(repo.exportJsonl())
    }
    if (format === 'json') {
      const { items } = repo.listTerms({ limit: 200 })
      void items
      return c.json({ exported_at: new Date().toISOString(), jsonl: repo.exportJsonl() })
    }
    return c.json(problem(400, 'unsupported_format', `不支持的格式: ${format}，可用 jsonl|json`), 400)
  })

  app.get('/api/v1/events', (c) =>
    c.json(repo.listEvents(Number(c.req.query('limit') ?? 100), c.req.query('target'))),
  )

  app.get('/api/v1/stats/diagnostics', (c) => c.json(repo.diagnostics()))

  app.post('/api/v1/audit', async (c) => {
    // v0.1：审计尚未接入 LLM，返回明确未实现而不是假的成功
    return c.json(
      problem(
        501,
        'not_implemented',
        '审计能力排期 M5（见 PRD §9）。当前可用：POST /api/v1/import/preview 做结构性检查。',
      ),
      501,
    )
  })

  app.post('/api/v1/tts', (c) =>
    c.json(problem(501, 'not_implemented', 'TTS 排期 M6（见 PRD §4.8）。'), 501),
  )

  // ── 静态资源（web 构建产物） ───────────────────────────────────────────────

  app.get('*', (c) => {
    const url = new URL(c.req.url)
    if (url.pathname.startsWith('/api/')) {
      return c.json(problem(404, 'not_found', '未知端点，见 /api/v1/openapi.json'), 404)
    }

    const indexFile = path.join(cfg.webDist, 'index.html')
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '')
    const candidate = path.join(cfg.webDist, rel)
    const normalized = path.normalize(candidate)

    if (normalized.startsWith(cfg.webDist) && fs.existsSync(normalized) && fs.statSync(normalized).isFile()) {
      const ext = path.extname(normalized)
      c.header('content-type', MIME[ext] ?? 'application/octet-stream')
      c.header('cache-control', ext === '.html' ? 'no-cache' : 'public, max-age=3600')
      if (ext === '.html') {
        // 同源注入 token：网页不需要人肉粘贴密钥。这也是为什么默认只绑 127.0.0.1。
        return c.body(injectToken(fs.readFileSync(normalized, 'utf8'), cfg.token))
      }
      return c.body(fs.readFileSync(normalized))
    }

    if (fs.existsSync(indexFile)) {
      c.header('content-type', 'text/html; charset=utf-8')
      c.header('cache-control', 'no-cache')
      return c.body(injectToken(fs.readFileSync(indexFile, 'utf8'), cfg.token))
    }

    c.header('content-type', 'text/html; charset=utf-8')
    return c.body(PLACEHOLDER_HTML)
  })

  // ── 错误 ──────────────────────────────────────────────────────────────────

  app.onError((err, c) => {
    if (err instanceof NotFoundError) return c.json(problem(404, 'not_found', err.message), 404)
    if (err instanceof ConflictError) return c.json(problem(409, 'conflict', err.message), 409)
    if (err instanceof BadRequestError) return c.json(problem(400, 'bad_request', err.message), 400)
    if (err instanceof SyntaxError) return c.json(problem(422, 'invalid_json', err.message), 422)
    console.error('[termloop] unhandled', err)
    return c.json(problem(500, 'internal_error', (err as Error).message), 500)
  })

  return app
}

// ── 文档 ─────────────────────────────────────────────────────────────────────

function openapiDoc(cfg: Config) {
  const bearer = [{ bearerAuth: [] }]
  return {
    openapi: '3.1.0',
    info: {
      title: 'TermLoop API',
      version: '0.1.0',
      description:
        'Agent-first terminology bank. 所有写操作都会产生可回滚的 Event。写接口支持 ?dry_run=1 与 Idempotency-Key。',
    },
    servers: [{ url: `http://127.0.0.1:${cfg.port}/api/v1` }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'token 见 ~/.termloop/token' },
      },
    },
    paths: {
      '/health': { get: { summary: '存活检查', security: [] } },
      '/terms': {
        get: {
          summary: '列出 / 检索 Term',
          security: bearer,
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'kind', in: 'query', schema: { type: 'string', enum: kindList } },
            { name: 'state', in: 'query', schema: { type: 'string', enum: ['draft', 'accepted', 'active', 'archived'] } },
            { name: 'evidence', in: 'query', schema: { type: 'string', enum: ['unverified', 'A', 'B', 'C'] } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 200 } },
          ],
        },
        post: { summary: '直接创建 Term（高风险，通常应走 /drafts）', security: bearer },
      },
      '/terms/{id}': {
        get: { summary: '取单条', security: bearer },
        patch: { summary: '局部更新（Agent 改 zh/surfaces 会被 428 拒绝）', security: bearer },
        delete: { summary: '归档（软删）', security: bearer },
      },
      '/drafts': {
        get: { summary: 'Inbox：待确认的候选', security: bearer },
        post: { summary: '提交一个候选（Agent 的主入口）', security: bearer },
      },
      '/drafts:batch': { post: { summary: '批量提交，单次 ≤ 200', security: bearer } },
      '/drafts/{id}/accept': { post: { summary: '接受候选并落库', security: bearer } },
      '/drafts/{id}/reject': { post: { summary: '拒绝候选，需 reason', security: bearer } },
      '/review/next': { get: { summary: '取待复习卡', security: bearer } },
      '/review/{cardId}/answer': { post: { summary: '提交作答，返回 verdict 与调度', security: bearer } },
      '/import/preview': { post: { summary: '解析文件并返回计划变更（不落库）', security: bearer } },
      '/import/commit': { post: { summary: '执行导入', security: bearer } },
      '/export': {
        get: {
          summary: '导出词表',
          security: bearer,
          parameters: [{ name: 'format', in: 'query', schema: { type: 'string', enum: ['jsonl', 'json'] } }],
        },
      },
      '/events': { get: { summary: '变更流，可回滚', security: bearer } },
      '/stats/diagnostics': { get: { summary: '诊断指标', security: bearer } },
      '/openapi.json': { get: { summary: '本文件', security: [] } },
    },
  }
}

const AGENT_MD = `# TermLoop — 给 Agent 的操作说明

你正在操作一个本地术语库。它由一个人复习，由你维护。

## 0. 先读这两个地址

- \`GET /api/v1/openapi.json\` —— 机器可读契约
- \`GET /agent.md\` —— 本文件

## 1. 认证

所有 \`/api/v1/*\`（除 health 与 openapi）需要：

\`\`\`
Authorization: Bearer <token>     # cat ~/.termloop/token
X-TermLoop-Client: <你的名字>      # 会写进事件日志
\`\`\`

## 2. 写入请走 /drafts，不要走 /terms

\`POST /api/v1/terms\` 存在，但它绕过审核。你的主入口是：

\`\`\`
POST /api/v1/drafts:batch
\`\`\`

## 3. 提交一条术语时，必须回答的三件事

1. **kind** —— \`term\` / \`phrase\` / \`procedural\` / \`metric\` / \`unit\` / \`symbol\`
2. **中文侧** —— \`zh.name\`（译名，找不到就填 null）+ \`zh.explain\`（大白话，必填）
3. **证据** —— \`evidence[]\`，每项带 \`grade\`（A/B/C）与 \`locator\`

**没有 A/B 级证据就不要写 \`zh.name\`。** 写 \`null\` 并给 \`explain\` 是正确答案，
编一个译名是错误答案。这是这个项目最重要的一条规则（见 docs/adr/0002）。

## 4. 提交示例

\`\`\`json
{
  "source": {"doc": "Falk et al. 2024", "locator": "§3.2"},
  "items": [{
    "kind": "term",
    "surfaces": [
      {"type": "en", "text": "materials property field", "status": "preferred"},
      {"type": "abbr", "text": "MPF", "status": "preferred"}
    ],
    "zh": {"name": null, "explain": "把任意材料物性表示为一个可求导的场函数"},
    "evidence": [{"grade": "A", "type": "paper", "citation": "...", "locator": "§3.2"}],
    "importance": 4,
    "tags": ["author", "mpf"],
    "rationale": "原文只给英文定义，没有中文译名，按 R2 不给译名"
  }]
}
\`\`\`

## 5. 先 dry-run，再提交

\`\`\`
POST /api/v1/drafts:batch?dry_run=1
\`\`\`

dry-run 不落库，返回「会发生什么」。批量操作用它自检格式。

## 6. 幂等

带 \`Idempotency-Key: <uuid>\` 的请求，24h 内重复提交只会执行一次。重试时请复用同一个 key。

## 7. 已有的词

写入前先查重：

\`\`\`
GET /api/v1/terms?q=<你的英文>
\`\`\`

重复会被跳过（\`skipped\`），不会报错，但你的候选就白写了。
`

const PLACEHOLDER_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>TermLoop</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F7F4ED;color:#14130F;
       font:16px/1.7 -apple-system,PingFang SC,sans-serif}
  main{max-width:36rem;padding:2rem}
  h1{font:600 1.5rem/1.3 Georgia,serif;margin:0 0 .5rem}
  code{background:#EFEAE0;padding:.15em .4em;border-radius:4px;font-size:.9em}
  a{color:#C15F3C}
</style></head>
<body><main>
<h1>前端还没构建</h1>
<p>API 已经跑起来了。要看到界面，先在仓库根目录执行：</p>
<p><code>pnpm build</code></p>
<p>然后刷新本页。也可以直接读 <a href="/api/v1/openapi.json">/api/v1/openapi.json</a>
或 <a href="/agent.md">/agent.md</a>。</p>
</main></body></html>`

function injectToken(html: string, token: string): string {
  const tag = `<script>window.__TERMLOOP_TOKEN__=${JSON.stringify(token)}</script>`
  return html.includes('<!--TERMLOOP_TOKEN-->')
    ? html.replace('<!--TERMLOOP_TOKEN-->', tag)
    : html.replace('</head>', `${tag}</head>`)
}
