import { useEffect, useState } from 'react'
import { Math } from '../Math.tsx'
import { useApi } from '../useApi.ts'
import type { Term } from '../api.ts'

const KINDS = ['', 'term', 'phrase', 'procedural', 'metric', 'unit', 'symbol']

function EvidenceChip({ value }: { value: string }) {
  if (value === 'A' || value === 'B') return <span className="chip ok">证据 {value}</span>
  if (value === 'C') return <span className="chip bad">无权威来源</span>
  return <span className="chip warn">未核查</span>
}

export default function Terms() {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [kind, setKind] = useState('')
  const [selected, setSelected] = useState<Term | null>(null)

  // 打字不直接打接口：250ms 防抖
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])

  const params = new URLSearchParams({ limit: '80' })
  if (debounced) params.set('q', debounced)
  if (kind) params.set('kind', kind)

  const { data, error, loading } = useApi<{ items: Term[]; total: number }>(`/terms?${params}`)
  const items = data?.items ?? []
  const total = data?.total ?? 0

  return (
    <>
      <h1>词表</h1>
      <p className="sub">
        {total} 条术语 · 点开看全部字段
        {loading ? ' · 检索中…' : ''}
      </p>

      <div className="toolbar">
        <input value={q} placeholder="搜索英文 / 中文 / 解释…" onChange={(e) => setQ(e.target.value)} />
        <select className="btn" value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k || '全部类型'}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="list">
        {items.map((t) => {
          const en = t.surfaces.find((s) => s.type === 'en')?.text ?? t.slug
          const zh = t.zh.name ?? `（无译名）${t.zh.explain.slice(0, 24)}`
          return (
            <div className="row" key={t.id} onClick={() => setSelected(t)}>
              <span className="kind">{t.kind}</span>
              <div style={{ minWidth: 0 }}>
                <div className="en">{en}</div>
                <div className="zh">{zh}</div>
              </div>
              <span className="chip">{t.cards.filter((c) => c.enabled).length} 卡</span>
            </div>
          )
        })}
        {!loading && items.length === 0 && <div className="empty">没有匹配的术语</div>}
      </div>

      {selected && (
        <div className="detail">
          <h3>{selected.surfaces.find((s) => s.type === 'en')?.text ?? selected.slug}</h3>

          <dl style={{ margin: 0 }}>
            <div className="kv">
              <dt>中文侧</dt>
              <dd>
                {selected.zh.name ? (
                  <b>{selected.zh.name}</b>
                ) : (
                  <span style={{ color: 'var(--muted)' }}>无译名（按政策不自造）</span>
                )}
                <div style={{ color: 'var(--muted)', marginTop: 4 }}>
                  {selected.zh.explain || '—'}
                </div>
              </dd>
            </div>

            <div className="kv">
              <dt>表征</dt>
              <dd>
                {selected.surfaces.map((s) => (
                  <div key={`${s.type}-${s.text}`} style={{ marginBottom: 2 }}>
                    <span className="chip" style={{ marginRight: 6 }}>
                      {s.type}
                    </span>
                    <Math tex={s.text} />
                    {s.status !== 'preferred' && (
                      <span style={{ color: 'var(--muted)', marginLeft: 6 }}>({s.status})</span>
                    )}
                  </div>
                ))}
              </dd>
            </div>

            <div className="kv">
              <dt>证据</dt>
              <dd style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <EvidenceChip value={selected.zh.name_evidence} />
                {selected.surfaces
                  .filter((s) => s.type === 'en')
                  .map((s) => (
                    <EvidenceChip key={s.text} value={s.evidence} />
                  ))}
              </dd>
            </div>

            <div className="kv">
              <dt>注解</dt>
              <dd>
                {selected.annotations.length === 0
                  ? '—'
                  : selected.annotations.map((a) => (
                      <div key={a.text}>
                        <span className="chip" style={{ marginRight: 6 }}>
                          {a.type}
                        </span>
                        {a.text}
                      </div>
                    ))}
              </dd>
            </div>

            <div className="kv">
              <dt>卡片</dt>
              <dd>
                {selected.cards.length === 0
                  ? '—'
                  : selected.cards.map((c) => (
                      <span
                        key={c.id}
                        className={`chip ${c.enabled ? 'ok' : ''}`}
                        style={{ marginRight: 6 }}
                      >
                        {c.direction}
                      </span>
                    ))}
              </dd>
            </div>

            <div className="kv">
              <dt>标签 / 状态</dt>
              <dd>
                {selected.tags.map((t) => (
                  <span className="chip" key={t} style={{ marginRight: 6 }}>
                    {t}
                  </span>
                ))}
                <span className="chip">{selected.state}</span>
              </dd>
            </div>
          </dl>

          <button className="btn ghost" style={{ marginTop: '1rem' }} onClick={() => setSelected(null)}>
            关闭
          </button>
        </div>
      )}
    </>
  )
}
