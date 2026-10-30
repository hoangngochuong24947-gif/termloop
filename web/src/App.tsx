import { useEffect, useState } from 'react'
import { api, getToken, setToken } from './api.ts'
import Review from './pages/Review.tsx'
import Terms from './pages/Terms.tsx'
import Inbox from './pages/Inbox.tsx'
import Diagnostics from './pages/Diagnostics.tsx'

type Tab = 'review' | 'terms' | 'inbox' | 'diagnostics'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'review', label: '复习' },
  { id: 'terms', label: '词表' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'diagnostics', label: '诊断' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('review')
  const [token, setTok] = useState(getToken())
  const [counts, setCounts] = useState<{ pending: number; due: number } | null>(null)

  useEffect(() => {
    if (!token) return
    api<{ totals: { terms: number; due_today: number } }>('/stats/diagnostics')
      .then((d) => setCounts((c) => ({ pending: c?.pending ?? 0, due: d.totals.due_today })))
      .catch(() => {})
    api<{ items: unknown[]; total: number }>('/drafts')
      .then((d) => setCounts((c) => ({ pending: d.total, due: c?.due ?? 0 })))
      .catch(() => {})
  }, [token, tab])

  if (!token) {
    return (
      <div className="gate">
        <h1>连接 TermLoop</h1>
        <p className="sub">
          从服务端读取 token：<code>cat ~/.termloop/token</code>
        </p>
        <input
          defaultValue=""
          placeholder="粘贴 token"
          onChange={(e) => setTok(e.target.value.trim())}
        />
        <button
          className="btn primary"
          onClick={() => {
            if (token) setToken(token)
            window.location.reload()
          }}
        >
          连接
        </button>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <b>TermLoop</b>
          <span>术语背记</span>
        </div>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} data-active={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === 'inbox' && counts?.pending ? (
                <span className="chip accent" style={{ marginLeft: 6 }}>
                  {counts.pending}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <div className="stat">{counts ? `今日待复习 ${counts.due}` : ''}</div>
      </header>

      <main className={tab === 'terms' ? 'wide' : ''}>
        {tab === 'review' && <Review />}
        {tab === 'terms' && <Terms />}
        {tab === 'inbox' && <Inbox />}
        {tab === 'diagnostics' && <Diagnostics />}
      </main>
    </div>
  )
}
