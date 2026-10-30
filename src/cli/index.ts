#!/usr/bin/env node
/**
 * termloop CLI。
 *
 * 和 HTTP 走同一套 service 层——CLI 不是第二套实现，只是另一个客户端。
 */

import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { serve } from '@hono/node-server'

import { createApp } from '../api/app.ts'
import { resolveConfig, tokenFile } from '../config.ts'
import { parseLegacyTsv } from '../core/legacy.ts'
import { Repo } from '../db/repo.ts'

// ── argv ─────────────────────────────────────────────────────────────────────

const OPTIONS = {
  port: { type: 'string' },
  host: { type: 'string' },
  db: { type: 'string' },
  token: { type: 'string' },
  dir: { type: 'string' },
  out: { type: 'string' },
  limit: { type: 'string' },
  q: { type: 'string' },
  kind: { type: 'string' },
  state: { type: 'string' },
  readonly: { type: 'boolean' },
  yes: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const

interface Args {
  command: string
  positional: string[]
  flags: Record<string, string | boolean>
}

function parseCli(argv: string[]): Args {
  let values: Record<string, string | boolean | undefined>
  let positionals: string[]
  try {
    const parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
    values = parsed.values
    positionals = parsed.positionals
  } catch (err) {
    console.error(`\n  参数错误：${(err as Error).message}\n  用 termloop help 看用法\n`)
    process.exit(1)
  }

  const flags: Record<string, string | boolean> = {}
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined) flags[k] = v
  }

  return { command: positionals.shift() ?? 'help', positional: positionals, flags }
}

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  accent: (s: string) => `\x1b[38;5;173m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
}

// ── 命令 ─────────────────────────────────────────────────────────────────────

async function cmdServe(args: Args): Promise<void> {
  const cfg = resolveConfig(args.flags as Record<string, string | boolean>)
  const repo = new Repo(cfg.dbPath)
  const app = createApp(repo, cfg)

  serve({ fetch: app.fetch, port: cfg.port, hostname: cfg.host }, (info) => {
    const terms = (repo.db.prepare('SELECT COUNT(*) c FROM terms').get() as { c: number }).c
    console.log('')
    console.log(`  ${C.accent('TermLoop')} ${C.dim('v0.1.0')}`)
    console.log('')
    console.log(`  ${C.dim('web   ')} http://${cfg.host}:${info.port}`)
    console.log(`  ${C.dim('api   ')} http://${cfg.host}:${info.port}/api/v1`)
    console.log(`  ${C.dim('spec  ')} http://${cfg.host}:${info.port}/api/v1/openapi.json`)
    console.log(`  ${C.dim('agent ')} http://${cfg.host}:${info.port}/agent.md`)
    console.log(`  ${C.dim('db    ')} ${cfg.dbPath}`)
    console.log(`  ${C.dim('token ')} ${tokenFile()}`)
    console.log(`  ${C.dim('terms ')} ${terms}`)
    if (cfg.readonly) console.log(`  ${C.yellow('readonly')} 写操作被拒绝`)
    if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') {
      console.log('')
      console.log(`  ${C.red('⚠ 服务绑定在非回环地址。')} 任何能访问该端口的人都能读你的词表。`)
      console.log(`  ${C.dim('   手机使用请优先走 Tailscale 或 SSH 隧道，而不是直接暴露端口。')}`)
    }
    console.log('')
  })

  process.on('SIGINT', () => {
    repo.close()
    process.exit(0)
  })
}

