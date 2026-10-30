# Presentation asset notes

## Tippy site icon (2026-10-17)

The site icon was generated through the owner's previously authorized image API (`gpt-image-2.5-sunburst`) with the imagegen skill's CLI after the built-in `image_gen` request failed with a network error. It uses the owner's `materials/characters/references/提比.png` and the existing `game/public/assets/v2/stickers/tippy.png` as visual references. The design uses Tippy's white fluffy silhouette, short triangular ears and small dark eyes, with few details so it remains recognizable at 16 and 32 pixels. Credentials are read only from the local configuration and passed in the generator process environment; they are never included in the site or generation record. The final prompt is recorded in `materials/characters/site-icon/README.md`.

The full transparent `1254 × 1254` PNG returned by the image service is preserved outside the game build context at `materials/characters/site-icon/tippy-source.png`. The published files under `game/public/` are:

| File | Sizes | Use |
| --- | --- | --- |
| `favicon.ico` | 16, 32, 48 and 64 pixels square | Browser favicon |
| `icons/tippy-32.png` | 32 × 32 | PNG favicon |
| `icons/tippy-512.png` | 512 × 512 | Large PNG icon |
| `apple-touch-icon.png` | 180 × 180 | Apple touch icon |

The page references the icons with `?v=tippy-1` to refresh cached favicons. Browsers load only these local static files.

## Downloaded audio assets (2026-10-16)

`audio/` contains the active local audio bundle. Current files, sources, required credits, edits and durations are documented in [audio/SOURCES.md](audio/SOURCES.md) and [audio/manifest.json](audio/manifest.json). The stock sound effects come from Sound Effect Lab and On-Jin; they are not original anime audio or character voices. Original downloads and retrieval records are preserved outside the game build context under `materials/audio/sfx/`, and the owner's music originals are under `materials/audio/bgm/`. Unused optional music, jingles and sound effects are separated into `materials/audio/candidates/`. The global audio provider and scene/action feedback play the active catalog, with saved music/effect levels, mute, gesture unlock and background suspension.

On-Jin credit: 効果音：On-Jin ～音人～（https://on-jin.com/）／音源の二次配布・無断利用禁止

All images are presentation assets only and are never used to determine scoring or progression. The four original backgrounds and three original character groups were generated through the project owner's external image API configuration. The nine supporting-character portraits added below use supplied reference originals and one official original instead. The credential and raw responses are not stored in this repository. Earlier prototype alternatives are archived outside the `game/` Docker build context under `archive/prototype-art-backup/`.

The production-floor image and archived townspeople images below were generated offline on 2026-10-14 through the owner's OpenAI-compatible external image endpoint using `gpt-image-2.5`. The runtime reads local assets; the browser never contacts that service. The API key, request envelopes, and raw responses are not stored in the repository or Docker build context.

## Supporting-character customer portraits

The eight supplied reference images are copied unchanged into `production/customers/`; they were not regenerated, repainted, or cropped on disk. Each character has an independent asset ID and crop ID (`maya`, `megu`, `aoyama`, `rin`, `moka`, `yura`, `fuyu`, `natsume`, `elulu`). `production-assets.ts` records each original's actual dimensions and its own upper-face crop. `CustomerPortrait` applies that crop at display time, preserving the original aspect ratio. All nine originals were visually inspected to choose face positions; reference backgrounds, borders, and lettering remain in the source files.

| Local file | Character | Original source | Dimensions |
| --- | --- | --- | --- |
| `production/customers/maya.png` | 条河麻耶 | Owner-provided `materials/characters/references/条河麻耶.png` | 152 × 318 |
| `production/customers/megu.png` | 奈津惠 | Owner-provided `materials/characters/references/奈津惠.png` | 149 × 290 |
| `production/customers/aoyama.png` | 青山翠 | Owner-provided `materials/characters/references/青山.png` | 214 × 410 |
| `production/customers/rin.png` | 真手凛 | Official series character artwork, downloaded unchanged | 382 × 687 |
| `production/customers/moka.png` | 保登摩卡 | Owner-provided `materials/characters/references/摩卡.png` | 212 × 409 |
| `production/customers/yura.png` | 狩手结良 | Owner-provided `materials/characters/references/狩手结良.png` | 351 × 485 |
| `production/customers/fuyu.png` | 风衣叶冬优 | Owner-provided `materials/characters/references/风衣叶冬优.png` | 324 × 465 |
| `production/customers/natsume.png` | 神沙夏明 | Owner-provided `materials/characters/references/神沙夏明.png` | 355 × 483 |
| `production/customers/elulu.png` | 神沙映月 | Owner-provided `materials/characters/references/神沙映月.png` | 341 × 537 |

