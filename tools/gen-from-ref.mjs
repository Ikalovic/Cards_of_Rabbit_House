// Dev-only: redraw base portraits from owner-supplied references in materials/characters/references/ via /images/edits. Key from IMG_KEY.
import { readFile, writeFile, access } from 'node:fs/promises'
const ROOT = new URL('../', import.meta.url).pathname
const OUT = `${ROOT}game/public/assets/v2/`
const STYLE = 'Polished Japanese anime visual-novel illustration, soft cel shading, clean outlines, full color. Transparent background, single character only, no text, no logo, no watermark, no frame, no extra views.'
const JOBS = [
  { ref: '心爱', out: 'characters/cocoa.png', size: '1024x1536', prompt: 'Cocoa Hoto exactly as in the reference: shoulder-length light orange-brown hair with a small hair clip, violet eyes; Rabbit House uniform: white long-sleeve blouse with a red ribbon bow, PINK vest with dark brown trim and buttons, LONG dark brown skirt reaching below the knees, black tights, dark brown boots. Single full-body standing portrait, front three-quarter view, bright warm open smile, hands relaxed. No apron, no white socks.' },
  { ref: '理世', out: 'characters/rize.png', size: '1024x1536', prompt: 'Rize Tedeza exactly as in the reference: long purple hair in high twin tails, violet eyes; Rabbit House uniform: white long-sleeve blouse with a purple ribbon tie, PURPLE vest with white piping and buttons, LONG dark navy-purple skirt below the knees, dark tights, dark shoes. Single full-body standing portrait, upright confident posture, one hand on hip, calm reliable expression. No apron, no short skirt.' },
  { ref: '千夜', out: 'characters/chiya.png', size: '1024x1536', prompt: 'Chiya Ujimatsu exactly as in the reference: long straight dark-brown hair with straight bangs, a long side lock bound in a green checkered wrap, green eyes; Ama Usa An uniform: dark green kimono with thin vertical white stripes, green-and-white checkered collar with a small black ribbon, a long white full-length apron with a frilled hem, brown boots. Single full-body standing portrait, serene gentle smile, hands clasped in front.' },
  { ref: '提比', out: 'stickers/tippy.png', size: '1024x1024', prompt: 'Die-cut sticker of Tippy exactly as in the reference: round fluffy white angora rabbit ball, small pointed ears with pink insides, tiny black dot eyes, small "w" mouth, no legs. Thick clean white sticker outline, flat front view.' },
]
const exists = p => access(p).then(() => true, () => false)
async function run(job) {
  const file = OUT + job.out
  if (await exists(file)) return console.log('skip', job.out)
  const ref = new Blob([await readFile(`${ROOT}materials/characters/references/${job.ref}.png`)], { type: 'image/png' })
  for (let a = 1; a <= 3; a++) {
    try {
      const f = new FormData()
      f.append('model', 'gpt-image-2.5-sunburst'); f.append('image', ref, 'reference.png'); f.append('size', job.size)
      f.append('background', 'transparent'); f.append('prompt', `${job.prompt} ${STYLE}`)
      const j = await (await fetch('https://cdn.coderelay.cn/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${process.env.IMG_KEY}` }, body: f })).json()
      const b = j.data?.[0]?.b64_json; if (!b) throw new Error(JSON.stringify(j).slice(0, 200))
      await writeFile(file, Buffer.from(b, 'base64')); return console.log('ok', job.out)
    } catch (e) { console.log('retry', job.out, a, String(e).slice(0, 120)) }
  }
  console.log('FAIL', job.out)
}
await Promise.all(JOBS.map(run))
