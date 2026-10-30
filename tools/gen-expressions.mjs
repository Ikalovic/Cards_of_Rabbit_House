// Dev-only: derive expression variants from each base portrait via /images/edits. Key from IMG_KEY.
import { readFile, writeFile, access } from 'node:fs/promises'
const URL_ = 'https://cdn.coderelay.cn/v1/images/edits'
const DIR = new URL('../game/public/assets/v2/characters/', import.meta.url).pathname
const KEEP = 'Same character, identical outfit, hairstyle, colors, proportions, art style and framing as the reference. Change only facial expression and a small hand gesture. Transparent background, single character, no text.'
const E = {
  cocoa: { smile: 'bright warm open smile', excited: 'over-excited sparkling eyes, both fists raised, leaning forward', sheepish: 'sheepish embarrassed laugh after being scolded, scratching cheek, small sweat drop', proud: 'proud big-sister pose, hand on chest, confident grin' },
  chino: { calm: 'calm neutral composed expression, hands together in front', deadpan: 'flat unimpressed deadpan stare, slightly half-lidded eyes', shy: 'slightly shy, faint blush, eyes glancing aside', smile: 'very small gentle soft smile, relieved' },
  rize: { briefing: 'reliable senior explaining, one finger raised, confident', serious: 'serious inspecting look, arms crossed, firm brows', flustered: 'flustered and blushing, waving hands in denial' },
  chiya: { smile: 'gentle serene smile, hands clasped', teasing: 'subtle mischievous teasing smile, hand covering mouth, playful eyes' },
  syaro: { polite: 'polite customer-service smile, hands neatly together', retort: 'quick tsukkomi retort, pointing hand, exasperated open mouth', troubled: 'troubled worried eyebrows, hand on forehead' },
}
const exists = p => access(p).then(() => true, () => false)
const jobs = Object.entries(E).flatMap(([c, m]) => Object.entries(m).map(([e, d]) => ({ c, e, d })))
async function run({ c, e, d }) {
  const out = `${DIR}${c}-${e}.png`
  if (await exists(out)) return console.log('skip', c, e)
  const ref = new Blob([await readFile(`${DIR}${c}.png`)], { type: 'image/png' })
  for (let a = 1; a <= 3; a++) {
    try {
      const f = new FormData()
      f.append('model', 'gpt-image-2.5-sunburst'); f.append('image', ref, `${c}.png`); f.append('size', '1024x1536')
      f.append('background', 'transparent'); f.append('prompt', `${KEEP}${c === 'chino' ? ' Tippy on her head is a round fluffy white fur ball with tiny short triangular ears, each only about 10-15% of the fur-ball body height; never long upright rabbit ears.' : ''} Expression: ${d}.`)
      const j = await (await fetch(URL_, { method: 'POST', headers: { Authorization: `Bearer ${process.env.IMG_KEY}` }, body: f })).json()
      const b = j.data?.[0]?.b64_json; if (!b) throw new Error(JSON.stringify(j).slice(0, 200))
      await writeFile(out, Buffer.from(b, 'base64')); return console.log('ok', c, e)
    } catch (err) { console.log('retry', c, e, a, String(err).slice(0, 120)) }
  }
  console.log('FAIL', c, e)
}
let i = 0
await Promise.all(Array.from({ length: 8 }, async () => { while (i < jobs.length) await run(jobs[i++]) }))
