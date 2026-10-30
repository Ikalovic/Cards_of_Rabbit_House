import { CardPreview } from '../components/CardPreview'
import { commissionFor } from '../content/commissions'
import type { Evaluation, SavedCard } from '../domain/types'

type ResultScreenProps = Readonly<{
  card?: SavedCard
  evaluation?: Evaluation
  continuesStory: boolean
  onRetry: () => void
  onContinue: () => void
}>

export function ResultScreen({ card, evaluation, continuesStory, onRetry, onContinue }: ResultScreenProps) {
  if (card === undefined) return null

  const commission = card.commissionId === undefined ? undefined : commissionFor(card.commissionId)
  const passed = evaluation?.passed ?? true
  const line = evaluation === undefined
    ? { speaker: '心爱', text: '自由制作的卡也完成啦！收进卡册以后还能再来看它。' }
    : passed
      ? commission!.successLine
      : commission!.retryLine

  return (
    <main className={`result-screen ${passed ? 'is-passed' : 'is-retry'}`}>
      <div className="result-confetti" aria-hidden="true">✦ · ✿ · ☆ · ✦</div>
      <header className="result-header">
        <span className="eyebrow">RABBIT HOUSE FINISHED CARD</span>
        <h1>{passed ? '成品已经冲印好了' : '再调整一次就会更好'}</h1>
      </header>

      <section className="result-layout">
        <div className="result-card-wrap">
          <CardPreview design={card.design} className="card-preview--result" />
          <span className="result-stamp" aria-hidden="true">RH<br />OK</span>
        </div>

        <div className="result-report">
          {evaluation === undefined ? (
            <div className="free-result-mark">
              <span aria-hidden="true">☕</span>
              <strong>今日自由作品</strong>
              <p>没有订单限制，它已经完整地留在 StampBook 里。</p>
            </div>
          ) : (
            <>
              <div className="score-total">
                <span>完成度</span>
                <strong>{evaluation.totalScore}</strong>
                <small>/ 100</small>
              </div>
              <div className="score-parts">
                {evaluation.parts.map((part) => (
                  <div key={part.key}>
                    <span>{part.label}</span>
                    <i><b style={{ width: `${(part.score / part.maxScore) * 100}%` }} /></i>
                    <strong>{part.score}</strong>
                  </div>
                ))}
              </div>
              {evaluation.advice.length > 0 && (
                <div className="result-advice">
                  <h2>{passed ? '下次可以试试' : '再整理一下'}</h2>
                  <ul>{evaluation.advice.map((advice) => <li key={advice}>{advice}</li>)}</ul>
                </div>
              )}
            </>
          )}

          <blockquote className="character-feedback">
            <strong>{line.speaker}</strong>
            <p>“{line.text}”</p>
          </blockquote>

          <div className="result-actions">
            {evaluation !== undefined && !evaluation.passed && (
              <button className="secondary-button" onClick={onRetry}>返回修改</button>
            )}
            <button className="primary-button primary-button--large" onClick={onContinue}>
              {evaluation?.passed && continuesStory
                ? commission?.id === 'chiya-sharo'
                  ? '看看大家的合照'
                  : '继续下一份委托'
                : evaluation === undefined || !continuesStory
                  ? '回到 StampBook'
                  : '继续整理'}
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}
