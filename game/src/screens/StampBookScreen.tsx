import { useState } from 'react'
import { useAudio } from '../app/AudioProvider'
import { CardPreview } from '../components/CardPreview'
import { ProductionCard } from '../components/ProductionCard'
import type { ShiftCardSnapshot, WorkshopDraft } from '../domain/shift-types'
import type { CardId, SavedCard } from '../domain/types'
import { prepareWorkshopTransfer } from '../app/workshop-transfer'

type StampBookScreenProps = Readonly<{
  cards: readonly SavedCard[]
  selectedCard?: SavedCard
  productionCards?: readonly ShiftCardSnapshot[]
  workshopDrafts?: readonly WorkshopDraft[]
  onContinueDraft?: (draft: WorkshopDraft) => void
  onSelect: (cardId: CardId) => void
  onEdit: () => void
  onPrint: () => void
  onBack: () => void
}>

const savedTime = (value: string | number) => {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return '今日'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function StampBookScreen({
  cards,
  selectedCard,
  productionCards = [],
  workshopDrafts = [],
  onContinueDraft,
  onSelect,
  onEdit,
  onPrint,
  onBack,
}: StampBookScreenProps) {
  const { playSfx } = useAudio()
  const [selectedProductionId, setSelectedProductionId] = useState<string>()
  const [selectedDraftId, setSelectedDraftId] = useState<string>()
  const selectedDraft = workshopDrafts.find(draft => draft.id === selectedDraftId)
  const transfer = selectedDraft ? prepareWorkshopTransfer(selectedDraft.design) : null
  const selectedProduction = selectedDraft ? undefined : productionCards.find(card => card.id === selectedProductionId)
    ?? (selectedCard === undefined ? productionCards[0] : undefined)
  return (
    <main className="book-screen">
      <header className="book-header">
        <button className="ghost-button" onClick={onBack}>← 回到制卡桌</button>
        <div>
          <span className="eyebrow">RABBIT HOUSE COLLECTION</span>
          <h1>StampBook</h1>
        </div>
        <div className="book-header__count">
          <strong>{cards.length + productionCards.length}</strong>
          <span>张收藏卡</span>
        </div>
      </header>

      <section className="book-layout">
        <aside className="book-index">
          <div className="book-index__rings" aria-hidden="true" />
          <h2>自由工坊</h2>
          {cards.length === 0 ? (
            <p className="empty-note">制作完成的卡片会出现在这里。</p>
          ) : (
            <div className="card-index-list">
              {cards.map((card, index) => (
                <button
                  key={card.cardId}
                  className={!selectedDraft && !selectedProduction && card.cardId === selectedCard?.cardId ? 'is-active' : ''}
                  aria-pressed={!selectedDraft && !selectedProduction && card.cardId === selectedCard?.cardId}
                  data-sound="none"
                  onClick={() => {
                    setSelectedDraftId(undefined); setSelectedProductionId(undefined); onSelect(card.cardId)
                    if (selectedDraft || selectedProduction || card.cardId !== selectedCard?.cardId) playSfx('book_page')
                  }}
                >
                  <span className={`mini-paper mini-paper--${card.design.paperId}`}>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span>
                    <strong>
                      {`收藏卡 ${String(index + 1).padStart(2, '0')}`}
                    </strong>
                    <small>{savedTime(card.savedAt)}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
          <h2>值班纪念</h2>
          {productionCards.length === 0 ? <p className="empty-note">值班时收入 StampBook 的作品会立刻留在这里。</p> : (
            <div className="card-index-list">
              {productionCards.map((card, index) => (
                <button key={card.id} className={card.id === selectedProduction?.id ? 'is-active' : ''}
                  aria-pressed={card.id === selectedProduction?.id}
                  data-sound="none"
                  onClick={() => {
                    setSelectedDraftId(undefined); setSelectedProductionId(card.id)
                    if (card.id !== selectedProduction?.id) playSfx('book_page')
                  }}>
                  <span className={`mini-paper mini-paper--${card.design.preparation.paperId ?? 'cream'}`}>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span><strong>值班纪念 {String(index + 1).padStart(2, '0')}</strong><small>{savedTime(card.savedAtMs)}</small></span>
                </button>
              ))}
            </div>
          )}
          {workshopDrafts.length > 0 && <><h2>未完成的心意</h2>
            <p className="empty-note">闭店后留下的草稿，可以带到自由工坊慢慢完成。</p>
            <div className="card-index-list">{workshopDrafts.map(draft => <button key={draft.id}
              className={draft.id === selectedDraft?.id ? 'is-active' : ''} aria-pressed={draft.id === selectedDraft?.id}
              data-sound="none"
              onClick={() => {
                setSelectedProductionId(undefined); setSelectedDraftId(draft.id)
                if (draft.id !== selectedDraft?.id) playSfx('book_page')
              }}>
              <span className="mini-paper mini-paper--cream" aria-hidden="true">✎</span>
              <span><strong>{draft.title}</strong><small>{draft.customerName} · {savedTime(draft.savedAtMs)}</small></span>
            </button>)}</div></>}
        </aside>

        <div className="book-detail">
          {selectedDraft && transfer ? <>
            <div className="book-detail__preview"><ProductionCard design={selectedDraft.design} /></div>
            <div className="book-detail__caption"><span>未完成的心意</span><strong>{selectedDraft.title}</strong></div>
            <section aria-label="带入工坊前看一眼">
              <h2>带到工坊继续做</h2>
              <p>可带入：{transfer.carried.join('、')}。</p>
              {transfer.adjustments.length > 0 && <ul>{transfer.adjustments.map(note => <li key={note}>{note}</li>)}</ul>}
              <p>这份原草稿会一直保留。带入后是一张自由作品，不能再交给已经离店的客人。</p>
              <button className="primary-button" disabled={!onContinueDraft} onClick={() => onContinueDraft?.(selectedDraft)}>带入自由工坊继续制作</button>
            </section>
          </> : selectedProduction ? (
            <>
              <div className="book-detail__preview"><ProductionCard design={selectedProduction.design} /></div>
              <div className="book-detail__caption"><span>已收入 StampBook</span><strong>值班时亲手完成的纪念</strong></div>
              <p className="book-reassurance">这份作品会按当时的模样珍藏，供你随时翻看。</p>
            </>
          ) : selectedCard === undefined ? (
            <div className="book-empty">
              <span aria-hidden="true">✦</span>
              <h2>还没有选中卡片</h2>
              <p>先在左侧翻开一页收藏吧。</p>
            </div>
          ) : (
            <>
              <div className="book-detail__preview">
                <span className="tape tape--left" aria-hidden="true" />
                <span className="tape tape--right" aria-hidden="true" />
                <CardPreview design={selectedCard.design} className="card-preview--book" />
              </div>
              <div className="book-detail__caption">
                <span>已收入 StampBook</span>
                <strong>
                  卡纸与贴纸都已安全保留
                </strong>
              </div>
              <div className="book-actions">
                <button className="secondary-button" onClick={onEdit}>继续修改</button>
                <button className="primary-button primary-button--large" onClick={onPrint}>
                  送去冲印 <span aria-hidden="true">→</span>
                </button>
              </div>
              <p className="book-reassurance">送去冲印前还会再向你确认一次。</p>
            </>
          )}
        </div>
      </section>
    </main>
  )
}
