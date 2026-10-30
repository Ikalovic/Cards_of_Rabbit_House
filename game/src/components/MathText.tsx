import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

type MathSegment = Readonly<{ raw: string; formula?: string; displayMode?: boolean }>

function escaped(text: string, index: number) {
  let preceding = index - 1
  while (preceding >= 0 && text[preceding] === '\\') preceding -= 1
  return (index - preceding - 1) % 2 === 1
}

function segments(text: string): MathSegment[] {
  const result: MathSegment[] = []
  let plainStart = 0
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '$' || escaped(text, start)) continue
    const width = text[start + 1] === '$' ? 2 : 1
    let end = start + width
    for (; end < text.length; end += 1) {
      if (text[end] !== '$' || escaped(text, end)) continue
      const endWidth = text[end + 1] === '$' ? 2 : 1
      if (endWidth === width) break
      end += endWidth - 1
    }
    if (end === text.length) {
      start += width - 1
      continue
    }
    if (plainStart < start) result.push({ raw: text.slice(plainStart, start) })
    result.push({ raw: text.slice(start, end + width), formula: text.slice(start + width, end), displayMode: width === 2 })
    plainStart = end + width
    start = plainStart - 1
  }
  if (plainStart < text.length) result.push({ raw: text.slice(plainStart) })
  return result
}

/** Only KaTeX-generated markup is inserted as HTML; prose and failures remain React text. */
export function MathText({ text }: Readonly<{ text: string }>) {
  const rendered = useMemo(() => segments(text).map(segment => {
    if (segment.formula === undefined || !segment.formula.trim()) return { ...segment, html: null }
    try {
      return { ...segment, html: katex.renderToString(segment.formula, {
        displayMode: segment.displayMode,
        output: 'htmlAndMathml',
        throwOnError: true,
        trust: false,
        strict: 'ignore',
        maxExpand: 1000,
        maxSize: 20,
      }) }
    } catch {
      return { ...segment, html: null }
    }
  }), [text])

  return <span className="math-text">{rendered.map((segment, index) => segment.html === null
    ? <span key={index}>{segment.raw}</span>
    : <span key={index} className={segment.displayMode ? 'math-formula math-formula-display' : 'math-formula'}
      dangerouslySetInnerHTML={{ __html: segment.html }} />)}</span>
}