Rin source page: https://gochiusa.com/chara/rin.html

Rin original image: https://gochiusa.com/core_sys/images/main/cont/chara/rin_body.png (retrieved 2026-10-16). The page identifies 真手凛 and credits © Koi・芳文社／ご注文はBLOOM製作委員会ですか？. This is official artwork, not generated art or a freely licensed stock asset; a general game-use or redistribution license was not verified. Rights for the other eight supplied references remain with their respective original owners; no new license is implied by copying them locally.

The retired `townspeople-a.png` and `townspeople-b.png` originals are preserved under the root `archive/prototype-art-backup/customers/` directory, outside the game build context. They are no longer registered in the active catalog, rendered as customer portraits, or shipped under `game/public/`.

The two files under `math/questions/` are not generated presentation art. They are the original diagrams supplied by the project owner with `数学题库_分类整理版.json`; they are copied byte-for-byte into the local static bundle. The math adapter accepts only those registered local paths, so question rendering cannot introduce a remote image request.

## `production/backgrounds/production-floor.png`

External API prompt summary: a wide Japanese-anime game background showing a practical card-production side room inside a warm European timber coffeehouse, with paper drawers, ribbon racks, stamp and inspection tools, a drying rack, and two blue-enamel/brass vintage printers. The center was deliberately kept quiet for the six-station interface; people, readable text, logos, watermarks, and interface elements were prohibited.

Final inspection: `1536 × 1024`, RGB PNG. The two printers and material stations are visually distinct, the central floor remains usable behind UI panels, and no readable text or watermark is present.

## Archived `archive/prototype-art-backup/customers/townspeople-a.png`

External API prompt summary: three original town customers on transparent background—a hurried student with a blank notebook, a time-conscious office worker with a blank envelope, and a patient elderly regular with a cane—spaced into left, center, and right sprite cells. The first generation was rejected because a newspaper introduced pseudo-text; the retained regeneration removes it.

Final inspection: `1536 × 1024`, RGBA PNG. It contains exactly three separated figures with complete heads and hands, usable silhouettes, a working transparent channel, and no readable text or watermark.

## Archived `archive/prototype-art-backup/customers/townspeople-b.png`

External API prompt summary: three further original town customers on transparent background—a tourist with a sketchbook, a flower-shop owner with a bouquet, and a stationery collector holding a blank card—again separated into left, center, and right sprite cells.

Final inspection: `1536 × 1024`, RGBA PNG. It contains exactly three separated figures with coherent props and hands, a working transparent channel, a blank card face, and no readable text or watermark.

## `backgrounds/rabbit-house-exterior.png`

External API prompt summary: a polished 16:9 Japanese-anime visual-novel exterior of a cozy European half-timber coffeehouse on a quiet stone street, with warm late-morning light, flower boxes, dark wood and cream stucco; calm open space on the left for the title menu; no people, animals, readable text, logo, watermark or interface.

Final inspection: `1672 × 941`, RGB PNG. The storefront is concentrated on the right and the left remains readable beneath the title overlay.

## `backgrounds/card-workbench-background.png`

External API prompt summary: a warm cafe craft workstation with walnut wood, card paper, drawers, ribbons, stamps, coffee and subtle rabbit-shaped craft motifs around the edges; a broad low-detail central work area; no people, hands, readable text, logo, watermark or interface.

Final inspection: `1672 × 941`, RGB PNG. The central paper area remains visually quiet behind the editor while material detail frames the edges.

## `backgrounds/print-workshop-background.png`

External API prompt summary: a vintage card-print workshop connected to a timber coffeehouse, with brass details, stationery shelves, drying racks and warm lamps; center and right kept open for the printer and receipt interface; no people, characters, readable text, logo, watermark or interface.

