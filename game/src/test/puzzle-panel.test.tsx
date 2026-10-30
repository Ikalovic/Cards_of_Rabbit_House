import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PuzzlePanel } from '../components/PuzzlePanel'
import type { PuzzleDefinition, PuzzleInstance } from '../domain/shift-types'
import puzzleStyles from '../styles/puzzles.css?inline'

const START = 10_000
const numberPuzzle: PuzzleDefinition = { kind: 'number-search', columns: 2, grid: [31, 13, 37, 73], target: 37 }
const connectPuzzle: PuzzleDefinition = { kind: 'connect', nodes: [{ id: '2', x: .8, y: .8 }, { id: '1', x: .2, y: .2 }, { id: '3', x: .8, y: .2 }] }
const minesPuzzle: Extract<PuzzleDefinition, { kind: 'minesweeper' }> = { kind: 'minesweeper', rows: 3, columns: 4, mineCount: 2, revealedCells: [4, 5, 6, 7, 8, 9, 10, 11].map(index => ({ index, clue: index < 8 ? 1 : 0 })) }
const sudokuPuzzle: PuzzleDefinition = { kind: 'sudoku', size: 4, boxRows: 2, boxColumns: 2, givens: [0, 2, 3, 4, 3, 0, 1, 2, 2, 1, 0, 3, 4, 3, 2, 0] }
const choicePuzzle: Extract<PuzzleDefinition, { kind: 'math-choice' }> = { kind: 'math-choice', id: 'private-question-id', prompt: '请选择符合题意的答案。', timeLimitSeconds: 60, options: [{ id: 'opaque-one', label: '选项甲' }, { id: 'opaque-two', label: '选项乙' }, { id: 'opaque-three', label: '选项丙' }], multiple: false }

function instance(definition: PuzzleDefinition, patch: Partial<PuzzleInstance> = {}): PuzzleInstance {
  return { id: 'puzzle-one', shiftRunId: 'run', orderId: 'order', intentId: 'intent', machineId: 'quick', attempt: 1, startedAtMs: START, deadlineAtMs: START + 60_000, definition, result: { status: 'pending' }, ...patch }
}

function mount(definition: PuzzleDefinition, patch: Partial<PuzzleInstance> = {}) {
  const onSubmit = vi.fn()
  const onExit = vi.fn()
  const onReveal = vi.fn()
  const puzzle = instance(definition, patch)
  const view = render(<PuzzlePanel puzzle={puzzle} nowMs={START} onSubmit={onSubmit} onReveal={onReveal} onExit={onExit} />)
  return { ...view, puzzle, onSubmit, onReveal, onExit }
}

