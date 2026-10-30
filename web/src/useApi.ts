import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.ts'

export interface ApiState<T> {
  data: T | null
  error: string
  loading: boolean
  reload: () => void
}

/**
 * 极小的取数 hook。
 *
 * 之前每个页面各写一遍 useState + useEffect + try/catch + error 渲染，
 * 四处重复且漏掉 loading 态。这里统一掉；路径变化即重取，
 * 所以搜索这类场景不需要额外的触发开关。
 *
 * 没有引入 TanStack Query：这个 App 的缓存需求只有「换页重取」，
 * 上一个带缓存失效语义的库是纯负担。等真需要乐观更新再说。
 */
export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(path !== null)
  const [tick, setTick] = useState(0)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (path === null) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    api<T>(path)
      .then((r) => {
        if (alive.current) setData(r)
      })
      .catch((e) => {
        if (alive.current) setError((e as Error).message)
      })
      .finally(() => {
        if (alive.current) setLoading(false)
      })
  }, [path, tick])

  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { data, error, loading, reload }
}
