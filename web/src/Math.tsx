import { useEffect, useState } from 'react'

/**
 * 行内公式渲染。
 *
 * 只有看起来像 LaTeX 的字符串才走 KaTeX，其余原样输出——
 * 把 "W/(m·K)" 丢给 KaTeX 会排出一堆奇怪的斜体。
 *
 * katex 用动态 import：首屏不为一个当前还没有数据的字段付 270KB。
 */

const LATEX_HINT = /[\\^_{}]/

export function isLatex(text: string): boolean {
  return LATEX_HINT.test(text)
}

export function Math({ tex }: { tex: string }) {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    if (!isLatex(tex)) {
      setHtml(null)
      return
    }
    let alive = true
    void import('katex').then(async (m) => {
      await import('katex/dist/katex.min.css')
      if (!alive) return
      setHtml(
        m.default.renderToString(tex, {
          throwOnError: false,
          displayMode: false,
          trust: false,
        }),
      )
    })
    return () => {
      alive = false
    }
  }, [tex])

  if (html === null) return <span>{tex}</span>
  // katex 的输出在 trust:false 下是安全的
  return <span dangerouslySetInnerHTML={{ __html: html }} />
}
