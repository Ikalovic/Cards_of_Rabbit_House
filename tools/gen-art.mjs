// Dev-only art generator. Key is read from IMG_KEY; nothing is written outside game/public/assets/v2.
import { mkdir, writeFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
const BASE = 'https://cdn.coderelay.cn/v1/images/generations'
const MODEL = 'gpt-image-2.5-sunburst'
const OUT = new URL('../game/public/assets/v2/', import.meta.url).pathname
const STYLE = 'Polished Japanese anime visual-novel / cafe-sim game art in the soft pastel style of the "Is the Order a Rabbit?" (Gochiusa) anime, warm coffeehouse palette of cream, caramel, teal-blue and rose, clean thin outlines, soft cel shading, cohesive and cute. No text, no letters, no logos, no watermark.'
const stk = (d) => ({ size: '1024x1024', transparent: true, prompt: `${d}. Single centered die-cut sticker object, thick clean white outline, flat front view, soft cel shading. Transparent background, nothing else in frame. ${STYLE}` })
const chr = (d) => ({ size: '1024x1536', transparent: true, prompt: `${d} Standing three-quarter body visual-novel portrait, faithful to the official anime design, full hands visible, nothing cropped. Transparent background, single character only. ${STYLE}` })
const bg = (d) => ({ size: '1536x1024', transparent: false, prompt: `${d} No people, no animals, no readable text, no UI. ${STYLE}` })
const paper = (d) => ({ size: '1536x1024', transparent: false, prompt: `Flat top-down seamless-feeling card stock paper texture, ${d}, subtle fibers, low contrast, evenly lit, edge to edge, no objects, no text, no borders.` })
const M = {
  'backgrounds/title-exterior': bg('Wide exterior of a cozy European half-timber coffeehouse on a quiet stone street, golden morning light, flower boxes, calm open space on the left, building on the right.'),
  'backgrounds/cafe-interior': bg('Interior of a warm timber coffeehouse, wooden counter, coffee equipment, arched windows, amber daylight, wide eye-level view, open lower area for dialogue boxes.'),
  'backgrounds/workbench': bg('Cafe craft desk viewed straight on, walnut wood surface, paper drawers, ribbons, stamps, small coffee cup at the edges, broad quiet empty middle area.'),
  'backgrounds/print-shop': bg('Vintage card printing corner of a coffeehouse, brass and blue-enamel printers, drying rack, warm lamps, open center.'),
  'backgrounds/stampbook-desk': bg('Cozy desk close view with a cream leather scrapbook album space, ribbon bookmarks, dried flowers, warm window light, empty middle for UI.'),
  'characters/cocoa': chr('Cocoa Hoto from Is the Order a Rabbit?, Rabbit House waitress uniform, cheerful open-arm pose.'),
  'characters/chino': chr('Chino Kafuu from Is the Order a Rabbit?, Rabbit House uniform, calm reserved expression with a tiny smile, Tippy the fluffy white Angora rabbit sitting on her head. Tippy is a round fluffy fur ball with tiny short triangular ears, each only about 10-15% of the fur-ball body height; never long upright rabbit ears.'),
  'characters/rize': chr('Rize Tedeza from Is the Order a Rabbit?, Rabbit House uniform, upright reliable pose, slightly embarrassed softness.'),
  'characters/chiya': chr('Chiya Ujimatsu from Is the Order a Rabbit?, long straight black hair with a pale green hair ribbon, green eyes, wearing her Ama Usa An wagashi cafe work uniform: a matcha-green Japanese kimono with tasuki-tied sleeves, a white frilled apron over it, and a decorative obi, traditional and graceful (NOT a western maid dress). Serene gentle smile with a hint of mischief, hands clasped.'),
  'characters/syaro': chr('Syaro Kirima from Is the Order a Rabbit?, Fleur de Lapin waitress uniform, lively tsukkomi expression.'),
  'stickers/coffee-cup': stk('A cute white coffee cup and saucer with latte art shaped like a rabbit'),
  'stickers/tea-cup': stk('An elegant porcelain tea cup with rose pattern and saucer, little steam'),
  'stickers/rabbit': stk('A chubby little white rabbit sitting, adorable'),
  'stickers/tippy': stk('A fluffy white Angora rabbit ball, sleepy dignified face'),
  'stickers/coffee-bean': stk('Three roasted coffee beans'),
  'stickers/sugar': stk('Two white sugar cubes with a tiny pink heart'),
  'stickers/ribbon': stk('A satin ribbon bow in rose pink with two flowing tails'),
  'stickers/star': stk('A golden star with soft rounded points and tiny sparkles'),
  'stickers/flower': stk('A pink cherry-blossom style flower with green leaves'),
  'papers/cream': paper('warm cream off-white'),
  'papers/coffee': paper('coffee brown kraft'),
  'papers/mint': paper('soft mint green'),
  'papers/pink': paper('pale sakura pink'),
  'ui/logo-emblem': { size: '1024x1024', transparent: true, prompt: `Round emblem badge: a white rabbit peeking over a steaming coffee cup, laurel of coffee leaves, brass and teal trim, no text. ${STYLE}` },
  'ui/wood-panel': { size: '1536x1024', transparent: false, prompt: 'Seamless-feeling dark walnut wood grain panel texture, flat, even lighting, low contrast, no objects, no text.' },
  'ui/paper-panel': paper('warm ivory writing paper with faint pale floral watermark'),
  'ui/corner-ornament': { size: '1024x1024', transparent: true, prompt: `Ornate cafe-style corner flourish in brass gold with tiny rabbit ear and leaf motifs, single top-left corner piece. ${STYLE}` },
}
const only = process.argv.slice(2)
const keys = Object.keys(M).filter(k => !only.length || only.some(o => k.startsWith(o)))
const exists = p => access(p).then(() => true, () => false)
async function one(id) {
  const file = join(OUT, id + '.png')
  if (await exists(file)) return console.log('skip', id)
  const { size, transparent, prompt } = M[id]
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.IMG_KEY}` },
        body: JSON.stringify({ model: MODEL, prompt, size, ...(transparent ? { background: 'transparent' } : {}) }) })
      const j = await r.json(); const b = j.data?.[0]?.b64_json
      if (!b) throw new Error(JSON.stringify(j).slice(0, 200))
      await mkdir(dirname(file), { recursive: true }); await writeFile(file, Buffer.from(b, 'base64')); return console.log('ok', id)
    } catch (e) { console.log('retry', id, a, String(e).slice(0, 150)) }
  }
  console.log('FAIL', id)
}
let i = 0
await Promise.all(Array.from({ length: 6 }, async () => { while (i < keys.length) await one(keys[i++]) }))
