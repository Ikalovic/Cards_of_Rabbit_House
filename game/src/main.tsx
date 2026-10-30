import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { bootstrapExamSession, examNow, examRequest } from './infrastructure/exam-session'
import './styles/game.css'
import './styles/screens.css'
import './styles/v2.css'

const root = createRoot(document.getElementById('root')!)
let generation = 0
async function start() {
  const current = ++generation
  root.render(<main className="shift-loading"><p role="status">正在打开今天的营业簿……</p></main>)
  try {
    await bootstrapExamSession()
    if (generation === current) root.render(<StrictMode><App now={examNow} /></StrictMode>)
  } catch (error) {
    if (generation === current) root.render(<main className="shift-loading"><p role="alert">{error instanceof Error ? error.message : '暂时无法打开营业簿。'}</p><button onClick={() => { void start() }}>重新连接</button></main>)
  }
}
window.addEventListener('exam-session-restarted', () => {
  generation++
  root.render(<main className="shift-loading"><p role="status">店里的营业记录已重新开始，旧进度已清空。</p><button onClick={() => { void start() }}>重新进入游戏</button></main>)
})
const checkSession = () => { void examRequest('/api/storage').catch(() => undefined) }
window.setInterval(checkSession, 15_000)
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkSession() })
void start()
