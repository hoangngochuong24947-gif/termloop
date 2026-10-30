import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { MIGRATIONS, migrate, schemaVersion } from '../src/db/migrate.ts'
import { SCHEMA_SQL } from '../src/db/schema.ts'
import { Repo } from '../src/db/repo.ts'

describe('迁移', () => {
  it('全新库：建表并记录版本', () => {
    const db = new Database(':memory:')
    const r = migrate(db)
    expect(r.from).toBe(0)
    expect(r.to).toBe(MIGRATIONS.length)
    expect(schemaVersion(db)).toBe(MIGRATIONS.length)

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['terms', 'surfaces', 'zh_sides', 'cards', 'reviews', 'drafts', 'events', 'schema_migrations']),
    )
  })

  it('重复执行不重复应用', () => {
    const db = new Database(':memory:')
    migrate(db)
    expect(migrate(db).applied).toEqual([])
  })

  it('升级一个「只有 v1 表结构、没有版本记录」的旧库，数据不丢', () => {
    const db = new Database(':memory:')
    // 精确模拟 v0.1 的状态：schema 是 v1，但没有 schema_migrations 表
    db.exec(SCHEMA_SQL)
    db.prepare(
      `INSERT INTO terms (id, slug, kind, level, importance, state, domain, created_at, updated_at)
       VALUES ('t1','phonon','term','domain',3,'active',NULL,'2026-01-01','2026-01-01')`,
    ).run()

    const r = migrate(db)
    expect(r.from).toBe(0)
    expect(r.applied).toEqual(MIGRATIONS.map((m) => m.version))
    expect((db.prepare('SELECT COUNT(*) c FROM terms').get() as { c: number }).c).toBe(1)

    // v2 的列确实加上了
    const cols = (db.prepare('PRAGMA table_info(cards)').all() as Array<{ name: string }>).map((c) => c.name)
    expect(cols).toEqual(expect.arrayContaining(['scheduled_days', 'learning_steps', 'state']))
  })

  it('Repo 启动即迁移，且 health 能读到版本', () => {
    const repo = new Repo(':memory:')
    expect(schemaVersion(repo.db)).toBe(MIGRATIONS.length)
    repo.close()
  })

  it('版本号只增不改——不允许出现重复版本', () => {
    const versions = MIGRATIONS.map((m) => m.version)
    expect(new Set(versions).size).toBe(versions.length)
    expect([...versions].sort((a, b) => a - b)).toEqual(versions)
  })
})

describe('中文侧不变量由数据库兜底', () => {
  it('name 与 explain 同时为空会被 CHECK 拒绝', () => {
    const repo = new Repo(':memory:')
    repo.db
      .prepare(
        `INSERT INTO terms (id, slug, kind, level, importance, state, domain, created_at, updated_at)
         VALUES ('t1','x','term','domain',3,'active',NULL,'2026-01-01','2026-01-01')`,
      )
      .run()

    expect(() =>
      repo.db
        .prepare('INSERT INTO zh_sides (term_id, name, name_evidence, explain) VALUES (?,?,?,?)')
        .run('t1', null, 'unverified', ''),
    ).toThrow()

    // 只有 name 也行
    expect(() =>
      repo.db
        .prepare('INSERT INTO zh_sides (term_id, name, name_evidence, explain) VALUES (?,?,?,?)')
        .run('t1', '声子', 'B', ''),
    ).not.toThrow()

    repo.close()
  })
})
