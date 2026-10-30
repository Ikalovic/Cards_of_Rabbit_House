import { useEffect, useId, useRef, useState } from 'react'
import type { ElementDirection, PublicMathQuestion, PuzzleAnswer, PublicPuzzleDefinition, PuzzleInstance } from '../domain/shift-types'
import { MathText } from './MathText'
import { ownValue } from '../domain/own-value'
import '../styles/puzzles.css'

export type PuzzlePanelProps = Readonly<{
  puzzle: PuzzleInstance
  nowMs: number
  disabled?: boolean
  onSubmit: (answer: PuzzleAnswer) => void
  onReveal?: (index: number) => void
  onExit: () => void
}>

type PuzzleControls = Readonly<{ disabled: boolean; onSubmit: (answer: PuzzleAnswer) => void; onReveal?: (index: number) => void }>
type DefinitionProps<Kind extends PublicPuzzleDefinition['kind']> = PuzzleControls & Readonly<{ definition: Extract<PublicPuzzleDefinition, { kind: Kind }> }>

const titles: Record<PublicPuzzleDefinition['kind'], string> = {
  'number-search': '找数校准', connect: '连线校准', identify: '快速辨认', minesweeper: '微型扫雷',
  sudoku: '迷你数独', 'math-choice': '数学选择题', 'math-fill': '数学填空题',
}
const directions: Record<ElementDirection, { label: string; arrow: string; rotation: number }> = {
  upright: { label: '正向', arrow: '↑', rotation: 0 }, left: { label: '向左', arrow: '←', rotation: -90 },
  right: { label: '向右', arrow: '→', rotation: 90 }, inverted: { label: '倒置', arrow: '↓', rotation: 180 },
}
const colors: Record<string, string> = { 红色: '#bb635f', 蓝色: '#668da5', 绿色: '#688f70', 紫色: '#977ca7' }
const cellLabel = (index: number, columns: number) => `第 ${Math.floor(index / columns) + 1} 行第 ${index % columns + 1} 列`
const sorted = (values: readonly number[]) => [...values].sort((left, right) => left - right)

function SubmitButton({ disabled, onClick }: Readonly<{ disabled: boolean; onClick: () => void }>) {
  return <button type="button" className="puzzle-submit" disabled={disabled} onClick={onClick}>提交校准</button>
}

function NumberSearch({ definition, disabled, onSubmit }: DefinitionProps<'number-search'>) {
  return <div className="puzzle-body">
    <p className="puzzle-prompt">找出数字 {definition.target}</p>
    <p className="puzzle-instruction">看准后点击对应的数字，只能选择一次。</p>
    <div className="puzzle-number-grid" style={{ gridTemplateColumns: `repeat(${definition.columns}, 1fr)` }}>
      {definition.grid.map((number, index) => <button type="button" key={index} disabled={disabled}
        onClick={() => onSubmit({ kind: 'number-search', index })}>{number}</button>)}
    </div>
  </div>
}

function Connect({ definition, disabled, onSubmit }: DefinitionProps<'connect'>) {
  const [path, setPath] = useState<string[]>([])
  const coordinate = (value: number) => 10 + value * 80
  const points = path.map(id => definition.nodes.find(node => node.id === id)!)
    .map(node => `${coordinate(node.x)},${coordinate(node.y)}`).join(' ')
  function connect(id: string) {
    if (disabled) return
    const next = [...path, id]
    setPath(next)
    if (next.length === definition.nodes.length) onSubmit({ kind: 'connect', path: next })
  }
  return <div className="puzzle-body">
    <p className="puzzle-prompt">从 1 开始，按数字顺序连起来</p>
    <p className="puzzle-instruction">每次点击下一个数字，完成全部连线后自动提交校准。</p>
    <div className="puzzle-connect-board" aria-label="连线区">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      {definition.nodes.map(node => <button type="button" key={node.id} aria-label={`节点 ${node.id}`}
        aria-pressed={path.includes(node.id)} disabled={disabled || path.includes(node.id)}
        style={{ left: `${coordinate(node.x)}%`, top: `${coordinate(node.y)}%` }}
        onClick={() => connect(node.id)}>{node.id}</button>)}
    </div>
    <p className="puzzle-progress">已连接 {path.length} / {definition.nodes.length} 个节点</p>
  </div>
}

