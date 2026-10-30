import type { CSSProperties, DragEvent, ReactNode } from 'react'
import { findProductionAsset, LAYOUTS, PAPERS, SHAPES, SURFACE_FINISHES } from '../content/production'
import { ownValue } from '../domain/own-value'
import type { CraftResult, ElementKind, PlacedElement, ProductionDesign, SlotDefinition } from '../domain/shift-types'
import '../styles/production-card.css'

const cream = '#fff8e8'
const rose = '#cf9396'
const blue = '#80a9b6'
const green = '#8aa68a'
const gold = '#c69c52'

function Rabbit() {
  return <g><ellipse cx="38" cy="28" rx="9" ry="23" transform="rotate(-12 38 28)" fill={cream} /><ellipse cx="61" cy="27" rx="9" ry="23" transform="rotate(12 61 27)" fill={cream} /><path d="M37 13l3 24m22-25-3 24" stroke={rose} strokeWidth="5" /><ellipse cx="50" cy="66" rx="31" ry="27" fill={cream} /><circle cx="39" cy="61" r="2.5" fill="currentColor" /><circle cx="61" cy="61" r="2.5" fill="currentColor" /><path d="m47 69 3 3 3-3m-3 3v4m0-1q-6 5-9 0m9 0q6 5 9 0" /><ellipse cx="29" cy="70" rx="5" ry="3" fill={rose} stroke="none" /><ellipse cx="71" cy="70" rx="5" ry="3" fill={rose} stroke="none" /></g>
}

function Bean() { return <g><ellipse cx="50" cy="50" rx="21" ry="32" transform="rotate(30 50 50)" fill="#a47b59" /><path d="M63 24C34 40 65 59 36 77" stroke={cream} strokeWidth="4" /></g> }
function Star({ fill = gold }: { fill?: string }) { return <path d="m50 10 12 26 29 4-21 21 5 29-25-14-26 14 6-29L9 40l29-4Z" fill={fill} /> }
function Heart() { return <path d="M50 83C36 73 12 58 12 36 12 13 38 10 50 30 62 10 88 13 88 36 88 58 64 73 50 83Z" fill={rose} /> }
function Leaf() { return <g><path d="M16 83C7 33 40 12 85 18 86 60 59 86 16 83Z" fill={green} /><path d="m16 83 54-48m-19 19-2-22m1 23 24-1" /></g> }
function Flower({ pressed = false }: { pressed?: boolean }) { return <g transform={pressed ? 'translate(0 10) scale(1 .8)' : undefined}>{[0, 72, 144, 216, 288].map((angle) => <ellipse key={angle} cx="50" cy="28" rx="15" ry="23" transform={`rotate(${angle} 50 50)`} fill={pressed ? '#c4a1b3' : '#e4a8a4'} />)}<circle cx="50" cy="50" r="13" fill="#edce85" /><circle cx="47" cy="46" r="3" fill={cream} stroke="none" /></g> }
function Bow({ color = blue }: { color?: string }) { return <g><path d="m45 51-15 39-8-15-15 2 25-36m23 10 15 39 8-15 15 2-25-36" fill={color} /><path d="M45 48C15 11-1 31 14 58c8 13 22 2 31-10m10 0C85 11 101 31 86 58c-8 13-22 2-31-10" fill={color} /><path d="m22 43 21 6m35-6-21 6" /><rect x="42" y="39" width="16" height="22" rx="6" fill={color} /></g> }
function Pair({ children, tilt = 0 }: { children: ReactNode; tilt?: number }) { return <g><g transform={`translate(0 17) scale(.58) rotate(${-tilt} 50 50)`}>{children}</g><g transform={`translate(42 28) scale(.58) rotate(${tilt} 50 50)`}>{children}</g></g> }
function Cup({ tea = false }: { tea?: boolean }) { return <g><path d="M30 25q-8-9 0-17m20 17q-8-9 0-17m20 17q-8-9 0-17" stroke={tea ? green : '#9b8977'} /><ellipse cx="48" cy="82" rx="39" ry="7" fill={cream} /><path d="M75 40h8c22 0 11 29-9 22" fill={cream} /><path d="M19 38h57v24c0 27-57 27-57 0Z" fill={cream} /><ellipse cx="47.5" cy="38" rx="28.5" ry="8" fill={tea ? '#c5be84' : '#8f6549'} /><g transform="translate(33 46) scale(.3)">{tea ? <Leaf /> : <Heart />}</g></g> }
function Pot({ tea = false }: { tea?: boolean }) { return <g><path d={tea ? 'M27 43 8 30 20 67m58-27c24-14 26 29 3 29' : 'M32 46 8 37l16 33m51-32c24-9 25 28 4 29'} fill={cream} /><path d={tea ? 'M27 38Q9 78 37 85h29q29-7 10-47Z' : 'M34 31h32l16 51H21Z'} fill={tea ? '#d9e3cc' : cream} /><path d="M29 37h43M38 29h26l-5-9H43Z" fill={cream} /><circle cx="51" cy="16" r="4" fill={gold} /><g transform="translate(34 43) scale(.34)">{tea ? <Flower /> : <Bean />}</g></g> }

