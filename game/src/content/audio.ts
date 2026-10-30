export type AudioTrackDefinition = Readonly<{
  src: string
  fallbackSrc?: string
  volume: number
  cooldownMs?: number
}>

// Scene music uses OGG first and MP3 as a browser fallback.
// These are local copies of music supplied by the project owner; see the public source manifest.
export const BGM_TRACKS = {
  title: { src: '/assets/audio/bgm/bgm_title.ogg', fallbackSrc: '/assets/audio/bgm/bgm_title.mp3', volume: 1 },
  dialogue: { src: '/assets/audio/bgm/bgm_dialogue.ogg', fallbackSrc: '/assets/audio/bgm/bgm_dialogue.mp3', volume: 1 },
  shift_normal: { src: '/assets/audio/bgm/bgm_shift_normal.ogg', fallbackSrc: '/assets/audio/bgm/bgm_shift_normal.mp3', volume: 1 },
  workshop: { src: '/assets/audio/bgm/bgm_workshop.ogg', fallbackSrc: '/assets/audio/bgm/bgm_workshop.mp3', volume: 1 },
  stampbook: { src: '/assets/audio/bgm/bgm_stampbook.ogg', fallbackSrc: '/assets/audio/bgm/bgm_stampbook.mp3', volume: 1 },
  result_clear: { src: '/assets/audio/bgm/bgm_result_clear.ogg', fallbackSrc: '/assets/audio/bgm/bgm_result_clear.mp3', volume: 1 },
  result_retry: { src: '/assets/audio/bgm/bgm_result_retry.ogg', fallbackSrc: '/assets/audio/bgm/bgm_result_retry.mp3', volume: 1 },
  keepsake: { src: '/assets/audio/bgm/bgm_keepsake.ogg', fallbackSrc: '/assets/audio/bgm/bgm_keepsake.mp3', volume: 1 },
  shift_busy: { src: '/assets/audio/bgm/bgm_shift_busy.ogg', fallbackSrc: '/assets/audio/bgm/bgm_shift_busy.mp3', volume: 1 },
} as const satisfies Record<string, AudioTrackDefinition>

export type BgmId = keyof typeof BGM_TRACKS

// Source clips have already been peak adjusted. Playback volume is controlled by the mixer.
// dialogue_* entries are interface cues, not character voice recordings.
export const SFX_TRACKS = {
  ui_click: { src: '/assets/audio/se/ui_click.ogg', volume: 1, cooldownMs: 50 },
  ui_back: { src: '/assets/audio/se/ui_back.ogg', volume: 1, cooldownMs: 50 },
  ui_unavailable: { src: '/assets/audio/se/ui_unavailable.ogg', volume: 1, cooldownMs: 50 },
  dialogue_next: { src: '/assets/audio/se/dialogue_next.ogg', volume: 1, cooldownMs: 50 },
  dialogue_open: { src: '/assets/audio/se/dialogue_open.ogg', volume: 1, cooldownMs: 50 },
  piece_place: { src: '/assets/audio/se/piece_place.ogg', volume: 1, cooldownMs: 70 },
  archive_success: { src: '/assets/audio/se/archive_success.ogg', volume: 1, cooldownMs: 300 },
  patience_warning: { src: '/assets/audio/se/patience_warning.ogg', volume: 1, cooldownMs: 300 },
  puzzle_success: { src: '/assets/audio/se/puzzle_success.ogg', volume: 1, cooldownMs: 300 },
  puzzle_failure: { src: '/assets/audio/se/puzzle_failure.ogg', volume: 1, cooldownMs: 300 },
  machine_ready: { src: '/assets/audio/se/machine_ready.ogg', volume: 1, cooldownMs: 300 },
  delivery_good: { src: '/assets/audio/se/delivery_good.ogg', volume: 1, cooldownMs: 300 },
  delivery_okay: { src: '/assets/audio/se/delivery_okay.ogg', volume: 1, cooldownMs: 300 },
  result_clear: { src: '/assets/audio/se/result_clear.ogg', volume: 1, cooldownMs: 300 },
  result_retry: { src: '/assets/audio/se/result_retry.ogg', volume: 1, cooldownMs: 300 },
  customer_leave: { src: '/assets/audio/se/customer_leave.ogg', volume: 1, cooldownMs: 300 },
  order_arrive: { src: '/assets/audio/se/order_arrive.ogg', volume: 1, cooldownMs: 300 },
  paper_pick: { src: '/assets/audio/se/paper_pick.ogg', volume: 1, cooldownMs: 100 },
  paper_cut: { src: '/assets/audio/se/paper_cut.ogg', volume: 1, cooldownMs: 100 },
  stamp_press: { src: '/assets/audio/se/stamp_press.ogg', volume: 1, cooldownMs: 80 },
  stamp_lift: { src: '/assets/audio/se/stamp_lift.ogg', volume: 1, cooldownMs: 80 },
  foil_brush: { src: '/assets/audio/se/foil_brush.ogg', volume: 1, cooldownMs: 120 },
  foil_peel: { src: '/assets/audio/se/foil_peel.ogg', volume: 1, cooldownMs: 120 },
  inspection_open: { src: '/assets/audio/se/inspection_open.ogg', volume: 1, cooldownMs: 300 },
  book_page: { src: '/assets/audio/se/book_page.ogg', volume: 1, cooldownMs: 120 },
  printer_start: { src: '/assets/audio/se/printer_start.ogg', volume: 1, cooldownMs: 300 },
  printer_loop: { src: '/assets/audio/se/printer_loop.ogg', volume: 1, cooldownMs: 300 },
  printer_output: { src: '/assets/audio/se/printer_output.ogg', volume: 1, cooldownMs: 300 },
  ribbon_fix: { src: '/assets/audio/se/ribbon_fix.ogg', volume: 1, cooldownMs: 100 },
  brush_stroke: { src: '/assets/audio/se/brush_stroke.ogg', volume: 1, cooldownMs: 120 },
  wax_pour: { src: '/assets/audio/se/wax_pour.ogg', volume: 1, cooldownMs: 120 },
} as const satisfies Record<string, AudioTrackDefinition>

export type SfxId = keyof typeof SFX_TRACKS