Final inspection: `1536 × 1024`, RGB PNG. CSS `cover` supplies the final desktop crop while preserving the open center.

## `backgrounds/rabbit-house-interior-api.png`

External API prompt summary: a polished Japanese-anime visual-novel background of the Rabbit House interior; warm European timber coffeehouse, wooden counter, coffee equipment, arched windows, small tables, amber daylight and muted teal accents; wide eye-level composition with open space for UI; no characters, rabbits, text, logos, watermark or interface.

Final inspection: `1536 × 1024`, RGB PNG. The low foreground remains open for dialogue UI and both sides have usable character positions; no readable text or watermark is present.

## `characters/cocoa-chino-tippy-api.png`

External API prompt summary: faithful Cocoa Hoto and Chino Kafuu visual-novel cutout with Tippy and recognizable Rabbit House uniforms; Cocoa leans warmly toward Chino with an enthusiastic self-appointed-big-sister gesture, while Chino remains reserved with a tiny softened smile and Tippy sits on her head; relationship-focused pose; no text, extra characters, watermark or cropped hands.

Final inspection: `1024 × 1536`, RGBA PNG with an active transparent channel. Two characters and Tippy are present, with no readable text or watermark.

## `characters/rize-api.png`

External API prompt summary: faithful Rize Tedeza visual-novel cutout in her Rabbit House uniform; upright reliable-senior briefing pose while indicating a star-and-ribbon invitation card, with a restrained embarrassed softness that reveals her fondness for cute decoration; no weapons, text, extra characters or watermark.

Final inspection: `1024 × 1536`, RGBA PNG with an active transparent channel. The card remains blank apart from decorative stars and ribbon; no text, watermark, weapon or extra character is present.

## `characters/chiya-syaro-api.png`

External API prompt summary: faithful Chiya Ujimatsu and Syaro Kirima visual-novel cutout; Chiya calmly presents an overly ornate blank tea-party card with a slightly mischievous smile, while Syaro answers with an animated familiar tsukkomi gesture; childhood-friend warmth rather than hostility; no text, extra characters or watermark.

Final inspection: `1024 × 1536`, RGBA PNG with an active transparent channel. Both characters read distinctly, the card is blank, and no watermark or extra character is present.

## `v2/` visual-refresh art

Generated offline with `tools/gen-art.mjs` (model `gpt-image-2.5-sunburst`; the key is read from `IMG_KEY` and never stored). The active bundle contains five backgrounds, five base character portraits, nine stickers, four paper textures, and four UI pieces. Unused Tippy portrait and cake, macaron and wreath stickers are preserved under the repository archive at `archive/assets/v2/`, outside the game build context, and are excluded from the active generation jobs. The runtime only reads these static files; scoring and progression never depend on them.

## `v2/characters/<name>-<expression>.png`

On 2026-10-16, the five active Chino sprites (`chino.png`, `chino-calm.png`, `chino-deadpan.png`, `chino-shy.png`, `chino-smile.png`) received a localized edit with the built-in image_gen tool. The owner's `materials/characters/references/提比.png` supplied the short-ear silhouette: tiny rounded triangular ears nestled into Tippy's fluffy body, about 10–15% of body height. Each original sprite was edited separately to preserve its expression, pose, clothing, framing and transparent background. The group portrait and Tippy sticker already use short ears. Prompt constraints and output paths are recorded in `materials/characters/chino-short-ears.md`; the generation scripts also constrain future Chino art to short ears.

Sixteen active expression variants were derived with `tools/gen-expressions.mjs` through the `/images/edits` endpoint, using each base portrait as the reference so outfit, hair and proportions stay consistent. `src/content/portraits.ts` maps dialogue moods to these files; unmapped moods use the base portrait. Four unreferenced variants (`rize-smile`, `chiya-dreamy`, `chiya-serious` and `syaro-blush`) are preserved under `archive/assets/v2/characters/` and excluded from the active generation jobs.

`v2/characters/syaro*.png` were redrawn from an official Fleur de Lapin character sheet supplied by the project owner (kept outside the build context at `materials/characters/references/纱路.png`) via `/images/edits`. Chiya's base and expressions were likewise regenerated in her Ama Usa An kimono.