function MotifDrawing({ id }: { id: string }) {
  switch (id) {
    case 'coffee-cup': return <Cup />
    case 'coffee-pot': return <Pot />
    case 'coffee-bean': return <Bean />
    case 'rabbit': return <Rabbit />
    case 'rabbit-pair': return <Pair tilt={8}><Rabbit /></Pair>
    case 'rabbit-house': return <g><path d="m11 48 39-32 39 32M20 42v47h60V42" fill={cream} /><path d="M43 89V67q7-13 14 0v22" fill={rose} /><rect x="27" y="51" width="11" height="13" rx="2" fill={blue} /><rect x="64" y="51" width="10" height="13" rx="2" fill={blue} /><path d="M39 22 33 6q-2-8 7-4l10 15 8-16q9-5 8 4l-5 20" fill={cream} /></g>
    case 'tea-cup': return <Cup tea />
    case 'tea-pot': return <Pot tea />
    case 'bouquet': return <g><path d="m30 49 18 42 23-46m-22 43 2-57" stroke={green} strokeWidth="5" /><path d="m25 58 23 33 27-35-25 12Z" fill={cream} /><g transform="translate(2 13) scale(.43)"><Flower /></g><g transform="translate(48 10) scale(.43)"><Flower /></g><g transform="translate(24 0) scale(.49)"><Flower /></g><g transform="translate(33 63) scale(.33)"><Bow color={rose} /></g></g>
    case 'rose': return <g><path d="m51 57-3 36m0-12q-27 0-23-19 22 0 23 19m1-10q25-1 27-18-25 0-27 18" fill={green} /><path d="M26 49 19 28l17-6 6-14 23 7 17 17-8 24-23 12Z" fill={rose} /><path d="m26 29 24 28 22-24-30-7 2 22 17-9-10-6" /></g>
    case 'star': return <Star />
    case 'moon': return <g><path d="M66 10a40 40 0 1 0 23 58C51 81 29 37 66 10Z" fill="#eed59b" /><g transform="translate(65 22) scale(.25)"><Star /></g><circle cx="83" cy="13" r="2" fill={gold} /></g>
    case 'ribbon-bow': return <Bow color={rose} />
    case 'book': return <g><path d="M50 25Q28 13 8 21v61q22-8 42 2 20-10 42-2V21Q72 13 50 25Z" fill={cream} /><path d="M50 25v59M17 34q14-4 24 2m-24 9q14-4 24 2m-24 9q14-4 24 2m18-20q14-4 24-2m-24 13q14-4 24-2" /><path d="M68 20v42l6-7 6 7V19" fill={rose} /></g>
    case 'shop-sign': return <g><path d="M26 12h48M35 12v19m30-19V12" /><rect x="8" y="31" width="84" height="54" rx="8" fill={cream} /><path d="M15 38h70v40H15Z" stroke={gold} /><text x="50" y="54" textAnchor="middle" stroke="none" fill="currentColor" fontSize="12" fontFamily="Georgia,serif">RABBIT</text><text x="50" y="69" textAnchor="middle" stroke="none" fill="currentColor" fontSize="11" fontFamily="Georgia,serif">HOUSE</text></g>
    case 'bread': return <g><path d="M10 69C-2 24 31 18 45 33 60 9 95 27 91 68c-3 24-73 24-81 1Z" fill="#e2b879" /><path d="m26 41 9 16m14-18 9 16m13-17 5 17M12 72q35 9 76 0" stroke="#a17648" /></g>
    case 'camera': return <g><path d="m30 31 8-13h26l8 13" fill={cream} /><rect x="8" y="31" width="84" height="53" rx="9" fill={blue} /><path d="M9 44h82" /><circle cx="51" cy="57" r="22" fill={cream} /><circle cx="51" cy="57" r="14" fill="#5b7276" /><path d="m44 51 5-3" stroke={cream} strokeWidth="4" /><rect x="75" y="35" width="10" height="6" rx="2" fill={gold} /></g>
    case 'envelope': return <g><rect x="7" y="24" width="86" height="57" rx="5" fill={cream} /><path d="m8 26 42 32 42-32M8 79l28-29m56 29L64 50" /><g transform="translate(36 41) scale(.28)"><Heart /></g></g>
    default: return <circle cx="50" cy="50" r="25" />
  }
}

