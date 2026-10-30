import type { StorySpeaker } from './story'

const BASE: Record<StorySpeaker, string> = { 心爱: 'cocoa', 智乃: 'chino', 理世: 'rize', 千夜: 'chiya', 纱路: 'syaro' }

/** Dialogue mood → expression variant; unknown moods fall back to the neutral base portrait. */
const MOOD_EXPRESSIONS: Record<StorySpeaker, Readonly<Record<string, string>>> = {
  心爱: {
    元气挺胸: 'proud', 挺起胸膛: 'proud', 得意叉腰: 'proud', 拍胸振作: 'proud', 认真挺身: 'proud',
    元气满满: 'excited', 干劲满满: 'excited', 闪闪发光: 'excited', 高举滚筒: 'excited',
    慌张捂嘴: 'sheepish', 慌忙摆手: 'sheepish', 自信挥手: 'smile',
  },
  智乃: {
    冷静平淡: 'calm', 冷静提示: 'calm', 认真指点: 'calm', 平静审视: 'deadpan', 轻声叹息: 'deadpan',
    眼睛微亮: 'shy', 端茶走近: 'smile',
  },
  理世: { 抱臂交代: 'serious', 确认工序: 'briefing', 认真提醒: 'briefing', 轻咳提醒: 'flustered' },
  千夜: { 优雅微笑: 'smile', 温和微笑: 'smile', 掩口轻笑: 'teasing' },
  纱路: { 双手合十: 'polite', 实际提醒: 'retort', 现实吐槽: 'retort', 扶额轻叹: 'troubled', 焦急看表: 'troubled' },
}

export function portraitFor(speaker: StorySpeaker, mood?: string): string {
  const expression = mood ? MOOD_EXPRESSIONS[speaker][mood] : undefined
  return `/assets/v2/characters/${BASE[speaker]}${expression ? `-${expression}` : ''}.png`
}
