import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const PKG_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
export const HOME_DIR = path.join(os.homedir(), '.termloop')

export interface Config {
  dbPath: string
  host: string
  port: number
  token: string
  webDist: string
  readonly: boolean
  allowedOrigins: string[]
}

export function tokenFile(): string {
  return path.join(HOME_DIR, 'token')
}

/**
 * 读取或生成 API token。
 *
 * 本机端口不是「只有我能访问」——任何网页都能 fetch 到 127.0.0.1，
 * 所以即使只绑回环地址也必须鉴权。见 PRD §5.4。
 */
export function loadOrCreateToken(): string {
  fs.mkdirSync(HOME_DIR, { recursive: true, mode: 0o700 })
  const file = tokenFile()
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8').trim()
    if (existing) return existing
  }
  const token = randomBytes(32).toString('hex')
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 })
  return token
}

export function resolveConfig(argv: Record<string, string | boolean>): Config {
  const port = Number(argv.port ?? process.env.TERMLOOP_PORT ?? 7788)
  const host = String(argv.host ?? process.env.TERMLOOP_HOST ?? '127.0.0.1')
  const dbPath = path.resolve(
    String(argv.db ?? process.env.TERMLOOP_DB ?? path.join(PKG_ROOT, 'data', 'termloop.db')),
  )

  return {
    dbPath,
    host,
    port,
    token: String(argv.token ?? process.env.TERMLOOP_TOKEN ?? loadOrCreateToken()),
    webDist: path.join(PKG_ROOT, 'web', 'dist'),
    readonly: Boolean(argv.readonly),
    allowedOrigins: [
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      `http://127.0.0.1:5173`,
      `http://localhost:5173`,
    ],
  }
}
