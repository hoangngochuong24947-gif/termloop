import { useEffect, useState } from 'react'
import { api, type Diagnostics as Diag } from '../api.ts'

function pct(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(0)}%`
}

export default function Diagnostics() {
  const [d, setD] = useState<Diag | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<Diag>('/stats/diagnostics')
      .then(setD)
      .catch((e) => setError((e as Error).message))
  }, [])

  if (error) return <div className="error">{error}</div>
  if (!d) return <div className="empty">载入中…</div>

  return (
    <>
      <h1>诊断</h1>
      <p className="sub">数字少而准，优先看第三行——那是你欠的技术债。</p>

      <div className="grid">
        <div className="metric">
          <b>{d.totals.terms}</b>
          <span>条术语</span>
        </div>
        <div className="metric">
          <b>{d.totals.due_today}</b>
          <span>今日到期</span>
        </div>
        <div className="metric">
          <b>{d.totals.reviews}</b>
          <span>累计作答</span>
        </div>
        <div className="metric">
          <b>{pct(d.recall.again_rate)}</b>
          <span>遗忘率（again）</span>
        </div>
      </div>

      <div className="grid">
        <div className="metric">
          <b style={{ color: d.evidence_gap.ratio > 0.5 ? 'var(--warn)' : undefined }}>
            {pct(d.evidence_gap.ratio)}
          </b>
          <span>证据未核查占比</span>
        </div>
        <div className="metric">
          <b>{d.evidence_gap.no_name_terms}</b>
          <span>无译名条目</span>
        </div>
        <div className="metric">
          <b>{d.totals.active}</b>
          <span>启用复习</span>
        </div>
      </div>

      <h3 style={{ fontFamily: 'var(--serif)', fontWeight: 500, marginTop: '2rem' }}>按类型分布</h3>
      <table>
        <thead>
          <tr>
            <th>kind</th>
            <th>条数</th>
          </tr>
        </thead>
        <tbody>
          {d.by_kind.map((k) => (
            <tr key={k.kind}>
              <td>{k.kind}</td>
              <td>{k.c}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ fontFamily: 'var(--serif)', fontWeight: 500, marginTop: '2rem' }}>维度遗忘率</h3>
      {d.dimension_lapse.length === 0 ? (
        <p className="sub">样本还不够（每个维度至少 3 次作答才会出现）。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>tag</th>
              <th>作答</th>
              <th>again</th>
              <th>遗忘率</th>
            </tr>
          </thead>
          <tbody>
            {d.dimension_lapse.map((r) => (
              <tr key={r.tag}>
                <td>{r.tag}</td>
                <td>{r.total}</td>
                <td>{r.again}</td>
                <td style={{ color: r.again_rate > 0.3 ? 'var(--bad)' : undefined }}>
                  {pct(r.again_rate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