function DecorationDrawing({ id }: { id: string }) {
  switch (id) {
    case 'tiny-star': return <g transform="translate(15 15) scale(.7)"><Star fill="#e6cf99" /></g>
    case 'star-pair': return <Pair><Star /></Pair>
    case 'cream-ribbon': return <Bow color="#efdfb6" />
    case 'blue-ribbon': return <Bow />
    case 'silk-ribbon': return <g><Bow color="#c6a7c9" /><path d="M13 38q12-14 27 9m20 0q14-23 26-9" stroke="#fff4ff" strokeWidth="4" /></g>
    case 'tiny-flower': return <g transform="translate(15 15) scale(.7)"><Flower /></g>
    case 'flower-pair': return <Pair><Flower /></Pair>
    case 'leaf': return <Leaf />
    case 'leaf-pair': return <Pair tilt={15}><Leaf /></Pair>
    case 'coffee-speck': return <g><circle cx="33" cy="31" r="8" fill="#936644" /><circle cx="68" cy="51" r="12" fill="#936644" /><circle cx="35" cy="74" r="5" fill="#936644" /></g>
    case 'bean-pair': return <Pair tilt={10}><Bean /></Pair>
    case 'rabbit-paw': return <g fill={rose}><ellipse cx="50" cy="64" rx="22" ry="18" /><ellipse cx="25" cy="37" rx="8" ry="11" transform="rotate(-25 25 37)" /><ellipse cx="48" cy="27" rx="8" ry="12" /><ellipse cx="72" cy="35" rx="8" ry="11" transform="rotate(25 72 35)" /></g>
    case 'rabbit-tail': return <g><path d="M26 30q-2-18 16-12 10-15 20 0 20-6 17 14 19 10 3 24 13 20-8 25-5 18-22 9-17 8-21-9-23 0-19-19-16-12 0-23 0-14 14-9Z" fill={cream} /><path d="m34 44 6-4m21 28 7-6m-30 8 6 2" stroke="#d8cbb7" /></g>
    case 'heart': return <Heart />
    case 'heart-pair': return <Pair tilt={10}><Heart /></Pair>
    case 'dot': return <g fill={blue}><circle cx="25" cy="50" r="8" /><circle cx="50" cy="50" r="8" /><circle cx="75" cy="50" r="8" /></g>
    case 'stripe': return <g stroke={blue} strokeWidth="8"><path d="m19 64 18-31m4 31 18-31m4 31 18-31" /></g>
    case 'check': return <g><rect x="17" y="17" width="66" height="66" fill={cream} /><path d="M17 39h66M17 61h66M39 17v66M61 17v66" stroke={blue} strokeWidth="9" opacity=".65" /></g>
    case 'sparkle': return <g fill={gold}><path d="m50 7 10 31 31 12-31 10-10 33-10-33L7 50l33-12Z" /><path d="m82 9 3 10 10 3-10 4-3 10-3-10-10-4 10-3Z" /></g>
    case 'pearl': return <g><circle cx="50" cy="50" r="28" fill="#dfcabb" /><circle cx="47" cy="46" r="23" fill="#fff9e9" /><circle cx="39" cy="35" r="7" fill="white" stroke="none" /><path d="M45 69q20 4 24-17" stroke="#c7b6b1" /></g>
    case 'pressed-flower': return <g><path d="M46 52 34 93m7-19 27-8" stroke={green} /><Flower pressed /></g>
    case 'lace-corner': return <g stroke="#aa9382"><path d="M15 83V16h68L15 83Z" fill={cream} /><path d="M16 31q14 0 14-14m-14 31q31 0 31-31M16 65q48 0 48-48M18 81q-8-13 7-14-8-13 7-14-8-13 7-14-8-13 7-14-8-13 7-14-8-13 7-14" /><circle cx="26" cy="27" r="3" /></g>
    case 'gold-star': return <g><Star fill="#d1a240" /><path d="m50 15 1 57-24 12 12-30-22-12 30-3Z" fill="#f5d891" stroke="none" /></g>
    case 'tiny-bell': return <g><circle cx="50" cy="16" r="7" fill={gold} /><path d="M23 64q6-7 6-27c0-24 42-24 42 0q0 20 6 27l7 8H16Z" fill="#e7c679" /><path d="M41 76q9 15 18 0M22 63h56m-39-30q0-9 7-11" /><g transform="translate(28 8) scale(.45)"><Bow color={rose} /></g></g>
    default: return null
  }
}

