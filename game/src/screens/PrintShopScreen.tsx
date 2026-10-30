import { useEffect, useRef } from 'react'
import { useAudio } from '../app/AudioProvider'
import { CardPreview } from '../components/CardPreview'
import type { PrintJob, SavedCard, ShopReceipt } from '../domain/types'

type PrintShopScreenProps = Readonly<{
  card?: SavedCard
  job?: PrintJob
  receipt?: ShopReceipt
  error?: string
  onCancel: () => void
  onConfirm: () => void
  onResult: () => void
}>

const STATUS_COPY = {
  queued: { step: '01', title: '卡片已收入纸槽', note: '正在校准纸张的位置……' },
  processing: { step: '02', title: '正在冲印', note: '颜色与贴纸正在慢慢落到纸面上。' },
  succeeded: { step: '03', title: '冲印完成', note: '成品与工坊回执已经准备好了。' },
  failed: { step: '!', title: '纸张暂时停住了', note: '卡片没有丢失，可以返回后再试一次。' },
} as const
const PRINT_START_DELAY_MS = 650
const PRINT_FINISH_DELAY_MS = 1650

export function PrintShopScreen({ card, job, receipt, error, onCancel, onConfirm, onResult }: PrintShopScreenProps) {
  const { playSfx, setLoop } = useAudio()
  const previous = useRef<{ job?: PrintJob; error?: string } | null>(null)
  const resumeCutoff = useRef(-Infinity)
  const wasHidden = useRef(document.visibilityState === 'hidden')
  useEffect(() => {
    const visibility = () => {
      const hidden = document.visibilityState === 'hidden'
      const restored = wasHidden.current && !hidden
      wasHidden.current = hidden
      if (restored) resumeCutoff.current = Date.now()
      if (hidden || restored) {
        const finishesAt = job ? Date.parse(job.createdAt) + PRINT_FINISH_DELAY_MS : -Infinity
        setLoop(!hidden && card && job?.status === 'processing' && finishesAt > resumeCutoff.current ? 'printer_loop' : null)
      }
    }
    // Clear stale loop intent before the global mixer resumes on visibility change.
    document.addEventListener('visibilitychange', visibility, true)
    return () => document.removeEventListener('visibilitychange', visibility, true)
  }, [card?.cardId, job, setLoop])
  useEffect(() => {
    const before = previous.current
    previous.current = { job, error }
    if (!before) return
    const createdAt = job ? Date.parse(job.createdAt) : -Infinity
    const staleFailure = Boolean(job && resumeCutoff.current > -Infinity
      && (!Number.isFinite(createdAt) || createdAt <= resumeCutoff.current))
    const newError = Boolean(error && error !== before.error)
    if (newError && !staleFailure) playSfx('ui_unavailable')
    if (!job || !before.job || before.job.printJobId !== job.printJobId || before.job.status === job.status) return
    if (job.status === 'processing' && createdAt + PRINT_START_DELAY_MS > resumeCutoff.current) playSfx('printer_start')
    if (job.status === 'succeeded' && createdAt + PRINT_FINISH_DELAY_MS > resumeCutoff.current) playSfx('machine_ready')
    // Failed jobs have no event timestamp; do not announce an old job after recovery.
    if (job.status === 'failed' && !newError && !staleFailure) playSfx('ui_unavailable')
  }, [error, job, playSfx])
  useEffect(() => {
    const finishesAt = job ? Date.parse(job.createdAt) + PRINT_FINISH_DELAY_MS : -Infinity
    setLoop(document.visibilityState !== 'hidden' && card && job?.status === 'processing'
      && finishesAt > resumeCutoff.current ? 'printer_loop' : null)
    return () => setLoop(null)
  }, [card?.cardId, job?.createdAt, job?.status, setLoop])
  if (card === undefined) {
    return (
      <main className="print-screen print-screen--empty">
        <h1>冲印台</h1>
        <p>请先从 StampBook 中选一张卡。</p>
        <button className="secondary-button" onClick={onCancel}>返回卡册</button>
      </main>
    )
  }

  const copy = job === undefined ? undefined : STATUS_COPY[job.status]

  return (
    <main className="print-screen">
      <header className="print-header">
        <button
          className="ghost-button"
          onClick={onCancel}
          disabled={job !== undefined && job.status !== 'succeeded' && job.status !== 'failed'}
        >
          ← 返回 StampBook
        </button>
        <div>
          <span className="eyebrow">RABBIT HOUSE WORKSHOP</span>
          <h1>冲印台</h1>
        </div>
        <span className="print-header__light" data-active={job !== undefined}>●</span>
      </header>

      <section className="print-layout">
        <div className="print-card-tray">
          <span className="print-card-tray__label">PRINT PREVIEW</span>
          <CardPreview design={card.design} className={`card-preview--print ${job?.status === 'succeeded' ? 'is-ejected' : ''}`} />
        </div>

        <div className={`printer-machine${job === undefined ? '' : ` is-${job.status}`}`} aria-label="冲印机">
          <div className="printer-machine__top">
            <span />
            <span />
            <span />
          </div>
          <div className="printer-machine__display">
            <small>RABBIT HOUSE</small>
            <strong>{copy?.title ?? '等待放入卡片'}</strong>
          </div>
          <div className="printer-machine__slot">
            <i />
          </div>
          <div className="printer-machine__rabbit" aria-hidden="true">🐇</div>
        </div>

        <aside className="print-receipt">
          <span className="print-receipt__tear" aria-hidden="true" />
          <h2>{job === undefined ? '冲印前确认' : `工序 ${copy?.step}`}</h2>
          {error !== undefined && <p role="alert">{error}</p>}
          {job === undefined ? (
            <>
              <p>这一步会把 StampBook 中选定的卡片送进冲印机。</p>
              <p>你还可以返回卡册，收藏好的卡片不会改变。</p>
              <button className="primary-button primary-button--large" onClick={onConfirm}>确认冲印</button>
            </>
          ) : (
            <>
              <div className="print-status-row">
                <span className="print-status-row__number">{copy?.step}</span>
                <div>
                  <strong>{copy?.title}</strong>
                  <p>{copy?.note}</p>
                </div>
              </div>
              <div className="print-progress" aria-label="冲印进度">
                <i data-status={job.status} />
              </div>
              {job.status === 'succeeded' && (
                <>
                  {receipt && (
                    <div className="print-receipt">
                      <h3>{receipt.title}</h3>
                      <pre>{receipt.bodyText}</pre>
                    </div>
                  )}
                  <button className="primary-button primary-button--large" onClick={onResult}>
                    取出成品
                  </button>
                </>
              )}
              {job.status === 'failed' && (
                <div className="print-retry-actions">
                  <button className="secondary-button" onClick={onCancel}>返回卡册</button>
                  <button className="primary-button" onClick={onConfirm}>重新冲印</button>
                </div>
              )}
            </>
          )}
        </aside>
      </section>
    </main>
  )
}
