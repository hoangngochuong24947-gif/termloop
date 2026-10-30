/**
 * 迁移。
 *
 * 之前是「每次启动 exec 一遍 CREATE TABLE IF NOT EXISTS」——那不算迁移，
 * 那只是一次幂等的建表。真正的迁移需要有版本号：否则改一个字段，
 * 老库会静默保持旧结构，然后在运行时炸。
 */

import type Database from 'better-sqlite3'
import { SCHEMA_SQL } from './schema.ts'

export interface Migration {
  version: number
  name: string
  sql: string
}

/**
 * 只增不改。每加一版就往数组尾部追加，永远不要编辑已发布的版本。
 */
export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'initial', sql: SCHEMA_SQL },
  {
    version: 2,
    name: 'cards: fsrs state fields',
    sql: `
      ALTER TABLE cards ADD COLUMN scheduled_days INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE cards ADD COLUMN learning_steps INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE cards ADD COLUMN state INTEGER NOT NULL DEFAULT 0;
    `,
  },
]

const BOOTSTRAP = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`

export interface MigrateResult {
  from: number
  to: number
  applied: number[]
}

export function migrate(db: Database.Database): MigrateResult {
  db.exec(BOOTSTRAP)

  const readVersion = (): number =>
    (db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as { v: number }).v

  const from = readVersion()
  const applied: number[] = []

  for (const m of MIGRATIONS) {
    if (m.version <= from) continue
    const run = db.transaction(() => {
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        new Date().toISOString(),
      )
    })
    run()
    applied.push(m.version)
  }

  return { from, to: readVersion(), applied }
}

export function schemaVersion(db: Database.Database): number {
  try {
    return (
      db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as { v: number }
    ).v
  } catch {
    return 0
  }
}