function BorderDrawing({ id }: { id: string }) {
  if (id === 'plain-line') return <rect x="8" y="8" width="284" height="184" rx="5" />
  if (id === 'double-line') return <g><rect x="5" y="5" width="290" height="190" rx="4" /><rect x="12" y="12" width="276" height="176" rx="2" strokeWidth="1" /></g>
  if (id === 'dotted') return <rect x="8" y="8" width="284" height="184" rx="9" strokeDasharray="1 8" strokeWidth="3" />
  if (id === 'gilded') return <g stroke={gold}><rect x="7" y="7" width="286" height="186" rx="2" strokeWidth="4" /><rect x="13" y="13" width="274" height="174" strokeWidth="1" />{[[7, 7], [293, 7], [7, 193], [293, 193]].map(([x, y]) => <path key={`${x}:${y}`} d={`m${x} ${y - 5} 5 5-5 5-5-5Z`} fill={gold} />)}</g>
  if (id === 'ribbon-frame') return <g stroke={rose}><rect x="9" y="9" width="282" height="182" rx="4" strokeWidth="8" /><rect x="9" y="9" width="282" height="182" rx="4" stroke={cream} strokeWidth="1" strokeDasharray="4 3" /><g transform="translate(120 -7) scale(.6 .4)"><Bow color={rose} /></g></g>
  const drawing = id === 'coffee-beans' ? <Bean /> : id === 'leaf-vine' ? <Leaf /> : id === 'rabbit-ears' ? <Rabbit /> : id === 'star-trail' ? <Star /> : <Flower />
  return <g><rect x="9" y="9" width="282" height="182" rx={id === 'lace' ? 10 : 5} stroke={id === 'leaf-vine' ? green : 'currentColor'} strokeWidth="1" strokeDasharray={id === 'lace' ? '2 4' : undefined} />{[20, 61, 102, 143, 184, 225, 266].flatMap((x) => [0, 180].map((y) => <g key={`${x}:${y}`} transform={`translate(${x} ${y}) scale(.14 .18)`}>{drawing}</g>))}{[44, 86, 128].flatMap((y) => [0, 284].map((x) => <g key={`${x}:${y}`} transform={`translate(${x} ${y}) scale(.14 .18)`}>{drawing}</g>))}</g>
}

const wordSubtitles: Record<string, string> = {
  welcome: 'WELCOME TO OUR LITTLE CAFÉ', thanks: 'THANK YOU, WITH LOVE', recommendation: 'TODAY’S SPECIAL',
  'tea-party': 'A LITTLE AFTERNOON TEA', 'good-day': 'HAVE A LOVELY DAY', friendship: 'ALWAYS BY YOUR SIDE',
  anniversary: 'PRECIOUS LITTLE MEMORIES', invitation: 'YOU ARE CORDIALLY INVITED', 'rabbit-house': 'RABBIT HOUSE', 'best-wishes': 'ALL THE BEST, ALWAYS',
}

/** Shared by the material drawer and the finished card; the same asset always has the same drawing. */
export function AssetArt({ kind, assetId }: Readonly<{ kind: ElementKind; assetId: string }>) {
  const asset = findProductionAsset(kind, assetId)
  if (!asset) return <span className="production-art" role="img" aria-label="未识别素材">?</span>
  const label = asset.label
  if (kind === 'word-stamp') return <span className={`production-art production-art--word production-word--${assetId}`} role="img" aria-label={label}><span>{label}</span><small>{ownValue(wordSubtitles, assetId)}</small></span>
  return <svg className={`production-art production-art--${kind}`} role="img" aria-label={label} viewBox={kind === 'border' ? '0 0 300 200' : '-4 -4 108 108'} preserveAspectRatio={kind === 'border' ? 'none' : 'xMidYMid meet'} fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
    {kind === 'border' ? <BorderDrawing id={assetId} /> : kind === 'motif' ? <MotifDrawing id={assetId} /> : <DecorationDrawing id={assetId} />}
  </svg>
}