function cmdImport(args: Args): void {
  const file = args.positional[0]
  if (!file) {
    console.error('用法: termloop import <file.tsv|csv> [--db path] [--yes]')
    process.exit(1)
  }

  const cfg = resolveConfig(args.flags as Record<string, string | boolean>)
  const text = fs.readFileSync(path.resolve(file), 'utf8')
  const { rows } = parseLegacyTsv(text)

  const ok = rows.filter((r) => r.parsed)
  const low = ok.filter((r) => (r.parsed?.confidence ?? 0) < 0.8)
  const bad = rows.filter((r) => r.error)

  const byKind: Record<string, number> = {}
  for (const r of ok) byKind[r.parsed!.kind] = (byKind[r.parsed!.kind] ?? 0) + 1

  console.log('')
  console.log(`  ${C.bold('导入预览')}  ${C.dim(path.basename(file))}`)
  console.log(`  ${C.dim('─'.repeat(46))}`)
  console.log(`  总行数      ${rows.length}`)
  console.log(`  可解析      ${C.green(String(ok.length))}`)
  console.log(`  解析失败    ${bad.length ? C.red(String(bad.length)) : '0'}`)
  console.log(`  低置信度    ${low.length ? C.yellow(String(low.length)) : '0'} ${C.dim('(< 0.8，建议人工过一遍)')}`)
  console.log(
    `  类型分布    ${Object.entries(byKind)
      .map(([k, v]) => `${k}:${v}`)
      .join('  ')}`,
  )

  if (low.length) {
    console.log('')
    console.log(`  ${C.yellow('低置信度条目')}`)
    for (const r of low.slice(0, 15)) {
      console.log(`    ${C.dim(`L${r.line}`)} ${r.en}  ${C.dim('|')}  ${r.zh}  ${C.dim(`(${r.parsed!.confidence})`)}`)
      for (const n of r.parsed!.notes) console.log(`      ${C.dim('·')} ${n}`)
    }
    if (low.length > 15) console.log(`    ${C.dim(`… 还有 ${low.length - 15} 条`)}`)
  }

  if (bad.length) {
    console.log('')
    console.log(`  ${C.red('解析失败')}`)
    for (const r of bad.slice(0, 10)) console.log(`    ${C.dim(`L${r.line}`)} ${r.error}`)
  }

  if (!args.flags.yes) {
    console.log('')
    console.log(`  ${C.dim('这是预览，未写入任何数据。加 --yes 执行导入。')}`)
    console.log('')
    return
  }

  const repo = new Repo(cfg.dbPath)
  let created = 0
  let skipped = 0
  const failed: string[] = []

  for (const r of ok) {
    try {
      const res = repo.createTerm(
        {
          kind: r.parsed!.kind,
          surfaces: r.parsed!.surfaces,
          zh: r.parsed!.zh,
          annotations: r.parsed!.annotations,
          tags: [],
          level: 'domain',
          importance: 3,
          domain: null,
          state: 'active',
        },
        { type: 'system', name: 'cli-import' },
        { onDuplicate: 'skip' },
      )
      if (res.created) created++
      else skipped++
    } catch (err) {
      failed.push(`L${r.line}: ${(err as Error).message}`)
    }
  }

  const snap = repo.snapshot(path.join(path.dirname(cfg.dbPath), '..', 'termbank'))
  repo.close()

  console.log('')
  console.log(`  ${C.green('已导入')}   新建 ${created}  跳过 ${skipped}  失败 ${failed.length}`)
  console.log(`  ${C.dim('快照')}     ${snap.path} ${C.dim(`(${snap.count} terms)`)}`)
  for (const f of failed.slice(0, 10)) console.log(`  ${C.red('✗')} ${f}`)
  console.log('')
}

function cmdExport(args: Args): void {
  const cfg = resolveConfig(args.flags as Record<string, string | boolean>)
  const repo = new Repo(cfg.dbPath)
  const jsonl = repo.exportJsonl()
  const out = args.flags.out as string | undefined
  if (out) {
    fs.writeFileSync(path.resolve(out), jsonl, 'utf8')
    console.log(`已导出 → ${path.resolve(out)}`)
  } else {
    process.stdout.write(jsonl)
  }
  repo.close()
}

function cmdSnapshot(args: Args): void {
  const cfg = resolveConfig(args.flags as Record<string, string | boolean>)
  const repo = new Repo(cfg.dbPath)
  const dir = (args.flags.dir as string) ?? path.join(process.cwd(), 'termbank')
  const res = repo.snapshot(path.resolve(dir))
  console.log(`快照 → ${res.path} (${res.count} terms)`)
  repo.close()
}

function cmdTerms(args: Args): void {
  const cfg = resolveConfig(args.flags as Record<string, string | boolean>)
  const repo = new Repo(cfg.dbPath)
  const { items, total } = repo.listTerms({
    limit: Number(args.flags.limit ?? 30),
    kind: args.flags.kind as never,
    state: args.flags.state as never,
    q: args.flags.q as string | undefined,
  })

  for (const t of items) {
    const en = t.surfaces.find((s) => s.type === 'en')?.text ?? t.slug
    const zh = t.zh.name ?? `…${t.zh.explain.slice(0, 18)}`
    const flag = t.zh.name === null ? C.yellow('∅') : t.zh.name_evidence === 'unverified' ? C.dim('·') : C.green('✓')
    console.log(`  ${flag} ${C.dim(t.kind.padEnd(10))} ${en.padEnd(34)} ${zh}`)
  }
  console.log(`\n  ${C.dim(`${items.length} / ${total} terms`)}\n`)
  repo.close()
}

function cmdToken(): void {
  console.log(fs.readFileSync(tokenFile(), 'utf8').trim())
}

function cmdHelp(): void {
  console.log(`
  ${C.accent('TermLoop')} ${C.dim('v0.1.0 — 术语背记，Agent 优先')}

  ${C.bold('用法')}
    termloop <command> [options]

  ${C.bold('命令')}
    serve                启动本地服务（API + 前端）
    import <file>        解析存量词表（默认只预览，--yes 执行）
    export               导出 JSONL
    snapshot             写 termbank 快照
    terms                列出术语
    token                打印 API token

  ${C.bold('常用选项')}
    --port 7788          API 端口
    --host 127.0.0.1     绑定地址（默认仅回环）
    --db ./data/termloop.db
    --readonly           只读模式
    --yes                真正执行写入（import）
`)
}

// ── 入口 ─────────────────────────────────────────────────────────────────────

const args = parseCli(process.argv.slice(2))

switch (args.command) {
  case 'serve':
    await cmdServe(args)
    break
  case 'import':
    cmdImport(args)
    break
  case 'export':
    cmdExport(args)
    break
  case 'snapshot':
    cmdSnapshot(args)
    break
  case 'terms':
    cmdTerms(args)
    break
  case 'token':
    cmdToken()
    break
  default:
    cmdHelp()
}
