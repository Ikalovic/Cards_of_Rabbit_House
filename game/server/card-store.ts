/** Session-owned server-side card storage. */

import { randomUUID } from 'node:crypto'
import type { CardId, RequestId, SavedCard } from '../src/domain/types'
import type { SaveCardCommand } from '../src/domain/gateways'

type StoredCardRecord = Readonly<{
  ownerSessionId: string
  card: SavedCard
}>

type CardRequestBinding = Readonly<{
  requestId: RequestId
  requestFingerprint: string
  cardId: CardId
}>

export class ServerCardStore {
  readonly #cards = new Map<CardId, StoredCardRecord>()
  readonly #requests = new Map<string, CardRequestBinding>()

  constructor(
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async save(sessionId: string, command: SaveCardCommand): Promise<SavedCard> {
    const fingerprint = this.fingerprint(sessionId, command)
    const existing = this.#requests.get(fingerprint)
    if (existing !== undefined) {
      if (existing.requestId !== command.requestId) {
        throw new Error('REQUEST_CONFLICT')
      }
      return this.clone(this.#cards.get(existing.cardId)!.card)
    }

    const cardId: CardId = `card:${randomUUID()}`
    const card: SavedCard = {
      cardId,
      design: this.clone(command.design),
      source: { kind: 'native' },
      ...(command.commissionId === undefined ? {} : { commissionId: command.commissionId }),
      savedAt: this.now(),
    }

    this.#cards.set(cardId, { ownerSessionId: sessionId, card })
    this.#requests.set(fingerprint, { requestId: command.requestId, requestFingerprint: fingerprint, cardId })
    return this.clone(card)
  }

  get(sessionId: string, cardId: CardId): SavedCard | undefined {
    const record = this.#cards.get(cardId)
    if (record === undefined || record.ownerSessionId !== sessionId) return undefined
    return this.clone(record.card)
  }

  list(sessionId: string): readonly SavedCard[] {
    return [...this.#cards.values()]
      .filter((record) => record.ownerSessionId === sessionId)
      .map((record) => this.clone(record.card))
  }

  private fingerprint(sessionId: string, command: SaveCardCommand): string {
    return `${sessionId}:${command.requestId}:${JSON.stringify(command)}`
  }

  private clone<T>(value: T): T {
    return structuredClone(value)
  }
}