function Identify({ definition, disabled, onSubmit }: DefinitionProps<'identify'>) {
  return <div className="puzzle-body">
    <p className="puzzle-prompt">{definition.prompt}</p>
    <p className="puzzle-instruction">同时核对颜色、形状和箭头方向。</p>
    <div className="puzzle-identify-options">
      {definition.options.map((option, index) => {
        const direction = directions[option.direction]
        const fill = ownValue(colors, option.color) ?? '#7c8b77'
        return <button type="button" key={option.id} disabled={disabled}
          aria-label={`选项 ${index + 1}：${option.color}、${option.shape}、${direction.label}`}
          onClick={() => onSubmit({ kind: 'identify', optionId: option.id })}>
          <span className="puzzle-option-number" aria-hidden="true">{index + 1}</span>
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <g transform={`rotate(${direction.rotation} 32 32)`}>
              {option.shape === '圆形' ? <circle cx="32" cy="32" r="23" fill={fill} />
                : option.shape === '方形' ? <rect x="11" y="11" width="42" height="42" rx="4" fill={fill} />
                  : option.shape === '三角形' ? <polygon points="32,7 58,54 6,54" fill={fill} />
                    : <text x="32" y="36" textAnchor="middle" fill={fill} fontSize="12">{option.shape}</text>}
            </g>
          </svg>
          <span className="puzzle-direction" aria-hidden="true">{direction.arrow}</span>
          <span className="puzzle-option-caption" aria-hidden="true">{option.color} · {option.shape}</span>
        </button>
      })}
    </div>
  </div>
}

function Minesweeper({ definition, disabled, onSubmit, onReveal }: DefinitionProps<'minesweeper'>) {
  const revealed = definition.revealedCells.map(cell => cell.index)
  const [flags, setFlags] = useState<readonly number[]>([])
  const [mode, setMode] = useState<'reveal' | 'flag'>('reveal')
  function selectCell(index: number) {
    if (disabled || revealed.includes(index)) return
    if (mode === 'flag') {
      setFlags(flags.includes(index) ? flags.filter(flag => flag !== index) : sorted([...flags, index]))
      return
    }
    if (flags.includes(index)) return
    onReveal?.(index)
  }
  return <div className="puzzle-body">
    <div className="puzzle-mine-caption"><p className="puzzle-prompt">共 {definition.mineCount} 颗雷</p><span>已标记 {flags.length} 格</span></div>
    <p className="puzzle-instruction">数字表示周围八格的雷数。翻开所有安全格、标出全部雷区，再提交。</p>
    <div className="puzzle-mine-tools" aria-label="扫雷操作">
      <button type="button" disabled={disabled} aria-pressed={mode === 'reveal'} onClick={() => setMode('reveal')}>翻开格子</button>
      <button type="button" disabled={disabled} aria-pressed={mode === 'flag'} onClick={() => setMode('flag')}>标记雷区</button>
    </div>
    <div className="puzzle-mine-grid" style={{ gridTemplateColumns: `repeat(${definition.columns}, 1fr)` }}>
      {Array.from({ length: definition.rows * definition.columns }, (_, index) => {
        const isRevealed = revealed.includes(index)
        const isFlagged = flags.includes(index)
        const count = definition.revealedCells.find(cell => cell.index === index)?.clue ?? null
        return <button type="button" key={index} disabled={disabled || isRevealed || (mode === 'reveal' && !onReveal)}
          className={isRevealed ? 'puzzle-mine-revealed' : isFlagged ? 'puzzle-mine-flagged' : ''}
          aria-label={`${cellLabel(index, definition.columns)}，${isRevealed ? `周围 ${count} 颗雷` : isFlagged ? '已标记' : '未翻开'}`}
          onClick={() => selectCell(index)}>{isRevealed ? count : isFlagged ? '⚑' : '·'}</button>
      })}
    </div>
    <SubmitButton disabled={disabled} onClick={() => onSubmit({ kind: 'minesweeper', revealedIndices: sorted(revealed), flaggedIndices: flags })} />
  </div>
}

