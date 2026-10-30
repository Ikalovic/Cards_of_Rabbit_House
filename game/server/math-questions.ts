import type { MathQuestion } from './private-puzzle-types'
import source from './数学题库_分类整理版.json'

export type MathQuestionValidationError = Readonly<{ index: number; id: string | null; message: string }>
export type MathQuestionValidation = Readonly<{
  questions: readonly MathQuestion[]
  errors: readonly MathQuestionValidationError[]
}>

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.normalize('NFKC').replace(/\s/gu, '').length > 0
}

function dense(value: readonly unknown[]): boolean {
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) return false
  }
  return true
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && dense(value) && value.every(nonempty)
}

// These exact paths are the two original image files supplied with this bank.
// Registration is closed: neither imported nor restored questions may introduce network URLs.
const sourceImagePaths: Readonly<Record<string, string>> = {
  'assets/single_14.png': '/assets/math/questions/single_14.png',
  'assets/multiple_03.png': '/assets/math/questions/multiple_03.png',
}
const bundledImagePaths = new Set(Object.values(sourceImagePaths))

function validImages(value: unknown): value is NonNullable<MathQuestion['images']> {
  return Array.isArray(value) && value.length > 0 && dense(value)
    && value.every(image => record(image) && typeof image.src === 'string' && bundledImagePaths.has(image.src) && nonempty(image.alt))
}

function validTable(value: unknown): value is NonNullable<MathQuestion['table']> {
  if (!record(value) || !strings(value.headers)) return false
  const columns = value.headers.length
  return Array.isArray(value.rows) && value.rows.length > 0 && dense(value.rows)
    && value.rows.every(row => strings(row) && row.length === columns)
}

/** Invalid entries are excluded with explicit errors; they are never repaired or replaced. */
export function validateMathQuestionBank(input: readonly unknown[]): MathQuestionValidation {
  const questions: MathQuestion[] = []
  const errors: MathQuestionValidationError[] = []
  const counts = new Map<string, number>()
  for (const candidate of input) {
    if (record(candidate) && nonempty(candidate.id)) counts.set(candidate.id, (counts.get(candidate.id) ?? 0) + 1)
  }
  input.forEach((candidate, index) => {
    const reject = (message: string) => errors.push({ index, id: record(candidate) && typeof candidate.id === 'string' ? candidate.id : null, message })
    if (!record(candidate) || !nonempty(candidate.id) || !nonempty(candidate.prompt)) {
      reject('题目必须提供非空编号与题干')
      return
    }
    if (counts.get(candidate.id) !== 1) {
      reject('题目编号重复，所有重名题目均已禁用')
      return
    }
    if (typeof candidate.timeLimitSeconds !== 'number' || !Number.isInteger(candidate.timeLimitSeconds) || candidate.timeLimitSeconds < 60 || candidate.timeLimitSeconds > 120) {
      reject('数学题限时必须为 60–120 秒的整数')
      return
    }
    if (candidate.images !== undefined && !validImages(candidate.images)) {
      reject('题目图片必须使用已登记的本地图片并提供替代文字')
      return
    }
    if (candidate.table !== undefined && !validTable(candidate.table)) {
      reject('题目表格必须有非空表头和完整等宽的数据行')
      return
    }
    const common = { id: candidate.id, prompt: candidate.prompt, timeLimitSeconds: candidate.timeLimitSeconds,
      ...(candidate.images === undefined ? {} : { images: candidate.images.map(image => ({ src: image.src, alt: image.alt })) }),
      ...(candidate.table === undefined ? {} : { table: { headers: [...candidate.table.headers], rows: candidate.table.rows.map(row => [...row]) } }),
    }
    if (candidate.kind === 'math-choice') {
      if (!Array.isArray(candidate.options) || candidate.options.length < 2 || !dense(candidate.options) || !candidate.options.every((option) => record(option) && nonempty(option.id) && nonempty(option.label))) {
        reject('选择题必须提供至少两个带编号与文字的有序选项')
        return
      }
      const options = candidate.options.map((option: { id: string; label: string }) => ({ id: option.id, label: option.label }))
      const optionIds = new Set(options.map((option) => option.id))
      if (optionIds.size !== options.length || !strings(candidate.correctOptionIds) || new Set(candidate.correctOptionIds).size !== candidate.correctOptionIds.length || !candidate.correctOptionIds.every((id) => optionIds.has(id))) {
        reject('选项编号必须唯一，正确答案必须是选项中非空且无重复的集合')
        return
      }
      if (candidate.multiple !== undefined && typeof candidate.multiple !== 'boolean') {
        reject('选择题模式必须是布尔值')
        return
      }
      questions.push({ ...common, kind: 'math-choice', options, correctOptionIds: [...candidate.correctOptionIds],
        ...(candidate.multiple === undefined ? {} : { multiple: candidate.multiple }) })
    } else if (candidate.kind === 'math-fill') {
      if (!strings(candidate.acceptedAnswers)) {
        reject('填空题必须提供至少一个非空可接受答案')
        return
      }
      questions.push({ ...common, kind: 'math-fill', acceptedAnswers: [...candidate.acceptedAnswers] })
    } else {
      reject('题型必须为数学选择题或数学填空题')
    }
  })
  return { questions, errors }
}

type SourceCategory = '单选题' | '多选题' | '填空题'
const categories: readonly SourceCategory[] = ['单选题', '多选题', '填空题']
const prefixes: Readonly<Record<SourceCategory, string>> = { 单选题: 'single', 多选题: 'multiple', 填空题: 'fill' }
const optionIds = ['A', 'B', 'C', 'D'] as const