describe('PuzzlePanel', () => {
  it('uses the fallback color for inherited option color names', () => {
    const { container } = mount({ kind: 'identify', prompt: '请选择图案',
      target: { color: '__proto__', shape: '圆形', direction: 'upright' },
      options: [{ id: 'one', color: '__proto__', shape: '圆形', direction: 'upright' }] })
    expect(container.querySelector('.puzzle-identify-options circle')).toHaveAttribute('fill', '#7c8b77')
  })

  it('focuses and scrolls to each new puzzle without stealing focus on countdown updates', () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    try {
      const { rerender, puzzle, onSubmit, onExit } = mount(numberPuzzle)
      const panel = screen.getByRole('region', { name: '找数校准' })
      expect(panel).toHaveFocus()
      expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'start', behavior: 'instant' })
      expect(scrollIntoView.mock.contexts[0]).toBe(panel)
      const button = screen.getByRole('button', { name: '37' })
      button.focus()
      rerender(<PuzzlePanel puzzle={puzzle} nowMs={START + 1_000} onSubmit={onSubmit} onExit={onExit} />)
      expect(button).toHaveFocus()
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      rerender(<PuzzlePanel puzzle={{ ...puzzle, id: 'next-puzzle' }} nowMs={START + 1_000} onSubmit={onSubmit} onExit={onExit} />)
      const nextPanel = screen.getByRole('region', { name: '找数校准' })
      expect(nextPanel).toHaveFocus()
      expect(scrollIntoView).toHaveBeenCalledTimes(2)
      expect(scrollIntoView.mock.contexts[1]).toBe(nextPanel)
    } finally {
      scrollIntoView.mockRestore()
    }
  })

  it('keeps the exit penalty explanation readable at normal text contrast', () => {
    render(<style>{puzzleStyles}</style>)
    const { container } = mount(numberPuzzle)
    const footer = container.querySelector('.puzzle-footer')!
    const explanation = footer.querySelector('p')!
    const luminance = (color: string) => {
      const rgb = color.startsWith('#')
        ? color.slice(1).match(/.{2}/g)!.map(channel => Number.parseInt(channel, 16))
        : color.match(/\d+/g)!.slice(0, 3).map(Number)
      const linear = rgb.map(channel => {
        const value = channel / 255
        return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
      })
      return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722
    }
    const foreground = luminance(getComputedStyle(explanation).color)
    const background = luminance(getComputedStyle(footer).backgroundColor)
    expect((background + .05) / (foreground + .05)).toBeGreaterThanOrEqual(4.5)
  })

  it('renders the target and dispatches the clicked grid position once', () => {
    const { onSubmit } = mount(numberPuzzle)
    expect(screen.getByText('找出数字 37')).toBeInTheDocument()
    const cell = screen.getByRole('button', { name: '37' })
    fireEvent.click(cell)
    fireEvent.click(cell)
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ kind: 'number-search', index: 2 })
  })

  it('places numbered connect nodes spatially and submits their complete forward sequence', () => {
    const { container, onSubmit } = mount(connectPuzzle)
    expect(screen.getByRole('button', { name: '节点 1' })).toHaveStyle({ left: '26%', top: '26%' })
    fireEvent.click(screen.getByRole('button', { name: '节点 1' }))
    fireEvent.click(screen.getByRole('button', { name: '节点 2' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(container.querySelector('polyline')).toHaveAttribute('points', '26,26 74,74')
    fireEvent.click(screen.getByRole('button', { name: '节点 3' }))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ kind: 'connect', path: ['1', '2', '3'] })
  })

  it('collects a full connection before asking the server to grade its order', () => {
    const { onSubmit } = mount(connectPuzzle)
    fireEvent.click(screen.getByRole('button', { name: '节点 2' }))
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '节点 1' }))
    fireEvent.click(screen.getByRole('button', { name: '节点 3' }))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ kind: 'connect', path: ['2', '1', '3'] })
  })

  it('shows distinguishable colors, shapes and direction arrows without marking the answer', () => {
    const definition: PuzzleDefinition = { kind: 'identify', prompt: '找出：红色、圆形、正向', target: { color: '红色', shape: '圆形', direction: 'upright' }, options: [
      { id: 'opaque-a', color: '红色', shape: '圆形', direction: 'upright' },
      { id: 'opaque-b', color: '蓝色', shape: '三角形', direction: 'right' },
      { id: 'opaque-c', color: '红色', shape: '圆形', direction: 'inverted' },
    ] }
    const { container, onSubmit } = mount(definition)
    const upright = screen.getByRole('button', { name: '选项 1：红色、圆形、正向' })
    const inverted = screen.getByRole('button', { name: '选项 3：红色、圆形、倒置' })
    expect(within(upright).getByText('↑')).toBeInTheDocument()
    expect(within(inverted).getByText('↓')).toBeInTheDocument()
    expect(upright.querySelector('circle')).toHaveAttribute('fill', '#bb635f')
    expect(screen.getByRole('button', { name: '选项 2：蓝色、三角形、向右' }).querySelector('polygon')).toBeInTheDocument()
    expect(container.innerHTML).not.toContain('opaque-a')
    fireEvent.click(inverted)
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ kind: 'identify', optionId: 'opaque-c' })
  })

  it('shows adjacent mine counts and requires explicit submission after reveal and flag actions', () => {
    const { onSubmit, onReveal, onExit, rerender, puzzle } = mount(minesPuzzle)
    expect(screen.getByText('共 2 颗雷')).toBeInTheDocument()
    expect(screen.getByLabelText('第 2 行第 1 列，周围 1 颗雷')).toHaveTextContent('1')
    expect(screen.getByLabelText('第 3 行第 2 列，周围 0 颗雷')).toHaveTextContent('0')
    fireEvent.click(screen.getByRole('button', { name: '第 1 行第 2 列，未翻开' }))
    fireEvent.click(screen.getByRole('button', { name: '第 1 行第 3 列，未翻开' }))
    expect(onReveal.mock.calls).toEqual([[1], [2]])
    expect(screen.getByRole('button', { name: '第 1 行第 2 列，未翻开' })).toBeInTheDocument()
    rerender(<PuzzlePanel puzzle={{ ...puzzle, definition: { ...minesPuzzle, revealedCells: [...minesPuzzle.revealedCells, { index: 1, clue: 1 }, { index: 2, clue: 1 }] } }}
      nowMs={START} onSubmit={onSubmit} onReveal={onReveal} onExit={onExit} />)
    fireEvent.click(screen.getByRole('button', { name: '标记雷区' }))
    fireEvent.click(screen.getByRole('button', { name: '第 1 行第 1 列，未翻开' }))
    fireEvent.click(screen.getByRole('button', { name: '第 1 行第 4 列，未翻开' }))
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '提交校准' }))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ kind: 'minesweeper', revealedIndices: [1, 2, 4, 5, 6, 7, 8, 9, 10, 11], flaggedIndices: [0, 3] })
  })

  it('supports removing a mine flag and sends every reveal to the server', () => {
    const { onSubmit, onReveal } = mount(minesPuzzle)
    fireEvent.click(screen.getByRole('button', { name: '标记雷区' }))
    fireEvent.click(screen.getByRole('button', { name: '第 1 行第 1 列，未翻开' }))
    fireEvent.click(screen.getByRole('button', { name: '第 1 行第 1 列，已标记' }))
    fireEvent.click(screen.getByRole('button', { name: '翻开格子' }))
    fireEvent.click(screen.getByRole('button', { name: '第 1 行第 1 列，未翻开' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onReveal).toHaveBeenCalledExactlyOnceWith(0)
  })

  it('preserves sudoku givens and sends player filled cells only after submission', () => {
    const { onSubmit } = mount(sudokuPuzzle)
    expect(screen.getByLabelText('第 1 行第 2 列，已知数字 2')).toHaveTextContent('2')
    expect(screen.getAllByRole('textbox')).toHaveLength(4)
    const blank = screen.getByRole('textbox', { name: '第 1 行第 1 列' })
    expect(blank).toHaveValue('')
    fireEvent.change(blank, { target: { value: '8' } })
    expect(blank).toHaveValue('')
    for (const [label, value] of [['第 1 行第 1 列', '1'], ['第 2 行第 2 列', '4'], ['第 3 行第 3 列', '4'], ['第 4 行第 4 列', '1']]) {
      fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } })
    }
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '提交校准' }))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ kind: 'sudoku', cells: [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1] })
  })

  it('renders single-choice radio buttons without leaking the correct set or question identity', () => {
    const { container, onSubmit } = mount(choicePuzzle)
    expect(screen.getByText('单选')).toBeInTheDocument()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(container.innerHTML).not.toMatch(/private-question-id|opaque-two|correctOptionIds|private-seed/)
    fireEvent.click(screen.getByRole('radio', { name: '选项甲' }))
    fireEvent.click(screen.getByRole('radio', { name: '选项乙' }))
    expect(screen.getByRole('radio', { name: '选项甲' })).not.toBeChecked()
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '提交校准' }))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ kind: 'math-choice', optionIds: ['opaque-two'] })
  })

  it('renders multiple choice checkboxes and sends the exact player selection on submit', () => {
    const { onSubmit } = mount({ ...choicePuzzle, multiple: true })
    expect(screen.getByText('可多选')).toBeInTheDocument()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    fireEvent.click(screen.getByRole('checkbox', { name: '选项甲' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选项丙' }))
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '提交校准' }))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ kind: 'math-choice', optionIds: ['opaque-one', 'opaque-three'] })
  })

  it('renders inline and display formulas inside the question without exposing private metadata', () => {
    const { container } = mount({ ...choicePuzzle, prompt: String.raw`已知 $x^2 + 1$，计算：$$\frac{1}{x}$$` })
    const prompt = container.querySelector('.puzzle-math-prompt')!
    expect(prompt).toHaveTextContent('已知')
    expect(prompt.querySelectorAll('.katex')).toHaveLength(2)
    expect(prompt.querySelectorAll('.katex-display')).toHaveLength(1)
    expect([...prompt.querySelectorAll('annotation')].map(node => node.textContent)).toEqual(['x^2 + 1', String.raw`\frac{1}{x}`])
    expect(container.innerHTML).not.toMatch(/private-question-id|opaque-two|correctOptionIds|private-seed/)
  })

  it('renders formulas in answer labels while preserving the selected option identity privately', () => {
    const { container, onSubmit } = mount({ ...choicePuzzle, options: [
      { id: 'opaque-one', label: String.raw`A. $\sqrt{2}$` },
      { id: 'opaque-two', label: String.raw`B. $\frac{3}{4}$` },
    ] })
    expect(container.querySelectorAll('.puzzle-choice-options .katex')).toHaveLength(2)
    expect(container.innerHTML).not.toMatch(/opaque-one|opaque-two|correctOptionIds/)
    fireEvent.click(screen.getAllByRole('radio')[1])
    fireEvent.click(screen.getByRole('button', { name: '提交校准' }))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ kind: 'math-choice', optionIds: ['opaque-two'] })
  })

  it('keeps malformed formulas readable and renders surrounding text without interpreting HTML', () => {
    const { container } = mount({ ...choicePuzzle,
      prompt: String.raw`<img src="x" onerror="alert(1)"> 错式 $\unknowncommand{x}$，后续 $y^2$。`,
    })
    const prompt = container.querySelector('.puzzle-math-prompt')!
    expect(prompt).toHaveTextContent(String.raw`$\unknowncommand{x}$`)
    expect(prompt).toHaveTextContent('<img src="x" onerror="alert(1)">')
    expect(prompt.querySelector('img')).not.toBeInTheDocument()
    expect(prompt.querySelectorAll('.katex')).toHaveLength(1)
    expect(prompt.querySelector('annotation')).toHaveTextContent('y^2')
  })

  it('disables trusted LaTeX links, images and HTML attributes', () => {
    const { container } = mount({ ...choicePuzzle,
      prompt: String.raw`$\href{javascript:alert(1)}{link}$ $\includegraphics{https://example.invalid/image.png}$ $\htmlId{injected-id}{x}$ 安全式 $z^2$`,
    })
    const prompt = container.querySelector('.puzzle-math-prompt')!
    expect(prompt.querySelector('a, img, script, #injected-id, [onclick], [onerror]')).not.toBeInTheDocument()
    expect(prompt.querySelectorAll('.katex').length).toBeGreaterThan(0)
    expect([...prompt.querySelectorAll('annotation')].map(node => node.textContent)).toContain('z^2')
  })

  it('preserves escaped and unmatched dollar signs outside complete formula segments', () => {
    const { container } = mount({ ...choicePuzzle, prompt: String.raw`价格 \$5，公式 $x + 1$，保留未闭合 $y` })
    const prompt = container.querySelector('.puzzle-math-prompt')!
    expect(prompt).toHaveTextContent(String.raw`价格 \$5`)
    expect(prompt).toHaveTextContent('保留未闭合 $y')
    expect(prompt.querySelectorAll('.katex')).toHaveLength(1)
    expect(prompt.querySelector('annotation')).toHaveTextContent('x + 1')
  })

  it('renders fill-question math and explains LaTeX input without revealing accepted answers', () => {
    const { container } = mount({ kind: 'math-fill', id: 'hidden-fill-id', prompt: String.raw`计算 $\int_0^1 x\,dx$。`, timeLimitSeconds: 60 })
    expect(container.querySelector('.puzzle-math-prompt .katex')).toBeInTheDocument()
    expect(screen.getByText(/公式请用 LaTeX/)).toHaveTextContent('可省略外围 $')
    expect(container.innerHTML).not.toMatch(/hidden-fill-id|private-accepted-answer|acceptedAnswers/)
    expect(screen.getByRole('textbox', { name: '填写答案' })).toHaveValue('')
  })

  it('renders local question diagrams with alt text and accessible tables with math cells', () => {
    const { container } = mount({ ...choicePuzzle,
      images: [{ src: '/assets/math/questions/single_14.png', alt: '风速向量示意图' }],
      table: { headers: ['级别', '风速'], rows: [['2', '$v = 2$'], ['3', '$v = 4$']] },
    })
    expect(screen.getByRole('img', { name: '风速向量示意图' })).toHaveAttribute('src', '/assets/math/questions/single_14.png')
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader')).toHaveLength(2)
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(table.querySelectorAll('.katex')).toHaveLength(2)
    expect(container.innerHTML).not.toMatch(/private-question-id|opaque-two|correctOptionIds|private-seed/)
  })

  it('keeps accepted fill answers private and preserves input for the domain grader', () => {
    const { container, onSubmit } = mount({ kind: 'math-fill', id: 'hidden-fill-id', prompt: '请填入计算结果。', timeLimitSeconds: 60 })
    expect(container.innerHTML).not.toMatch(/hidden-fill-id|private-accepted-answer|acceptedAnswers/)
    fireEvent.change(screen.getByRole('textbox', { name: '填写答案' }), { target: { value: '  Ｘ − ２  ' } })
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '提交校准' }))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ kind: 'math-fill', text: '  Ｘ − ２  ' })
  })

  it('derives countdown from the provided time and never submits or exits by itself on expiry', () => {
    const { puzzle, onSubmit, onExit, rerender } = mount(numberPuzzle)
    expect(screen.getByRole('timer')).toHaveTextContent('剩余 60 秒')
    rerender(<PuzzlePanel puzzle={puzzle} nowMs={START + 58_700} onSubmit={onSubmit} onExit={onExit} />)
    expect(screen.getByRole('timer')).toHaveTextContent('剩余 2 秒')
    rerender(<PuzzlePanel puzzle={puzzle} nowMs={puzzle.deadlineAtMs + 1} onSubmit={onSubmit} onExit={onExit} />)
    expect(screen.getByRole('timer')).toHaveTextContent('剩余 0 秒')
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onExit).not.toHaveBeenCalled()
  })

  it('accepts a pending answer exactly at the deadline while displaying zero seconds', () => {
    const { puzzle, onSubmit, onExit, rerender } = mount(numberPuzzle)
    rerender(<PuzzlePanel puzzle={puzzle} nowMs={puzzle.deadlineAtMs} onSubmit={onSubmit} onExit={onExit} />)
    expect(screen.getByRole('timer')).toHaveTextContent('剩余 0 秒')
    const cell = screen.getByRole('button', { name: '37' })
    expect(cell).toBeEnabled()
    fireEvent.click(cell)
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ kind: 'number-search', index: 2 })
  })

  it('disables paused and settled puzzles, and resets local state for a new puzzle', () => {
    const { puzzle, onSubmit, onExit, rerender } = mount(choicePuzzle)
    fireEvent.click(screen.getByRole('radio', { name: '选项甲' }))
    rerender(<PuzzlePanel puzzle={puzzle} nowMs={START} disabled onSubmit={onSubmit} onExit={onExit} />)
    expect(screen.getByRole('radio', { name: '选项乙' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '提交校准' }))
    expect(onSubmit).not.toHaveBeenCalled()
    rerender(<PuzzlePanel puzzle={{ ...puzzle, id: 'puzzle-two' }} nowMs={START} onSubmit={onSubmit} onExit={onExit} />)
    expect(screen.getByRole('radio', { name: '选项甲' })).not.toBeChecked()
    rerender(<PuzzlePanel puzzle={{ ...puzzle, id: 'puzzle-two', result: { status: 'failed', failedAtMs: START, reason: 'exit', answer: null } }} nowMs={START} onSubmit={onSubmit} onExit={onExit} />)
    for (const control of [...screen.getAllByRole('radio'), ...screen.getAllByRole('button')]) expect(control).toBeDisabled()
  })

  it('requires an explicit exit action and sends it only once', () => {
    const { onExit, onSubmit } = mount(numberPuzzle)
    expect(screen.getByText(/退出会让本次校准失败/)).toBeInTheDocument()
    expect(screen.getByText(/切换工位或订单也按退出处理/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '退出校准' }))
    fireEvent.click(screen.getByRole('button', { name: '退出校准' }))
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
