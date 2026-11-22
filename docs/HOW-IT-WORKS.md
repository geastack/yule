# How Yule works

The short version is in the [README](../README.md). This is the long one:
what each globe does, how the water and the snow move, how the pictures and
songs get onto the board, and what it took to keep it fast in TypeScript.

## What is alive in each globe

Every globe has the same water, snow, wind, glint on the glass, and stars
and shooting stars wherever its sky is open dark blue. What else lives in
it is traced by hand from its painting in `art/globes/<id>.json` (source
pixels; check one with `node scripts/overlay.mjs <id> out.png`):

- **Solids**: buildings, trees, figures and vehicles, each an outline with
  a depth, so snow passes behind them and lands on their roofs and
  branches.
- **Warm lights**: windows, lanterns, campfires and lamps, the fires first
  (they flicker); windows with glass now and then go dark for a few
  seconds; one lamp may stutter like an old bulb, cooling its pool of
  light on the snow.
- **Bulbs**: found in boxes over each tree's lights, carousel rim, Ferris
  wheel or arch, and changing pattern every 20-30 s (twinkle, a chase, a
  slow fade).
- **Chimney smoke** or steam where it is painted, and **swaying** trees in
  the wind.

Yule (the first) is built into the firmware; the other 26 are read from the
microSD card and switched in place. The paintings were generated with GPT
Image 2.5 (the first ten) and gpt-image-2 (the sixteen figurine scenes) as
square scenes and composited into Yule's glass and base
([`scripts/compose.mjs`](../scripts/compose.mjs): the scene follows the
curve where the snow meets the walnut rim, with a soft edge, a contact
shadow, a dark groove line and a faint highlight on the glass's lip).

## Interaction in detail

- **Gravity** is the accelerometer's slow part carried round by the gyro,
  as a full 3D direction. Tilt the board and every flake drifts slowly
  through the water to the low side; upside down it falls to the top of the
  glass; lying flat (gravity into the screen) it settles against the back
  glass and what has landed stays put. A slow turn changes only gravity: it
  never counts as a shake.
- **Shake**: only the glass's own jolt (the accelerometer less gravity) and
  fast twists stir the water, in proportion to their force: a gentle shake
  lifts a little loose snow, a hard one nearly all of it, thrown anywhere up
  to the glass. Falling snow also feels the jolt (effective gravity is
  g - a), so it lags behind the glass. When the hand stops, the water keeps
  its momentum and the snow tumbles down in its own time. The picture itself
  never moves.
- **Landed snow** lets go when the slope under it passes its own grip angle
  (20-35°): snow on the ground and roofs reads only the tilt across the
  screen, snow on the glass the full 3D direction. Freed snow slides and
  falls to the new low side and heaps against the glass around it.
- **Turn** (twist fast): the water by the glass catches up in about a
  second and the core in about 4 s, so a fast twist shears the snow cloud.
- **Drag**: turns the water with your finger. **Tap**: a small whirlpool.
- **Swipe**: a quick, mostly sideways flick (at least 70 px within 450 ms,
  more than twice as wide as tall) shows the next globe (to the left) or the
  previous one; anything slower is a drag.
- **Boot and switching**: a globe starts with its snow spread through the
  water, falling.
- **Wind**: a light breeze drifts the snow and the smoke. Every 8-20 s a gust
  builds over half a second, holds 1-2 s and dies away over 2-3 s: the water
  picks up a broad current (rolling back underneath) and churns, loose snow
  sprays off the windward side of the ground and roofs, the smoke lies nearly
  flat, and the pines and the Christmas tree bend, then rock back with a
  little overshoot. Settings turns it off.
- **Lights**: the street lamp is steady, but every 20-60 s it stutters like
  an old bulb (2-4 quick dips, sometimes nearly off, its pool on the snow
  cooling with it). A fire flickers behind the living-room and dormer
  windows, and about once a minute a window goes dark for a few seconds. The
  tree's bulbs change pattern every 20-30 s: twinkling, a chase up the tree,
  a slow fade together.
- **Stars**: the painted stars twinkle, and every 15-40 s a shooting star
  crosses the open sky on a shallow slant with a fading tail (sometimes a
  fainter, shorter one), hidden behind the house and trees and clipped to the
  glass. Never two at once.
- **Dev triggers**: hold still for 0.7 s on the wooden base for a gust
  (`gea devctl tap 205 450 900`), on Yule's street lamp for a stutter
  (`gea devctl tap 64 202 900`), on the sky for a shooting star
  (`gea devctl tap 205 80 900`), anywhere else in the glass for a hard shake
  (`gea devctl tap 205 250 900`).

## The microSD card in detail

```sh
node scripts/bake.mjs                       # globes -> .gea/sd/yule/globes
node scripts/music.mjs <folder of .raw songs>  # songs -> .gea/sd/yule/music
sh scripts/push.sh                           # both onto the card over USB
```

The songs are 16 kHz mono 16-bit raw samples (about 47 MB for 26 minutes),
stored as 2 MiB parts (`<song>.raw.0`, `.1`...): the board takes a pushed
file whole into PSRAM, and anything over about 3 MB fails with `no-memory`.
Push with the menu open and music off: the display's periodic perf log lines
(`[flush.split]`) and the audio thread's can land in the middle of the
board's `GEADEV:PUSH READY` reply, the CLI then misses it and times out, and
the board sits waiting for the file's bytes (it swallows the next commands
as payload, then gives up). `music/tracks.json` lists each song's source page
and licence.