function Sudoku({ definition, disabled, onSubmit }: DefinitionProps<'sudoku'>) {
  const [cells, setCells] = useState<readonly number[]>(definition.givens)
  return <div className="puzzle-body">
    <p className="puzzle-prompt">补齐缺少的数字</p>
    <p className="puzzle-instruction">每行、每列和每个粗线小宫，都要包含 1、2、3、4。</p>
    <div className="puzzle-sudoku-grid">
      {definition.givens.map((given, index) => <div key={index} className="puzzle-sudoku-cell">
        {given !== 0 ? <span aria-label={`${cellLabel(index, 4)}，已知数字 ${given}`}>{given}</span>
          : <input type="text" inputMode="numeric" autoComplete="off" maxLength={1} pattern="[1-4]"
            aria-label={cellLabel(index, 4)} disabled={disabled} value={cells[index] || ''}
            onChange={event => {
              const value = event.target.value
              if (!disabled && /^[1-4]?$/.test(value)) setCells(cells.map((cell, position) => position === index ? Number(value) : cell))
            }} />}
      </div>)}
    </div>
    <SubmitButton disabled={disabled} onClick={() => onSubmit({ kind: 'sudoku', cells: [...cells] })} />
  </div>
}

function MathQuestionContext({ definition }: Readonly<{ definition: PublicMathQuestion }>) {
  return <>
    {definition.images && <div className="puzzle-question-images">
      {definition.images.map((image, index) => <img key={index} src={image.src} alt={image.alt} decoding="async" />)}
    </div>}
    {definition.table && <div className="puzzle-question-table-scroll">
      <table className="puzzle-question-table" aria-label="题目数据表">
        <thead><tr>{definition.table.headers.map((header, index) => <th key={index} scope="col"><MathText text={header} /></th>)}</tr></thead>
        <tbody>{definition.table.rows.map((row, rowIndex) => <tr key={rowIndex}>
          {row.map((cell, columnIndex) => <td key={columnIndex}><MathText text={cell} /></td>)}
        </tr>)}</tbody>
      </table>
    </div>}
  </>
}

function MathChoice({ definition, disabled, onSubmit }: DefinitionProps<'math-choice'>) {
  const [selected, setSelected] = useState<readonly string[]>([])
  const groupName = useId()
  const multiple = definition.multiple
  return <div className="puzzle-body">
    <span className="puzzle-choice-mode">{multiple ? '可多选' : '单选'}</span>
    <p className="puzzle-prompt puzzle-math-prompt"><MathText text={definition.prompt} /></p>
    <MathQuestionContext definition={definition} />
    <fieldset className="puzzle-choice-options" disabled={disabled}>
      <legend className="puzzle-instruction">选好答案后，点击下方提交。</legend>
      {definition.options.map(option => <label key={option.id}>
        <input type={multiple ? 'checkbox' : 'radio'} name={groupName} checked={selected.includes(option.id)} disabled={disabled}
          onChange={() => {
            if (!disabled) setSelected(multiple ? selected.includes(option.id) ? selected.filter(id => id !== option.id) : [...selected, option.id] : [option.id])
          }} />
        <MathText text={option.label} />
      </label>)}
    </fieldset>
    <SubmitButton disabled={disabled} onClick={() => onSubmit({ kind: 'math-choice', optionIds: [...selected] })} />
  </div>
}

