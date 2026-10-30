/** Mulberry32 with an explicit serializable state; helpers never mutate their input. */
export type ShiftRngState = Readonly<{ seed: string; state: number; cursor: number }>
export type RngDraw<T> = Readonly<{ value: T; rng: ShiftRngState }>

export function createRng(seed: string | number): ShiftRngState {
  const text = String(seed)
  let state = 2166136261
  for (let index = 0; index < text.length; index++) {
    state = Math.imul(state ^ text.charCodeAt(index), 16777619) >>> 0
  }
  return { seed: text, state, cursor: 0 }
}

export function nextRandom(rng: ShiftRngState): RngDraw<number> {
  const state = (rng.state + 0x6d2b79f5) >>> 0
  let value = Math.imul(state ^ (state >>> 15), state | 1)
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
  return {
    value: ((value ^ (value >>> 14)) >>> 0) / 4294967296,
    rng: { seed: rng.seed, state, cursor: rng.cursor + 1 },
  }
}

/** Both endpoints are inclusive. */
export function randomInt(rng: ShiftRngState, minimum: number, maximum: number): RngDraw<number> {
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || maximum < minimum || maximum - minimum >= 4294967296) {
    throw new RangeError('Integer bounds must form a nonempty range of at most 2^32 values')
  }
  const draw = nextRandom(rng)
  return { value: minimum + Math.floor(draw.value * (maximum - minimum + 1)), rng: draw.rng }
}

export function pickRandom<T>(rng: ShiftRngState, values: readonly T[]): RngDraw<T> {
  if (values.length === 0) throw new RangeError('Cannot pick from an empty collection')
  const draw = randomInt(rng, 0, values.length - 1)
  return { value: values[draw.value], rng: draw.rng }
}

export function shuffleRandom<T>(rng: ShiftRngState, values: readonly T[]): RngDraw<readonly T[]> {
  const result = [...values]
  let current = rng
  for (let index = result.length - 1; index > 0; index--) {
    const draw = randomInt(current, 0, index)
    current = draw.rng
    ;[result[index], result[draw.value]] = [result[draw.value], result[index]]
  }
  return { value: result, rng: current }
}

/** A named stream depends on the seed and label, never on unrelated draws/cursors. */
export function forkRng(rng: ShiftRngState, label: string): ShiftRngState {
  return createRng(JSON.stringify([rng.seed, label]))
}
