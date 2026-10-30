type EndingScreenProps = Readonly<{
  onFreeCreate: () => void
  onTitle: () => void
}>

export function EndingScreen({ onFreeCreate, onTitle }: EndingScreenProps) {
  return (
    <main className="ending-screen">
      <div className="ending-screen__background" />
      <section className="ending-collage" aria-label="Rabbit House 手作周末合照">
        <img className="ending-collage__cocoa" src="/assets/characters/cocoa-chino-tippy-api.png" alt="心爱、智乃和提比" />
        <img className="ending-collage__rize" src="/assets/characters/rize-api.png" alt="理世" />
        <img className="ending-collage__chiya" src="/assets/characters/chiya-syaro-api.png" alt="千夜和纱路" />
      </section>
      <section className="ending-panel">
        <span className="eyebrow">ALL ORDERS COMPLETE</span>
        <h1>手作周末·圆满收工</h1>
        <div className="ending-lines">
          <p><strong>心爱</strong>那就再做一张大家都在的卡吧！</p>
          <p><strong>理世</strong>好，我来确认制作顺序。</p>
          <p><strong>千夜</strong>名字就叫“回忆与兔子共舞的——”</p>
          <p><strong>纱路</strong>又要从名字开始吗！</p>
          <p><strong>智乃</strong>……做好的话，我会把它收在 StampBook 最前面。</p>
          <p><strong>提比</strong>哼，这才像 Rabbit House 的手艺。</p>
        </div>
        <div className="ending-actions">
          <button className="primary-button primary-button--large" onClick={onFreeCreate}>进入自由制作</button>
          <button className="secondary-button" onClick={onTitle}>回到门口</button>
        </div>
      </section>
    </main>
  )
}