## How it is built

| File | Role |
| --- | --- |
| [`scripts/compose.mjs`](../scripts/compose.mjs) | Composites a square scene painting into the glass of `art/backdrop.png`: `art/globes/<id>.jpg` |
| `art/globes/<id>.json` | Each globe's life, in source pixels of its painting: solids (outline, depth, landing), warm lights (fires first), window glass, the stuttering lamp and its pool, the chimney, swaying parts, and boxes its bulbs are found in |
| [`scripts/overlay.mjs`](../scripts/overlay.mjs) | Draws a globe's JSON over its painting, to check the tracing by eye |
| [`scripts/bake.mjs`](../scripts/bake.mjs) | Fits each globe to the panel, error-diffuses it to RGB565 (no banding in the night sky), finds its bulbs; writes Yule's window to `src/data/backdrop.ts`, the others to `.gea/sd/yule/globes`, the globes and bulbs to `src/data/globes.ts`, and the base to `public/art/base.png` |
| [`scripts/music.mjs`](../scripts/music.mjs), [`scripts/push.sh`](../scripts/push.sh) | Stage the songs and copy everything onto the card |
| `src/lib/globes.ts` | What a globe is, and the 27 in menu order |
| `src/navigation.ts`, `src/screens/menu.tsx`, `src/stores/` | The menu, playlist and settings pages; settings kept in `localStorage` |
| `src/lib/yule.ts` | The frame loop, touch, and the present |
| `src/lib/motion.ts` | Accelerometer and gyro to scene-down, jolt and how fast the glass turns |
| `src/lib/water.ts` | The water: two-layer spin, whirlpools, eddy waves, and what stirs them |
| `src/lib/snow.ts` | 1,200 flakes in Q12 fixed point, each with its own fall, lag, glide, rock, wander and glint |
| `src/lib/scene.ts` | A globe's solids and the base: occlusion depths and the landing height map |
| `src/lib/painter.ts` | Soft sub-pixel sprites, blended or added into the frame; puts back only what the last frame touched |
| `src/lib/lights.ts` | Bulb patterns, window fires and blackouts, the lamp's stutter, the glint on the glass |
| `src/lib/smoke.ts` | Chimney smoke, carried by the water and the wind |
| `src/lib/wind.ts` | The breeze and the gusts |
| `src/lib/stars.ts` | The open-sky mask, twinkling painted stars, shooting stars |
| `src/lib/sway.ts` | Trees bending in the wind: springs that shear their pixels in the settled picture |
| `src/lib/music.ts`, `src/lib/player.worklet.ts` | The playlist: the music box synthesised on the audio thread, or a song streamed from the card a chunk at a time |

**The picture.** Only the globe's window (374x378) is a live frame; the base
below it is a static asset. Each frame starts with an opaque `clear()` so the
display diffs frames and sends only the window.

