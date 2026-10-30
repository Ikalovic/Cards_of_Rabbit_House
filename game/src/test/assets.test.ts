import { describe, expect, it } from 'vitest'
import { createLayerFromAsset } from '../content/assets'

describe('commission asset placement', () => {
  it('places Chino coffee and thanks stamp in a readable starting layout', () => {
    const cup = createLayerFromAsset('coffee-cup', 'chino', 0, 'cup-1')
    const thanks = createLayerFromAsset('thanks-stamp', 'chino', 0, 'thanks-1')

    expect(cup).toMatchObject({ kind: 'sticker', x: 0.25, scale: 0.26 })
    expect(thanks).toMatchObject({ kind: 'text-stamp', x: 0.68, text: '谢谢光临' })
  })

  it('places Rize stars on opposite sides at matching height', () => {
    const left = createLayerFromAsset('star', 'rize', 0, 'star-1')
    const right = createLayerFromAsset('star', 'rize', 1, 'star-2')

    expect(left).toMatchObject({ x: 0.25, y: 0.5 })
    expect(right).toMatchObject({ x: 0.75, y: 0.5 })
  })

  it('keeps Chiya and Syaro tea cups in the lower half', () => {
    const left = createLayerFromAsset('tea-cup', 'chiya-sharo', 0, 'tea-1')
    const right = createLayerFromAsset('tea-cup', 'chiya-sharo', 1, 'tea-2')

    expect(left).toMatchObject({ x: 0.32, y: 0.68, scale: 0.2 })
    expect(right).toMatchObject({ x: 0.68, y: 0.68, scale: 0.2 })
  })
})