/** Fixed editorial bands, based on the supplied question number, never on a random draw.
 * Tier 0 = substitution/one standard identity; 1 = two steps or a short case analysis;
 * 2 = longer reasoning. Single: 60/75/90s; multiple: 90/105/120s (check four claims);
 * fill: 75/90/105s (derive and type the formula). Future numbers default to tier 2.
 * The explicit lists preserve each question's time if the file is reordered or retried.
 */
function sourceTimeLimit(category: SourceCategory, number: number): number {
  const bands: Readonly<Record<SourceCategory, readonly [readonly number[], readonly number[]]>> = {
    单选题: [[1, 2, 3, 9, 10, 11, 12, 17, 18], [4, 5, 13, 14, 15, 19, 20, 21]],
    多选题: [[4, 7], [1, 2, 3, 8]],
    填空题: [[4, 7], [1, 2, 5, 6, 8]],
  }
  const tier = bands[category][0].includes(number) ? 0 : bands[category][1].includes(number) ? 1 : 2
  return ({ 单选题: 60, 多选题: 90, 填空题: 75 } as const)[category] + tier * 15
}

/** Adapt the unedited owner source. Invalid records produce diagnostics; no answer is inferred. */
export function adaptClassifiedMathQuestionBank(input: unknown): MathQuestionValidation {
  const errors: MathQuestionValidationError[] = []
  if (!record(input) || Object.keys(input).length !== categories.length || !categories.every(category => Array.isArray(input[category]))) {
    return { questions: [], errors: [{ index: -1, id: null, message: '题库必须包含单选题、多选题、填空题三个数组分类' }] }
  }
  const candidates: unknown[] = []
  const sourceIndices: number[] = []
  let index = 0
  for (const category of categories) {
    const entries = input[category] as unknown[]
    const identity = (entry: unknown): string | null => record(entry) && typeof entry.number === 'number'
      && Number.isSafeInteger(entry.number) && entry.number > 0 ? `${prefixes[category]}-${String(entry.number).padStart(2, '0')}` : null
    const counts = new Map<string, number>()
    for (const entry of entries) {
      const id = identity(entry)
      if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    for (const entry of entries) {
      const sourceIndex = index++
      const id = identity(entry)
      const reject = (message: string) => errors.push({ index: sourceIndex, id, message })
      if (!record(entry) || id === null || !nonempty(entry.stem) || !nonempty(entry.answer)) {
        reject('原题必须提供正整数编号、非空题干与答案')
        continue
      }
      if (counts.get(id) !== 1) {
        reject('题目编号重复，所有重名题目均已禁用')
        continue
      }
      let images: NonNullable<MathQuestion['images']> | undefined
      if (entry.images !== undefined) {
        if (!Array.isArray(entry.images) || entry.images.length === 0 || !dense(entry.images)) {
          reject('题目图片声明必须是非空数组')
          continue
        }
        const missing = entry.images.find(image => !record(image) || typeof image.path !== 'string' || !Object.hasOwn(sourceImagePaths, image.path))
        if (missing !== undefined) {
          reject(`缺少已登记的本地题目图片：${record(missing) && typeof missing.path === 'string' ? missing.path : '无效图片路径'}`)
          continue
        }
        if (!entry.images.every(image => record(image) && nonempty(image.alt))) {
          reject('题目图片必须提供非空替代文字')
          continue
        }
        images = entry.images.map(image => ({ src: sourceImagePaths[image.path], alt: image.alt }))
      }
      const common = { id, prompt: entry.stem, timeLimitSeconds: sourceTimeLimit(category, entry.number as number),
        ...(images === undefined ? {} : { images }), ...(entry.table === undefined ? {} : { table: entry.table }),
      }
      if (category === '填空题') {
        candidates.push({ ...common, kind: 'math-fill', acceptedAnswers: [entry.answer] })
      } else {
        if (!record(entry.options) || Object.keys(entry.options).length !== optionIds.length || !optionIds.every(id => nonempty((entry.options as Record<string, unknown>)[id]))) {
          reject('选择题必须提供恰好 A–D 四个非空选项')
          continue
        }
        // Only the declared A–D alphabet and the source's Chinese separator are accepted.
        // In particular, single-23 says its premises contradict; it cannot map to any option.
        if (!(category === '单选题' ? /^[A-D]$/u : /^[A-D](?:、[A-D])*$/u).test(entry.answer)) {
          reject('正确答案必须是 A–D 合法选项集合；题设矛盾或非选项答案不能启用')
          continue
        }
        const correctOptionIds = entry.answer.split('、')
        if (new Set(correctOptionIds).size !== correctOptionIds.length) {
          reject('正确答案的 A–D 选项集合不能重复')
          continue
        }
        candidates.push({ ...common, kind: 'math-choice', options: optionIds.map(id => ({ id, label: (entry.options as Record<string, unknown>)[id] })), correctOptionIds, multiple: category === '多选题' })
      }
      sourceIndices.push(sourceIndex)
    }
  }
  const checked = validateMathQuestionBank(candidates)
  errors.push(...checked.errors.map(error => ({ ...error, index: sourceIndices[error.index] })))
  return { questions: checked.questions, errors: errors.sort((left, right) => left.index - right.index) }
}

// Kept verbatim, including the contradictory single-23 entry, for source auditing.
export const MATH_QUESTION_SOURCE = source
const imported = adaptClassifiedMathQuestionBank(MATH_QUESTION_SOURCE)
export const MATH_QUESTION_IMPORT_ERRORS: readonly MathQuestionValidationError[] = Object.freeze(imported.errors)
export const MATH_QUESTION_BANK: readonly MathQuestion[] = Object.freeze(imported.questions)
