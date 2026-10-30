import { PRODUCTION_ASSETS, type CharacterPortrait } from '../content/production-assets'
import type { CustomerIdentity } from '../domain/shift-types'

const official: Record<Extract<CustomerIdentity, { kind: 'official' }>['characterId'], CharacterPortrait> = {
  cocoa: { assetId: 'cocoa-chino-tippy', cropId: 'cocoa' }, chino: { assetId: 'cocoa-chino-tippy', cropId: 'chino' },
  rize: { assetId: 'rize', cropId: 'rize' }, chiya: { assetId: 'chiya-syaro', cropId: 'chiya' }, syaro: { assetId: 'chiya-syaro', cropId: 'syaro' },
  maya: { assetId: 'maya', cropId: 'maya' }, megu: { assetId: 'megu', cropId: 'megu' },
  aoyama: { assetId: 'aoyama', cropId: 'aoyama' }, rin: { assetId: 'rin', cropId: 'rin' },
  moka: { assetId: 'moka', cropId: 'moka' }, yura: { assetId: 'yura', cropId: 'yura' },
  fuyu: { assetId: 'fuyu', cropId: 'fuyu' }, natsume: { assetId: 'natsume', cropId: 'natsume' }, elulu: { assetId: 'elulu', cropId: 'elulu' },
}
function portraitFor(customer: CustomerIdentity): CharacterPortrait | undefined {
  return customer.kind === 'official' ? official[customer.characterId] : undefined
}

export function CustomerPortrait({ customer, portrait = portraitFor(customer) }: Readonly<{ customer: CustomerIdentity; portrait?: CharacterPortrait }>) {
  if (!portrait) return null
  const sheet = PRODUCTION_ASSETS.find(asset => asset.id === portrait.assetId)
  if (sheet?.kind !== 'character-sheet') return null
  const crop = sheet.crops.find(item => item.id === portrait.cropId)
  if (!crop) return null
  // Preserve each original's aspect ratio and crop around its own catalogued face.
  const { width, height } = sheet.dimensions
  const focus = crop.focus ?? { x: 0.5, y: 0.5 }
  const size = Math.min(crop.width * width, crop.height * height)
  const x = Math.max(crop.x * width, Math.min((crop.x + crop.width) * width - size, (crop.x + crop.width * focus.x) * width - size / 2))
  const y = Math.max(crop.y * height, Math.min((crop.y + crop.height) * height - size, (crop.y + crop.height * focus.y) * height - size / 2))
  return <svg className="shift-customer-portrait" viewBox={`${x} ${y} ${size} ${size}`} role="img" aria-label={`${customer.name}的头像`}>
    <image href={sheet.src} width={width} height={height} />
  </svg>
}