const bounded = (value: number | undefined, fallback = 0.5) => Number.isFinite(value) ? Math.max(0, Math.min(1, value!)) : fallback
const percent = (value: number) => `${Math.round(value * 100)}%`
const craftNames = { stamp: '盖章', trim: '裁边', ribbon: '缎带', foil: '烫金', wax: '蜡封' }
const dimensionNames: Record<string, string> = { position: '位置', pressure: '压力', length: '长度', time: '按压', coverage: '覆盖' }
const discreteNames: Record<string, string> = { color: '颜色', stamp: '印模', start: '起点', end: '终点', startPosition: '起点', endPosition: '终点', coverage: '原始覆盖', overflow: '越界', overheated: '过热格数' }
const choiceNames: Record<string, string> = { blue: '蓝色', red: '红色', cream: '奶油色', pink: '粉色', gold: '金色', green: '绿色', purple: '紫色', star: '星形', rabbit: '兔兔', heart: '爱心', flower: '花朵', coffee: '咖啡' }
const craftColors: Record<string, string> = { blue, red: '#bd6971', cream: '#eddbaf', pink: rose, gold, green, purple: '#a78aaf' }

function craftDescription(result: CraftResult) {
  return [ownValue(craftNames, result.kind) ?? '工艺', ...Object.entries(result.measurements).map(([key, value]) => `${ownValue(dimensionNames, key) ?? key} ${percent(value)}`), ...Object.entries(result.discrete).map(([key, value]) => `${ownValue(discreteNames, key) ?? key} ${ownValue(choiceNames, value) ?? (['start', 'end', 'startPosition', 'endPosition', 'coverage', 'overflow'].includes(key) && Number.isFinite(Number(value)) ? percent(Number(value)) : value)}`)].join(' · ')
}

