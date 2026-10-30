import { ProductionCard } from '../ProductionCard'
import { ownValue } from '../../domain/own-value'
import { EmptyStation, StationNext, useStationAudio, useStationDraft } from './station-shared'

export const ISSUE_LABELS: Record<string, string> = {
  'paper-color-mismatch': '卡纸颜色与订单不同', 'paper-material-mismatch': '卡纸材质与订单不同', 'shape-mismatch': '成品卡型与订单不同',
  'orientation-mismatch': '成品方向与订单不同', 'layout-mismatch': '槽位版式与订单不同', 'required-content-missing': '还缺少订单中的必需内容',
  'required-content-type-mismatch': '有一件必需内容拿错了种类', 'assembly-slot-missing': '有素材没有放进卡片位置', 'assembly-slot-incompatible': '有素材放进了不合适的位置',
  'assembly-size-not-allowed': '有素材大小超出了所在位置的适用范围', 'assembly-direction-not-allowed': '有素材的方向不合适', 'assembly-layer-not-allowed': '有素材的前后层次不合适',
  'preference-unmet': '还有客人的喜好没有体现', 'taboo-violated': '卡片触及了客人明确不喜欢的内容', 'required-craft-missing': '还有必需工艺没有完成',
  'required-craft-kind-mismatch': '有一项工艺做成了别的种类', 'craft-discrete-mismatch': '工艺的颜色或印章款式与订单不同',
  'craft-measurement-missing': '有一项工艺尚未留下完整效果', 'craft-target-missed': '有工艺操作超出了订单的目标范围',
  'complex-card-quick-printer': '快印机会损失这张卡的精细效果', 'normal-patience-elapsed': '客人已经等候了一会儿，下次给冲印和交付多留些时间',
  'final-wait-delivery': '客人已经进入最后等待', 'final-wait-original-exhausted': '延长等待期间无法获得及时分',
}
export function InspectionStation() {
  const { draft, dispatch, run } = useStationDraft()
  useStationAudio(run, draft)
  if (!draft || !run) return <EmptyStation />
  return <div className="station-stack"><p className="station-intro">完整检查需要 5 秒，会一次列出这张卡的所有明显问题。检查用完后仍可收入卡册与冲印。</p>
    <div className="station-inspection-layout"><ProductionCard design={draft.design} /><div className="station-inspection-tools"><span className="station-tag">正式检查剩余 {run.inspectionsRemaining} 次</span><button data-sound="none" className="station-primary" disabled={run.inspectionsRemaining <= 0 || run.status !== 'running'} onClick={() => { void dispatch({ station: 'inspection', type: 'inspect', draftId: draft.id, freeDemo: false }) }}>完整检查 · 5 秒</button>{run.freeDemoInspectionsRemaining > 0 && <button data-sound="none" className="station-secondary" disabled={run.status !== 'running'} onClick={() => { void dispatch({ station: 'inspection', type: 'inspect', draftId: draft.id, freeDemo: true }) }}>教学示范检查 · 5 秒</button>}<p>客人与机器在检查期间仍会继续等待和工作。</p><StationNext station="print">去卡册与冲印台</StationNext></div></div>
    <div className="station-reports">{[...draft.inspections].reverse().map((report, index) => <article key={report.id} aria-label={`检查记录 ${draft.inspections.length - index}`} className="station-report"><header><strong>检查记录 {draft.inspections.length - index}</strong><span>{report.draftRevision === draft.revision ? '当前版本的检查' : '修改前的检查'}</span></header>{report.issues.length ? <ul>{[...new Set(report.issues.map(issue => issue.code))].map(code => <li key={code}>{ownValue(ISSUE_LABELS, code) ?? '卡片上还有需要留意的制作细节'}</li>)}</ul> : <p>✓ 未发现明显问题。接下来请留意冲印机与客人的等候时间。</p>}</article>)}{!draft.inspections.length && <p className="station-intro">还没有检查记录。可以先对照右侧订单自行查看。</p>}</div>
  </div>
}
