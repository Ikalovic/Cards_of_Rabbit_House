import { useEffect, useState, type CSSProperties } from 'react'
import type { Commission, DialogueLine } from '../content/commissions'

type DialogueSceneProps = Readonly<{
  commission: Commission
  onAccept: () => void
  onBack: () => void
}>

export function DialogueScene({ commission, onAccept, onBack }: DialogueSceneProps) {
  const [lineIndex, setLineIndex] = useState(0)
  const [branchLine, setBranchLine] = useState<DialogueLine>()

  useEffect(() => {
    setLineIndex(0)
    setBranchLine(undefined)
  }, [commission.id])

  const reachedBranch = lineIndex >= commission.intro.length
  const currentLine = branchLine ?? commission.intro[Math.min(lineIndex, commission.intro.length - 1)]

  return (
    <main className="dialogue-scene" style={{ '--commission-accent': commission.accent } as CSSProperties}>
      <div className="dialogue-scene__background" />
      <header className="scene-header">
        <button className="ghost-button" onClick={onBack}>← 回到门口</button>
        <div className="scene-header__chapter">
          <small>ORDER {commission.number}</small>
          <strong>{commission.title}</strong>
        </div>
        <button className="primary-button" onClick={onAccept}>接受委托</button>
      </header>

      <section className="scene-stage">
        <aside className="order-ticket">
          <div className="order-ticket__pin" aria-hidden="true" />
          <span className="order-ticket__kicker">今日委托</span>
          <h1>{commission.title}</h1>
          <p className="order-ticket__paper">◇ {commission.paperLabel}</p>
          <ol>
            {commission.requirements.map((requirement) => (
              <li key={requirement}>{requirement}</li>
            ))}
          </ol>
          <div className="order-ticket__seal">
            <span>合格目标</span>
            <strong>{commission.threshold}</strong>
          </div>
        </aside>

        <div className="character-stage">
          <div className="character-stage__halo" />
          <img src={commission.art} alt={`${commission.customer}的立绘`} />
        </div>

        <div className="dialogue-box" aria-live="polite">
          <div className="dialogue-box__speaker">{currentLine.speaker}</div>
          <p>{currentLine.text}</p>

          {reachedBranch && branchLine === undefined ? (
            <div className="dialogue-choices" aria-label={commission.branch.prompt}>
              {commission.branch.options.map((option) => (
                <button key={option.label} onClick={() => setBranchLine(option.response)}>
                  {option.label}
                </button>
              ))}
            </div>
          ) : (
            <button
              className="dialogue-next"
              onClick={() => {
                if (branchLine !== undefined) {
                  setBranchLine(undefined)
                  setLineIndex(commission.intro.length)
                  return
                }
                setLineIndex((index) => Math.min(index + 1, commission.intro.length))
              }}
              aria-label="下一句"
            >
              ▼
            </button>
          )}
        </div>
      </section>
    </main>
  )
}