**The water** (relative to the glass, units of the globe's radius) is the
sum of three parts, none of them shared by every flake alike:
- a spin in two layers: the water by the glass catches up with the glass in
  ~2.5 s, the core with that layer in ~8 s, and a flake's spin blends from
  the core's to the wall's by its distance from the centre;
- up to four whirlpools that turns and jolts shed, each with its own place,
  axis, core (0.25-0.4) and life (4-8 s), drifting with the spin. Each is
  Γ·core²·(axis × d)/(|d|² + core²)², which dies off as 1/d³, so it stays a
  local swirl and never drags the whole globe one way;
- four eddy waves at two sizes (0.6 and 0.3 of the radius), each flowing
  across its own direction and drifting its own way, stirred by turns and
  jolts and dying over ~7 s.

Near the glass and just above the ground and roofs, the part of the flow
going into them fades out, so the water slides along them instead of
pouring snow onto them.

**Each flake** sinks along effective gravity at its own speed (lognormal:
median 0.11 radii/s, ~5x between slowest and fastest, bigger flakes
faster), its own lag behind the water (0.02-0.12 s), a tilt that glides it sideways (some spiralling),
a rock that makes it sink fastest mid-swing, and a slow random walk of its
own. Matte flakes shimmer, dimmer edge-on; one in seven is glitter and
flashes as it turns.

Flakes slide along the glass without bouncing and land on a 40x40 height map
of the ground and each globe's roofs, trees and figures where the water there
is slow and the slope is within their grip, or on the glass where it is
level enough for them (each its own 25-63°, so snow heaps round the low
point). Snow on the ground and roofs is no longer drawn: the painting already
has its snow. Resting flakes are looked at a quarter at a time, only while
the water is stirred or for half a second after down turns.

Flakes are 1,200 small plastic chips, as a real globe's snow is, drawn with a
little perspective (offsets grow by 1/(1 - 0.2z)): far ones as 2 x 2 dots,
most as 2-px chips splatted over 3 x 3 pixels at sub-pixel positions, the
nearest as soft sprites up to ~6 px. Each turns as it sinks: edge-on it is a
thin dim sliver, face-on a round bright chip; one in seven is glitter and
flashes. Resting chips stop turning. A flake behind anything traced in the
painting is hidden by a per-pixel depth map.

**The trees** sway without any 3D: each part (the pines on either side, the
Christmas tree) is a damped spring, and its pixels are sheared sideways in
the settled picture, none at the base and up to 2 px at the top. Only rows
whose shift changed are rewritten, and the tree's bulbs move with it.

**Songs** stream from the card an 8 KB chunk at a time, about a second
ahead of the player, which reports how far it has played; at the end of a
song the next one starts, and the playlist loops.

**The music box** renders each pitch once into a 16-bit table: a plucked tine
is three inharmonic partials (1, 2, 5.4x), each a damped integer resonator,
plus a click. Playing is only mixing table reads. Shaking winds the spring;
the tune slows as it unwinds and stops when it runs down. "Silent Night"
(Gruber, 1818) is public domain.

**Fast TypeScript.** On this compiler (core 0.1.41):
- `f32` annotations still compile to software doubles, and the ESP32-S3 has
  no double-precision FPU, so the flakes are fixed point and per-pixel work
  is integer.
- A loop counted with a plain `number` and indexing typed arrays by it gets
  unchecked array access, but setting that up costs ~400 cycles per array
  each time the loop starts. So the flake loop has no inner loops (the
  whirlpools and waves are written out) and calls nothing, the small dots are
  drawn inline, and small per-sprite loops count with `i32` instead.
- In a hot loop, a single function call (`Math.min` included) or inner
  loop costs every array access its fast path, so the flake loops are
  written out and the few big sprites are blended in a second loop.
- The accelerometer and gyro are read every frame (each value is a separate
  I2C read of about 0.6 ms), and the gyro's resting offset is learned and
  subtracted.

## Frame rate and memory

PRODFPS amoled (410x502): 25-27 with the snow settled (wind, lights, smoke,
stars and glint live, a song streaming from the card); 16-18 during a gust;
about 11 right after a hard shake or a globe switch with all 1,200 flakes
in the water. Drawing that many chips into the frame (in PSRAM) costs about
28 ms; after a busy frame the window is restored in one copy (about 17 ms)
rather than thousands of patches.

The present passes constant positions: with variable ones (even 0) the
display re-sends the whole panel every frame.

The present takes about 11 ms of each frame (the 374x378 window, flushed in
20-row chunks). `@geastack/core` 0.1.41 byte-swaps every `putImageData` into
a staging copy before the panel transfer; core 0.1.53 adds zero-copy panel
buffers (`panelBufferCount`, `acquirePanelBuffer`), which remove that copy.

**Internal RAM.** The board has about 200 KB of it, and three things here
need some: the display's flush pool (`flushPoolBytes`, 32 KB), a 10 KB task
the runtime makes on the first card read, and the speaker's DMA buffers. With
the earlier 128 KB pool the first card read aborted the app and the speaker
could not start. The audio thread is only made once music is switched on.

**Switching globes** takes about 0.37 s, most of it reading the 282 KB
picture from the card. Everything every globe shares (the base and the glass
mask in the depth map, the light sprites) is built once at boot, and the star
search runs in 32-bit integers; rebuilt each time in soft doubles it took
2.4 s, long enough to drain the song's queue. Songs keep 1.5 s queued.