function CraftArtwork({ result }: Readonly<{ result: CraftResult }>) {
  const m = result.measurements
  const position = bounded(m.position)
  const color = ownValue(craftColors, result.discrete.color) ?? blue
  let drawing: ReactNode
  if (result.kind === 'stamp') {
    const pressure = bounded(m.pressure)
    drawing = <g transform={`translate(${20 + position * 245} 143) rotate(${(position - 0.5) * 30})`} opacity={0.15 + pressure * 0.85} stroke="#a46465"><circle r="23" fill="none" strokeWidth={1 + pressure * 3} /><circle r="19" strokeDasharray="1 3" /><g transform="translate(-15 -16) scale(.3)"><Rabbit /></g>{pressure > 0.75 && <circle cx="2" cy="1" r="23" opacity=".25" strokeWidth="5" />}</g>
  } else if (result.kind === 'trim') {
    const y = 14 + position * 172
    drawing = <g><path d={`M9 ${y}h${282 * bounded(m.length)}`} stroke="#fff9ed" strokeWidth="7" /><path d={`M9 ${y}h${282 * bounded(m.length)}`} stroke="#a58362" strokeWidth="1.4" strokeDasharray="4 3" /><path d={`m${9 + 282 * bounded(m.length)} ${y - 5}v10`} stroke="#a58362" /></g>
  } else if (result.kind === 'ribbon') {
    const start = bounded(Number(result.discrete.startPosition ?? result.discrete.start ?? 0.15), 0.15)
    const end = bounded(Number(result.discrete.endPosition ?? result.discrete.end ?? 0.85), 0.85)
    const y = 134 + (position - 0.5) * 70
    const slack = (bounded(m.length) - Math.abs(end - start)) * 70
    const path = `M${start * 300} ${y}Q150 ${y + slack} ${end * 300} ${y}`
    drawing = <g><path d={path} stroke={color} strokeWidth="14" /><path d={path} stroke={cream} strokeWidth="1" strokeDasharray="3 3" opacity=".7" /><circle cx={start * 300} cy={y} r="3" fill={gold} /><circle cx={end * 300} cy={y} r="3" fill={gold} /><g transform={`translate(${end * 300 - 15} ${y - 15}) scale(.3)`}><Bow color={color} /></g></g>
  } else if (result.kind === 'foil') {
    const cells = Math.round(bounded(m.coverage, 0) * 20)
    const overflow = bounded(Number(result.discrete.overflow ?? 0), 0)
    const overheated = Math.max(0, Number(result.discrete.overheated ?? 0))
    drawing = <g>{Array.from({ length: cells }, (_, i) => <rect key={i} x={35 + (i % 10) * 23} y={165 + Math.floor(i / 10) * 7} width="20" height="5" rx="1" fill={i < overheated ? '#93622d' : i % 3 === 0 ? '#f5d588' : gold} stroke="none" />)}{Array.from({ length: Math.ceil(overflow * 30) }, (_, i) => <circle key={`spill-${i}`} cx={22 + ((i * 37) % 260)} cy={154 - ((i * 11) % 20)} r={1 + (i % 3)} fill={gold} stroke="none" />)}</g>
  } else {
    const time = bounded(m.time)
    const seal = result.discrete.stamp === 'rabbit' ? <Rabbit /> : result.discrete.stamp === 'heart' ? <Heart /> : result.discrete.stamp === 'flower' ? <Flower /> : result.discrete.stamp === 'coffee' ? <Bean /> : <Star fill="none" />
    drawing = <g transform={`translate(${30 + position * 240} 151) scale(${0.65 + time * 0.55})`} stroke={cream}><path d="M-22-11q1-16 14-13 11-9 18 1 16-2 15 12 10 12-1 20 0 15-15 15-10 10-19 0-17 1-17-14-9-13 5-21Z" fill={color} stroke="none" /><circle r="18" opacity={0.3 + time * 0.65} strokeWidth={1 + time} /><g transform="translate(-13 -13) scale(.26)" opacity={0.2 + time * 0.8}>{seal}</g></g>
  }
  return <svg className={`production-craft production-craft--${result.kind}`} viewBox="0 0 300 200" preserveAspectRatio="none" aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">{drawing}</svg>
}

function placementStyle(slot: SlotDefinition, element?: PlacedElement, cardRatio = 1.5): CSSProperties {
  const turn = element?.direction === 'left' ? -15 : element?.direction === 'right' ? 15 : element?.direction === 'inverted' ? 180 : 0
  const picture = element?.kind === 'motif' || element?.kind === 'decoration'
  const scale = picture ? element.size === 'small' ? 0.65 : element.size === 'large' ? 1 : 0.82
    : element?.size === 'small' ? 0.7 : element?.size === 'large' ? 1.2 : 1
  const borderScale = element?.size === 'small' ? 0.9 : element?.size === 'large' ? 1.04 : 1
  // Slot percentages use different axes. Fit the complete rotated square in physical
  // card units before converting back, leaving room for outlines and shadows.
  const radians = turn * Math.PI / 180
  const side = Math.min(slot.width * cardRatio, slot.height) * 0.94 / (Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians)))
  return { left: `${slot.x * 100}%`, top: `${slot.y * 100}%`, width: `${(picture ? side / cardRatio : slot.width) * 100}%`, height: `${(picture ? side : slot.height) * 100}%`, '--asset-scale': element?.kind === 'border' ? borderScale : scale, '--asset-turn': `${turn}deg`, zIndex: element ? element.layer === 'back' ? 2 : 4 : undefined } as CSSProperties
}

function droppedAsset(event: DragEvent, slot: SlotDefinition): { kind: ElementKind; assetId: string } | null {
  try {
    const value: unknown = JSON.parse(event.dataTransfer.getData('application/x-rabbit-asset'))
    if (typeof value !== 'object' || value === null || !('kind' in value) || !('assetId' in value) || typeof value.kind !== 'string' || typeof value.assetId !== 'string') return null
    const kind = value.kind as ElementKind
    return slot.accepts.includes(kind) && findProductionAsset(kind, value.assetId) ? { kind, assetId: value.assetId } : null
  } catch { return null }
}

export type ProductionCardProps = Readonly<{
  design: ProductionDesign
  showSlots?: boolean
  selectedSlotId?: string
  onSlotSelect?: (slotId: string) => void
  onSlotDrop?: (slotId: string, asset: { kind: ElementKind; assetId: string }) => void
}>

