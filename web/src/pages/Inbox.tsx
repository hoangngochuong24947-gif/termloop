import { useCallback, useEffect, useState } from 'react'
import { api, type Draft } from '../api.ts'

export default function Inbox() {
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const r = await api<{ items: Draft[]; total: number }>('/drafts')
      setDrafts(r.items)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function decide(id: string, action: 'accept' | 'reject') {
    setBusy(id)
    try {
      await api(`/drafts/${id}/${action}`, {
        method: 'POST',
        body: JSON.stringify(action === 'reject' ? { reason: 'rejected in UI' } : {}),
      })
      setDrafts((d) => d.filter((x) => x.id !== id))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <h1>Inbox</h1>
      <p className="sub">
        Agent 提交的候选。你只做判断题：接受、拒绝，或者先放着。
      </p>

      {error && <div className="error">{error}</div>}

      {drafts.length === 0 && (
        <div className="empty">
          <h2>没有待确认的候选</h2>
          <p>
            Agent 通过 <code>POST /api/v1/drafts:batch</code> 提交的东西会出现在这里。
          </p>
        </div>
      )}

      {drafts.map((d) => {
        const p = d.payload as {
          kind?: string
          surfaces?: Array<{ type: string; text: string }>
          zh?: { name: string | null; explain: string }
          tags?: string[]
          rationale?: string
        }
        const en = p.surfaces?.find((s) => s.type === 'en')?.text ?? '(缺英文)'
        const abbr = p.surfaces?.find((s) => s.type === 'abbr')?.text

        return (
          <div className="detail" key={d.id} style={{ marginTop: '1rem' }}>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '0.25rem' }}>{en}</h3>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              <span className="chip">{p.kind}</span>
              {abbr && <span className="chip">{abbr}</span>}
              {(p.tags ?? []).map((t) => (
                <span className="chip" key={t}>
                  {t}
                </span>
              ))}
              <span className="chip">{d.actor_name ?? d.actor_type}</span>
            </div>

            <div style={{ marginBottom: '0.75rem' }}>
              {p.zh?.name ? (
                <b>{p.zh.name}</b>
              ) : (
                <span style={{ color: 'var(--warn)' }}>无译名 —— 按政策，这是允许的</span>
              )}
              <div style={{ color: 'var(--muted)', fontSize: '0.88rem' }}>{p.zh?.explain}</div>
            </div>

            {p.rationale && (
              <div
                style={{
                  borderLeft: '2px solid var(--accent)',
                  paddingLeft: '0.75rem',
                  color: 'var(--muted)',
                  fontSize: '0.85rem',
                  marginBottom: '1rem',
                }}
              >
                {p.rationale}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn primary"
                disabled={busy === d.id}
                onClick={() => void decide(d.id, 'accept')}
              >
                接受
              </button>
              <button className="btn" disabled={busy === d.id} onClick={() => void decide(d.id, 'reject')}>
                拒绝
              </button>
            </div>
          </div>
        )
      })}
    </>
  )
}
