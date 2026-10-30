/** Render a workshop receipt for a saved card owned by the current session. */

import type { PrintRecord } from '../src/domain/gateways'
import type { ShopReceipt } from '../src/domain/types'
import type { ServerCardStore } from './card-store'

type WorkshopRenderResult = Readonly<{ status: 'succeeded' | 'failed'; receipt: ShopReceipt }>

export async function renderWorkshop(
  record: PrintRecord,
  cards: ServerCardStore,
  sessionId: string,
): Promise<WorkshopRenderResult> {
  const card = cards.get(sessionId, record.snapshotId)
  if (!card) throw new Error('CARD_NOT_FOUND')

  return {
    status: 'succeeded',
    receipt: {
      receiptId: record.receiptId,
      title: 'Rabbit House 工坊回执',
      bodyText: [
        'Rabbit House 工坊回执',
        '',
        `卡片编号：${card.cardId}`,
        '来源：现代卡片',
        `纸张：${card.design.paperId}`,
        `图层数：${card.design.layers.length}`,
        '',
        '冲印已完成。',
      ].join('\n'),
    },
  }
}
