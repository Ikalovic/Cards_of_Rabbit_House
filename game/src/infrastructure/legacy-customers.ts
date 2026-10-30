import { ORDER_TEMPLATES } from '../content/production'

const LEGACY_CUSTOMERS = [
  { identity: 'student', name: '放学的学生', title: '学生的友谊小卡', replacement: 'maya-friendship' },
  { identity: 'office-worker', name: '午休的上班族', title: '上班族的感谢卡', replacement: 'rin-thanks' },
  { identity: 'tourist', name: '街角的游客', title: '游客的旅行票卡', replacement: 'fuyu-visit' },
  { identity: 'neighbor', name: '熟悉的街坊', title: '街坊的茶会邀请', replacement: 'moka-tea' },
  { identity: 'collector', name: '卡片收藏家', title: '收藏家的纪念卡', replacement: 'aoyama-keepsake' },
  { identity: 'hurried', name: '提着礼物的客人', title: '赶路客人的礼物吊牌', replacement: 'yura-gift' },
] as const

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function migrateOrder(value: unknown): void {
  if (!object(value) || typeof value.id !== 'string' || !value.id.trim() || typeof value.title !== 'string'
    || !object(value.customer) || value.customer.kind !== 'regular'
    || typeof value.customer.name !== 'string' || typeof value.customer.situation !== 'string'
    || typeof value.customer.personality !== 'string') return
  const customer = value.customer
  const legacy = LEGACY_CUSTOMERS.find(entry => entry.identity === customer.identity)
  const replacement = ORDER_TEMPLATES.find(template => template.id === legacy?.replacement)
  if (!legacy || !replacement) return
  // All order IDs and production requirements remain tied to their original run.
  value.title = replacement.title
  value.customer = { ...replacement.customer }
}

/** Only modifies freshly parsed data. Reading a save never writes or advances its revision. */
export function migrateLegacyCustomerSnapshot(value: unknown): void {
  if (!object(value) || !object(value.run)) return
  if (object(value.run.stage) && Array.isArray(value.run.stage.customers)) {
    for (const scheduled of value.run.stage.customers) if (object(scheduled)) migrateOrder(scheduled.order)
  }
  if (Array.isArray(value.run.orders)) {
    for (const order of value.run.orders) if (object(order)) migrateOrder(order.content)
  }
}

/** Workshop drafts store presentation metadata separately from the immutable card design. */
export function migrateLegacyWorkshopCustomer(value: unknown): void {
  if (!object(value) || typeof value.title !== 'string') return
  const legacy = LEGACY_CUSTOMERS.find(entry => entry.name === value.customerName)
  const replacement = ORDER_TEMPLATES.find(template => template.id === legacy?.replacement)
  if (!legacy || !replacement) return
  value.customerName = replacement.customer.name
  if (value.title === legacy.title) value.title = replacement.title
}
