import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Preview, type QueueItem, type Term } from '../api.ts'

const RATINGS = [
  { key: '1', rating: 'again', label: '忘了', hint: 'Again' },
  { key: '2', rating: 'hard', label: '难', hint: 'Hard' },
  { key: '3', rating: 'good', label: '记得', hint: 'Good' },
  { key: '4', rating: 'easy', label: '太简单', hint: 'Easy' },
] as const

const KEYMAP: Record<string, string> = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' }

export default function Review() {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [idx, setIdx] = useState(0)
  const [answer, setAnswer] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [revealed, setRevealed] = useState<Term | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reviewed, setReviewed] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const card = queue[idx] ?? null

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await api<{ items: QueueItem[] }>('/review/next?limit=10')
      setQueue(r.items)
      setIdx(0)
      setAnswer('')
      setPreview(null)
      setRevealed(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    inputRef.current?.focus()
  }, [idx, loading])

  const reveal = useCallback(async () => {
    if (!card) return
    try {
      const [p, term] = await Promise.all([
        api<Preview>(`/review/${card.card_id}/answer?dry_run=1`, {
          method: 'POST',
          body: JSON.stringify({ answer_raw: answer }),
        }),
        api<Term>(`/terms/${card.term_id}`),
      ])
      setPreview(p)
      setRevealed(term)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [card, answer])

  const rate = useCallback(
    async (rating: string) => {
      if (!card || !preview) return
      try {
        await api(`/review/${card.card_id}/answer`, {
          method: 'POST',
          body: JSON.stringify({ answer_raw: answer, rating }),
        })
        setReviewed((n) => n + 1)
        if (idx + 1 < queue.length) {
          setIdx(idx + 1)
          setAnswer('')
          setPreview(null)
          setRevealed(null)
        } else {
          await load()
        }
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [card, preview, answer, idx, queue.length, load],
  )

  const latest = useRef({ reveal, rate, preview })
  latest.current = { reveal, rate, preview }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')

      if (typing) {
        if (e.key === 'Enter' && !latest.current.preview) {
          e.preventDefault()
          void latest.current.reveal()
        }
        return
      }

      if (!latest.current.preview && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        void latest.current.reveal()
        return
      }

      const r = KEYMAP[e.key]
      if (r && latest.current.preview) {
        e.preventDefault()
        void latest.current.rate(r)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (loading) return <div className="empty">载入中…</div>
  if (error) return <div className="error">{error}</div>

  if (!card) {
    return (
      <div className="empty">
        <h2>今天清完了</h2>
        <p>
          {reviewed > 0 ? `刚复习了 ${reviewed} 张卡。` : '没有到期的卡片。'}
          <br />
          去 <b>词表</b> 里补充术语，或者明天再来。
        </p>
        <button className="btn" style={{ marginTop: '1rem' }} onClick={() => void load()}>
          重新载入
        </button>
      </div>
    )
  }

  const name = revealed?.zh.name ?? null
  const explain = revealed?.zh.explain ?? ''
  const provenance = revealed?.annotations.find((a) => a.type === 'provenance')?.text

  return (
    <div className="review">
      <div>
        <div className="review-progress">
          <span>
            {idx + 1} / {queue.length}
            {reviewed > 0 ? ` · 已完成 ${reviewed}` : ''}
          </span>
          <span>{card.term_kind}</span>
        </div>
        <div className="bar">
          <i style={{ width: `${((idx + (preview ? 1 : 0)) / queue.length) * 100}%` }} />
        </div>
      </div>

      <div>
        <div className="prompt">{card.prompt}</div>
        <div className="ctx">
          {card.context.map((c) => (
            <span className="chip" key={c}>
              {c}
            </span>
          ))}
        </div>
      </div>

      <div className="answerbox">
        <input
          ref={inputRef}
          value={answer}
          placeholder="你的答案…"
          disabled={!!preview}
          onChange={(e) => setAnswer(e.target.value)}
        />
      </div>

      {!preview && (
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button className="btn primary" onClick={() => void reveal()}>
            显示答案
          </button>
          <span className="hints" style={{ alignSelf: 'center' }}>
            <span>
              <span className="kbd">↵</span> 提交
            </span>
            <span>
              <span className="kbd">space</span> 显示答案
            </span>
          </span>
        </div>
      )}

      {preview && (
        <>
          <div className="reveal">
            {name ? <div className="name">{name}</div> : <div className="name">（无公认译名）</div>}
            {explain && <div className="explain">{explain}</div>}
            {provenance && <div className="explain">出处：{provenance}</div>}

            <div className="verdict">
              {preview.verdict === 'correct' && <span className="chip ok">✓ 判对</span>}
              {preview.verdict === 'partial' && <span className="chip warn">△ 部分对</span>}
              {preview.verdict === 'wrong' && <span className="chip bad">✗ 判错</span>}
              {preview.verdict === null && <span className="chip">自评</span>}
              {preview.matched.length > 0 && (
                <span style={{ color: 'var(--muted)' }}>命中：{preview.matched.join(' / ')}</span>
              )}
              {preview.suggested_rating && (
                <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>
                  建议 {preview.suggested_rating}
                </span>
              )}
            </div>
          </div>

          <div className="ratings">
            {RATINGS.map((r) => (
              <button
                key={r.rating}
                onClick={() => void rate(r.rating)}
                style={
                  preview.suggested_rating === r.rating
                    ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' }
                    : undefined
                }
              >
                <b>
                  <span className="kbd">{r.key}</span> {r.label}
                </b>
                <span>{r.hint}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
