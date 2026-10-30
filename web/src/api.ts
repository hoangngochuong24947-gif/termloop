const TOKEN_KEY = 'termloop.token'

declare global {
  interface Window {
    __TERMLOOP_TOKEN__?: string
  }
}

export function getToken(): string {
  return window.__TERMLOOP_TOKEN__ ?? localStorage.getItem(TOKEN_KEY) ?? ''
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    message: string,
  ) {
    super(message)
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${getToken()}`,
      'content-type': 'application/json',
      'x-termloop-client': 'web',
      ...(init.headers ?? {}),
    },
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { title?: string; detail?: string }
    throw new ApiError(res.status, body.title ?? res.statusText, body.detail ?? '')
  }
  return (await res.json()) as T
}

// ── 类型（与后端 src/core/types.ts 对齐的子集） ─────────────────────────────

export interface Surface {
  type: 'en' | 'zh' | 'abbr' | 'symbol' | 'formula'
  text: string
  status: 'preferred' | 'accepted' | 'rejected'
  evidence: 'unverified' | 'A' | 'B' | 'C'
  locator?: string | null
}

export interface Term {
  id: string
  slug: string
  kind: string
  level: string
  importance: number
  state: string
  domain: string | null
  surfaces: Surface[]
  zh: { name: string | null; name_evidence: string; explain: string }
  annotations: Array<{ type: string; text: string }>
  tags: string[]
  cards: Array<{ id: string; direction: string; enabled: boolean }>
  created_at: string
  updated_at: string
}

export interface QueueItem {
  card_id: string
  term_id: string
  direction: string
  prompt: string
  context: string[]
  self_graded: boolean
  due: string
  reps: number
  stability: number
  term_kind: string
}

export interface Preview {
  verdict: 'correct' | 'partial' | 'wrong' | null
  self_graded: boolean
  matched: string[]
  suggested_rating: 'again' | 'hard' | 'good' | 'easy' | null
}

export interface Draft {
  id: string
  created_at: string
  actor_type: string
  actor_name: string | null
  payload: Record<string, unknown>
  status: string
}

export interface Diagnostics {
  totals: { terms: number; active: number; reviews: number; due_today: number }
  evidence_gap: { unverified_terms: number; no_name_terms: number; ratio: number }
  recall: { again_rate: number }
  by_kind: Array<{ kind: string; c: number }>
  dimension_lapse: Array<{ tag: string; total: number; again: number; again_rate: number }>
}