export function ProductionCard({ design, showSlots = false, selectedSlotId, onSlotSelect, onSlotDrop }: ProductionCardProps) {
  const { preparation, elements } = design
  const latestCrafts = new Map<string, CraftResult>()
  for (const result of design.crafts) {
    const previous = latestCrafts.get(result.requirementId)
    if (!previous || result.completedAtMs >= previous.completedAtMs) latestCrafts.set(result.requirementId, result)
  }
  const crafts = [...latestCrafts.values()]
  const paper = PAPERS.find((item) => item.id === preparation.paperId)
  const shape = SHAPES.find((item) => item.id === preparation.shapeId)
  const layout = LAYOUTS.find((item) => item.id === preparation.layoutId)
  const finish = SURFACE_FINISHES.find((item) => item.id === preparation.surfaceFinishId)
  const finishKind = finish?.id === 'foil' ? 'foil' : finish?.id === 'wax' ? 'wax' : 'stamp'
  const finishComplete = !finish?.materialCosts.length || crafts.some((craft) => craft.kind === finishKind)
  const cardRatio = shape?.id === 'square' ? 1 : preparation.orientation === 'portrait' ? 2 / 3 : shape?.id === 'ticket' ? 2 : 1.5
  return <figure className="production-preview" aria-label="当前卡片">
    <div className={`production-card production-card--${shape?.id ?? 'landscape'} production-orientation--${preparation.orientation} production-paper--${preparation.paperMaterialId ?? paper?.materialId ?? 'smooth'} production-finish--${finishComplete ? preparation.surfaceFinishId : 'matte'}${paper?.id === 'midnight' ? ' production-card--dark' : ''}`} style={{ '--production-paper': paper?.color ?? '#fff5df', aspectRatio: cardRatio } as CSSProperties}>
      <div className="production-paper-texture" aria-hidden="true" />
      <div className="production-card-brand" aria-hidden="true"><span>R H</span><small>HANDCRAFTED WITH LOVE</small></div>
      {shape?.id === 'folded' && <div className="production-card-fold" aria-hidden="true" />}
      {shape?.id === 'tag' && <div className="production-card-hole" aria-hidden="true" />}
      {!layout && <div className="production-card-empty">选择一张卡纸<br /><small>从这里，开始一份心意。</small></div>}
      {elements.map((element) => {
        const slot = layout?.slots.find((candidate) => candidate.id === element.slotId)
        return slot ? <div key={element.id} className={`production-element production-element--${element.kind}`} style={placementStyle(slot, element, cardRatio)}><AssetArt kind={element.kind} assetId={element.assetId} /></div> : null
      })}
      <div className="production-finish-sheen" aria-hidden="true" />
      {crafts.map((result) => <CraftArtwork key={result.id} result={result} />)}
      {showSlots && layout?.slots.map((slot) => {
        const filled = elements.some((element) => element.slotId === slot.id)
        const frame = slot.accepts.includes('border')
        return <button key={slot.id} type="button" className={`production-slot${frame ? ' production-slot--frame' : ''}${filled ? ' is-filled' : ''}${slot.id === selectedSlotId ? ' is-selected' : ''}`} style={frame ? { left: `${slot.x * 100}%`, top: '94%' } : placementStyle(slot)} aria-label={`${filled ? '选择' : '放置到'}${slot.label}`} aria-pressed={slot.id === selectedSlotId} onClick={() => onSlotSelect?.(slot.id)} onDragOver={(event) => {
          // Browsers hide payload data during dragover; validate the complete payload on drop.
          if (event.dataTransfer.types?.includes('application/x-rabbit-asset')) event.preventDefault()
        }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const asset = droppedAsset(event, slot); if (asset) onSlotDrop?.(slot.id, asset) }}><span>{filled ? '编辑' : '+'} {slot.label}</span></button>
      })}
    </div>
    <figcaption className="production-preview-caption"><span>{paper?.label ?? '未选卡纸'} · {shape?.label ?? '待裁卡胚'} · {finish?.label}{!finishComplete && '（待制作）'}</span>{layout && <small>{layout.label}</small>}</figcaption>
    {crafts.length > 0 && <ul className="production-craft-results" aria-label="已完成工艺">{crafts.map((result) => <li key={result.id}>{craftDescription(result)}</li>)}</ul>}
  </figure>
}