function MathFill({ definition, disabled, onSubmit }: DefinitionProps<'math-fill'>) {
  const [text, setText] = useState('')
  return <div className="puzzle-body">
    <p className="puzzle-prompt puzzle-math-prompt"><MathText text={definition.prompt} /></p>
    <MathQuestionContext definition={definition} />
    <label className="puzzle-fill-label">填写答案
      <input type="text" autoComplete="off" spellCheck={false} disabled={disabled} value={text}
        placeholder="填写数值或 LaTeX 公式" onChange={event => { if (!disabled) setText(event.target.value) }} />
    </label>
    <p className="puzzle-instruction">公式请用 LaTeX 填写，可省略外围 $。填写完成后，点击下方提交。</p>
    <SubmitButton disabled={disabled} onClick={() => onSubmit({ kind: 'math-fill', text })} />
  </div>
}

function PuzzleBody({ definition, ...controls }: PuzzleControls & Readonly<{ definition: PublicPuzzleDefinition }>) {
  switch (definition.kind) {
    case 'number-search': return <NumberSearch definition={definition} {...controls} />
    case 'connect': return <Connect definition={definition} {...controls} />
    case 'identify': return <Identify definition={definition} {...controls} />
    case 'minesweeper': return <Minesweeper definition={definition} {...controls} />
    case 'sudoku': return <Sudoku definition={definition} {...controls} />
    case 'math-choice': return <MathChoice definition={definition} {...controls} />
    case 'math-fill': return <MathFill definition={definition} {...controls} />
  }
}

function PuzzleSession({ puzzle, nowMs, disabled = false, onSubmit, onReveal, onExit }: PuzzlePanelProps) {
  const headingId = useId()
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    panel.current?.focus({ preventScroll: true })
    panel.current?.scrollIntoView?.({ block: 'start', behavior: 'instant' })
  }, [])
  const sent = useRef(false)
  const [submitted, setSubmitted] = useState(false)
  useEffect(() => {
    if (!disabled && puzzle.result.status === 'pending') {
      sent.current = false
      setSubmitted(false)
    }
  }, [disabled, puzzle.result.status])
  const remainingMs = Math.max(0, puzzle.deadlineAtMs - nowMs)
  const expired = nowMs > puzzle.deadlineAtMs
  const locked = disabled || expired || submitted || puzzle.result.status !== 'pending'
  function submit(answer: PuzzleAnswer) {
    if (locked || sent.current) return
    sent.current = true
    setSubmitted(true)
    onSubmit(answer)
  }
  function exit() {
    if (locked || sent.current) return
    sent.current = true
    setSubmitted(true)
    onExit()
  }
  const notice = puzzle.result.status === 'succeeded' ? '校准完成。'
    : puzzle.result.status === 'failed' ? '本次校准结束，请稍后重新准备。'
      : expired ? '时间到了，请等待机器重新准备。'
        : submitted ? '正在核对本次校准…' : disabled ? '冲印机正在确认，请稍候。' : null
  return <section ref={panel} tabIndex={-1} className="puzzle-panel" aria-labelledby={headingId}>
    <header className="puzzle-header">
      <div><span className="puzzle-eyebrow">{puzzle.machineId === 'quick' ? '快印机' : '精印机'} · 开印前校准</span><h3 id={headingId}>{titles[puzzle.definition.kind]}</h3></div>
      <div className={`puzzle-timer${remainingMs <= 5_000 ? ' puzzle-timer-urgent' : ''}`} role="timer" aria-live="off">剩余 <strong>{Math.ceil(remainingMs / 1_000)}</strong> 秒</div>
    </header>
    <div className="puzzle-time-track" aria-hidden="true"><span style={{ width: `${Math.min(100, remainingMs / Math.max(1, puzzle.deadlineAtMs - puzzle.startedAtMs) * 100)}%` }} /></div>
    <PuzzleBody definition={puzzle.definition} disabled={locked} onSubmit={submit} onReveal={onReveal} />
    {notice && <p className="puzzle-notice" role="status">{notice}</p>}
    <footer className="puzzle-footer"><p>退出会让本次校准失败，本机对这张订单暂歇 30 秒。切换工位或订单也按退出处理。</p><button type="button" disabled={locked} onClick={exit}>退出校准</button></footer>
  </section>
}

export function PuzzlePanel(props: PuzzlePanelProps) {
  return <PuzzleSession key={props.puzzle.id} {...props} />
}

export default PuzzlePanel
