import { useEffect, useState } from 'react'
import { getToken, setToken } from './api.ts'
import { useApi } from './useApi.ts'
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

  const diag = useApi<{ totals: { terms: number; due_today: number } }>(
    token ? '/stats/diagnostics' : null,
  )
  const drafts = useApi<{ items: unknown[]; total: number }>(token ? '/drafts' : null)

  const pending = drafts.data?.total ?? 0
  const due = diag.data?.totals.due_today ?? 0

  // 换页时刷新顶部角标
  useEffect(() => {
    if (!token) return
    diag.reload()
    drafts.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, token])

  if (!token) {
    return (
      <div className="gate">
        <h1>连接 TermLoop</h1>
        <p className="sub">
          从服务端读取 token：<code>cat ~/.termloop/token</code>
        </p>
        <input defaultValue="" placeholder="粘贴 token" onChange={(e) => setTok(e.target.value.trim())} />
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
              {t.id === 'inbox' && pending > 0 ? (
                <span className="chip accent" style={{ marginLeft: 6 }}>
                  {pending}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <div className="stat">{due > 0 ? `今日待复习 ${due}` : ''}</div>
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
